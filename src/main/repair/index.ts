// Check and repair (step 3 of the consistency plan, Adam, 2026-10-07; contracts/repair.ts). Straight after new AI
// words land in a scene (a draft, Add below, a beat, Continue, a polished draft Adam accepted), the page sends them
// here, and they are checked claim by claim against:
//   - where things stand just before them: the very stage the writer was told (noteStage, kept by record as each
//     draft, beat or Continue starts, from the live stage's checkpoints in continuity/tracker.ts), so no extra call;
//   - the memory as of the scene's start (checks/context.ts): who knows what, injuries, what people own, who is dead,
//     and the scenes just before.
// One call on the memory model (with its own Thinking, Off unless Adam changes it). The page mends the small slips
// (repairsApplied tells which it could) and the rest are asked as questions in the Issues tab. No Electron imports.

import type Database from 'better-sqlite3'
import type { RepairFix, RepairInput, RepairOutcome } from '@shared/contracts/repair'
import type { CheckKind, IssueSource } from '@shared/contracts/checks'
import { ALL_CHECKS } from '@shared/contracts/checks'
import type { ID, Settings, WritingPrefs } from '@shared/types'
import type { SceneState } from '@shared/continuity'
import { toldStage, type ContextInput } from '../ai/context'
import * as cdb from '../db/checks'
import * as gens from '../db/generations'
import { callModel, type MemoryModel } from '../keeper/model'
import { gatherSceneCheck, type SceneCheckContext } from '../checks/context'
import { issueKey, KIND_OF_CHECK, occurrenceAt } from '../checks/quote'
import { findQuote } from '../keeper/text'
import { newId } from '../util'
import { judgeClaims, newWordsOf, readClaims, type Claim, type FoundFix, type FoundQuestion } from './claims'
import { codexLines, REPAIR_MARKER, repairRequest, stageLines, type CodexLine, type StageLine } from './prompts'

type DB = Database.Database

// ---------- The stage each landing is checked against ----------

/** The stage each draft, beat or Continue was written from, by its record: exactly what the writer was told. */
const stages = new Map<ID, { sceneId: ID; stage: SceneState | null }>()
const MOST_STAGES = 40

/** Keeps where things stood when the AI's words were asked for (null: not known, so nothing on the stage is mended). */
export function noteStage(recordId: ID, sceneId: ID, stage: SceneState | null): void {
  stages.delete(recordId)
  stages.set(recordId, { sceneId, stage })
  while (stages.size > MOST_STAGES) stages.delete(stages.keys().next().value!)
}

/**
 * Where things stood as a draft's or a beat's writer was told it: the end of the scene so far for one that carries on
 * from it (`soFar`; nothing when that couldn't be worked out in time), else where the scene starts. Only the people in
 * the scene and a time that still holds (ai/context.ts toldStage), so no W line is about someone from another scene.
 */
export const stageTold = (
  b: { input: Pick<ContextInput, 'scene' | 'memory' | 'continuity' | 'continuityAtSoFar' | 'options' | 'soFar'> },
  soFar: boolean
): SceneState | null => (soFar && !b.input.continuityAtSoFar ? null : toldStage(b.input))

/**
 * Where things stood just before the new words, as noted when they were asked for. Null when that isn't known (then
 * nothing on the stage is mended; the memory's facts are still checked).
 */
function stageAt(input: RepairInput): SceneState | null {
  const noted = stages.get(input.stageOf ?? input.recordId) ?? stages.get(input.recordId)
  return noted && noted.sceneId === input.sceneId ? noted.stage : null
}

// ---------- What the critic leaves to the repair ----------

/**
 * Each landing's check, by the record of its words (the draft's or beat's): `covered` is null while it runs, then the
 * checks it covered (none when it failed). The critic after a draft asks (criticChecks).
 */
interface Checked {
  done: Promise<void>
  covered: CheckKind[] | null
}
const checked = new Map<ID, Checked>()
const MOST_CHECKED = 60

/**
 * The checks a landing's claims cover: continuity when there was a stage to compare with (W lines), who knows what when
 * the memory listed any (K lines), the timeline when there were scenes before (S lines). Facts, voices and style are
 * always the critic's.
 */
export function coveredBy(stage: StageLine[], codex: CodexLine[]): CheckKind[] {
  const out: CheckKind[] = []
  if (stage.length) out.push('continuity')
  if (codex.some((l) => l.kind === 'knows')) out.push('knowledge')
  if (codex.some((l) => l.kind === 'scene')) out.push('timeline')
  return out
}

/** How long the critic waits for a landing's check that is still running before checking everything itself. */
export const CRITIC_WAIT_MS = 60_000

