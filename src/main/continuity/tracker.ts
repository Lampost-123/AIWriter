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
// - Piece by piece (step 2b, Adam 2026-10-07): each piece of clothing, each thing in the place (a door barred, a case
//   on the windowsill), who touches whom and who can see or hear whom, each with its own words (@shared/stageItems).
// - One reading of a scene (overhaul phase 1, 2026-10-19): when the memory keeper reads exactly the words this tracker
//   would read next, its reading says where things stand at their end in the same call, kept here by the same rules
//   (stageToRead, keepStageRead), and this tracker's own call is skipped; otherwise it reads them itself, as before.
// - A scene the memory model turns down (some models won't read explicit scenes; 2026-10-16): the state before it is
//   carried on through it, marked unchecked, so the scenes after it don't lose what was worn, held or hurt before it;
//   Recall says so, and Adam can put right what the scene changed. The words it turned down are remembered with the
//   model, so they aren't sent (and paid for) again before every draft: only once the words change, another memory
//   model is picked, or Adam asks with Read again. With nothing kept for a scene at all, Recall starts from the state
//   before it too, so Adam can fill it in by hand.
// No Electron imports.

import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { ChatMessage, ID } from '@shared/types'
import {
  mergeState,
  newSceneStage,
  readChanges,
  samePlace,
  sameWhen,
  sourceKey,
  stateText,
  withEdits,
  withoutSceneTime,
  type SceneState,
  type StateEdits
} from '@shared/continuity'
import { sameMoment } from '../memory/calendar'
import { calendarOfScene } from '../memory/storyCalendar'
import { castBlock, STAGE_FIELD, STAGE_REPLY, STAGE_RULES, STAGE_SHAPE } from './stagePrompt'

export { mergeState, readChanges, stateText, withEdits, type SceneState, type StateEdits } from '@shared/continuity'
import * as repo from '../db/repo'
import * as kdb from '../db/keeper'
import { calledIn } from '../db/called'
import { namedInProse } from '@shared/names'
import { callModel, type MemoryModel } from '../keeper/model'
import { modelKeyOf } from '../keeper/refusals'
import { scenesBefore } from '../keeper/places'
import { estimateTokens } from '../keeper/text'

type DB = Database.Database

export const META_KEY = 'continuity'
const MARKER = '[AIWRITE-CONTINUITY v3]'

/** The most of a scene sent at once (characters); a longer one is read from its end, where it finishes. */
const SCENE_CHARS = 60_000
/** How many scenes before a draft's are brought up to date at most (oldest first, so each builds on the last). */
export const CATCH_UP = 3

