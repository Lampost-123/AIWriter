// A recipe's "Genre and content" part: the genre presets (src/shared/genres.ts) and content intensity levels
// (src/shared/intensity.ts) the Recipe maker suggests, as plain text Adam can read and edit:
//   "Genres: Horror, Mystery. Romance: Fade to black. Violence: Vivid. Language: Mild."
// The choices the prompt lists come from those two files, and the parser reads the text back by the same labels
// (case does not matter; words it doesn't know are left out). Made only of AI Write's own labels, so it never
// carries the story's words. Pure; no Electron.

import { cleanGenres, GENRES, genresOf, MAX_GENRES } from '@shared/genres'
import { cleanIntensity, INTENSITY, intensityStep } from '@shared/intensity'
import type { ContentIntensity } from '@shared/types'

export interface RecipeFeel {
  /** Genre preset ids, the lead first (at most MAX_GENRES). */
  genres: string[]
  /** The scales the text sets; a scale left out is left to the genre. */
  intensity: ContentIntensity
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[“”"'‘’*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-•]\s*/, '')

const GENRE_BY_WORD = new Map<string, string>(GENRES.flatMap((g) => [[norm(g.label), g.id], [norm(g.id), g.id]] as [string, string][]))

/** "Horror, Mystery", "Fantasy with romance", "horror and mystery" → known genre ids, in order. */
function genresIn(text: string): string[] {
  return text
    .split(/,|\/|&|\+|\band\b|\bwith\b/i)
    .map((w) => GENRE_BY_WORD.get(norm(w)))
    .filter((id): id is string => !!id)
}

/** Reads the part back: "Genres: Horror, Mystery. Romance: Fade to black." → ids and levels. Empty when nothing is known. */
export function parseFeel(text: string): RecipeFeel {
  const genres: string[] = []
  const intensity: ContentIntensity = {}
  for (const piece of String(text ?? '').split(/[.;\n]/)) {
    const at = piece.indexOf(':')
    const key = norm(at < 0 ? '' : piece.slice(0, at))
    const value = at < 0 ? piece : piece.slice(at + 1)
    const scale = INTENSITY.find((s) => norm(s.label) === key)
    if (scale) {
      const step = scale.steps.find((st) => norm(st.label) === norm(value))
      if (step && intensity[scale.scale] === undefined) intensity[scale.scale] = step.level
    } else if (!key || /^genres?$/.test(key)) genres.push(...genresIn(value))
  }
  return { genres: cleanGenres(genres), intensity: cleanIntensity(intensity) }
}

/** True when the part sets a genre or a level. */
export const feelFound = (f: RecipeFeel): boolean => f.genres.length > 0 || Object.keys(f.intensity).length > 0

/** The part in its own form ('' when nothing is set). */
export function feelText(f: RecipeFeel): string {
  const g = genresOf(f.genres)
  const out: string[] = []
  if (g.length) out.push(`${g.length === 1 ? 'Genre' : 'Genres'}: ${g.map((x) => x.label).join(', ')}.`)
  for (const s of INTENSITY) {
    const step = intensityStep(f.intensity, s.scale)
    if (step) out.push(`${s.label}: ${step.label}.`)
  }
  return out.join(' ')
}

/** What the Recipe maker may choose from, for its prompt. */
export function feelChoices(): string {
  const scales = INTENSITY.map((s) => `${s.label} (${s.steps.map((st) => st.label).join(', ')})`)
  return `Genres (one, or ${MAX_GENRES} when the story blends them, the leading one first): ${GENRES.map((g) => g.label).join(', ')}. Levels: ${scales.join('; ')}.`
}
