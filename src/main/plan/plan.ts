// Plan before writing (step 4 of the consistency plan, Adam 2026-10-07). Before the prose is written, one short call to
// the memory model plans the scene: which facts and positions it relies on, what will change on the page (a coat taken
// off, a move to the window), and any codex entry it needs that isn't in the briefing. The app then fetches what is
// missing and checks the plan against the stage: a position the plan relies on is told in the stage's own words (or
// left out when the stage doesn't know it), a fact must be in what the planner was given, and a change that is already
// so, starts from something the stage says isn't so, or is made by someone dead is left out. What is left goes in as the
// opening of the writer's own notes, after the closing instruction, so the prose carries on from it rather than from a
// distant rule: with cheap models (DeepSeek), events given as a rule were ignored 9 times in 9, and followed 3 times in
// 3 as text the model carried on from. Never holds a draft up: a plan that fails, is stopped or takes too long is no
// plan. No Electron imports.

import type Database from 'better-sqlite3'
import type { ChatMessage, ContextPreview, EntryState, ID } from '@shared/types'
import { quoteFound, type CharacterState, type SceneState, type StateField } from '@shared/continuity'
import { callModel, type MemoryModel } from '../keeper/model'
import { estimateTokens } from '../keeper/text'
import { mentions, MUST_BLOCK, sceneTail, type ContextInput, type PreparedContext } from '../ai/context'
import { deathOf } from '../ai/deaths'
import { stageFor, stageLine } from '../ai/mustStay'
import { SPEAKER_TAG_LINE } from '../ai/speakerTags'
import { SO_FAR_BLOCK } from '../beats/instructions'

type DB = Database.Database

export const PLAN_MARKER = '[AIWRITE-PLAN v1]'
/** How long a draft waits for its plan before going ahead without one. */
export const PLAN_LIMIT_MS = 30_000
/** Room for the planner's reply. */
export const PLAN_REPLY_TOKENS = 900
/** The most of each the plan keeps. */
export const PLAN_MOST = { relies: 10, changes: 8, needs: 4 }
/** The most entries named for the planner: those in the briefing, and those it may ask for. */
const MOST_NAMED = { inBriefing: 40, others: 150 }
/** About how much of the words just before the planner reads. */
const BEFORE_WORDS = { min: 200, target: 300, max: 400 }

/** What the plan says first, and last: the writer's own notes, leading into the prose. */
export const PLAN_HEAD = 'My notes before I write (I keep to them as I go):'
export const PLAN_GO = {
  start: 'Now the prose itself:',
  here: 'Now the prose, carrying straight on from the very end of the scene so far:'
} as const

// ---------- What the planner is given ----------

export interface PlanMaterial {
  /** What the writer is asked: the closing instruction. */
  ask: string
  card: string
  /** What must stay true (ai/mustStay.ts), as the writer gets it; '' for none. */
  must: string
  /** Where things stand, as the writer gets it; '' when not known. */
  stand: string
  /** The end of the scene so far, or of the previous scene. */
  before: { title: string; text: string } | null
  /** Each entry in the briefing, one line. */
  inBriefing: string[]
  /** The names of entries that exist here but aren't in the briefing, which the plan may ask for. */
  others: string[]
}

const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()

