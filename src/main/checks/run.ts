// One AI consistency check of one scene (milestone 5, AI checks): gathers the memory as of the scene's
// start (context.ts), asks the consistency check model once for every check asked for (cost matters), in
// parts that fit a small model when the scene is long, reads the reply (parse.ts: a malformed reply is asked
// for once more, saying what was wrong, as the memory keeper does; one cut off by the reply limit is asked
// again in two halves), and saves what it found in one go, replacing what the same checks found there
// before. Each request is a 'check' generation record made by the shared task runner, so "What the AI saw"
// works for it. Never writes once stopped by the world closing. With the scene's contract (long story memory fix 13:
// the chapter writer's checks of the scenes it drafted), the first request goes through it item by item as well, as
// check and repair does when a draft lands (repair/contract.ts): no more requests. No Electron imports.

import type Database from 'better-sqlite3'
import type { CheckKind, CheckReport } from '@shared/contracts/checks'
import type { ChatMessage, Entry, EntryState, ID, WritingPrefs } from '@shared/types'
import * as repo from '../db/repo'
import { runTask, type Emit } from '../ai/tasks'
import type { JobModel } from '../ai/jobModel'
import * as cdb from '../db/checks'
import { CUT_OFF } from '../keeper/json'
import { estimateTokens, plain } from '../keeper/text'
import { fieldOrigin, fieldValue } from '../keeper/facts'
import { newId, UserError } from '../util'
import { checkRequest, checkSections, gatherSceneCheck, splitScene, type SceneCheckContext } from './context'
import { foundIssues, orderedChecks, readCheckReply, type ReadContext } from './parse'
import { retryMessage, sceneSystem } from './prompts'
import { reportItems, saveReport } from './report'
import { ruleChecksQuietly } from './ruleChecks'
import { findSceneQuote, issueKey, KIND_OF_CHECK, occurrenceAt } from './quote'
import type { ContractCheck } from '@shared/contracts/checks'
import type { SceneContract } from '../ai/contract'
import {
  contractResults,
  contractSection,
  contractSources,
  judgeContract,
  mergeAnswers,
  notYetIssue,
  readContractAnswers,
  type ContractAnswer
} from '../repair/contract'
import { now } from '../util'

type DB = Database.Database

/** The checks asked together in one request: what is so, then who knows what and how it reads. */
export const CHECK_GROUPS: CheckKind[][] = [
  ['facts', 'timeline', 'continuity'],
  ['knowledge', 'voice', 'style']
]

/** Low creativity: the check reports, it doesn't invent. */
export const CHECK_TEMPERATURE = 0.2
/** Context length assumed when the model's is unknown. */
const DEFAULT_CONTEXT = 16_000
/** How many times one scene's check may split a part whose reply ran past the reply limit. */
const MAX_SPLITS = 8

export interface CheckOptions {
  db: DB
  model: JobModel
  prefs: WritingPrefs
  /** True once the check should stop (Stop, or the world closing). */
  stopped: () => boolean
  /** True once the world has closed: nothing more is written. */
  closed?: () => boolean
  /** Told each request's task id as it starts, so Stop can stop it. */
  onTask?: (taskId: ID | null) => void
  onKeyRejected?: () => void
  /** Why the scene is checked, for its report (the critic's, in the Issues tab): 'request' when left out. */
  after?: CheckReport['after']
  /**
   * The scene's contract its draft was written to (long story memory fix 13): the chapter writer's checks go through it
   * too, in the first request. Null or left out: no contract, as before.
   */
  contract?: SceneContract | null
  fetchImpl?: typeof fetch
  retryDelays?: number[]
}

export type SceneOutcome =
  | { status: 'done'; found: number }
  | { status: 'empty' }
  | { status: 'stopped'; found: number }
  | { status: 'error'; error: string; found: number }

/** Room for the reply, and for the scene's text in one request, for this model. */
export function checkBudget(model: Pick<JobModel, 'choice'>, system: string): { reply: number; available: number } {
  const contextLength = model.choice.contextLength && model.choice.contextLength > 0 ? model.choice.contextLength : DEFAULT_CONTEXT
  let reply = Math.max(800, Math.min(3000, Math.floor(contextLength * 0.15)))
  if (model.choice.maxOutput && model.choice.maxOutput > 0) reply = Math.min(reply, model.choice.maxOutput)
  return { reply, available: Math.floor(contextLength * 0.9) - reply - estimateTokens(system) }
}

/** A field is Adam's when he wrote it (as the memory keeper decides it). */
export const adamsField = (e: Entry, field: string): boolean =>
  e.fieldOrigins?.[field] === 'adam' || (fieldOrigin(e, field) === 'adam' && fieldValue(e, field).trim() !== '')

/**
 * True when "Update the memory" may set an entry's field from the text: the field is Adam's own, and no
 * earlier scene's change has set it, so what the memory says at this scene is his note itself.
 */
export function canUpdateField(db: DB, state: EntryState, field: string): boolean {
  if ((state.changed ?? []).includes(field)) return false
  let base: Entry
  try {
    base = repo.getEntry(db, state.id)
  } catch {
    return false
  }
  return adamsField(base, field) && plain(fieldValue(state, field)) === plain(fieldValue(base, field))
}

