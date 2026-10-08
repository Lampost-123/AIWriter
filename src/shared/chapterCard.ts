// Chapter cards (2026-10-08): the scene card parts a chapter's scenes share (point of view, characters present,
// location, when, mood, length and the notes for the AI), set once on the chapter. "Copy through": the chapter's
// value is written into each scene card that follows it, and the card marks which parts it follows
// (SceneCard.inherits), so every reader of a scene card (the briefing, the memory, the views, search) reads the
// value as it always has. The rules, in one place for the main process and the window:
//
// - A new scene follows every part of its chapter's card (adoptChapter 'new').
// - When a chapter card changes, or a scene moves to another chapter, each part a scene follows takes the
//   chapter's value; a part it has never settled (no mark) takes it only while the scene's own is empty
//   (adoptChapter 'follow'). A part the scene has its own value for is never changed.
// - Writing a scene card (by hand, or the interview, ideas or Ask filling it in) makes a followed part the
//   scene's own only when its value actually changed and isn't the chapter's (resolveCardWrite).
// No imports beyond types and defaults, so both sides and the tests use it.

import type { CarryField, ChapterCard, ID, Inherits, SceneCard } from './types'
import { cardLength, OLD_DEFAULT_LENGTH } from './defaults'

/** A chapter card's key in the world's meta table is this and the chapter's id. */
export const CHAPTER_CARD_PREFIX = 'chapter_card:'

export const CARRY_FIELDS: readonly CarryField[] =['pov', 'present', 'location', 'when', 'mood', 'length', 'notes']

/** What each part is called on screen, for "from chapter" and the toasts. */
export const CARRY_LABELS: Record<CarryField, string> = {
  pov: 'Point of view',
  present: 'Characters present',
  location: 'Location',
  when: 'When',
  mood: 'Mood or tone',
  length: 'Length',
  notes: 'Notes for the AI'
}

/** The most a chapter card keeps of each written part. */
export const CHAPTER_CARD_LIMITS = { when: 200, mood: 500, notes: 5000, present: 200 }

export const emptyChapterCard = (): ChapterCard => ({
  povId: null,
  presentIds: [],
  locationId: null,
  when: '',
  mood: '',
  targetWords: OLD_DEFAULT_LENGTH,
  lengthSet: false,
  notes: ''
})

const isId = (v: unknown): v is ID => typeof v === 'string' && v.length > 0 && v.length <= 64
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')

/** A chapter card as sent or read back, tidied: anything missing or of the wrong kind reads as empty. */
export function cleanChapterCard(v: unknown): ChapterCard {
  const x = (v && typeof v === 'object' ? v : {}) as Partial<Record<keyof ChapterCard, unknown>>
  const words = Math.round(Number(x.targetWords))
  const okWords = Number.isFinite(words) && words >= 100 && words <= 20000
  const present = Array.isArray(x.presentIds) ? [...new Set(x.presentIds.filter(isId))].slice(0, CHAPTER_CARD_LIMITS.present) : []
  return {
    povId: isId(x.povId) ? x.povId : null,
    presentIds: present,
    locationId: isId(x.locationId) ? x.locationId : null,
    when: text(x.when, CHAPTER_CARD_LIMITS.when),
    mood: text(x.mood, CHAPTER_CARD_LIMITS.mood),
    targetWords: okWords ? words : OLD_DEFAULT_LENGTH,
    // As cardLength reads it: a card with no mark has a length set unless it is the old default.
    lengthSet: okWords && (typeof x.lengthSet === 'boolean' ? x.lengthSet : words !== OLD_DEFAULT_LENGTH),
    notes: text(x.notes, CHAPTER_CARD_LIMITS.notes)
  }
}

type CardLike = Partial<ChapterCard>

/** The part has nothing in it (a length on Auto counts as nothing). */
export function isFieldEmpty(card: CardLike, f: CarryField): boolean {
  switch (f) {
    case 'pov':
      return !card.povId
    case 'present':
      return !card.presentIds?.length
    case 'location':
      return !card.locationId
    case 'length':
      return cardLength({ targetWords: card.targetWords ?? OLD_DEFAULT_LENGTH, lengthSet: card.lengthSet }) == null
    default:
      return !(card[f] ?? '').trim()
  }
}

/** Every part of the chapter card is empty: the chapter has no card. */
export const chapterCardEmpty = (c: CardLike): boolean => CARRY_FIELDS.every((f) => isFieldEmpty(c, f))

const sameIds = (a: ID[] | undefined, b: ID[] | undefined): boolean => {
  const x = [...(a ?? [])].sort()
  const y = [...(b ?? [])].sort()
  return x.length === y.length && x.every((v, i) => v === y[i])
}

/** The part reads the same on both cards (the characters present in any order; a length by what it means). */
export function sameField(a: CardLike, b: CardLike, f: CarryField): boolean {
  switch (f) {
    case 'pov':
      return (a.povId ?? null) === (b.povId ?? null)
    case 'present':
      return sameIds(a.presentIds, b.presentIds)
    case 'location':
      return (a.locationId ?? null) === (b.locationId ?? null)
    case 'length':
      return (
        cardLength({ targetWords: a.targetWords ?? OLD_DEFAULT_LENGTH, lengthSet: a.lengthSet }) ===
        cardLength({ targetWords: b.targetWords ?? OLD_DEFAULT_LENGTH, lengthSet: b.lengthSet })
      )
    default:
      return (a[f] ?? '') === (b[f] ?? '')
  }
}

