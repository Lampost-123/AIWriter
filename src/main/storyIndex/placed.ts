// Place memory (2026-10-19; a live finding: a letter's hiding place drifted across chapters). Where things stand keeps the
// things in a place (a case on the windowsill, a letter under the loose hearthstone) only while the story stays there: a
// scene somewhere else starts without them (shared/continuity.ts newSceneStage), and nothing brought them back when the
// story returned. So the story index keeps each thing left in a place as a dated fact of its own ('placed': the place
// entry, the thing, where and how it is there, the words that show it), built for free from where things stand scene by
// scene, and closed when the thing is
// - taken: someone holds it, by the scene's own words (the stage's "holding");
// - moved: the same thing put somewhere else, or the same place saying something else of it;
// - gone: the scene right before, at the same place, had it, and this scene doesn't (picked up, burnt, carried off).
// Read back as "Left here before: …" for a scene whose card returns to the place, a room inside it, or the house a room
// is in (leftHere: the plan's gathered core and the writer's briefing), and by the where_is look-up (whereIs). The
// tracker's own rules are kept: nothing is put back into where things stand itself. No Electron imports.

import type { ID } from '@shared/types'
import { sourceKey, thingKey, thingsOf, type SceneState, type StateSource } from '@shared/continuity'
import { itemKey, matching, MOST_THINGS, singular, type StageItem } from '@shared/stageItems'
import * as sidx from '../db/storyIndex'
import type { IndexWorld, SceneSource } from './build'
import type { IndexOrigin, NewIndexFact, PlacedFact } from './types'

type DB = Parameters<typeof sidx.indexScene>[0]

const clean = (s: unknown): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '')
const compared = (s: string): string =>
  clean(s)
    .replace(/[.;,]+$/, '')
    .toLowerCase()

// ---------- What can be left in a place ----------

/** Words for part of a place itself, or what is there only for the moment: never "left" anywhere. */
const FIXED = new Set(
  `door doorway gate window shutter curtain blind fire hearth fireplace grate stove oven chimney light lamp candle lantern
  torch bed table chair bench settle stool floor floorboard wall roof ceiling stair staircase step room hall air smoke rain
  water mud dust blood sunlight moonlight shadow latch bolt bar lock`.split(/\s+/)
)
/** Words saying where in the place a thing is. */
const WHERE_WORDS =
  'on|in|inside|under|underneath|beneath|behind|beside|by|near|next to|against|atop|among|between|within|into|onto|at|hidden|buried|tucked|wedged|stuffed|hung|hanging|propped|stowed|left|lying|leaning|set|laid|placed|locked away'
