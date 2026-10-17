// The AI fills chapter cards (2026-10-08): when it plans a story or a chapter (the outline helper, a recipe's
// story, a chapter's plan), each chapter's lines "Point of view:", "Characters:", "Location:", "When:" and
// "Mood:" go on the chapter card, and a scene's own lines only where it clearly differs from its chapter (another
// place, a jump in time, another point of view). Names are matched to the world's characters and places as the
// interview's fill matches them. A kept outline (keepOutline) first makes a page for each name it doesn't know
// (addMissing, 2026-10-17), so the cards point at them and a story starts with its cast; a chapter's plan filling
// its card leaves an unknown name out. No Electron imports.

import type Database from 'better-sqlite3'
import type { ChapterCardNames, ChapterCardSaved } from '@shared/contracts/chapterCards'
import type { CarryField, ChapterCard, Entry, ID } from '@shared/types'
import { CARRY_LABELS, CHAPTER_CARD_LIMITS, copyField, isFieldEmpty } from '@shared/chapterCard'
import * as repo from '../db/repo'
import { matchEntry } from './names'

type DB = Database.Database

const oneLine = (s: unknown, max: number): string =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim()

/** The names as cleaned up (what keepOutline and the fill accept from the window). */
export function cleanNames(v: unknown): ChapterCardNames {
  const x = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const out: ChapterCardNames = {}
  const pov = oneLine(x.pov, 200)
  if (pov) out.pov = pov
  const characters = (Array.isArray(x.characters) ? x.characters : []).map((c) => oneLine(c, 200)).filter(Boolean).slice(0, 40)
  if (characters.length) out.characters = characters
  const location = oneLine(x.location, 200)
  if (location) out.location = location
  const when = oneLine(x.when, CHAPTER_CARD_LIMITS.when)
  if (when) out.when = when
  const mood = oneLine(x.mood, CHAPTER_CARD_LIMITS.mood)
  if (mood) out.mood = mood
  return out
}

/** The world's characters and places, to match names against. */
export function namedEntries(db: DB): { characters: Entry[]; places: Entry[] } {
  const all = repo.listEntries(db)
  return { characters: all.filter((e) => e.kind === 'character'), places: all.filter((e) => e.kind === 'place') }
}

/** Words the AI may give where a name goes, which name no one ("none", "everyone", "the narrator"). */
const NOT_A_NAME =
  /^(none|nobody|no one|n\/?a|unknown|unnamed|tbd|tba|everyone|everybody|all|various|several|others?|many|same|narrator|the narrator|omniscient|multiple|nowhere|anywhere|somewhere|various places|same as (the )?chapter)$/i

/** A name worth a page of its own: short, not a stand-in ("none", "everyone"), and not a description in lower case ("two guards"). */
export function isPageName(name: string): boolean {
  const n = name.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim()
  if (n.length < 2 || n.length > 60 || n.split(' ').length > 6) return false
  if (NOT_A_NAME.test(n)) return false
  return /\p{Lu}/u.test(n)
}

/** "Kitchen, Venn House" (a room or spot inside a bigger place, as the outline gives it): the room and the place; null for one name. */
export function splitPlace(raw: string): { room: string; place: string } | null {
  const m = /^(.+?)\s*(?:,|\s[–—-]\s)\s*(.+)$/.exec(raw.replace(/\s+/g, ' ').trim())
  if (!m) return null
  const room = m[1].trim()
  const place = m[2].trim()
  return room && place ? { room, place } : null
}

/** A room's page name: "the kitchen" gives "Kitchen". */
const roomName = (s: string): string => {
  const n = s.replace(/^(the|a|an)\s+/i, '').trim()
  return n.charAt(0).toUpperCase() + n.slice(1)
}

/** A place's name as compared with another: case, punctuation and a leading "the" don't count. */
const placeKey = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^the /, '')
const sameName = (a: string, b: string): boolean => placeKey(a) === placeKey(b)

/**
 * The world's place a Location means (2026-10-17): one named so exactly; for "Kitchen, Venn House", the kitchen
 * inside Venn House (never another house's kitchen); else the place its name matches. Null when there is none.
 */