/** What the planner reads, from the writer's briefing as it stands (before the plan). */
export function planMaterial(input: ContextInput, preview: ContextPreview, prepared: Pick<PreparedContext, 'finals'>): PlanMaterial {
  const sent = preview.blocks.filter((b) => !b.dropped)
  const text = (id: string): string => sent.find((b) => b.id === id)?.text.trim() ?? ''
  const soFar = text(SO_FAR_BLOCK)
  const previous = text('previous-scene')
  const before = soFar
    ? { title: 'The end of the scene so far', text: sceneTail(soFar, BEFORE_WORDS) }
    : previous
      ? { title: 'The end of the previous scene', text: sceneTail(previous, BEFORE_WORDS) }
      : null
  const ask = (previous ? prepared.finals.withPrevious : prepared.finals.withoutPrevious).replace(SPEAKER_TAG_LINE, '').trim()
  const byId = new Map<ID, EntryState>([...input.memory.elsewhere.map((x) => [x.entry.id, x.entry] as const), ...input.memory.entries.map((e) => [e.id, e] as const)])
  const shown = new Set((preview.entries ?? []).filter((e) => !e.hidden && e.blockId).map((e) => e.entryId))
  const hidden = new Set((preview.entries ?? []).filter((e) => e.hidden).map((e) => e.entryId))
  const inBriefing = [...shown]
    .map((id) => byId.get(id))
    .filter((e): e is EntryState => !!e)
    .slice(0, MOST_NAMED.inBriefing)
    .map((e) => `${e.name} (${e.kind})${clean(e.summary) ? `: ${clean(e.summary)}` : ''}`)
  const others = input.memory.entries
    .filter((e) => !shown.has(e.id) && !hidden.has(e.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MOST_NAMED.others)
    .map((e) => {
      const aka = (e.aliases ?? []).map(clean).filter(Boolean)
      return `${e.name} (${e.kind}${aka.length ? `; also ${aka.join(', ')}` : ''})`
    })
  return { ask, card: text('scene-card'), must: text(MUST_BLOCK), stand: text('continuity'), before, inBriefing, others }
}

const SYSTEM = `${PLAN_MARKER} plan
You plan one scene of a novel just before it is written, so the writer keeps to the facts. You don't write any of the scene.

Read what the writer is asked, the scene card, what must stay true, where things stand and the words just before. Then say:
- relies: the facts and positions the scene relies on: where people are, what they wear and hold, how they are placed, injuries, what someone knows or doesn't know. Copy each value word for word from what you are given. Never guess one.
- changes: what will change on the page, in the order it happens: a coat taken off, a move to the window, something picked up or put down, someone arriving or leaving, a secret told. For each: how it is now (from), how it is after (to), and how it happens, in one short sentence (how).
- needs: the names of entries under "Also in the world" that the scene needs and the briefing lacks (a place it moves to, an object or a person it brings in). Only names from that list, at most 4. None is fine.

Reply with only a JSON object:
{"relies": [{"who": "", "what": "", "value": ""}], "changes": [{"who": "", "what": "", "from": "", "to": "", "how": ""}], "needs": [""]}
- who: a character's name as given, or "" for the scene itself or a fact about the world.
- what: one of where, wearing, position, holding, condition, mood, time, light, weather, or fact.
- Keep to what must stay true and to where things stand: nothing changes unless it happens on the page, and each change starts from how things are now.
- At most ${PLAN_MOST.relies} relies and ${PLAN_MOST.changes} changes, the ones that matter most. Keep each short.`

/** What the memory model is asked. */
export function planMessages(m: PlanMaterial): ChatMessage[] {
  const part = (title: string, body: string): string => (body.trim() ? `## ${title}\n${body.trim()}` : '')
  const user = [
    part('What the writer is asked', m.ask),
    part('The scene card', m.card),
    part('Must stay true', m.must),
    part('Where things stand', m.stand),
    m.before ? part(m.before.title, `"""\n${m.before.text}\n"""`) : '',
    part('In the briefing', m.inBriefing.map((l) => `- ${l}`).join('\n')),
    part('Also in the world (not in the briefing)', m.others.join('; ')),
    'Plan the scene now, as one JSON object.'
  ]
    .filter(Boolean)
    .join('\n\n')
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: user }
  ]
}

// ---------- Reading the reply ----------

export interface RawPlan {
  relies: { who: string; what: string; value: string }[]
  changes: { who: string; what: string; from: string; to: string; how: string }[]
  needs: string[]
}

const str = (v: unknown): string => (typeof v === 'string' ? clean(v).slice(0, 400) : '')
const list = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []

/** The planner's reply, read; null when it isn't JSON. Anything missing is empty. */
export function readPlan(reply: string): RawPlan | null {
  const body = reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)
  let v: unknown
  try {
    v = JSON.parse(body)
  } catch {
    return null
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  return {
    relies: list(o.relies).map((r) => ({ who: str(r.who), what: str(r.what), value: str(r.value) })),
    changes: list(o.changes).map((c) => ({ who: str(c.who), what: str(c.what), from: str(c.from), to: str(c.to), how: str(c.how) })),
    needs: (Array.isArray(o.needs) ? o.needs : [])
      .map((n) => (typeof n === 'string' ? str(n) : n && typeof n === 'object' ? str((n as Record<string, unknown>).name) : ''))
      .filter(Boolean)
  }
}

