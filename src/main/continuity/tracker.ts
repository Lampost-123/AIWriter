// Where things stand (Adam, 2026-10-04): for each character, as a scene ends, where they are, what they wear, how
// they are placed (sitting, lying down), what they hold or carry, their injuries and how they feel, their mood and
// what they last did; and for the scene, the time, the weather and the light. Only the latest of each is kept: what a
// scene changes replaces what was there, and the rest carries on from the scenes before.
//
// - Worked out by the memory model from a scene's words and the state before it (the previous scene's), when a draft
//   or a check needs it (stateBefore), and kept in the world's `meta` under 'continuity', by scene, with the hash of
//   the words it was read from and of the state it built on. No ghosts (Adam, 2026-10-04): when either changes (the
//   scene's words edited or deleted, or an earlier scene's state changed), it is worked out again rather than used,
//   so nothing outlives the words it came from.
// - Adam can browse and change it (Recall, in the scene panel): a value he sets or a character he takes out is kept
//   until that scene's words change, and is then read again too.
// - Told to the writer as "Where things stand" (context.ts, block 3b) and to the consistency checks (checks/context).
// No Electron imports.

import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { ChatMessage, ID } from '@shared/types'
import { mergeState, readChanges, stateText, withEdits, type SceneState, type StateEdits } from '@shared/continuity'

export { mergeState, readChanges, stateText, withEdits, type SceneState, type StateEdits } from '@shared/continuity'
import * as repo from '../db/repo'
import * as kdb from '../db/keeper'
import { callModel, type MemoryModel } from '../keeper/model'
import { scenesBefore } from '../keeper/places'
import { estimateTokens } from '../keeper/text'

type DB = Database.Database

export const META_KEY = 'continuity'
const MARKER = '[AIWRITE-CONTINUITY v2]'

/** The most of a scene sent at once (characters); a longer one is read from its end, where it finishes. */
const SCENE_CHARS = 60_000
/** How many scenes before a draft's are brought up to date at most (oldest first, so each builds on the last). */
const CATCH_UP = 3

interface Kept {
  /** The scene's words it was read from. */
  hash: string
  /** The state it built on (the scene before's), '' for none. */
  base: string
  /** As read, before Adam's edits. */
  state: SceneState
  edits?: StateEdits
}

type Stored = Record<ID, Kept>

const hashOf = (text: string): string => createHash('sha1').update(text).digest('hex').slice(0, 16)
/** A state's own hash, so the scenes built on it know when it changed. */
const stateHash = (s: SceneState | null): string => (s ? hashOf(JSON.stringify(s)) : '')

function load(db: DB): Stored {
  try {
    const raw = JSON.parse(repo.getMeta(db, META_KEY) ?? '{}') as unknown
    return raw && typeof raw === 'object' ? (raw as Stored) : {}
  } catch {
    return {}
  }
}

/** The state (with Adam's edits) a scene ends with, as kept; null when there is none. */
function finalOf(all: Stored, sceneId: ID | undefined): SceneState | null {
  const k = sceneId ? all[sceneId] : undefined
  return k ? withEdits(k.state, k.edits) : null
}

/**
 * The state a scene's own reading builds on: the one kept for the scene before it on the story's line. The scene's
 * end and its checkpoints are all keyed to it, so every reading of the scene finds the same checkpoints.
 */
const startOf = (db: DB, all: Stored, sceneId: ID): SceneState | null => finalOf(all, scenesBefore(db, sceneId).at(-1))

/**
 * True when the scenes a draft brings up to date (the last few before this one) are each kept from their words as
 * they are now, built on the one before: what the scene starts from is no ghost. Looser than `stands`, which goes all
 * the way back, so a scene far back waiting to be read again doesn't leave the scene so far with nothing.
 */
function startsFresh(db: DB, all: Stored, sceneId: ID): boolean {
  const line = scenesBefore(db, sceneId)
  return line.slice(-CATCH_UP).every((id) => {
    const k = all[id]
    if (!k) return true
    const i = line.indexOf(id)
    return k.hash === hashOf(kdb.keeperScene(db, id)?.text ?? '') && k.base === stateHash(i > 0 ? finalOf(all, line[i - 1]) : null)
  })
}