const within = (p: Promise<unknown>, ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms)
    void p.finally(() => {
      clearTimeout(t)
      resolve()
    })
  })

/**
 * The checks the critic runs after the drafts with these records (more than one when drafts landed in a row before it
 * ran): all six, less what every one of their landings' checks covered and finished. A check still running is waited
 * for, at most `waitMs`; one that failed, ran out of time or never ran (switched off, Adam in another scene) covers
 * nothing, so the critic checks it all, as before.
 */
export async function criticChecks(recordIds: ID[], waitMs = CRITIC_WAIT_MS): Promise<CheckKind[]> {
  let covered: CheckKind[] | null = null
  for (const id of recordIds) {
    const c = checked.get(id)
    if (c && c.covered === null) await within(c.done, waitMs)
    const kinds = checked.get(id)?.covered ?? []
    covered = covered === null ? kinds : covered.filter((k) => kinds.includes(k))
  }
  return ALL_CHECKS.filter((k) => !(covered ?? []).includes(k))
}

/**
 * Whether new words are checked as they land: Adam's switch (Settings › Models, "Check new words straight away", on
 * by default), except that AIWRITE_REPAIR=off always turns it off (app tests that aren't about it).
 */
export const repairWanted = (settings: Partial<Pick<Settings, 'checkNewWords'>>, env: Record<string, string | undefined> = process.env): boolean =>
  env.AIWRITE_REPAIR !== 'off' && settings.checkNewWords !== false

// ---------- Checking ----------

export interface RepairOptions {
  db: DB
  model: MemoryModel
  prefs: WritingPrefs
  closed: () => boolean
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  retryDelays?: number[]
}

/** What a check found that the page is still to mend, by repair id, until it says which it could. */
interface Pending {
  db: DB
  sceneId: ID
  storyId: ID
  fixes: { fix: RepairFix; issue: cdb.FoundIssue }[]
}
const pending = new Map<ID, Pending>()
const MOST_PENDING = 20

const NOTHING: RepairOutcome = { repairId: null, fixes: [], questions: 0, claims: 0, slips: 0 }
/** The most of the words before the new ones told as a lead-in. */
const LEAD_IN = 1_500
/** Room for the reply. */
const REPLY_TOKENS = 2_500
/** How many of a scene's checks keep their whole prompt for What the AI saw; older ones keep their cost and reply. */
export const KEEP_PROMPTS = 10

/** The input as the page sent it, made safe. */
function cleanInput(input: RepairInput): RepairInput {
  const paragraphs = (Array.isArray(input?.paragraphs) ? input.paragraphs : [])
    .slice(0, 400)
    .filter((p) => p && typeof p.text === 'string')
    .map((p) => {
      const text = p.text.slice(0, 20_000)
      const from = Math.max(0, Math.min(text.length, Math.floor(Number(p.from) || 0)))
      const to = Math.max(from, Math.min(text.length, Math.floor(Number(p.to ?? text.length))))
      return { text, from, to, ...(p.edited ? { edited: true } : {}) }
    })
    .filter((p) => p.text.slice(p.from, p.to).trim())
  return {
    sceneId: String(input?.sceneId ?? ''),
    recordId: String(input?.recordId ?? ''),
    ...(input?.stageOf ? { stageOf: String(input.stageOf) } : {}),
    paragraphs,
    leadIn: typeof input?.leadIn === 'string' ? input.leadIn.slice(-LEAD_IN) : '',
    beforeChars: Math.max(0, Math.floor(Number(input?.beforeChars) || 0))
  }
}

/**
 * Where a quote of the new words is in the scene's text: the first time it appears at or after `near` (the new words'
 * place in the scene), so a question on words that also appear earlier (in Adam's words, say) is about the new ones.
 */
export function placeInScene(text: string, quote: string, near: number): number {
  const from = Math.max(0, Math.min(near, text.length))
  const r = findQuote(text.slice(from), quote)
  if (r) return from + r.start
  return findQuote(text, quote)?.start ?? -1
}

