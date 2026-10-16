// The Critique tab's words and small decisions (the scene and chapter critic, contracts/critique.ts), kept pure so
// they are unit-tested.
import type { Critique, CritiqueCategory, CritiqueNote, CritiqueNoteStatus, CritiqueScope, CritiqueWeight } from '@shared/contracts/critique'
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

/** "Critiqued 5 minutes ago · 3 notes" (", 1 dealt with" once Adam has acted on or set aside any). */
export function critiqueHeadline(c: Pick<Critique, 'at' | 'notes'>, nowMs: number = Date.now()): string {
  const when = relativeTime(c.at, nowMs)
  const notes = c.notes.length === 0 ? 'no notes' : c.notes.length === 1 ? '1 note' : `${c.notes.length} notes`
  const dealt = c.notes.filter((n) => n.status).length
  return `Critiqued ${when || 'earlier'} · ${notes}${dealt ? `, ${dealt} dealt with` : ''}`
}

/** What a note's tag says once Adam has done something about it. */
export const STATUS_WORDS: Record<CritiqueNoteStatus, string> = { done: 'Done', dismissed: 'Not needed', unwanted: 'Not for this story' }

/** Said on a note still to do whose words are no longer in the scene. */
export const CHANGED_WORDS = 'These words have changed'

/** How a note stands: still to do, its words changed since, or what Adam did about it. */
export type NoteState = 'open' | 'changed' | CritiqueNoteStatus

export function noteState(note: Pick<CritiqueNote, 'id' | 'status'>, gone: readonly string[]): NoteState {
  return note.status ?? (gone.includes(note.id) ? 'changed' : 'open')
}

/** What the button that brings a settled note back says. */
export const bringBackWords = (status: CritiqueNoteStatus): string => (status === 'done' ? 'Not done yet' : 'Bring back')

/**
 * The line about how the critique came about, under its summary ('' for a first reading Adam asked for): the chapter
 * writer's reading (a re-read after its changes, from its second round), or how many notes from last time are settled.
 */
export function readingNote(c: Pick<Critique, 'reread' | 'by' | 'settledSince'>): string {
  if (c.by === 'chapter-writer') return c.reread ? 'Re-read after the chapter writer’s changes.' : 'Read during the chapter writer’s run.'
  const n = c.settledSince ?? 0
  return c.reread && n ? `Since last time, ${n === 1 ? '1 note is' : `${n} notes are`} settled.` : ''
}

/** The quiet line under the notes when Adam has said some kinds of note aren't for this story. */
export const wantsWords = (n: number): string =>
  n === 1 ? 'You told the critic 1 kind of note isn’t for this story.' : `You told the critic ${n} kinds of note aren’t for this story.`

/** Said over a critique whose words have changed since it was written. */
export const changedWords = (scope: CritiqueScope): string =>
  scope === 'scene' ? 'The scene changed since this critique.' : 'The chapter changed since this critique.'

/** What the button asks for. */
export const askWords = (scope: CritiqueScope, again: boolean): string =>
  again ? 'Critique again' : scope === 'scene' ? 'Critique scene' : 'Critique chapter'

/** What the line says while the critic reads. */
export const readingWords = (scope: CritiqueScope): string => (scope === 'scene' ? 'Reading the scene…' : 'Reading the chapter…')

/** Said under a critique whose words were sent shortened, to fit the writer model. */
export const shortenedWords = (scope: CritiqueScope): string =>
  scope === 'scene'
    ? 'This scene was too long for the writer model to read whole, so it read its opening and ending.'
    : 'This chapter was too long for the writer model to read whole, so it read each long scene’s opening and ending, with its summary.'

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