/**
 * True when a kept state still stands: read from the scene's words as they are now, built on the state the scene
 * before ends with now, and that one standing too, all the way back. Anything else would be a ghost (a cloak taken
 * off in an earlier scene's new words, still worn here), and is worked out again before it is used.
 */
function stands(db: DB, all: Stored, sceneId: ID): boolean {
  const line = [...scenesBefore(db, sceneId), sceneId]
  let ok = true
  for (let i = 0; i < line.length; i++) {
    const k = all[line[i]]
    // A scene with nothing kept (never read, or no words) passes nothing on: the next one builds on nothing.
    if (!k) {
      ok = true
      continue
    }
    const scene = kdb.keeperScene(db, line[i])
    const before = i > 0 && all[line[i - 1]] ? finalOf(all, line[i - 1]) : null
    ok = ok && !!scene && k.hash === hashOf(scene.text) && k.base === stateHash(before)
  }
  return !!all[sceneId] && ok
}

/** The state kept for a scene's end (with Adam's edits), and whether it still stands. */
export function storedState(db: DB, sceneId: ID): { state: SceneState; current: boolean; edited: boolean } | null {
  const all = load(db)
  const kept = all[sceneId]
  if (!kept) return null
  return { state: withEdits(kept.state, kept.edits), current: stands(db, all, sceneId), edited: !!kept.edits }
}

function save(db: DB, all: Stored): void {
  // Scenes that are gone take their state with them.
  for (const id of Object.keys(all)) if (!kdb.keeperScene(db, id)) delete all[id]
  repo.setMeta(db, META_KEY, JSON.stringify(all))
}

/** Adam changes a scene's state: a value, or a character taken out. Kept until the scene's words change. */
export function editState(db: DB, sceneId: ID, change: (edits: StateEdits) => void): boolean {
  const all = load(db)
  const k = all[sceneId]
  if (!k) return false
  const edits: StateEdits = k.edits ?? {}
  change(edits)
  k.edits = edits
  save(db, all)
  // When the scene goes on from here, the reading starts from his version.
  const scene = kdb.keeperScene(db, sceneId)
  // Only when his version still stands: one laid over an old start would set aside the checkpoints that do.
  if (scene && stands(db, all, sceneId)) keepPoint(db, sceneId, k.base, scene.text, withEdits(k.state, edits))
  return true
}

export interface StateAsk {
  /** The text is the scene so far (the words before a Continue, a beat or Add below), not a finished scene. */
  soFar?: boolean
  /**
   * The words just before `sceneText`, already counted in the state before: the text is the rest of the scene from a
   * checkpoint, and these are given so it reads on from them.
   */
  after?: string
}