const SAYS_WHERE = new RegExp(`\\b(?:${WHERE_WORDS})\\b`, 'i')
const STARTS_WHERE = new RegExp(`^(?:${WHERE_WORDS})\\b`, 'i')
/** A state that has the thing on someone, not in the place: held, worn, in a hand or a pocket, with someone. */
const ON_SOMEONE = /\b(?:held|holding|carried|carrying|clutched|clutching|gripped|worn|wearing)\b/i
const ON_BODY =
  /\b(?:her|his|their|my|your|its|[A-Z][\p{L}]*['’]s)\s+(?:[\p{L}-]+\s+)?(?:hand|hands|grip|grasp|pocket|pockets|lap|arm|arms|fist|palm|fingers|belt|bodice|sleeve|coat|cloak|jacket|satchel|bag|pack|purse|boot|boots|apron|skirt|skirts)\b/u
const WITH_SOMEONE = /\bwith\s+(?:[A-Z][\p{L}]+)\b/u

/** True for a thing that can be left in a place and found there later: not part of the place, said where it is, not on anyone. */
export function leftable(t: StageItem): boolean {
  const key = itemKey(t.name)
  const head = singular(key.split(' ').at(-1) ?? '')
  if (head.length < 3 || FIXED.has(head)) return false
  const state = clean(t.state)
  return SAYS_WHERE.test(state) && !ON_SOMEONE.test(state) && !ON_BODY.test(state) && !WITH_SOMEONE.test(state)
}

/** True when two names are the same thing (shared/stageItems.ts matching): "letter" is "the letter" and "the sealed letter". */
export function sameThing(a: string, b: string): boolean {
  if (!itemKey(a) || !itemKey(b)) return false
  return matching([{ name: a, state: 'x' }], b, false).length > 0
}

const NOT_HELD = new Set(['nothing', 'none', 'empty', 'hand', 'hands', 'nothing at all'])

/**
 * The things a "holding" names, as compared ("the letter, tucked in her bodice; a lantern" is "letter" and "lantern"):
 * each piece without where on them it is.
 */
export function heldNames(text: string): string[] {
  const out: string[] = []
  for (const piece of clean(text).split(/\s*(?:[,;]|\band\b|\bwith\b|\bplus\b)\s*/i)) {
    const core = piece.replace(
      /(?:^|\s+)(?:in|on|under|at|by|from|to|inside|behind|between|against|over|into|onto|beneath|across|around|tucked|folded|clutched|held|wrapped|rolled|pressed|close)\b.*$/i,
      ''
    )
    const key = itemKey(core)
    if ((key.split(' ').at(-1) ?? '').length >= 3 && !NOT_HELD.has(key) && !out.includes(key)) out.push(key)
  }
  return out
}

/** A placed fact's value read back: the thing's name and where and how it is ("the letter", "under the loose hearthstone"). */
export function splitPlaced(value: string): { name: string; how: string } {
  const at = value.indexOf(': ')
  return at < 0 ? { name: clean(value), how: '' } : { name: clean(value.slice(0, at)), how: clean(value.slice(at + 2)) }
}

/** A thing and where it is, as a line says it: "the letter under the loose hearthstone", "the case, shut, on the sill". */
export function placedText(name: string, how: string): string {
  if (!how) return name
  return STARTS_WHERE.test(how) ? `${name} ${how}` : `${name}, ${how}`
}

/** Where a thing was left, after "left": "under the loose hearthstone", or "there (shut, on the sill)". */
export const leftWords = (how: string): string => (!how ? 'there' : STARTS_WHERE.test(how) ? how : `there (${how})`)

// ---------- Building: one scene's placed facts ----------

/**
 * One scene's placed facts, from where things stand as it ends (no AI call): each thing in the card's place whose words
 * are this scene's (or Adam set in Recall), a thing gone from the place since the scene right before it there, and an end
 * for each thing someone here holds by this scene's words (taken, wherever it was). `src.thingsBefore`: the things as the
 * scene right before ended, when it has where things stand, with its card's place.
 */
export function placedFacts(src: SceneSource, world: IndexWorld): NewIndexFact[] {
  if (!src.stage) return []
  const { state, edited } = src.stage
  const place = src.card.locationId && world.entries.get(src.card.locationId)?.kind === 'place' ? src.card.locationId : null
  /** Whose a value is: the stage's (with its words), Adam's, or no one's here (null: carried from elsewhere). As stageFacts. */
  const whose = (said: StateSource | undefined): { origin: IndexOrigin; quote: string } | null => {
    if (said?.sceneId === src.sceneId) return { origin: 'tracker', quote: said.line ? '' : said.quote }
    if (said) return null
    if (edited) return { origin: 'hand', quote: '' }
    return state.said ? null : { origin: 'tracker', quote: '' }
  }
  const out: NewIndexFact[] = []
  const add = (entryId: ID | null, slot: string, value: string, by: { origin: IndexOrigin; quote: string }): void => {
    out.push({ entryId, kind: 'placed', slot, value: clean(value), fromSceneId: src.sceneId, quote: clean(by.quote), origin: by.origin })
  }
  const things = thingsOf(state)
  if (place) {
    for (const t of things) {
      if (!leftable(t)) continue
      const by = whose(state.said?.[thingKey(t.name)])
      if (by) add(place, itemKey(t.name), `${clean(t.name)}: ${clean(t.state)}`, by)
    }
    // Gone from here: the scene right before, in the same place, had it, and this one doesn't (never when the list is
    // full: a thing may only have made room for newer ones).
    const before = src.thingsBefore
    if (before && before.placeId === place && things.length < MOST_THINGS) {
      for (const b of before.things) {
        if (leftable(b) && !matching(things, b.name, false).length) add(place, itemKey(b.name), '', { origin: edited ? 'hand' : 'tracker', quote: '' })
      }
    }
  }
  // Taken: someone holds it now, by this scene's words (wherever it was left).
  const calledHere = new Map(src.called.map((c) => [clean(c.words).toLowerCase(), c.entryId]))
  for (const c of state.characters) {
    if (!clean(c.holding)) continue
    const by = whose(state.said?.[sourceKey(c.name, 'holding')])
    if (!by) continue
    const lower = clean(c.name).toLowerCase()
    const id = world.byName.get(lower) ?? calledHere.get(lower) ?? null
    for (const k of heldNames(c.holding)) add(id, `taken:${k}`, '', by)
  }
  return out
}

// ---------- Where each placed fact stops ----------

/**
 * Where each placed fact stops, for those whose stored end is different (storyIndex/link.ts factEnds asks): a thing left
 * stays until a later row says it was taken (anyone holding it, wherever), gone from that place, or put somewhere else or
 * otherwise in the same place; the same again carries it on. `rows` in story order, ends before starts within a scene.
 */
export function placedEnds(rows: readonly PlacedFact[]): { id: ID; untilSceneId: ID | null }[] {
  type Open = { rows: PlacedFact[]; place: ID | null; slot: string; name: string; value: string }
  let open: Open[] = []
  const until = new Map<ID, ID | null>()
  const close = (list: Open[], at: ID): void => {
    for (const o of list) for (const r of o.rows) until.set(r.id, at)
    open = open.filter((o) => !list.includes(o))
  }
  const placed = rows.filter((r) => r.kind === 'placed')
  for (const r of placed) {
    if (!r.value) {
      until.set(r.id, null)
      const taken = r.slot.startsWith('taken:')
      const key = taken ? r.slot.slice('taken:'.length) : r.slot
      close(
        open.filter((o) => (taken || o.place === r.entryId) && sameThing(o.name, key)),
        r.fromSceneId
      )
      continue
    }
    const { name } = splitPlaced(r.value)
    const same = open.find((o) => o.place === r.entryId && o.slot === r.slot && compared(o.value) === compared(r.value))
    if (same) {
      same.rows.push(r)
      continue
    }
    close(
      open.filter((o) => sameThing(o.name, name)),
      r.fromSceneId
    )
    open.push({ rows: [r], place: r.entryId, slot: r.slot, name, value: r.value })
  }
  for (const o of open) for (const r of o.rows) until.set(r.id, null)
  return placed.filter((r) => until.has(r.id) && until.get(r.id) !== r.untilSceneId).map((r) => ({ id: r.id, untilSceneId: until.get(r.id) ?? null }))
}

// ---------- Reading them back ----------

/** A thing left in a place, as the story last had it at a point. */
export interface LeftThing {
  placeId: ID
  place: string
  /** As the story names it ("the letter"). */
  name: string
  /** Where and how it is in the place ("under the loose hearthstone"); '' when not said. */
  how: string
  /** Where it was left there, in plain words ("Ch 2, Sc 3"). */
  since: string
  sinceSceneId: ID
  quote: string
  /** The thing and where it is, as a line says it ("the letter under the loose hearthstone"). */
  text: string
}

export interface AtOptions {
  /** As the scene begins (before its own facts), rather than as it ends. */
  asItBegins?: boolean
}

/** The story's point: the scene's row and the cut (facts started at or before it, not stopped by it). */
function cutAt(db: DB, storyId: ID, sceneId: ID, opts: AtOptions): number | null {
  const scene = sidx.indexScene(db, sceneId)
  if (!scene || scene.storyId !== storyId) return null
  return opts.asItBegins ? scene.position - 1 : scene.position
}

/** Every thing left in a place at a point of the story, oldest first: placed, and not taken, moved or gone since. */
export function thingsLeft(db: DB, storyId: ID, atSceneId: ID, opts: AtOptions = {}): LeftThing[] {
  const cut = cutAt(db, storyId, atSceneId, opts)
  if (cut == null) return []
  const runs = new Map<string, PlacedFact[]>()
  for (const r of sidx.factsAt(db, storyId, cut, { kinds: ['placed'] })) {
    if (!r.entryId) continue
    const key = `${r.entryId}|${r.slot}`
    const list = runs.get(key)
    if (list) list.push(r)
    else runs.set(key, [r])
  }
  const names = sidx.entryNames(
    db,
    [...runs.values()].map((l) => l[0].entryId ?? '')
  )
  const out: LeftThing[] = []
  for (const list of runs.values()) {
    const first = list[0]
    const last = list[list.length - 1]
    const place = names.get(last.entryId ?? '')
    if (!place) continue
    const { name, how } = splitPlaced(last.value)
    out.push({
      placeId: last.entryId!,
      place: place.name,
      name,
      how,
      since: first.fromLabel,
      sinceSceneId: first.fromSceneId,
      quote: list.map((r) => r.quote).find(Boolean) ?? '',
      text: placedText(name, how)
    })
  }
  return out
}

/** True when one place is the other, or inside it, or the other inside it (a room in its house, at any depth). */
export function samePlaceOrNested(a: ID, b: ID, parents: ReadonlyMap<ID, ID | null>): boolean {
  if (a === b) return true
  const within = (x: ID, y: ID): boolean => {
    const seen = new Set<ID>()
    for (let p = parents.get(x) ?? null; p && !seen.has(p); p = parents.get(p) ?? null) {
      if (p === y) return true
      seen.add(p)
    }
    return false
  }
  return within(a, b) || within(b, a)
}

/**
 * The things left in a scene's place on an earlier visit (or in a room inside it, or in the house its room is in), as
 * the story last had them at that point, with a line each for a prompt: "Left here before: the letter under the loose
 * hearthstone (since Ch 2, Sc 3)"; one in another of those places names it ("…, in the study (since …)"). Nothing when the
 * scene has no place.
 */
export function leftHere(
  db: DB,
  storyId: ID,
  sceneId: ID,
  placeId: ID | null | undefined,
  opts: AtOptions = {}
): { things: (LeftThing & { line: string })[]; lines: string[] } {
  if (!placeId) return { things: [], lines: [] }
  const all = thingsLeft(db, storyId, sceneId, opts)
  if (!all.length) return { things: [], lines: [] }
  const parents = sidx.placeParents(db)
  const things = all
    .filter((t) => samePlaceOrNested(t.placeId, placeId, parents))
    .map((t) => ({ ...t, line: `Left here before: ${t.text}${t.placeId === placeId ? '' : `, in ${t.place}`} (since ${t.since})` }))
  return { things, lines: things.map((t) => t.line) }
}

/**
 * The lines for the things left in a place (leftHere), without those where things stand as told already has in the place
 * (it says how they are now, in this scene's words).
 */
export function leftHereLines(things: readonly (LeftThing & { line: string })[], stage: SceneState | null | undefined): string[] {
  const here = thingsOf(stage)
  return things.filter((t) => !matching(here, t.name, false).length).map((t) => t.line)
}

/** What each person carries at a cut, as the story index has it: their latest "carrying" and since when. */
export function carriedAt(db: DB, storyId: ID, cut: number): { entryId: ID; value: string; since: string; sinceSceneId: ID; position: number }[] {
  const byEntry = new Map<ID, PlacedFact[]>()
  for (const r of sidx.factsAt(db, storyId, cut, { kinds: ['carrying'] })) {
    if (!r.entryId) continue
    const list = byEntry.get(r.entryId)
    if (list) list.push(r)
    else byEntry.set(r.entryId, [r])
  }
  return [...byEntry.entries()].map(([entryId, list]) => ({
    entryId,
    value: list[list.length - 1].value,
    since: list[0].fromLabel,
    sinceSceneId: list[0].fromSceneId,
    position: list[0].fromPosition
  }))
}

/**
 * Where a thing is at a point of the story, or was last (the where_is look-up): where it was left and since when, who
 * carries it, or, with neither, where it was last left and what became of it ("taken by Mara Venn in Ch 3, Sc 1"). No
 * lines when the story index has nothing of it.
 */
export function whereIs(db: DB, storyId: ID, thing: string, atSceneId: ID, opts: AtOptions = {}): { lines: string[] } {
  const asked = clean(thing)
  const cut = cutAt(db, storyId, atSceneId, opts)
  if (cut == null || !itemKey(asked)) return { lines: [] }
  const lines: string[] = []
  for (const t of thingsLeft(db, storyId, atSceneId, opts).filter((x) => sameThing(x.name, asked)))
    lines.push(`Now: ${t.text}, at ${t.place} (since ${t.since}).`)
  const carriers = carriedAt(db, storyId, cut).filter((c) => heldNames(c.value).some((k) => sameThing(k, asked)))
  const names = sidx.entryNames(
    db,
    carriers.map((c) => c.entryId)
  )
  for (const c of carriers) {
    const who = names.get(c.entryId)?.name
    if (who) lines.push(`Now: ${who} is carrying ${c.value} (since ${c.since}).`)
  }
  if (lines.length) return { lines }
  // Nothing now: where it was last left, and what became of it.
  const rows = sidx.storyFactsInOrder(db, storyId).filter((r) => r.kind === 'placed' && r.fromPosition <= cut)
  const last = rows.filter((r) => r.value && r.entryId && sameThing(splitPlaced(r.value).name, asked)).at(-1)
  if (!last) return { lines }
  const place = sidx.entryNames(db, [last.entryId!]).get(last.entryId!)?.name
  const { name, how } = splitPlaced(last.value)
  const at = `${placedText(name, how)}${place ? `, at ${place}` : ''} (${last.fromLabel})`
  if (!last.untilSceneId || last.untilPosition == null || last.untilPosition > cut) return { lines: [`Last known: ${at}.`] }
  const taken = rows.find(
    (r) => !r.value && r.fromSceneId === last.untilSceneId && r.slot.startsWith('taken:') && sameThing(name, r.slot.slice('taken:'.length))
  )
  const by = taken?.entryId ? sidx.entryNames(db, [taken.entryId]).get(taken.entryId)?.name : undefined
  const after = taken ? `taken${by ? ` by ${by}` : ''} in ${last.untilLabel}` : `no longer there by ${last.untilLabel}`
  return { lines: [`Last left: ${at}; ${after}. Nothing since says where it is.`] }
}