interface Kept {
  /** The scene's words it was read from. */
  hash: string
  /** The state it built on (the scene before's), '' for none. */
  base: string
  /** As read, before Adam's edits. */
  state: SceneState
  edits?: StateEdits
  /** Not read from the scene's words: carried on from the scene before (turned down, or started by hand in Recall). */
  unchecked?: true
  /** The memory model (its key, refusals.ts) that turned the scene's words down: not asked again with these words. */
  refusedBy?: string
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

/** A scene's card's When and place, and its story, read without its words; null when the scene is gone. */
function whenOf(db: DB, sceneId: ID): { when: string; place: string; storyId: string } | null {
  const r = db
    .prepare('SELECT s.card_json AS card, c.story_id AS story FROM scenes s LEFT JOIN chapters c ON c.id = s.chapter_id WHERE s.id = ?')
    .get(sceneId) as { card: string | null; story: string | null } | undefined
  if (!r) return null
  try {
    const card = JSON.parse(r.card ?? '{}') as { when?: unknown; locationId?: unknown }
    return {
      when: typeof card?.when === 'string' ? card.when : '',
      place: typeof card?.locationId === 'string' ? card.locationId : '',
      storyId: r.story ?? ''
    }
  } catch {
    return { when: '', place: '', storyId: r.story ?? '' }
  }
}

/**
 * The state a scene starts from, given the one the scene before it (`prevId`) ends with: all of it, but the time of
 * day, the light and the weather only when both are the same moment in the same story. A new time starts fresh (Adam,
 * 2026-10-07): "morning" from the scene before was carried through a night scene and told to the writer, who had a man
 * say "Morning". The same moment is read on the story calendar (long story memory fix 11, memory/calendar.ts
 * sameMoment): the same day and the same time of day ("Day 3, evening", then "Later that evening"), never two different
 * days however alike their words ("The next day" twice); where the calendar can't tell (a day it can't place, or neither
 * says the time), both cards giving the same When, as before (sameWhen). Who touches whom and who can see or hear whom
 * never carry into a new scene, and the things in the place (a door barred, a case on the windowsill) only when both
 * cards name the same place, in the same story (step 2b, newSceneStage). Part of what the scene's reading builds on (its
 * hash), so a When or a place changed on a card means the scene is read again.
 */
function startFrom(db: DB, sceneId: ID, prevId: ID | undefined, state: SceneState | null): SceneState | null {
  if (!state || !prevId) return state
  const now = whenOf(db, sceneId)
  const then = whenOf(db, prevId)
  const story = !!now && !!then && now.storyId === then.storyId
  const timed = story && sameTime(db, sceneId, prevId, now!.when, then!.when) ? state : withoutSceneTime(state)
  return newSceneStage(timed, story && samePlace(now!.place, then!.place))
}

/** Whether a scene starts at the same moment the scene before it ended (startFrom): by the story calendar, else by the words. */
function sameTime(db: DB, sceneId: ID, prevId: ID, now: string, then: string): boolean {
  let moment: boolean | null = null
  try {
    const cal = calendarOfScene(db, sceneId)
    moment = cal ? sameMoment(cal.dates.get(prevId), cal.dates.get(sceneId)) : null
  } catch (e) {
    console.warn('Could not read the story calendar; going by the scene cards’ words', e)
  }
  return moment ?? sameWhen(now, then)
}

/**
 * The time of day the memory read from each scene's own words, as its end state was kept (where things stand: the
 * scene's time, when its words come from that scene and the reading still matches the scene's words), for the scenes
 * given; the story calendar takes it for a scene whose card has no When (long story memory fix 11, memory/calendar.ts
 * withCues). Never a day.
 */
export function timeCues(db: DB, sceneIds: readonly ID[]): Map<ID, string> {
  const out = new Map<ID, string>()
  if (!sceneIds.length) return out
  const all = load(db)
  for (const id of sceneIds) {
    const k = all[id]
    if (!k) continue
    const state = withEdits(k.state, k.edits)
    const time = state.time.trim()
    if (!time || state.said?.[sourceKey(null, 'time')]?.sceneId !== id) continue
    if (k.hash !== hashOf(kdb.keeperScene(db, id)?.text ?? '')) continue
    out.set(id, time)
  }
  return out
}

/**
 * The scenes before this one on the story's line that have words, in order: an empty scene (one not written yet) passes
 * nothing on and is passed over, so the scene after it starts where the one before it ends (review, 2026-10-16: an empty
 * scene between left the next one with nothing to start from). Never back into an earlier book, as the writer's scene
 * before isn't (memory/scene.ts previousScene): with nothing written in the story of the scene just before, that empty
 * scene stays last and passes nothing on.
 */
function wordedBefore(db: DB, sceneId: ID): ID[] {
  const line = scenesBefore(db, sceneId)
  const has = (id: ID): boolean => !!kdb.keeperScene(db, id)?.text.trim()
  const worded = line.filter(has)
  const last = line.at(-1)
  if (!last || has(last)) return worded
  const prev = worded.at(-1)
  return prev && kdb.keeperScene(db, prev)?.storyId === kdb.keeperScene(db, last)?.storyId ? worded : [...worded, last]
}

/**
 * The state a scene's own reading builds on: the one kept for the scene before it on the story's line (with a new time
 * starting fresh, startFrom). The scene's end and its checkpoints are all keyed to it, so every reading of the scene
 * finds the same checkpoints.
 */
const startOf = (db: DB, all: Stored, sceneId: ID): SceneState | null => {
  const prev = wordedBefore(db, sceneId).at(-1)
  return startFrom(db, sceneId, prev, finalOf(all, prev))
}

/**
 * True when the scenes a draft brings up to date (the last few before this one) are each kept from their words as
 * they are now, built on the one before: what the scene starts from is no ghost. Looser than `stands`, which goes all
 * the way back, so a scene far back waiting to be read again doesn't leave the scene so far with nothing.
 */
function startsFresh(db: DB, all: Stored, sceneId: ID): boolean {
  const line = wordedBefore(db, sceneId)
  return line.slice(-CATCH_UP).every((id) => {
    const k = all[id]
    if (!k) return true
    const i = line.indexOf(id)
    return (
      k.hash === hashOf(kdb.keeperScene(db, id)?.text ?? '') &&
      k.base === stateHash(i > 0 ? startFrom(db, id, line[i - 1], finalOf(all, line[i - 1])) : null)
    )
  })
}

/**
 * True when a kept state still stands: read from the scene's words as they are now, built on the state the scene
 * before ends with now, and that one standing too, all the way back. Anything else would be a ghost (a cloak taken
 * off in an earlier scene's new words, still worn here), and is worked out again before it is used.
 */
function stands(db: DB, all: Stored, sceneId: ID): boolean {
  const line = [...wordedBefore(db, sceneId), sceneId]
  let ok = true
  for (let i = 0; i < line.length; i++) {
    const k = all[line[i]]
    // A scene with nothing kept (never read, or no words) passes nothing on: the next one builds on nothing.
    if (!k) {
      ok = true
      continue
    }
    const scene = kdb.keeperScene(db, line[i])
    const before = i > 0 && all[line[i - 1]] ? startFrom(db, line[i], line[i - 1], finalOf(all, line[i - 1])) : null
    ok = ok && !!scene && k.hash === hashOf(scene.text) && k.base === stateHash(before)
  }
  return !!all[sceneId] && ok
}

/**
 * The state kept for a scene's end (with Adam's edits), and whether it still stands. `unchecked`: carried on from the
 * scene before rather than read from this one's words; `refused`: because the memory model turned the scene down.
 */
export function storedState(
  db: DB,
  sceneId: ID
): { state: SceneState; current: boolean; edited: boolean; unchecked: boolean; refused: boolean } | null {
  const all = load(db)
  const kept = all[sceneId]
  if (!kept) return null
  return {
    state: withEdits(kept.state, kept.edits),
    current: stands(db, all, sceneId),
    edited: !!kept.edits,
    unchecked: !!kept.unchecked,
    refused: !!kept.refusedBy
  }
}

/**
 * The states kept for these scenes' ends (with Adam's edits), from one read of the store (the story index,
 * storyIndex/index.ts, reads a whole story at once). `fresh`: read from the scene's words as they are now. Unlike
 * storedState's `current`, it doesn't ask whether the scenes before still stand: the index keeps only the values a scene's
 * own words gave (`said`), which no earlier scene's new words can make a ghost.
 */
export function keptStates(
  db: DB,
  sceneIds: readonly ID[]
): Map<ID, { state: SceneState; fresh: boolean; edited: boolean }> {
  const out = new Map<ID, { state: SceneState; fresh: boolean; edited: boolean }>()
  if (!sceneIds.length) return out
  const all = load(db)
  for (const id of sceneIds) {
    const kept = all[id]
    if (!kept) continue
    const scene = kdb.keeperScene(db, id)
    out.set(id, {
      state: withEdits(kept.state, kept.edits),
      fresh: !!scene && kept.hash === hashOf(scene.text),
      edited: !!kept.edits
    })
  }
  return out
}

function save(db: DB, all: Stored): void {
  // Scenes that are gone take their state with them.
  for (const id of Object.keys(all)) if (!kdb.keeperScene(db, id)) delete all[id]
  repo.setMeta(db, META_KEY, JSON.stringify(all))
}

/** Told when where things stand as a scene ends is kept anew (worked out, carried on through it, or changed by Adam). */
export type StageKept = (db: DB, sceneId: ID) => void
const stageListeners: StageKept[] = []

/**
 * Listens for a scene's end state being kept anew (the story index brings that scene's rows up to date: storyIndex/
 * upkeep.ts). Returns the way to stop listening. A listener that throws is logged; it never stops the tracker.
 */
export function onStageKept(fn: StageKept): () => void {
  stageListeners.push(fn)
  return () => {
    const i = stageListeners.indexOf(fn)
    if (i >= 0) stageListeners.splice(i, 1)
  }
}

function stageKept(db: DB, sceneId: ID): void {
  for (const fn of [...stageListeners]) {
    try {
      fn(db, sceneId)
    } catch (e) {
      console.warn('Something listening for where things stand failed', e)
    }
  }
}

/** Nothing known yet. */
const EMPTY: SceneState = { time: '', weather: '', light: '', things: [], characters: [] }

/**
 * Adam changes a scene's state: a value, a piece of clothing or a thing, or a character taken out. Kept until the
 * scene's words change. `change` is given the state as he sees it (with his edits so far). With nothing kept for the
 * scene (never read, or it couldn't be), his changes start from the state the scene starts from, marked unchecked, so
 * he can fill it in by hand; the memory still reads the scene when it can. False only when the scene is gone.
 */
export function editState(db: DB, sceneId: ID, change: (edits: StateEdits, state: SceneState) => void): boolean {
  const scene = kdb.keeperScene(db, sceneId)
  if (!scene) return false
  const all = load(db)
  const start = all[sceneId] ? null : startOf(db, all, sceneId)
  const k = (all[sceneId] ??= { hash: hashOf(scene.text), base: stateHash(start), state: start ?? EMPTY, unchecked: true })
  const edits: StateEdits = k.edits ?? {}
  change(edits, withEdits(k.state, k.edits))
  k.edits = edits
  save(db, all)
  stageKept(db, sceneId)
  // When the scene goes on from here, the reading starts from his version. Only when his version still stands (one laid
  // over an old start would set aside the checkpoints that do), and was read from the scene's words: one carried on
  // from the scene before would stand in for the reading it is waiting for.
  if (!k.unchecked && stands(db, all, sceneId)) keepPoint(db, sceneId, k.base, scene.text, withEdits(k.state, edits))
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

/** The memory model turned the words down (keeper/model.ts tells a refusal apart). */
const REFUSED = 'refused'
type Reading = SceneState | null | typeof REFUSED

/** What the memory model is asked for one scene, or for the rest of a scene from a checkpoint. */
export function stateMessages(before: SceneState | null, sceneText: string, cast: string[], ask: StateAsk = {}): ChatMessage[] {
  // The shape and the rules are shared with the memory keeper's reading of a scene, which can say where things stand at
  // its end in the same call (one reading of a scene, overhaul phase 1: stagePrompt.ts).
  const system = `${MARKER} state
You keep track of continuity for a novel, so the next scenes are written consistently. Given where things stood before a scene and the scene's text, say what the scene changes, so it is known where things stand at the END of it.

Reply with only a JSON object. Each value is ${STAGE_FIELD}: the value as it is at the end, and the quote: the exact words in the scene that show it, copied word for word (a few words to a sentence; join two places with …):
${STAGE_SHAPE}

${STAGE_RULES}`
  const from = ask.after?.trim()
  const user = [
    castBlock(cast),
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
 * words). Null when the scene has no words or the model couldn't say. When the model turns the scene down, the state
 * before it is kept for it, carried on and marked unchecked (and returned), so the scenes after it keep what came
 * before; it isn't asked again with these words and this model unless `force` (Recall's Read again) says so. A state
 * carried on for any other reason (started by hand in Recall) is read as soon as the model can.
 */
export async function stateAfter(o: TrackOptions, sceneId: ID, force = false): Promise<SceneState | null> {
  const scene = kdb.keeperScene(o.db, sceneId)
  if (!scene || !scene.text.trim()) return null
  const hash = hashOf(scene.text)
  const model = modelKeyOf(o.model)
  const all = load(o.db)
  const kept = all[sceneId]
  if (kept && stands(o.db, all, sceneId) && !(kept.unchecked && (force || kept.refusedBy !== model))) return withEdits(kept.state, kept.edits)
  const before = startOf(o.db, all, sceneId)
  const read = await readUpTo(o, sceneId, before, scene.text, false, force)
  if (!read) return null
  const now = load(o.db)
  // Adam's edits stay while the words are the ones he edited against; new words are read afresh (from the checkpoint
  // his edits were laid over, so what he put right carries on). Taken as they are now: he may have changed a value
  // while the model was reading.
  const edits = now[sceneId]?.hash === hash ? now[sceneId].edits : undefined
  if (read === REFUSED) {
    // Carried on through the scene: as it was at the latest point read in it, else as it began.
    const carried = pointFor(o.db, sceneId, stateHash(before), scene.text)?.state ?? before ?? EMPTY
    now[sceneId] = { hash, base: stateHash(before), state: carried, ...(edits ? { edits } : {}), unchecked: true, refusedBy: model }
  } else now[sceneId] = { hash, base: stateHash(before), state: read, ...(edits ? { edits } : {}) }
  save(o.db, now)
  stageKept(o.db, sceneId)
  return withEdits(now[sceneId].state, now[sceneId].edits)
}

/** The most characters in the cast list the memory model is given. */
export const MOST_CAST = 80

/**
 * The cast list for reading a scene (Adam, 2026-10-16: it was the first 80 names in the world, A to Z, with no other names,
 * so a long book's cast past "M" was missing and "the Captain" matched no one): those on the scene card first, then those
 * its words name (by name, other name, or what this scene's words call them: db/called.ts), then the rest A to Z, at most
 * MOST_CAST; each with its other names ("Mara Venn (also Mara; the Captain)").
 */
export function castFor(db: DB, sceneId: ID, text: string): string[] {
  const card = (() => {
    try {
      return repo.getScene(db, sceneId).card
    } catch {
      return null
    }
  })()
  const onCard = new Set([card?.povId, ...(card?.presentIds ?? [])].filter((x): x is ID => !!x))
  const called = new Map<ID, string[]>()
  for (const c of calledIn(db, sceneId)) called.set(c.entryId, [...(called.get(c.entryId) ?? []), c.words])
  const people = repo.listEntries(db, 'character').map((e, i) => {
    const others = [...new Set([...(e.aliases ?? []), ...(called.get(e.id) ?? [])].map((x) => x.replace(/\s+/g, ' ').trim()))].filter(
      (x) => x && x.toLowerCase() !== e.name.toLowerCase()
    )
    const named = [e.name, ...others].some((n) => namedInProse(text, n))
    return { line: others.length ? `${e.name} (also ${others.join('; ')})` : e.name, rank: onCard.has(e.id) ? 0 : named ? 1 : 2, i }
  })
  return people
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .slice(0, MOST_CAST)
    .map((p) => p.line)
}

/** Asks the memory model where things stand after `text`, laid over `before`. Null when it couldn't say; REFUSED when it turned the words down. */
async function askState(o: TrackOptions, sceneId: ID, before: SceneState | null, text: string, ask: StateAsk): Promise<Reading> {
  const messages = stateMessages(before, text, castFor(o.db, sceneId, text), ask)
  const got = await callModel({
    db: o.db,
    model: o.model,
    targetId: sceneId,
    job: 'memory',
    task: 'stage',
    messages,
    blocks: [{ id: 'continuity', title: 'Where things stand', text: messages[1].content, tokens: estimateTokens(messages[1].content), priority: 1, dropped: false, short: false, entryIds: [] }],
    maxTokens: STAGE_REPLY,
    signal: o.signal,
    closed: o.closed,
    // Read in the background: a provider that has stopped answering is given up on sooner (ai/patience.ts).
    background: true,
    fetchImpl: o.fetchImpl,
    retryDelays: o.retryDelays
  })
  if (o.closed() || !o.db.open) return null
  if (got.failure?.type === 'refused') return REFUSED
  // Nothing to go on: no state rather than one the words no longer support.
  if (got.status !== 'complete') return null
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
 * checkpoint. Null when the model couldn't say; REFUSED when it turned the words down, now or before (the words it
 * turned down are still there, and it is the same model), unless `force`.
 */
async function readUpTo(o: TrackOptions, sceneId: ID, before: SceneState | null, text: string, soFar: boolean, force = false): Promise<Reading> {
  const base = stateHash(before)
  const from = pointFor(o.db, sceneId, base, text)
  if (from && !text.slice(from.at).trim()) return from.state
  const model = modelKeyOf(o.model)
  if (!force && refusedAt(o.db, sceneId, text, model)) return REFUSED
  const state = from
    ? await askState(o, sceneId, from.state, text.slice(from.at), { soFar, after: text.slice(Math.max(0, from.at - LEAD_IN), from.at) })
    : await askState(o, sceneId, before, text, { soFar })
  if (state === REFUSED) {
    keepRefused(o.db, sceneId, text, model)
    return REFUSED
  }
  if (!state) return null
  keepPoint(o.db, sceneId, base, text, state)
  return state
}

// ---------- Words the memory model turned down ----------
// Kept in the world's `meta` under 'continuity-refused', by scene: how far into the scene's words the turned-down
// reading went (and those words' hash), and the model. A later reading of words that still start with them, by the same
// model, isn't asked for (whatever the scenes before now say: it is the words it turns down), as it would be turned
// down again.

export const REFUSED_KEY = 'continuity-refused'

interface RefusedPoint {
  at: number
  hash: string
  model: string
}

function loadRefused(db: DB): Record<ID, RefusedPoint> {
  try {
    const raw = JSON.parse(repo.getMeta(db, REFUSED_KEY) ?? '{}') as unknown
    return raw && typeof raw === 'object' ? (raw as Record<ID, RefusedPoint>) : {}
  } catch {
    return {}
  }
}

/** True when `model` turned down words that `text` still starts with. */
function refusedAt(db: DB, sceneId: ID, text: string, model: string): boolean {
  const r = loadRefused(db)[sceneId]
  return !!r && r.model === model && r.at <= text.length && hashOf(text.slice(0, r.at)) === r.hash
}

/**
 * True when the memory model (`model`, its key) turned down the words of the scene up to the end of `text`, or words
 * `text` starts with: Recall at the cursor says so rather than "try again". No model is asked.
 */
export function turnedDown(db: DB, sceneId: ID, text: string, model: string): boolean {
  return refusedAt(db, sceneId, text, model)
}

function keepRefused(db: DB, sceneId: ID, text: string, model: string): void {
  if (!db.open) return
  const all = loadRefused(db)
  all[sceneId] = { at: text.length, hash: hashOf(text), model }
  // Scenes that are gone take theirs with them.
  for (const id of Object.keys(all)) if (!kdb.keeperScene(db, id)) delete all[id]
  repo.setMeta(db, REFUSED_KEY, JSON.stringify(all))
}

/**
 * Where things stand at the end of `text`, the scene so far (the words before a Continue, or before a beat or Add
 * below): built on where things stood as the scene before it ended, brought up to date first. When `text` is the
 * scene's saved words this is the scene's own state (kept, and shown in Recall); otherwise it is worked out from the
 * latest checkpoint before it and kept as a checkpoint. With no words, the state the scene starts from. Null when the
 * memory model couldn't say (never the state before in its place: that would be told as the scene so far's).
 */
export async function stateAtText(o: TrackOptions, sceneId: ID, text: string, force = false): Promise<SceneState | null> {
  // The scene before's end, just brought up to date: what the scene's own state builds on too (startOf), so both
  // readings, and Recall at the cursor, find the same checkpoints. Nothing when it couldn't be read from its words as
  // they are now: never a ghost.
  await stateBefore(o, sceneId)
  const all = load(o.db)
  if (!startsFresh(o.db, all, sceneId)) return null
  const before = startOf(o.db, all, sceneId)
  if (!text.trim() || o.signal.aborted || o.closed()) return before
  const scene = kdb.keeperScene(o.db, sceneId)
  if (scene && scene.text.trim() === text.trim()) return stateAfter(o, sceneId, force)
  try {
    const read = await readUpTo(o, sceneId, before, text, true, force)
    // Turned down: nothing is told as the scene so far's (never the state before in its place).
    return read === REFUSED ? null : read
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
    const before = wordedBefore(o.db, sceneId).slice(-CATCH_UP)
    let last: SceneState | null = null
    for (const id of before) {
      if (o.signal.aborted || o.closed()) break
      last = (await stateAfter(o, id)) ?? last
    }
    const prev = before.at(-1)
    if (!prev) return null
    const all = load(o.db)
    // Only a state that still stands is told; otherwise nothing, rather than a ghost.
    return stands(o.db, all, prev) ? startOf(o.db, all, sceneId) : startFrom(o.db, sceneId, prev, last)
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

// ---------- One reading of a scene (overhaul phase 1, 2026-10-19) ----------
// The memory keeper reads a scene's new and changed paragraphs (keeper/run.ts). When those are exactly the words this
// tracker would read next (the whole scene from its start, or everything after its latest checkpoint that still matches),
// the same call says where things stand at their end, laid over the same state this tracker would lay it over, and it is
// kept here as this tracker's own reading would be (stageToRead, keepStageRead): the tracker's own call is skipped. In
// every other case (an edit in the middle, a scene read in parts, the scenes before not yet brought up to date) the
// tracker works it out as before. Nothing is kept that its words or the state it built on no longer support.

/** What a reading of a scene is asked about where things stand, and what it builds on (stageToRead). */
export interface StageAsk {
  sceneId: ID
  /** The scene's words when it was asked (the end state is kept against their hash). */
  text: string
  /** The hash of the state the scene starts from: what its reading builds on (as stateAfter keeps it). */
  base: string
  /** Where things stand before `words`: the latest checkpoint that matches, else the scene's start; null when nothing is known. */
  before: SceneState | null
  /** How far into `text` that checkpoint is (0: the scene's start). */
  at: number
  /** The words to read: `text` from `at`. */
  words: string
  /** The cast list, as the tracker's own request gives it. */
  cast: string[]
}

/**
 * True when the last few scenes before this one (those a draft brings up to date first: stateBefore) each have where
 * things stand kept from their words as they are now, built on the one before, and not waiting to be read again: a
 * reading of this scene now builds on what the tracker itself would build on. A scene with words and nothing kept, or one
 * carried on unchecked that this model didn't turn down, would be worked out first and change what this scene starts from.
 */
function startsKept(db: DB, all: Stored, sceneId: ID, model: string): boolean {
  const line = wordedBefore(db, sceneId)
  return line.slice(-CATCH_UP).every((id) => {
    const k = all[id]
    const text = kdb.keeperScene(db, id)?.text ?? ''
    if (!k) return !text.trim()
    if (k.unchecked && k.refusedBy !== model) return false
    const i = line.indexOf(id)
    return k.hash === hashOf(text) && k.base === stateHash(i > 0 ? startFrom(db, id, line[i - 1], finalOf(all, line[i - 1])) : null)
  })
}

/**
 * What a reading of the scene's words now would be asked about where things stand at their end: the words the tracker
 * would read next (the whole scene, or what follows its latest checkpoint that still matches), on the state it would lay
 * them over. Null when nothing need be asked (kept already for these words, or for all of them at a checkpoint), when this
 * model turned these words down before (the tracker carries the state on through them), or when the scenes before aren't
 * kept from their words as they are now (the tracker brings them up to date first, then reads this one itself). No model
 * is asked.
 */
export function stageToRead(db: DB, sceneId: ID, m: MemoryModel): StageAsk | null {
  const scene = kdb.keeperScene(db, sceneId)
  if (!scene || !scene.text.trim()) return null
  const model = modelKeyOf(m)
  const all = load(db)
  const kept = all[sceneId]
  // (Its own words first: a read is mostly of words changed since, and then nothing need be walked.)
  if (kept && kept.hash === hashOf(scene.text) && !(kept.unchecked && kept.refusedBy !== model) && stands(db, all, sceneId)) return null
  if (refusedAt(db, sceneId, scene.text, model)) return null
  if (!startsKept(db, all, sceneId, model)) return null
  const start = startOf(db, all, sceneId)
  const base = stateHash(start)
  const from = pointFor(db, sceneId, base, scene.text)
  const at = from?.at ?? 0
  const words = scene.text.slice(at)
  if (!words.trim()) return null
  return { sceneId, text: scene.text, base, before: from ? from.state : start, at, words, cast: castFor(db, sceneId, scene.text) }
}

/**
 * Keeps where things stand at the end of a scene from the reading that was asked `ask` (stageToRead), its reply's "stage"
 * being what the tracker's own reply would be: each value only with words from what was read (readChanges), laid over the
 * state before (mergeState), kept as a checkpoint and as the scene's end, Adam's Recall edits staying while the words are
 * the ones he edited against, and the story index told (onStageKept). Nothing is kept when the state the reading built on
 * has changed since (it would be a ghost), and the end is kept only while the scene's words are still the ones read (else
 * only the checkpoint, which the tracker reads on from); one worked out meanwhile for these same words stays. True when
 * where things stand at the scene's end is now kept for its words, so the tracker needn't ask.
 */
export function keepStageRead(db: DB, ask: StageAsk, reply: unknown): boolean {
  if (!db.open || !reply || typeof reply !== 'object' || Array.isArray(reply)) return false
  const read = readChanges(JSON.stringify(reply), ask.words, ask.sceneId)
  if (!read) return false
  const scene = kdb.keeperScene(db, ask.sceneId)
  if (!scene) return false
  const all = load(db)
  if (stateHash(startOf(db, all, ask.sceneId)) !== ask.base) return false
  const state = mergeState(ask.before, read)
  keepPoint(db, ask.sceneId, ask.base, ask.text, state)
  const hash = hashOf(ask.text)
  if (hashOf(scene.text) !== hash) return false
  const kept = all[ask.sceneId]
  if (kept && !kept.unchecked && kept.hash === hash && kept.base === ask.base) return true
  const edits = kept?.hash === hash ? kept.edits : undefined
  all[ask.sceneId] = { hash, base: ask.base, state, ...(edits ? { edits } : {}) }
  save(db, all)
  stageKept(db, ask.sceneId)
  return true
}