/** What the memory model is asked for one scene, or for the rest of a scene from a checkpoint. */
export function stateMessages(before: SceneState | null, sceneText: string, cast: string[], ask: StateAsk = {}): ChatMessage[] {
  const field = '{"value": "", "quote": ""}'
  const system = `${MARKER} state
You keep track of continuity for a novel, so the next scenes are written consistently. Given where things stood before a scene and the scene's text, say what the scene changes, so it is known where things stand at the END of it.

Reply with only a JSON object. Each value is ${field}: the value as it is at the end, and the quote: the exact words in the scene that show it, copied word for word (a few words to a sentence; join two places with …):
{"time": ${field}, "weather": ${field}, "light": ${field}, "characters": [{"name": "", "where": ${field}, "wearing": ${field}, "posture": ${field}, "holding": ${field}, "condition": ${field}, "mood": ${field}, "lastAction": ${field}}]}

- Only values the scene's words show or change, each with its quote. Leave out anything you can't quote: it carries on from before, or stays unknown. Never guess or fill a gap with what is likely. A value without its words is thrown away.
- time: time of day (and date, if the story gives one); weather; light (lamplight, dusk, harsh sun).
- One entry for each character who is in the scene or whose situation it changes, by their name as the cast list has it.
- where: where they are at the end, as exactly as the text allows (the inn's back room, by the hearth; on the bed, by the window).
- wearing: everything they have on, item by item, each with how it is now: done up or open, pushed up or down, tucked in or loose, torn, soaked, half off (a white shirt unbuttoned to the waist with the sleeves rolled up, dark trousers, boots off). Anything taken off and where it is now (cloak over the chair). Jewellery, a pack, a sword belt. Always the whole outfit as it is now, not only what changed (what carries on comes from before; the quote is the words that change it). Never their hair, beard or body: those aren't worn.
- posture: how their body is placed: standing, sitting, kneeling or lying, and on what; which way they face; what their hands, arms and legs are doing; anyone they are touching or holding (sitting on the edge of the bed facing the window, hands in her lap, knee against Tobin's).
- holding: what they hold or carry, and in which hand when the text says.
- condition: injuries, exhaustion, hunger, drunkenness: how their body is now, not how it always is (a scar or a missing finger belongs to who they are, not here, unless the scene changes it).
- mood: how they feel at the end.
- lastAction: the last thing they did, in a few words.
- When something has changed, give only the new state, never the old one.
- Keep each value short, but leave out no detail the text gives: wearing and posture may take a full line.`
  const from = ask.after?.trim()
  const user = [
    cast.length ? `Characters in this story: ${cast.join(', ')}` : '',
    from
      ? `Where things stand before the words below (the scene up to here is counted in it):\n${before ? stateText(before) || '(nothing known yet)' : '(nothing known yet)'}`
      : `Before this scene:\n${before ? stateText(before) || '(nothing known yet)' : '(nothing known yet: this may be the opening)'}`,
    from
      ? `The words just before, already counted (for what leads into the scene below; nothing to report from them):\n"""\n…${from}\n"""`
      : '',
    ask.soFar ? 'The scene is not finished: this is the scene so far. Say where things stand at the end of what is written.' : '',
    `The scene${from ? ', from here on' : ''}:\n"""\n${sceneText.length > SCENE_CHARS ? `…${sceneText.slice(-SCENE_CHARS)}` : sceneText}\n"""`
  ]
    .filter(Boolean)
    .join('\n\n')
  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]
}

export interface TrackOptions {
  db: DB
  model: MemoryModel
  signal: AbortSignal
  closed: () => boolean
  fetchImpl?: typeof fetch
  retryDelays?: number[]
}

/**
 * The state at the end of a scene, from its words as they are now: kept, or asked for (building on the state kept
 * for the scene before it on the story's line, and reading on from the scene's last checkpoint that still matches its
 * words). Null when the scene has no words or the model couldn't say.
 */
export async function stateAfter(o: TrackOptions, sceneId: ID): Promise<SceneState | null> {
  const scene = kdb.keeperScene(o.db, sceneId)
  if (!scene || !scene.text.trim()) return null
  const hash = hashOf(scene.text)
  const all = load(o.db)
  const kept = all[sceneId]
  if (kept && stands(o.db, all, sceneId)) return withEdits(kept.state, kept.edits)
  const before = startOf(o.db, all, sceneId)
  const state = await readUpTo(o, sceneId, before, scene.text, false)
  if (!state) return null
  const now = load(o.db)
  // Adam's edits stay while the words are the ones he edited against; new words are read afresh (from the checkpoint
  // his edits were laid over, so what he put right carries on). Taken as they are now: he may have changed a value
  // while the model was reading.
  const edits = now[sceneId]?.hash === hash ? now[sceneId].edits : undefined
  now[sceneId] = { hash, base: stateHash(before), state, ...(edits ? { edits } : {}) }
  save(o.db, now)
  return withEdits(state, now[sceneId].edits)
}

