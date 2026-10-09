// The story's spine on the desk: a slim dark capsule down the left of the page with each chapter's numeral and a ring
// for each of its scenes (planned, drafted, revised, done), the open scene lit. Where everything goes, for a spine of a
// given height: rings 30px apart, closer as the story grows (never under 14px); past that every chapter but the open
// one folds to its numeral; past that too the spine scrolls. The story's title runs down the foot while there is room.
// Pure, so it is unit-tested (features/desk/spine/Spine.tsx draws it).
import type { ID, SceneStatus } from '@shared/types'

export interface SpineScene {
  id: ID
  title: string
  status: SceneStatus
}

export interface SpineChapter {
  id: ID
  title: string
  scenes: SpineScene[]
}

export type SpineRow =
  | { type: 'chapter'; id: ID; title: string; numeral: string; top: number; folded: boolean; scenes: number }
  | { type: 'line'; id: ID; top: number; height: number }
  | { type: 'scene'; id: ID; title: string; status: SceneStatus; top: number; current: boolean; chapterId: ID }

export interface SpineLayout {
  rows: SpineRow[]
  /** How tall the rows are in all (more than the room given when the spine scrolls). */
  contentHeight: number
  /** The rows don't fit even folded: the spine's list scrolls. */
  scrolls: boolean
  /** The gap between rings now (30 at most, 14 at least). */
  pitch: number
  /** The story's title down the foot, and its ornament. */
  showTitle: boolean
}

/** The first chapter numeral's top, from the spine's top. */
export const TOP = 18
/** A ring's box (the ring itself is 14px, centred in it). */
export const RING = 24
/** From a numeral's top to its first ring's top. */
const FIRST_RING = 28
/** From a chapter's last ring's bottom to the next numeral's top. */
const CHAPTER_GAP = 16
/** A numeral's height, and the gap after a numeral standing alone (a folded or empty chapter). */
const NUMERAL = 16
const FOLDED_GAP = 10
export const PITCH_MAX = 30
export const PITCH_MIN = 14
/** The foot: the + button alone, or with the story's title and its ornament above it. */
export const FOOT = 52
export const FOOT_WITH_TITLE = 264

/** I, II, III … up to XXXIX; after that, plain numbers (a Roman numeral that long wouldn't fit the spine). */
export function chapterNumeral(n: number): string {
  if (n < 1 || n > 39 || !Number.isInteger(n)) return String(n)
  const tens = ['', 'X', 'XX', 'XXX'][Math.floor(n / 10)]
  const ones = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'][n % 10]
  return tens + ones
}

/** How tall a chapter is with its rings `pitch` apart (folded: its numeral alone). */
function chapterHeight(scenes: number, pitch: number, folded: boolean, last: boolean): number {
  if (folded || scenes === 0) return NUMERAL + (last ? 0 : FOLDED_GAP)
  return FIRST_RING + (scenes - 1) * pitch + RING + (last ? 0 : CHAPTER_GAP)
}

function heightAt(chapters: SpineChapter[], pitch: number, folded: (i: number) => boolean): number {
  return chapters.reduce((h, c, i) => h + chapterHeight(c.scenes.length, pitch, folded(i), i === chapters.length - 1), 0)
}

/** The widest pitch (from 30 down to 14) that fits `room`, or null when even 14 doesn't. */
function pitchFor(chapters: SpineChapter[], room: number, folded: (i: number) => boolean): number | null {
  const at14 = heightAt(chapters, PITCH_MIN, folded)
  if (at14 > room) return null
  const gaps = chapters.reduce((n, c, i) => n + (folded(i) || c.scenes.length === 0 ? 0 : c.scenes.length - 1), 0)
  if (!gaps) return PITCH_MAX
  return Math.min(PITCH_MAX, PITCH_MIN + Math.floor((room - at14) / gaps))
}

/**
 * Lays the spine out for `height` px (the capsule's own height), with `currentId` the open scene. The rows' tops are
 * from the capsule's top.
 */
export function spineLayout(chapters: SpineChapter[], currentId: ID | null, height: number): SpineLayout {
  const currentChapter = chapters.findIndex((c) => c.scenes.some((s) => s.id === currentId))
  const open = currentChapter >= 0 ? currentChapter : 0
  const none = (): boolean => false
  const others = (i: number): boolean => i !== open
  let showTitle = true
  let folded: (i: number) => boolean = none
  let pitch = pitchFor(chapters, height - TOP - FOOT_WITH_TITLE, none)
  if (pitch === null) {
    showTitle = false
    pitch = pitchFor(chapters, height - TOP - FOOT, none)
  }
  if (pitch === null) {
    folded = others
    pitch = pitchFor(chapters, height - TOP - FOOT, others)
  }
  const scrolls = pitch === null
  if (pitch === null) pitch = PITCH_MIN

  const rows: SpineRow[] = []
  let top = TOP
  chapters.forEach((c, i) => {
    const fold = folded(i)
    rows.push({ type: 'chapter', id: c.id, title: c.title, numeral: chapterNumeral(i + 1), top, folded: fold, scenes: c.scenes.length })
    if (!fold && c.scenes.length) {
      const first = top + FIRST_RING
      if (c.scenes.length > 1) rows.push({ type: 'line', id: c.id, top: first + RING / 2, height: (c.scenes.length - 1) * pitch! })
      c.scenes.forEach((s, j) =>
        rows.push({ type: 'scene', id: s.id, title: s.title, status: s.status, top: first + j * pitch!, current: s.id === currentId, chapterId: c.id })
      )
    }
    top += chapterHeight(c.scenes.length, pitch!, fold, i === chapters.length - 1)
  })
  return { rows, contentHeight: top, scrolls, pitch, showTitle }
}
