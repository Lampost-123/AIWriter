// The rules behind "Story feel" on the Style guide screen, kept apart from the interface so they can be tested:
// how picking a genre tile changes the picks, what the tiles and intensity controls show on the World and
// This story tabs (a story with nothing of its own shows the world's), and how a written sample is kept.
import { cleanGenres, genreLabel, MAX_GENRES } from '@shared/genres'
import { cleanIntensity, INTENSITY, intensityStep, type IntensityScale } from '@shared/intensity'
import type { ContentIntensity, IntensityLevel, StyleGuide } from '@shared/types'

export type FeelMode = 'world' | 'story'

/** One line under the Genre label saying how picking works. */
export const GENRE_RULE = 'Pick one, or two to blend: the first leads. A third pick replaces the second; click a picked one to take it off.'

/**
 * The picks after clicking a tile. A picked tile comes off (if it led, the other one leads now). Otherwise it is
 * added, up to MAX_GENRES; past that it replaces the last pick, so the one leading stays.
 */
export function pickGenre(own: readonly string[], id: string): string[] {
  const list = cleanGenres(own)
  if (list.includes(id)) return list.filter((x) => x !== id)
  if (list.length < MAX_GENRES) return [...list, id]
  return [...list.slice(0, MAX_GENRES - 1), id]
}

export type GenreRole = 'main' | 'blend'

/** Whether this genre leads or blends in, among these picks. */
export function genreRole(ids: readonly string[], id: string): GenreRole | null {
  const i = ids.indexOf(id)
  return i < 0 ? null : i === 0 ? 'main' : 'blend'
}

export interface GenresShown {
  /** The picks the tiles show. */
  ids: string[]
  /** True when they are the world's, shown on a story that has none of its own. */
  inherited: boolean
}

/** What the tiles show: the guide's own picks, or on a story with none, the world's. */
export function shownGenres(own: readonly string[], below: readonly string[], mode: FeelMode): GenresShown {
  const mine = cleanGenres(own)
  if (mine.length || mode === 'world') return { ids: mine, inherited: false }
  const theirs = cleanGenres(below)
  return { ids: theirs, inherited: theirs.length > 0 }
}

/** The line under the Genre label: the rule, or which genres a story is using from its world. */
export function genreHint(shown: GenresShown): string {
  return shown.inherited ? `Uses the world's: ${genreLabel(shown.ids)}. Pick here to give this story its own.` : GENRE_RULE
}

/** The intensity after clicking a step: the step picked, or, if it was already, the scale left to the genre again. */
export function toggleLevel(own: ContentIntensity, scale: IntensityScale, level: IntensityLevel): ContentIntensity {
  const out = cleanIntensity(own)
  if (out[scale] === level) delete out[scale]
  else out[scale] = level
  return out
}

export const LEFT_TO_GENRE = 'Left to the genre.'

export interface ScaleShown {
  /** The step this guide picked, or null. */
  picked: IntensityLevel | null
  /** The world's step, shown on a story that picked none on this scale. */
  inherited: IntensityLevel | null
  /** What clicking the picked step again does, in words: "use the world's" or "leave it to the genre". */
  clearTo: string
  /** The line under the control. */
  hint: string
  /** Every line that can show under this control, so the room they take is the longest one's and never jumps. */
  hints: string[]
}

export function scaleShown(own: ContentIntensity, below: ContentIntensity, scale: IntensityScale, mode: FeelMode): ScaleShown {
  const info = INTENSITY.find((i) => i.scale === scale)!
  const picked = cleanIntensity(own)[scale] ?? null
  const worlds = mode === 'world' ? null : (cleanIntensity(below)[scale] ?? null)
  const inherited = picked ? null : worlds
  // The world's line stays among the hints while the story picks its own, so the room kept doesn't change.
  const inheritedLine = worlds ? `Uses the world's: ${info.steps[worlds - 1].label}. ${info.steps[worlds - 1].hint}` : null
  const hint = picked ? info.steps[picked - 1].hint : inherited ? inheritedLine! : LEFT_TO_GENRE
  const hints = [...info.steps.map((s) => s.hint), LEFT_TO_GENRE, ...(inheritedLine ? [inheritedLine] : [])]
  const clearTo = worlds ? "use the world's" : 'leave it to the genre'
  return { picked, inherited, hint, hints, clearTo }
}

/** The line under "How far it goes": what clicking a picked level again does, as it is on this tab. */
export function intensityIntro(mode: FeelMode, below: ContentIntensity): string {
  if (mode === 'world') return 'Pick a level, or leave it to the genre. Click a picked level again to clear it.'
  const set = INTENSITY.filter(({ scale }) => cleanIntensity(below)[scale] != null).length
  if (set === INTENSITY.length) return "Pick a level to change it for this story. Click it again to use the world's."
  if (!set) return 'Pick a level to change it for this story, or leave it to the genre. Click a picked level again to clear it.'
  return "Pick a level to change it for this story. Click it again to use the world's, or the genre where the world hasn't set one."
}

/** The step's words, for a screen reader: "Romance: Fade to black". */
export const levelName = (scale: IntensityScale, level: IntensityLevel): string => {
  const info = INTENSITY.find((i) => i.scale === scale)!
  return `${info.label}: ${intensityStep({ [scale]: level }, scale)!.label}`
}

/** A plain style guide (no sources or preferences) to send with "Write a sample for me". */
export function styleForSample(s: StyleGuide): StyleGuide {
  return {
    pov: s.pov,
    tense: s.tense,
    proseStyle: s.proseStyle,
    samplePassage: s.samplePassage,
    avoidPhrases: [...s.avoidPhrases],
    spelling: s.spelling,
    contentLimits: s.contentLimits,
    notes: s.notes,
    genres: cleanGenres(s.genres),
    genreNotes: s.genreNotes,
    intensity: cleanIntensity(s.intensity)
  }
}

export interface KeptSample {
  /** The Sample passage field's new text. */
  next: string
  /** What it held before, for Undo. */
  previous: string
  /** Words for the toast. */
  message: string
}

/** What "Use this" does to the Sample passage field. Null when there is nothing to keep. */
export function keepSample(current: string, sample: string): KeptSample | null {
  const next = sample.trim()
  if (!next) return null
  const replaced = !!current.trim() && current.trim() !== next
  return {
    next,
    previous: current,
    message: replaced ? 'Replaced the sample passage with the new sample.' : 'Put the sample in the sample passage.'
  }
}

/** Plain words for a sample that couldn't start or ended badly. */
export function sampleProblem(message: string | null | undefined): string {
  const m = (message ?? '').trim()
  return m ? `Couldn't write a sample. ${m}` : "Couldn't write a sample just now. Please try again."
}