/** Events from the task runner aren't for the window: the check says how it goes itself. */
const quiet: Emit = () => undefined

/** Checks one scene with these checks and saves what was found. Never throws once started. */
export async function checkScene(o: CheckOptions, sceneId: ID, asked: CheckKind[]): Promise<SceneOutcome> {
  const checks = orderedChecks(asked)
  let ctx: SceneCheckContext
  try {
    ctx = gatherSceneCheck(o.db, sceneId, o.prefs)
  } catch (e) {
    if (e instanceof UserError) return { status: 'error', error: e.message, found: 0 }
    throw e
  }
  if (!ctx.text.trim()) return { status: 'empty' }

  const read: ReadContext = {
    sceneId,
    storyId: ctx.storyId,
    text: ctx.text,
    checks,
    entries: new Map(ctx.entries.map((c) => [c.code, c.entry])),
    scenes: new Map(ctx.earlier.map((s) => [s.code, { sceneId: s.sceneId, label: s.label }])),
    canUpdateMemory: (entryId, field) => {
      const e = ctx.entries.find((c) => c.entry.id === entryId)?.entry
      return !!e && canUpdateField(o.db, e, field)
    }
  }
  const versions = new Map(ctx.entries.map((c) => [c.entry.id, c.entry.updatedAt]))
  const items: Record<string, unknown>[] = []
  // What each check looked at and found good, from every part (the critic's report).
  const checked: Record<string, unknown>[] = []
  let splits = 0
  let failure: string | null = null
  let stopped = false
  // A reply read only in part can't say what is no longer there.
  let partial = false

  // The checks in two focused requests (a live run found one request for all six spread the model thin and missed
  // plain contradictions): what is so (facts, timeline, continuity), then who knows what and how it reads.
  const groups = CHECK_GROUPS.map((g) => checks.filter((c) => g.includes(c))).filter((g) => g.length)
  // The scene's contract (fix 13) rides in the request about what is so (or the only one), item by item.
  const contract = o.contract?.items.length ? o.contract : null
  const contractGroup = contract ? (groups.find((g) => g.includes('facts')) ?? groups[0]) : null
  const answers: ContractAnswer[][] = []
  for (const group of groups) {
    if (stopped || failure) break
    const withContract = group === contractGroup
    const system = sceneSystem(group, withContract)
    const budget = checkBudget(o.model, system)
    const terms = withContract && contract ? [contractSection(contract).section] : []
    let sections = [...checkSections(ctx, group), ...terms]
    const size = (s: typeof sections): number => s.reduce((n, x) => n + estimateTokens(x.text) + 8, 0)
    // A big memory leaves too little room for the scene: its entries are told in a line each.
    if (size(sections) > budget.available * 0.6) sections = [...checkSections(ctx, group, true), ...terms]
    const room = budget.available - size(sections)
    if (room < 250) {
      return {
        status: 'error',
        error: 'This is more than the consistency check model can read at once. Pick a model that can read more in Settings › Models.',
        found: 0
      }
    }
    const queue = splitScene(ctx.text, room).map((text) => ({ text }))
    let number = 0
    const total = (): number => number + queue.length

    while (queue.length && !stopped && !failure) {
      const part = queue.shift()!
      number++
      const req = checkRequest(sections, part.text, { part: number, parts: total() })
      let messages: ChatMessage[] = [
        { role: 'system', content: system },
        { role: 'user', content: req.user }
      ]
      let got: Record<string, unknown>[] | null = null
      for (let attempt = 0; attempt < 2 && !got && !stopped && !failure; attempt++) {
        if (o.stopped()) {
          stopped = true
          break
        }
        const taskId = newId()
        o.onTask?.(taskId)
        let done
        try {
          done = await runTask({
            db: o.db,
            taskId,
            job: 'check',
            sceneId,
            model: o.model,
            messages,
            reply: budget.reply,
            temperature: CHECK_TEMPERATURE,
            topP: 1,
            blocks: req.blocks,
            entries: req.entryIds.map((id) => ({ entryId: id, version: versions.get(id) ?? '' })),
            emit: quiet,
            onKeyRejected: o.onKeyRejected,
            fetchImpl: o.fetchImpl,
            retryDelays: o.retryDelays
          })
        } catch (e) {
          failure = e instanceof UserError ? e.message : 'Something went wrong starting the check. Try again.'
          break
        } finally {
          o.onTask?.(null)
        }
        if (done.status === 'stopped' || o.stopped()) {
          stopped = true
          break
        }
        if (done.status === 'error') {
          failure = done.error ?? 'Something went wrong while checking. Try again.'
          break
        }
        const reply = readCheckReply(done.text)
        if (reply.ok) {
          got = reply.items
          checked.push(...(reply.checked ?? []))
          if (withContract) answers.push(readContractAnswers(done.text))
          if (!reply.complete) partial = true
          break
        }
        // A long reply cut off by the reply limit: asking again would be cut off the same way, so the part is checked in halves.
        if ((reply.why === CUT_OFF || done.cutOff) && splits < MAX_SPLITS) {
          const halves = splitScene(part.text, Math.ceil(estimateTokens(part.text) / 2))
          if (halves.length > 1) {
            splits++
            queue.unshift(...halves.map((text) => ({ text })))
            number--
            break
          }
        }
        messages = [...messages, { role: 'assistant', content: done.text }, { role: 'user', content: retryMessage(reply.why) }]
        if (attempt === 1) {
          failure =
            "The consistency check model's reply wasn't in the right format. Try again, or pick another consistency check model in Settings › Models."
        }
      }
      if (got) items.push(...got)
    }
  }

  if (!o.db.open || o.closed?.() || (stopped && !items.length)) return { status: 'stopped', found: 0 }
  // The scene may have been deleted while it was checked.
  if (!cdb.sceneTexts(o.db, [sceneId]).has(sceneId)) return { status: 'stopped', found: 0 }
  const whole = !stopped && !failure && !partial
  // The scene's contract (fix 13): what the scene goes against, or doesn't show yet, as issues like the rest.
  const kept = contract && answers.length ? contractFindings(contract, mergeAnswers(answers), ctx) : null
  const found = [...foundIssues(items, read), ...(kept?.found ?? [])]
  // A whole check replaces what the same checks found here before; a check cut short only adds. What a check through the
  // scene's contract found is replaced only by another check through it (the critic after a draft never is one).
  const replaces = whole
    ? (p: cdb.IssuePayload) => !!p.check && (checks as string[]).includes(p.check) && (!p.contract || !!kept)
    : () => false
  let raised = cdb.saveFound(o.db, cdb.rowsInScenes(o.db, [sceneId]), found, replaces)
  // The free rule checks (long story memory fix 8), after the AI's findings are kept, so the rules never raise what the
  // AI just found, and bring back at once one the AI didn't find again.
  raised += ruleChecksQuietly(o.db, sceneId, o.prefs)
  // The report: what each check looked at, what was good and where there were issues (a whole check only).
  if (whole) {
    const foundBy = new Map<CheckKind, number>()
    for (const f of found) {
      const c = f.payload.check
      if (c && c !== 'story') foundBy.set(c, (foundBy.get(c) ?? 0) + 1)
    }
    try {
      saveReport(o.db, {
        sceneId,
        after: o.after ?? 'request',
        items: reportItems(checks, checked, foundBy),
        found: found.length,
        ...(kept ? { contract: kept.check } : {})
      })
    } catch (e) {
      console.warn('Could not keep the check report', e)
    }
  }
  if (failure) return { status: 'error', error: failure, found: raised }
  if (stopped) return { status: 'stopped', found: raised }
  return { status: 'done', found: raised }
}

