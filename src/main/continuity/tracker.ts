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
import {
  mergeState,
  readState,
  stateText,
  withEdits,
  type SceneState,
  type StateEdits
} from '@shared/continuity'

export { mergeState, readState, stateText, withEdits, type SceneState, type StateEdits } from '@shared/continuity'
import * as repo from '../db/repo'
import * as kdb from '../db/keeper'
import { callModel, type MemoryModel } from '../keeper/model'
import { scenesBefore } from '../keeper/places'
import { estimateTokens } from '../keeper/text'

type DB = Database.Database

export const META_KEY = 'continuity'
const MARKER = '[AIWRITE-CONTINUITY v1]'

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
  return true
}

/** What the memory model is asked for one scene. */
export function stateMessages(before: SceneState | null, sceneText: string, cast: string[]): ChatMessage[] {
  const system = `${MARKER} state
You keep track of continuity for a novel, so the next scenes are written consistently. Given where things stood before a scene and the scene's text, say where things stand at the END of the scene.

Reply with only a JSON object:
{"time": "", "weather": "", "light": "", "characters": [{"name": "", "where": "", "wearing": "", "posture": "", "holding": "", "condition": "", "mood": "", "lastAction": ""}]}

- time: time of day (and date, if the story gives one); weather; light (lamplight, dusk, harsh sun).
- One entry for each character who is in the scene or whose situation it changes, by their name as the cast list has it.
- where: where they are at the end, as exactly as the text allows (the inn's back room, by the hearth).
- wearing: what they have on, including anything put on, taken off, torn or soaked.
- posture: how they are placed (standing, sitting on the bed, lying on the floor, kneeling).
- holding: what they hold or carry.
- condition: injuries, exhaustion, hunger, drunkenness, anything about their body that lasts.
- mood: how they feel at the end.
- lastAction: the last thing they did, in a few words.
- Each value under 12 words. Give a value only when the scene shows it or it carries on from before; "" when unknown. When something has changed, give only the new state, never the old one.`
  const user = [
    cast.length ? `Characters in this story: ${cast.join(', ')}` : '',
    `Before this scene:\n${before ? stateText(before) || '(nothing known yet)' : '(nothing known yet: this may be the opening)'}`,
    `The scene:\n"""\n${sceneText.length > SCENE_CHARS ? `…${sceneText.slice(-SCENE_CHARS)}` : sceneText}\n"""`
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
 * for the scene before it on the story's line). Null when the scene has no words or the model couldn't say.
 */
export async function stateAfter(o: TrackOptions, sceneId: ID): Promise<SceneState | null> {
  const scene = kdb.keeperScene(o.db, sceneId)
  if (!scene || !scene.text.trim()) return null
  const hash = hashOf(scene.text)
  const all = load(o.db)
  const kept = all[sceneId]
  if (kept && stands(o.db, all, sceneId)) return withEdits(kept.state, kept.edits)
  const before = finalOf(all, scenesBefore(o.db, sceneId).at(-1))
  const cast = repo
    .listEntries(o.db, 'character')
    .map((e) => e.name)
    .slice(0, 80)
  const messages = stateMessages(before, scene.text, cast)
  const got = await callModel({
    db: o.db,
    model: o.model,
    targetId: sceneId,
    job: 'memory',
    messages,
    blocks: [{ id: 'continuity', title: 'Where things stand', text: messages[1].content, tokens: estimateTokens(messages[1].content), priority: 1, dropped: false, short: false, entryIds: [] }],
    maxTokens: 2000,
    signal: o.signal,
    closed: o.closed,
    fetchImpl: o.fetchImpl,
    retryDelays: o.retryDelays
  })
  // Nothing to go on: no state rather than one the words no longer support.
  if (got.status !== 'complete' || o.closed() || !o.db.open) return null
  const read = readState(got.text)
  if (!read) return null
  const state = mergeState(before, read)
  const now = load(o.db)
  // Adam's edits stay while the words are the ones he edited against; new words are read afresh.
  now[sceneId] = { hash, base: stateHash(before), state, ...(kept?.hash === hash && kept.edits ? { edits: kept.edits } : {}) }
  save(o.db, now)
  return withEdits(state, now[sceneId].edits)
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

/** The state a scene starts from, as kept (no model is asked): the previous scene's end, if it still stands. */
export function keptStateBefore(db: DB, sceneId: ID): SceneState | null {
  const prev = scenesBefore(db, sceneId).at(-1)
  if (!prev) return null
  const all = load(db)
  return stands(db, all, prev) ? finalOf(all, prev) : null
}