/** The card with the chapter's value for this part. */
export function copyField<T extends CardLike>(card: T, from: CardLike, f: CarryField): T {
  switch (f) {
    case 'pov':
      return { ...card, povId: from.povId ?? null }
    case 'present':
      return { ...card, presentIds: [...(from.presentIds ?? [])] }
    case 'location':
      return { ...card, locationId: from.locationId ?? null }
    case 'length': {
      const n = cardLength({ targetWords: from.targetWords ?? OLD_DEFAULT_LENGTH, lengthSet: from.lengthSet })
      if (n != null) return { ...card, targetWords: n, lengthSet: true }
      // Auto as a card made before Auto had it (the old default, no mark), so a writer that sets only a word count
      // (as those cards did) still sets the length.
      const out = { ...card, targetWords: OLD_DEFAULT_LENGTH }
      delete out.lengthSet
      return out
    }
    default:
      return { ...card, [f]: from[f] ?? '' }
  }
}

/** The parts of a scene card a chapter card carries, as a chapter card. */
export function chapterPartsOf(card: CardLike): ChapterCard {
  return cleanChapterCard({ ...emptyChapterCard(), ...card })
}

export const follows = (card: Pick<SceneCard, 'inherits'>, f: CarryField): boolean => card.inherits?.[f] === true

/** The card with this part's mark set (undefined: unsettled). An empty set of marks is left off the card. */
export function withMark<T extends Pick<SceneCard, 'inherits'>>(card: T, f: CarryField, on: boolean | undefined): T {
  const marks: Inherits = { ...(card.inherits ?? {}) }
  if (on === undefined) delete marks[f]
  else marks[f] = on
  const out = { ...card }
  if (Object.keys(marks).length) out.inherits = marks
  else delete out.inherits
  return out
}

/**
 * The scene card with its chapter's card put in. 'new' (a scene just made in the chapter): every part follows the
 * chapter. 'follow' (the chapter card changed, or the scene moved here): each part the scene follows takes the
 * chapter's value, and a part with no mark takes it, and follows from then on, only while the scene's own is empty
 * and the chapter has one. A part the scene has as its own (marked false) never changes.
 */
export function adoptChapter(card: SceneCard, chapter: ChapterCard, mode: 'new' | 'follow'): SceneCard {
  let out = card
  for (const f of CARRY_FIELDS) {
    const mark = card.inherits?.[f]
    if (mode === 'new' || mark === true) {
      out = withMark(copyField(out, chapter, f), f, true)
    } else if (mark === undefined && isFieldEmpty(card, f) && !isFieldEmpty(chapter, f)) {
      out = withMark(copyField(out, chapter, f), f, true)
    }
  }
  return out
}

/**
 * A scene card being written (`next`) over the one stored (`prev`), in a chapter with this card. A part marked as
 * following the chapter stays so, with the chapter's value, unless it was changed to something that isn't the
 * chapter's: then it becomes the scene's own. A writer that gives no marks keeps the stored ones. "Use chapter's"
 * is a write marking the part as following again.
 */
export function resolveCardWrite(prev: SceneCard, next: SceneCard, chapter: ChapterCard): SceneCard {
  let out: SceneCard = { ...next }
  if (!('inherits' in next) || next.inherits === undefined) {
    if (prev.inherits) out.inherits = { ...prev.inherits }
    else delete out.inherits
  }
  for (const f of CARRY_FIELDS) {
    if (!follows(out, f)) continue
    if (sameField(next, chapter, f) || sameField(next, prev, f)) out = copyField(out, chapter, f)
    else out = withMark(out, f, false)
  }
  if (out.inherits && !Object.keys(out.inherits).length) delete out.inherits
  return out
}

/** "Use chapter's": the part follows the chapter again, with its value. */
export const followChapterPart = (card: SceneCard, chapter: ChapterCard, f: CarryField): SceneCard => withMark(copyField(card, chapter, f), f, true)

/** What a scene card has of the parts a chapter card carries, and its marks: what an Undo of a chapter card change puts back. */
export interface SceneCarry {
  parts: ChapterCard
  inherits: Inherits | null
}

export const carryOf = (card: SceneCard): SceneCarry => ({ parts: chapterPartsOf(card), inherits: card.inherits ? { ...card.inherits } : null })

/** The card with those parts and marks put back. */
export function withCarry(card: SceneCard, carry: SceneCarry): SceneCard {
  let out: SceneCard = { ...card }
  for (const f of CARRY_FIELDS) out = copyField(out, carry.parts, f)
  if (carry.inherits && Object.keys(carry.inherits).length) out.inherits = { ...carry.inherits }
  else delete out.inherits
  return out
}

/** The chapter card's parts that differ between two cards. */
export const changedFields = (a: CardLike, b: CardLike): CarryField[] => CARRY_FIELDS.filter((f) => !sameField(a, b, f))
