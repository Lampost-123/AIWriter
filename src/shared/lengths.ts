// Word targets (Adam, 2026-10-17: "allow me to set a target wordcount for chapters/scenes and make it the default in
// settings"). A scene aims for, in order: its own length (set on the scene card, or carried from the chapter card's
// per-scene length), else its share of its chapter's target for the whole chapter (the chapter card's, else the
// default in Settings › Writing), else the default scene length in Settings › Writing, else Auto (the AI picks).
// Pure, so the main side (the briefing, beats, the chapter writer) and the window read the same rule.

import type { ChapterCard, WritingPrefs } from './types'

/** What a scene length may be (as the scene card takes it). */
export const SCENE_LENGTH_LIMITS = { min: 100, max: 20_000 } as const
/** What a chapter's target may be. */
export const CHAPTER_TARGET_LIMITS = { min: 500, max: 200_000 } as const
/** A share of a chapter's target is never less than this, so a scene never comes back as a fragment. */
export const MIN_SHARE = 300
/** Nor more than one draft can write (as a draft's own length is capped). */
export const MAX_SHARE = 12_000

/** A word count as typed or stored, tidied: a whole number within the limits, else null (none set). */
export function cleanTarget(v: unknown, limits: { min: number; max: number }): number | null {
  if (v == null || v === '') return null
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n >= limits.min && n <= limits.max ? n : null
}

/** Writing preferences with their word targets tidied (anything unreadable is none). */
export function cleanPrefsTargets<P extends Pick<WritingPrefs, 'sceneLength' | 'chapterLength'>>(p: P): P {
  return { ...p, sceneLength: cleanTarget(p.sceneLength, SCENE_LENGTH_LIMITS), chapterLength: cleanTarget(p.chapterLength, CHAPTER_TARGET_LIMITS) }
}

/** The chapter's target for the whole chapter: its card's, else the default in Settings › Writing; null when neither. */
export function chapterTarget(card: Pick<ChapterCard, 'totalWords'> | null | undefined, prefs: Pick<WritingPrefs, 'chapterLength'>): number | null {
  return cleanTarget(card?.totalWords, CHAPTER_TARGET_LIMITS) ?? cleanTarget(prefs.chapterLength, CHAPTER_TARGET_LIMITS)
}

/**
 * One scene's share of its chapter's target: what the scenes with a length of their own leave, split evenly between
 * this scene and the others on Auto. `others`: the lengths of the chapter's other scenes (cardLength: null for Auto).
 * Null when the scenes with their own length already take all of it.
 */
export function chapterShare(total: number, others: (number | null)[]): number | null {
  const taken = others.reduce<number>((sum, n) => sum + (n ?? 0), 0)
  const left = total - taken
  if (left <= 0) return null
  const auto = others.filter((n) => n == null).length + 1
  return Math.min(MAX_SHARE, Math.max(MIN_SHARE, Math.round(left / auto)))
}

/** The length a scene aims for, by the rule at the top; null is Auto. */
export function sceneAim(o: {
  /** The scene card's own length (cardLength). */
  cardWords: number | null
  /** The chapter's target (chapterTarget). */
  chapterTotal: number | null
  /** The lengths of the chapter's other scenes (cardLength). */
  others: (number | null)[]
  prefs: Pick<WritingPrefs, 'sceneLength'>
}): number | null {
  if (o.cardWords != null) return o.cardWords
  const share = o.chapterTotal != null ? chapterShare(o.chapterTotal, o.others) : null
  return share ?? cleanTarget(o.prefs.sceneLength, SCENE_LENGTH_LIMITS)
}
