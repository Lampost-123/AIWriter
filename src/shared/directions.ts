// The direction composer's rules both sides share (contracts/direction.ts): when two directions are the same words, and
// how the starred ones are kept. Pure, so it is unit-tested (features/direction/logic.test.ts).
import { FAVOURITES_MAX, FAVOURITE_MAX_CHARS } from './contracts/direction'

/** A direction as typed, tidied: spaces and line breaks run together once, no spaces at the ends. */
export const tidyDirection = (text: string): string => text.replace(/\s+/g, ' ').trim()

/**
 * What makes two directions the same: their words, whatever the case, the spacing, quotes' shapes or a full stop (or
 * two) at the end. "Make it tense." and "make it  tense" are one direction.
 */
export function directionKey(text: string): string {
  return tidyDirection(text)
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[\s.…]+$/u, '')
}

/** Beat by beat keeps a beat's note with the scene's direction as "<direction>. For this beat: <note>" (beats/instructions.ts). */
const BEAT_NOTE = 'For this beat: '

/** The directions in a beat's record: the scene's (when there was one) and the beat's own note (when there was one). */
export function beatDirections(direction: string): string[] {
  const at = direction.lastIndexOf(BEAT_NOTE)
  if (at < 0) return [direction.trim()].filter(Boolean)
  const scene = direction.slice(0, at).trim()
  const note = direction.slice(at + BEAT_NOTE.length).trim()
  return [scene, note].filter(Boolean)
}

/**
 * The favourites with `text` starred (first, as the most recently starred) or its star taken away. The same words
 * starred twice are kept once; a direction too long to be a quick ask is cut at a word; at most FAVOURITES_MAX.
 */
export function withFavourite(list: readonly string[], text: string, on: boolean): string[] {
  const tidy = tidyDirection(text)
  const key = directionKey(tidy)
  const rest = list.filter((t) => directionKey(t) !== key)
  if (!on || !key) return rest
  const kept = tidy.length > FAVOURITE_MAX_CHARS ? tidy.slice(0, FAVOURITE_MAX_CHARS).replace(/\s+\S*$/, '') : tidy
  return [kept, ...rest].slice(0, FAVOURITES_MAX)
}

/** Favourites as read from the preferences file: strings only, tidied, the same words once. */
export function cleanFavourites(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  let out: string[] = []
  for (const t of [...raw].reverse()) if (typeof t === 'string' && tidyDirection(t)) out = withFavourite(out, t, true)
  return out
}