/** Asks the memory model where things stand after `text`, laid over `before`. Null when it couldn't say. */
async function askState(o: TrackOptions, sceneId: ID, before: SceneState | null, text: string, ask: StateAsk): Promise<SceneState | null> {
  const cast = repo
    .listEntries(o.db, 'character')
    .map((e) => e.name)
    .slice(0, 80)
  const messages = stateMessages(before, text, cast, ask)
  const got = await callModel({
    db: o.db,
    model: o.model,
    targetId: sceneId,
    job: 'memory',
    messages,
    blocks: [{ id: 'continuity', title: 'Where things stand', text: messages[1].content, tokens: estimateTokens(messages[1].content), priority: 1, dropped: false, short: false, entryIds: [] }],
    maxTokens: 3000,
    signal: o.signal,
    closed: o.closed,
    fetchImpl: o.fetchImpl,
    retryDelays: o.retryDelays
  })
  // Nothing to go on: no state rather than one the words no longer support.
  if (got.status !== 'complete' || o.closed() || !o.db.open) return null
  // A value counts only with words it was given to read: the words before a checkpoint are already counted, and a
  // value quoted from them may since have changed again.
  const read = readChanges(got.text, text, sceneId)
  return read ? mergeState(before, read) : null
}

// ---------- Checkpoints inside scenes ----------
// Where things stand after the first `at` characters of a scene's words (Adam, 2026-10-07), kept in the world's
// `meta` under 'continuity-points', by scene, with the hash of those words and of the state the scene starts from.
// Taken whenever where things stand is worked out partway through a scene (Continue, a beat, Add below, Recall at
// the cursor) or at its end; the next reading starts from the latest one that still matches the words, so only new
// words are read. A checkpoint whose words, or whose scene's starting state, changed is never used.

export const POINTS_KEY = 'continuity-points'
/** The most checkpoints kept for a scene (the oldest go first), and the most scenes kept with them (the least lately read go first). */
const MOST_POINTS = 8
const MOST_SCENES = 15
/** How much of the words before a checkpoint is given with the words after it, so the reading follows on. */
const LEAD_IN = 1_500

interface Point {
  /** How many characters of the scene's words it stands after. */
  at: number
  /** Those words' hash. */
  hash: string
  state: SceneState
}
type Points = Record<ID, { base: string; points: Point[] }>

function loadPoints(db: DB): Points {
  try {
    const raw = JSON.parse(repo.getMeta(db, POINTS_KEY) ?? '{}') as unknown
    return raw && typeof raw === 'object' ? (raw as Points) : {}
  } catch {
    return {}
  }
}

/** The latest checkpoint for a scene that matches `text` and builds on `base` (the state the scene starts from). */
function pointFor(db: DB, sceneId: ID, base: string, text: string): Point | null {
  const mine = loadPoints(db)[sceneId]
  if (!mine || mine.base !== base) return null
  let best: Point | null = null
  for (const p of mine.points) if (p.at <= text.length && (!best || p.at > best.at) && hashOf(text.slice(0, p.at)) === p.hash) best = p
  return best
}

function keepPoint(db: DB, sceneId: ID, base: string, text: string, state: SceneState): void {
  if (!db.open) return
  const all = loadPoints(db)
  const mine = all[sceneId]?.base === base ? all[sceneId] : { base, points: [] }
  mine.points = [...mine.points.filter((p) => p.at !== text.length), { at: text.length, hash: hashOf(text), state }].slice(-MOST_POINTS)
  // This scene last, so the scenes read least lately are the first to go.
  delete all[sceneId]
  all[sceneId] = mine
  const ids = Object.keys(all)
  // Scenes that are gone take their checkpoints with them.
  for (const [i, id] of ids.entries()) if (i < ids.length - MOST_SCENES || !kdb.keeperScene(db, id)) delete all[id]
  repo.setMeta(db, POINTS_KEY, JSON.stringify(all))
}

/**
 * Where things stand after `text` (a scene's words, or the first part of them), built on `before` (the state the
 * scene starts from): from the latest checkpoint that matches, reading only the words after it, and kept as a new
 * checkpoint. Null when the model couldn't say.
 */
