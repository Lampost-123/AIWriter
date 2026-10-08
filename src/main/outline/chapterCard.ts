// The AI fills chapter cards (2026-10-08): when it plans a story or a chapter (the outline helper, a recipe's
// story, a chapter's plan), each chapter's lines "Point of view:", "Characters:", "Location:", "When:" and
// "Mood:" go on the chapter card, and a scene's own lines only where it clearly differs from its chapter (another
// place, a jump in time, another point of view). Names are matched to the world's characters and places as the
// interview's fill matches them; a name it doesn't know is left out. No Electron imports.

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
  const loc = names.location ? matchEntry(names.location, world.places) : null
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