export function findPlace(raw: string, places: Entry[]): Entry | null {
  const whole = places.find((p) => [p.name, ...p.aliases].some((n) => sameName(raw, n)))
  if (whole) return whole
  const split = splitPlace(raw)
  if (split) {
    const house = matchEntry(split.place, places)
    if (!house) return null
    const rooms = places.filter((p) => p.parentId === house.id)
    return rooms.find((p) => [p.name, ...p.aliases].some((n) => sameName(roomName(split.room), n))) ?? matchEntry(roomName(split.room), rooms)
  }
  return matchEntry(raw, places)
}

/**
 * Makes a page, drafted by AI, for each name on a kept card the world has no character or place for (2026-10-17:
 * Adam wants a new story's cast and places there before anything is written; the World build that follows fills
 * them in). Each one goes into `world`, so later cards in the same keep match it, and its id into `made`.
 */
export function addMissing(db: DB, names: ChapterCardNames, world: { characters: Entry[]; places: Entry[] }, storyId: ID, made: ID[]): void {
  const make = (kind: 'character' | 'place', raw: string, parentId: ID | null = null): Entry => {
    const name = raw.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim()
    const e = repo.createEntry(db, kind, { name, ...(parentId ? { parentId } : {}) }, { origin: 'ai', originStoryId: storyId })
    ;(kind === 'character' ? world.characters : world.places).push(e)
    made.push(e.id)
    return e
  }
  for (const raw of [names.pov, ...(names.characters ?? [])]) {
    if (raw && isPageName(raw) && !matchEntry(raw, world.characters)) make('character', raw)
  }
  const loc = names.location
  if (!loc || findPlace(loc, world.places)) return
  // A room or spot inside a bigger place ("Kitchen, Venn House"): the place first, then the room inside it.
  const split = splitPlace(loc)
  if (split && isPageName(split.place)) {
    const house = matchEntry(split.place, world.places) ?? make('place', split.place)
    const room = roomName(split.room)
    if (room.length >= 2 && room.length <= 60) make('place', room, house.id)
  } else if (isPageName(loc)) make('place', loc)
}

/**
 * The card parts the names give, matched to the world (a name it doesn't know is left out): only parts that came
 * out with something in them. The point of view is among the characters present when both are given.
 */
export function partsFromNames(names: ChapterCardNames, world: { characters: Entry[]; places: Entry[] }): Partial<ChapterCard> {
  const out: Partial<ChapterCard> = {}
  const pov = names.pov ? matchEntry(names.pov, world.characters) : null
  if (pov) out.povId = pov.id
  const present: ID[] = []
  for (const n of names.characters ?? []) {
    const e = matchEntry(n, world.characters)
    if (e && !present.includes(e.id)) present.push(e.id)
  }
  if (present.length) out.presentIds = pov && !present.includes(pov.id) ? [pov.id, ...present] : present
  const loc = names.location ? findPlace(names.location, world.places) : null
  if (loc) out.locationId = loc.id
  if (names.when) out.when = names.when
  if (names.mood) out.mood = names.mood
  return out
}

const NAMED_FIELDS: CarryField[] = ['pov', 'present', 'location', 'when', 'mood']

/** The card with the parts given put into those still empty; says which it filled. */
export function fillEmpty(card: ChapterCard, parts: Partial<ChapterCard>): { card: ChapterCard; filled: CarryField[] } {
  let out = card
  const filled: CarryField[] = []
  for (const f of NAMED_FIELDS) {
    if (!isFieldEmpty(out, f) || isFieldEmpty(parts, f)) continue
    out = copyField(out, parts, f)
    filled.push(f)
  }
  return { card: out, filled }
}

/**
 * A chapter's plan gave the chapter a card: its parts go into those still empty on the chapter's card (nothing
 * Adam set changes), and from there into the scenes that follow it.
 */
export function fillChapterCard(db: DB, chapterId: ID, names: unknown): ChapterCardSaved & { before: ChapterCard; filled: string[] } {
  const before = repo.getChapterCard(db, chapterId)
  const { card, filled } = fillEmpty(before, partsFromNames(cleanNames(names), namedEntries(db)))
  if (!filled.length) return { card: before, updated: [], before, filled: [] }
  const saved = repo.saveChapterCard(db, chapterId, card)
  return { ...saved, before, filled: filled.map((f) => CARRY_LABELS[f]) }
}