async function readUpTo(o: TrackOptions, sceneId: ID, before: SceneState | null, text: string, soFar: boolean): Promise<SceneState | null> {
  const base = stateHash(before)
  const from = pointFor(o.db, sceneId, base, text)
  if (from && !text.slice(from.at).trim()) return from.state
  const state = from
    ? await askState(o, sceneId, from.state, text.slice(from.at), { soFar, after: text.slice(Math.max(0, from.at - LEAD_IN), from.at) })
    : await askState(o, sceneId, before, text, { soFar })
  if (!state) return null
  keepPoint(o.db, sceneId, base, text, state)
  return state
}

/**
 * Where things stand at the end of `text`, the scene so far (the words before a Continue, or before a beat or Add
 * below): built on where things stood as the scene before it ended, brought up to date first. When `text` is the
 * scene's saved words this is the scene's own state (kept, and shown in Recall); otherwise it is worked out from the
 * latest checkpoint before it and kept as a checkpoint. With no words, the state the scene starts from. Null when the
 * memory model couldn't say (never the state before in its place: that would be told as the scene so far's).
 */
export async function stateAtText(o: TrackOptions, sceneId: ID, text: string): Promise<SceneState | null> {
  // The scene before's end, just brought up to date: what the scene's own state builds on too (startOf), so both
  // readings, and Recall at the cursor, find the same checkpoints. Nothing when it couldn't be read from its words as
  // they are now: never a ghost.
  await stateBefore(o, sceneId)
  const all = load(o.db)
  if (!startsFresh(o.db, all, sceneId)) return null
  const before = startOf(o.db, all, sceneId)
  if (!text.trim() || o.signal.aborted || o.closed()) return before
  const scene = kdb.keeperScene(o.db, sceneId)
  if (scene && scene.text.trim() === text.trim()) return stateAfter(o, sceneId)
  try {
    return await readUpTo(o, sceneId, before, text, true)
  } catch (e) {
    console.warn('Could not work out where things stand in the scene so far', e)
    return null
  }
}

/**
 * Where things stand at the end of `text` (the scene up to a point in it), as kept: the scene's own state when `text`
 * is all its words, else the latest checkpoint at or before that point. `exact`: worked out at that very point.
 * Null when nothing is kept for it. No model is asked.
 */
export function storedStateAt(db: DB, sceneId: ID, text: string): { state: SceneState; exact: boolean; current: boolean } | null {
  const scene = kdb.keeperScene(db, sceneId)
  if (scene && scene.text.trim() === text.trim()) {
    const end = storedState(db, sceneId)
    return end && { state: end.state, exact: true, current: end.current }
  }
  const all = load(db)
  if (!startsFresh(db, all, sceneId)) return null
  const p = pointFor(db, sceneId, stateHash(startOf(db, all, sceneId)), text)
  return p && { state: p.state, exact: !text.slice(p.at).trim(), current: true }
}

/**
 * Before a draft (or a check) of a scene: the state at the end of the scenes before it, brought up to date, the
 * last few at most and oldest first. Returns the state the scene starts from (null when nothing is known).
 * Never throws: a failure leaves what was kept.
 */
export async function stateBefore(o: TrackOptions, sceneId: ID): Promise<SceneState | null> {
  try {
    const before = scenesBefore(o.db, sceneId).slice(-CATCH_UP)
    let last: SceneState | null = null
    for (const id of before) {
      if (o.signal.aborted || o.closed()) break
      last = (await stateAfter(o, id)) ?? last
    }
    const prev = before.at(-1)
    if (!prev) return null
    const all = load(o.db)
    // Only a state that still stands is told; otherwise nothing, rather than a ghost.
    return stands(o.db, all, prev) ? finalOf(all, prev) : last
  } catch (e) {
    console.warn('Could not work out where things stand', e)
    return null
  }
}

/**
 * The state a scene starts from, as kept (no model is asked): the previous scene's end, when the last few scenes
 * before are fresh (`startsFresh`, as a draft brings them up to date), else null rather than a ghost.
 */
export function keptStateBefore(db: DB, sceneId: ID): SceneState | null {
  const all = load(db)
  return startsFresh(db, all, sceneId) ? startOf(db, all, sceneId) : null
}