/**
 * What a check of the whole scene found against its contract (fix 13): an item the scene goes against, on the scene's own
 * words, with its rewrite when the model gave one; something that must change that the scene doesn't show, asked with no
 * words to point at (repair/contract.ts notYetIssue). And how each item came out, for the scene's report.
 */
export function contractFindings(
  contract: SceneContract,
  answers: ContractAnswer[],
  ctx: Pick<SceneCheckContext, 'sceneId' | 'storyId' | 'text' | 'memory'>
): { found: cdb.FoundIssue[]; check: ContractCheck } {
  const j = judgeContract(answers, contract, ctx.text)
  const names = new Map([...ctx.memory.entries, ...ctx.memory.elsewhere.map((x) => x.entry)].map((e) => [e.id, e.name] as const))
  const found: cdb.FoundIssue[] = []
  const broken = new Set<string>()
  for (const c of j.broken) {
    const item = contract.items.find((i) => i.code === c.line)
    const at = findSceneQuote(ctx.text, c.quote)
    if (!item || !at) continue
    const said = j.said.get(c.line)
    const rewrite = said?.rewrite && plain(said.rewrite) !== plain(at.quote) ? said.rewrite : c.fix && at.quote.includes(c.fix.replace) ? at.quote.replace(c.fix.replace, c.fix.with) : null
    broken.add(c.line)
    found.push({
      sceneId: ctx.sceneId,
      storyId: ctx.storyId,
      kind: KIND_OF_CHECK[item.check],
      severity: 'warning',
      quote: at.quote,
      message: c.why || `This goes against the scene’s contract: ${item.text}`,
      key: issueKey(item.check, 'contract', at.quote),
      payload: {
        by: 'check',
        check: item.check,
        sources: contractSources(item.entryIds, names),
        fix: rewrite,
        memoryFix: null,
        ...(c.question ? { advice: c.question } : {}),
        contract: { part: item.part, text: item.text },
        occurrence: occurrenceAt(ctx.text, at.quote, at.start)
      }
    })
  }
  for (const item of j.notYet) found.push(notYetIssue({ sceneId: ctx.sceneId, storyId: ctx.storyId, names }, item, contract.asks))
  const items = contractResults(contract, j, { broken, notYet: new Set(j.notYet.map((i) => i.code)) })
  return { found, check: { at: now(), asks: contract.asks, items } }
}
