// The Critique tab's words and small decisions (the scene and chapter critic, contracts/critique.ts), kept pure so
// they are unit-tested.
import type { Critique, CritiqueCategory, CritiqueNote, CritiqueScope, CritiqueWeight } from '@shared/contracts/critique'
import { relativeTime } from '@/features/generate/format'

/** How much a note matters, as the tab says it. */
export const WEIGHT_WORDS: Record<CritiqueWeight, string> = { high: 'Matters most', medium: 'Worth a look', low: 'Small thing' }

/** What each kind of note is about, in a word or two. */
export const CATEGORY_WORDS: Record<CritiqueCategory, string> = {
  pacing: 'Pacing',
  tension: 'Tension and stakes',
  voice: 'Character voice',
  dialogue: 'Dialogue',
  clarity: 'Clarity',
  'show-tell': 'Show and tell',
  prose: 'Prose',
  opening: 'Opening',
  ending: 'Ending',
  shape: 'Shape and arc',
  flow: 'Flow between scenes',
  pull: 'Pull to read on',
  other: 'Craft'
}

/** "Critiqued 5 minutes ago · 3 notes". */
export function critiqueHeadline(c: Pick<Critique, 'at' | 'notes'>, nowMs: number = Date.now()): string {
  const when = relativeTime(c.at, nowMs)
  const notes = c.notes.length === 0 ? 'no notes' : c.notes.length === 1 ? '1 note' : `${c.notes.length} notes`
  return `Critiqued ${when || 'earlier'} · ${notes}`
}

/** Said over a critique whose words have changed since it was written. */
export const changedWords = (scope: CritiqueScope): string =>
  scope === 'scene' ? 'The scene changed since this critique.' : 'The chapter changed since this critique.'

/** What the button asks for. */
export const askWords = (scope: CritiqueScope, again: boolean): string =>
  again ? 'Critique again' : scope === 'scene' ? 'Critique scene' : 'Critique chapter'

/** What the line says while the critic reads. */
export const readingWords = (scope: CritiqueScope): string => (scope === 'scene' ? 'Reading the scene…' : 'Reading the chapter…')

/** Said under a chapter's critique when its scenes were sent shortened. */
export const SHORTENED_WORDS =
  'This chapter was too long for the writer model to read whole, so it read each long scene’s opening and ending, with its summary.'

/**
 * The direction Rewrite is given for a note: what the critic said and what to do, so the rewrite acts on it, while
 * keeping to what happens.
 */
export function rewriteDirection(note: Pick<CritiqueNote, 'title' | 'suggestion' | 'category'>): string {
  const said = [note.title.trim().replace(/[.!?]*$/, '.'), note.suggestion.trim()].filter((s) => s && s !== '.').join(' ')
  return `An editor's note on these words (${CATEGORY_WORDS[note.category].toLowerCase()}): ${said} Rewrite them so they act on the note. Keep what happens, who is there and what they say the same, in the scene's own voice.`.slice(
    0,
    1800
  )
}

/** The words in quotation marks, unless they start or end with their own (dialogue). */
export const quoted = (q: string): string => (/^["“‘']|["”’']$/.test(q) ? q : `“${q}”`)