// ---------- Checking it against the stage ----------

type SceneField = 'time' | 'light' | 'weather'

/** The stage's field for what the planner wrote ("position" is posture); null for a fact. */
export function fieldOf(what: string): StateField | SceneField | null {
  const w = what.toLowerCase().replace(/[^a-z]/g, '')
  if (['where', 'place', 'location', 'whereabouts'].includes(w)) return 'where'
  if (['wearing', 'clothes', 'clothing', 'dress', 'outfit'].includes(w)) return 'wearing'
  if (['position', 'posture', 'pose', 'placed'].includes(w)) return 'posture'
  if (['holding', 'carrying', 'held', 'holds'].includes(w)) return 'holding'
  if (['condition', 'injury', 'injuries', 'health', 'body'].includes(w)) return 'condition'
  if (['mood', 'feeling', 'feelings'].includes(w)) return 'mood'
  if (['lastaction', 'action'].includes(w)) return 'lastAction'
  if (w === 'time' || w === 'light' || w === 'weather') return w
  return null
}

const SCENE_FIELDS: readonly string[] = ['time', 'light', 'weather']

/** Words that say how something is, in pairs that can't both hold. */
const OPPOSITES: [string, string][] = [
  ['on', 'off'],
  ['open', 'closed'],
  ['open', 'shut'],
  ['up', 'down'],
  ['in', 'out'],
  ['standing', 'sitting'],
  ['standing', 'lying'],
  ['sitting', 'lying'],
  ['standing', 'kneeling'],
  ['asleep', 'awake'],
  ['locked', 'unlocked'],
  ['lit', 'unlit'],
  ['dry', 'wet'],
  ['dry', 'soaked'],
  ['buttoned', 'unbuttoned'],
  ['laced', 'unlaced'],
  ['tied', 'untied']
]
const STATE_WORDS = new Set(OPPOSITES.flat())
const opposite = (a: string, b: string): boolean => OPPOSITES.some(([x, y]) => (x === a && y === b) || (x === b && y === a))
const SMALL = new Set(['the', 'and', 'her', 'his', 'their', 'its', 'a', 'an', 'of', 'with', 'by', 'at', 'to', 'from', 'over', 'under', 'she', 'he', 'they'])
const tokens = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[’']/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)

/** The word saying how a thing is, nearest to it (within three words; after it on a tie), or null. */
function stateNear(words: string[], at: number): string | null {
  let best: { word: string; d: number; after: boolean } | null = null
  for (let j = Math.max(0, at - 3); j <= Math.min(words.length - 1, at + 3); j++) {
    if (j === at || !STATE_WORDS.has(words[j])) continue
    const d = Math.abs(j - at)
    if (!best || d < best.d || (d === best.d && j > at && !best.after)) best = { word: words[j], d, after: j > at }
  }
  return best?.word ?? null
}

/**
 * True when two descriptions disagree about something both name: "boots on" and "shirt open, boots off by the door"
 * (the boots), "sitting by the fire" and "standing by the fire". Only the word saying how each thing is counts, so
 * different wording that agrees ("cloak on, boots off" and "boots off, cloak on") doesn't.
 */
export function contradicts(a: string, b: string): boolean {
  const x = tokens(a)
  const y = tokens(b)
  for (let i = 0; i < x.length; i++) {
    const w = x[i]
    if (w.length < 3 || SMALL.has(w) || STATE_WORDS.has(w)) continue
    const s = stateNear(x, i)
    if (!s) continue
    for (let j = 0; j < y.length; j++) {
      if (y[j] !== w) continue
      const t = stateNear(y, j)
      if (t && opposite(s, t)) return true
    }
  }
  // How a person is placed: "standing" against "sitting on the bed", with nothing named in both.
  const pose = (ws: string[]): string | null => ws.find((v) => ['standing', 'sitting', 'lying', 'kneeling'].includes(v)) ?? null
  const p = pose(x)
  const q = pose(y)
  return !!p && !!q && opposite(p, q)
}

const plainText = (s: string): string => tokens(s).join(' ')

export interface CheckWith {
  /** Where things stand at the point of writing; null when not known. */
  stand: SceneState | null | undefined
  /** Everything the planner was given, so a fact it relies on can be found there. */
  material: string
  /** Every entry that exists here, for what the plan asks for and who is dead. */
  entries: EntryState[]
  /** Entries already in the briefing, and those Adam kept out: never asked for. */
  inBriefing: ReadonlySet<ID>
  hidden: ReadonlySet<ID>
}

export interface ScenePlan {
  /** What the scene rests on, as things stand. */
  keep: string[]
  /** What happens on the page, in order. */
  changes: string[]
  /** The codex entries to bring into the briefing. */
  needs: ID[]
  /** How the check went: values put right from the stage, and things left out. */
  checked: { corrected: number; dropped: number }
}

/** The plan, checked against the stage and the codex (see the top of this file). */
export function checkPlan(raw: RawPlan, w: CheckWith): ScenePlan {
  const keep: string[] = []
  const changes: string[] = []
  const needs: ID[] = []
  let corrected = 0
  let dropped = 0
  const stage = (who: string): CharacterState | null => (who ? stageFor({ name: who, aliases: [] }, w.stand) : null)
  const nowOf = (who: string, f: StateField | SceneField): string =>
    SCENE_FIELDS.includes(f) ? clean(w.stand?.[f as SceneField]) : clean(stage(who)?.[f as StateField])
  const nameOf = (who: string): string => clean(stage(who)?.name) || who
  const put = (line: string): void => {
    if (line && !keep.some((l) => l.toLowerCase() === line.toLowerCase())) keep.push(line)
  }

  for (const r of raw.relies.slice(0, PLAN_MOST.relies)) {
    if (!r.value) continue
    const f = fieldOf(r.what)
    const scene = !!f && SCENE_FIELDS.includes(f)
    if (f && (scene || r.who)) {
      // A position or the like: the stage's own words, whatever the planner wrote.
      const now = nowOf(r.who, f)
      if (now) {
        if (plainText(now) !== plainText(r.value)) corrected++
        put(stageLine(scene ? '' : nameOf(r.who), f, now))
        continue
      }
      // Not on the stage: only what the planner was given (a mark on the codex page, say), never a guess.
      if (quoteFound(r.value, w.material)) put(stageLine(r.who || '', f, r.value))
      else dropped++
      continue
    }
    // A fact: only one in what the planner was given.
    if (!quoteFound(r.value, w.material)) {
      dropped++
      continue
    }
    put(r.who && !r.value.toLowerCase().startsWith(r.who.toLowerCase()) ? `${r.who}: ${r.value}` : r.value)
  }

  const dead = w.entries.filter((e) => deathOf(e)).flatMap((e) => [e.name, ...(e.aliases ?? [])].map((n) => clean(n).toLowerCase()))
  const isDead = (who: string): boolean => {
    const n = clean(who).toLowerCase()
    return !!n && dead.some((d) => d === n || d.startsWith(`${n} `))
  }
  for (const c of raw.changes.slice(0, PLAN_MOST.changes)) {
    if (!c.how && !c.to) continue
    if (isDead(c.who)) {
      dropped++
      continue
    }
    const f = fieldOf(c.what)
    const now = f && (SCENE_FIELDS.includes(f) || c.who) ? nowOf(c.who, f) : ''
    // Already so: nothing to change. Starting from something the stage says isn't so: planned from a wrong picture.
    if (now && ((c.to && plainText(c.to) === plainText(now)) || (c.from && contradicts(c.from, now)))) {
      dropped++
      continue
    }
    const line = c.how || `${c.who ? `${c.who}: ` : ''}${c.what ? `${c.what} ` : ''}now ${c.to}`
    if (!changes.some((l) => l.toLowerCase() === line.toLowerCase())) changes.push(line)
  }

  const open = w.entries.filter((e) => !w.inBriefing.has(e.id) && !w.hidden.has(e.id))
  for (const n of raw.needs) {
    if (needs.length >= PLAN_MOST.needs) break
    const want = clean(n).toLowerCase()
    const named = (e: EntryState): string[] => [e.name, ...(e.aliases ?? [])].map((x) => clean(x).toLowerCase()).filter(Boolean)
    const e = open.find((x) => named(x).includes(want)) ?? open.find((x) => [x.name, ...(x.aliases ?? [])].some((a) => mentions(n, a)))
    if (e && !needs.includes(e.id)) needs.push(e.id)
  }
  return { keep, changes, needs, checked: { corrected, dropped } }
}

/** The plan as the writer's own notes, leading into the prose; '' when it says nothing. */
export function planText(p: Pick<ScenePlan, 'keep' | 'changes'>, carryingOn: boolean): string {
  if (!p.keep.length && !p.changes.length) return ''
  const parts = [PLAN_HEAD]
  if (p.keep.length) parts.push(`What the scene rests on, as things stand:\n${p.keep.map((l) => `- ${l}`).join('\n')}`)
  if (p.changes.length) parts.push(`What happens on the page, in order:\n${p.changes.map((l, i) => `${i + 1}. ${l}`).join('\n')}`)
  parts.push(carryingOn ? PLAN_GO.here : PLAN_GO.start)
  return parts.join('\n')
}

// ---------- The call ----------

export interface PlanCall {
  db: DB
  model: MemoryModel
  sceneId: ID
  material: PlanMaterial
  check: Omit<CheckWith, 'material'>
  /** The writing carries on from words already in the scene (Add below, a later beat). */
  carryingOn: boolean
  /** Adam stopped the draft before it began. */
  signal?: AbortSignal
  /** True once the world has closed. */
  closed: () => boolean
  limitMs?: number
  fetchImpl?: typeof fetch
  retryDelays?: number[]
}

export interface MadePlan {
  needs: ID[]
  /** The writer's notes; '' when the plan only asked for entries. */
  text: string
  checked: ScenePlan['checked']
}

/**
 * Plans the scene with the memory model (as a 'memory' record, so "What the AI saw" shows what it was asked), and
 * checks the plan. Null when there is nothing to go on: the call failed, was stopped, took longer than `limitMs` (it
 * is then stopped too), or said nothing usable. Never throws.
 */
export async function makePlan(o: PlanCall): Promise<MadePlan | null> {
  if (o.signal?.aborted || o.closed()) return null
  const stop = new AbortController()
  const onAbort = (): void => stop.abort()
  o.signal?.addEventListener('abort', onAbort, { once: true })
  const limit = o.limitMs ?? PLAN_LIMIT_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  let late: ReturnType<typeof setTimeout> | undefined
  try {
    timer = setTimeout(() => stop.abort(), limit)
    const messages = planMessages(o.material)
    const user = messages[1].content
    const call = callModel({
      db: o.db,
      model: o.model,
      targetId: o.sceneId,
      job: 'memory',
      messages,
      blocks: [{ id: 'plan', title: 'Planning the scene', text: user, tokens: estimateTokens(user), priority: 1, dropped: false, short: false, entryIds: [] }],
      maxTokens: PLAN_REPLY_TOKENS,
      signal: stop.signal,
      closed: o.closed,
      fetchImpl: o.fetchImpl,
      retryDelays: o.retryDelays
    })
    // Stopping the call ends it at once; this is only in case something doesn't hear the stop.
    const gaveUp = new Promise<null>((resolve) => {
      late = setTimeout(() => resolve(null), limit + 2_000)
    })
    const got = await Promise.race([call, gaveUp])
    if (!got || got.status !== 'complete' || stop.signal.aborted || o.closed()) return null
    const raw = readPlan(got.text)
    if (!raw) return null
    const plan = checkPlan(raw, { ...o.check, material: user })
    const text = planText(plan, o.carryingOn)
    if (!text && !plan.needs.length) return null
    return { needs: plan.needs, text, checked: plan.checked }
  } catch (e) {
    console.warn('Could not plan the scene; writing without a plan', e)
    return null
  } finally {
    clearTimeout(timer)
    clearTimeout(late)
    o.signal?.removeEventListener('abort', onAbort)
  }
}