/** The scene card in a few lines: when, where, whose point of view, who is there. */
function cardText(ctx: SceneCheckContext): string {
  const name = (id: ID | null | undefined): string => (id ? (ctx.entries.find((c) => c.entry.id === id)?.entry.name ?? '') : '')
  const card = ctx.card
  return [
    card.when?.trim() ? `When: ${card.when.trim()}` : '',
    name(card.locationId) ? `Where: ${name(card.locationId)}` : '',
    name(card.povId) ? `Point of view: ${name(card.povId)}` : '',
    card.presentIds?.length ? `Present: ${card.presentIds.map(name).filter(Boolean).join(', ')}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

/** The check a claim's line stands for, for the issue's kind and key. */
function checkOf(code: string): CheckKind {
  return code.startsWith('W') ? 'continuity' : code.startsWith('K') ? 'knowledge' : code.startsWith('S') ? 'timeline' : 'facts'
}

/** What a claim's line links to in the Issues tab. */
function sourcesOf(code: string, codex: CodexLine[]): IssueSource[] {
  const l = codex.find((x) => x.code === code)
  if (l?.kind === 'scene' && l.sceneId) return [{ kind: 'scene', sceneId: l.sceneId, label: l.label }]
  if ((l?.kind === 'entry' || l?.kind === 'dead' || l?.kind === 'owns') && l.entryId) return [{ kind: 'entry', entryId: l.entryId, name: l.label, field: null }]
  return []
}

/** One finding as an issue: a fixed slip (its words as the AI wrote them) or a question. */
function asIssue(
  ctx: { sceneId: ID; storyId: ID; text: string; codex: CodexLine[]; stage: StageLine[]; base: number },
  c: Claim,
  quote: string,
  start: number,
  message: string,
  fix: string | null
): cdb.FoundIssue {
  const check = checkOf(c.line)
  const who = c.who.trim().toLowerCase() || ctx.stage.find((l) => l.code === c.line)?.who?.toLowerCase() || ''
  // Which of the quote's places in the scene: the new words', never an earlier one (`start` is its place in them).
  const at = placeInScene(ctx.text, quote, ctx.base + start)
  return {
    sceneId: ctx.sceneId,
    storyId: ctx.storyId,
    kind: KIND_OF_CHECK[check],
    severity: 'warning',
    quote,
    message,
    key: issueKey(check, who, quote),
    payload: {
      by: 'check',
      check,
      sources: sourcesOf(c.line, ctx.codex),
      fix,
      memoryFix: null,
      ...(at >= 0 ? { occurrence: occurrenceAt(ctx.text, quote, at) } : {})
    }
  }
}

/**
 * Checks new words claim by claim (see the top of this file). Questions are raised at once; the fixes go back to the
 * page to mend, and are kept as issues once it says which it could. Never throws for a model problem: nothing found.
 */
export async function checkNewWords(o: RepairOptions, raw: RepairInput): Promise<RepairOutcome> {
  const input = cleanInput(raw)
  const newWords = newWordsOf(input.paragraphs)
  if (!input.sceneId || !input.recordId || newWords.split(/\s+/).filter(Boolean).length < 3) return NOTHING
  let ctx: SceneCheckContext
  try {
    ctx = gatherSceneCheck(o.db, input.sceneId, o.prefs)
  } catch {
    return NOTHING
  }
  // The record of the AI's words: only words in it are ever mended.
  let aiText = ''
  try {
    aiText = gens.getGeneration(o.db, input.recordId).response ?? ''
  } catch {
    aiText = ''
  }
  const stage = stageLines(stageAt(input), input.sceneId)
  const codex = codexLines(ctx, newWords)
  // The critic after the draft waits for this check, and leaves out what it covered once it has (criticChecks).
  let settle!: () => void
  const entry: Checked = { done: new Promise<void>((r) => (settle = r)), covered: null }
  checked.delete(input.recordId)
  checked.set(input.recordId, entry)
  while (checked.size > MOST_CHECKED) checked.delete(checked.keys().next().value!)
  try {
    const out = await checkWith(o, input, ctx, aiText, stage, codex, newWords)
    if (out.repairId) entry.covered = coveredBy(stage, codex.lines)
    return out
  } finally {
    entry.covered ??= []
    settle()
  }
}

/** The call and what comes of it, for checkNewWords. */
async function checkWith(
  o: RepairOptions,
  input: RepairInput,
  ctx: SceneCheckContext,
  aiText: string,
  stage: StageLine[],
  codex: ReturnType<typeof codexLines>,
  newWords: string
): Promise<RepairOutcome> {
  const req = repairRequest({ stage, codex, card: cardText(ctx), leadIn: input.leadIn, newWords })
  const versions = new Map(ctx.entries.map((c) => [c.entry.id, c.entry.updatedAt]))
  const got = await callModel({
    db: o.db,
    model: o.model,
    targetId: input.sceneId,
    job: 'memory',
    messages: req.messages,
    blocks: req.blocks,
    entries: req.entryIds.map((id) => ({ entryId: id, version: versions.get(id) ?? '' })),
    maxTokens: REPLY_TOKENS,
    signal: o.signal ?? new AbortController().signal,
    closed: o.closed,
    fetchImpl: o.fetchImpl,
    retryDelays: o.retryDelays
  })
  // Only the newest few checks of a scene keep their whole prompt (each holds the scene's facts and the new words).
  try {
    if (o.db.open) gens.forgetOldPrompts(o.db, input.sceneId, REPAIR_MARKER, KEEP_PROMPTS)
  } catch (e) {
    console.warn('Could not let go of older check prompts', e)
  }
  // Not checked after all (stopped, failed, or a reply that can't be read): the critic checks it all, as before.
  if (got.status !== 'complete' || o.closed() || !o.db.open) return NOTHING
  const claims = readClaims(got.text)
  if (!claims) return NOTHING
  const judged = judgeClaims(claims, { stage, codex: codex.lines, paragraphs: input.paragraphs, aiText, leadIn: input.leadIn })
  const where = {
    sceneId: input.sceneId,
    storyId: ctx.storyId,
    text: cdb.sceneTexts(o.db, [input.sceneId]).get(input.sceneId) ?? ctx.text,
    codex: codex.lines,
    stage,
    base: input.beforeChars ?? 0
  }
  // Anything Adam said is meant to be so (ignored) is neither mended nor asked again.
  const rows = cdb.rowsInScenes(o.db, [input.sceneId])
  const ignored = (f: cdb.FoundIssue): boolean => rows.some((r) => r.status === 'ignored' && cdb.sameThing({ ...f.payload, key: f.key }, r, f))

  const questions = judged.questions.map((q: FoundQuestion) => asIssue(where, q.claim, q.quote, q.start, q.message, q.fix)).filter((f) => !ignored(f))
  const raised = questions.length ? cdb.saveFound(o.db, rows, questions, () => false) : 0
  const fixes = judged.fixes
    .map((f: FoundFix) => {
      const fix: RepairFix = { id: newId(), para: f.para, start: f.start, end: f.end, was: f.was, now: f.now, why: f.claim.why || 'This didn’t match where things stood.' }
      const rewrite = f.quote.includes(f.was) ? f.quote.replace(f.was, f.now) : f.now
      return { fix, issue: asIssue(where, f.claim, f.quote, f.quoteStart, fix.why, rewrite) }
    })
    .filter((x) => !ignored(x.issue))
  const repairId = newId()
  if (fixes.length) {
    pending.set(repairId, { db: o.db, sceneId: input.sceneId, storyId: ctx.storyId, fixes })
    while (pending.size > MOST_PENDING) pending.delete(pending.keys().next().value!)
  }
  return { repairId, fixes: fixes.map((x) => x.fix), questions: raised, claims: judged.claims, slips: judged.slips }
}

/**
 * Checks new words when Adam wants it (`repairWanted`: his switch, and AIWRITE_REPAIR); otherwise nothing is asked,
 * nothing is found, and the critic after a draft checks it all, as before.
 */
export async function checkIfWanted(
  o: RepairOptions,
  input: RepairInput,
  settings: Partial<Pick<Settings, 'checkNewWords'>>,
  env: Record<string, string | undefined> = process.env
): Promise<RepairOutcome> {
  return repairWanted(settings, env) ? checkNewWords(o, input) : NOTHING
}

/**
 * The page mended `applied` (fix ids) and couldn't mend the rest (Adam was in those words): the mended ones are kept
 * as fixed issues (so Undo can say "not again"), the rest are asked as questions with the fix to review. Returns each
 * mended fix's issue id.
 */
export function repairsApplied(repairId: ID, applied: ID[]): Record<ID, ID> {
  const p = pending.get(repairId)
  pending.delete(repairId)
  if (!p || !p.db.open) return {}
  const made = new Set(Array.isArray(applied) ? applied.map(String) : [])
  const asked = p.fixes.filter((x) => !made.has(x.fix.id)).map((x) => ({ ...x.issue, message: questionText(x.fix.why) }))
  const rows = cdb.rowsInScenes(p.db, [p.sceneId])
  if (asked.length) cdb.saveFound(p.db, rows, asked, () => false)
  const out: Record<ID, ID> = {}
  for (const x of p.fixes) {
    if (!made.has(x.fix.id)) continue
    const id = cdb.saveFixed(p.db, x.issue)
    if (id) out[x.fix.id] = id
  }
  return out
}

/** A slip the page couldn't mend, as a question. */
const questionText = (why: string): string => `${why.trim().replace(/[.!?]?$/, '.')} Use the fix, or keep it as it is?`

/** For tests: forget the stages, the repairs waiting for the page and when each scene was last repaired. */
export function resetRepairsForTests(): void {
  stages.clear()
  pending.clear()
  checked.clear()
}
