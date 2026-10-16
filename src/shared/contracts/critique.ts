// The scene and chapter critic (Adam, 2026-10-09): craft feedback on a scene or a whole chapter, only when Adam asks
// ("Critique scene" and "Critique chapter" in the Critique tab beside Issues, and in the palette). It looks at craft,
// never continuity (the consistency checker does that): for a scene, pacing, tension and stakes, character voice and
// dialogue, clarity, show and tell, the prose, the opening and the ending; for a chapter, its shape and arc, how its
// scenes flow into each other, pacing across them, and whether it ends with a pull to read on.
//
// A critique is a short summary, a few strengths and up to eight notes. A note that points at words carries them as
// the scene's own text (found in the scene; a quote the critic made up is dropped, and its note shown without one), so
// a click shows them in the page and "Rewrite this" hands them, with the note, to the AI tools' Rewrite (the usual
// tracked change). The latest critique of each scene and each chapter is kept in the world, with a fingerprint of the
// words it read, so reopening costs nothing and the tab can say when the words have changed since.
//
// It runs through the shared task runner (task:* events, contracts/tasks.ts) as a 'critique' record, with the writer
// model; Stop is stopTask(taskId).
//
// The critic knows the story and remembers (2026-10-16): it is told the facts it must respect (the premise, themes, the
// content level, the card, the chapter's goal, the plot threads and when each is due, the scene's contract, the open
// must-fix problems), and what Adam has said: a note acted on (its rewrite accepted) is done, one he said isn't needed
// stays away from that scene, and one he said isn't for this story stays away from every scene of it. Critique again
// sends the notes before with what became of each, and the critic says which are settled; it never reverses a note
// Adam acted on.
import type { ID } from '../types'

export type CritiqueScope = 'scene' | 'chapter'

export interface CritiqueTarget {
  scope: CritiqueScope
  /** The scene's id, or the chapter's. */
  id: ID
}

/** What a note is about. A scene's notes use the first nine; a chapter's mostly the last four. */
export type CritiqueCategory =
  | 'pacing'
  | 'tension'
  | 'voice'
  | 'dialogue'
  | 'clarity'
  | 'show-tell'
  | 'prose'
  | 'opening'
  | 'ending'
  | 'shape'
  | 'flow'
  | 'pull'
  | 'other'

export const CRITIQUE_CATEGORIES: readonly CritiqueCategory[] = [
  'pacing',
  'tension',
  'voice',
  'dialogue',
  'clarity',
  'show-tell',
  'prose',
  'opening',
  'ending',
  'shape',
  'flow',
  'pull',
  'other'
]

/** How much a note matters: 'high' (matters most), 'medium' (worth a look), 'low' (a small thing). */
export type CritiqueWeight = 'high' | 'medium' | 'low'

export interface CritiqueNote {
  /** "n1", "n2"... in the order shown. */
  id: string
  category: CritiqueCategory
  /** A few words: "The middle sags". */
  title: string
  weight: CritiqueWeight
  /** The scene's own words the note points at, cut out exactly; '' for a note about the whole. */
  quote: string
  /** The scene the words are in (for a chapter's notes, one of its scenes); null when the note has no words. */
  sceneId: ID | null
  /** Which of the words' appearances in that scene it means (0 for the first). */
  occurrence: number
  /** What to do about it, in plain words. */
  suggestion: string
  /** What Adam did about it (left out: nothing yet). */
  status?: CritiqueNoteStatus
  /** For a note marked done by an accepted rewrite: the words the rewrite put in (so a later critique doesn't reverse it). */
  newWords?: string
  /** On a re-read: a note from last time that the critic says still stands, given again. */
  repeated?: boolean
}

/**
 * What Adam did about a note: 'done' (he accepted a rewrite of its words), 'dismissed' ("Not needed": not for this scene
 * or chapter), 'unwanted' ("Not for this story": this kind of note isn't wanted anywhere in the story).
 */
export type CritiqueNoteStatus = 'done' | 'dismissed' | 'unwanted'

/** A kind of note Adam said isn't for this story ("Not for this story"), kept for the whole story and told to the critic. */
export interface CritiqueWant {
  id: string
  category: CritiqueCategory
  title: string
  suggestion: string
  /** When he said it (ISO). */
  at: string
  /** The note it was said on, so bringing that note back takes it away again. */
  from?: { scope: CritiqueScope; targetId: ID; noteId: string }
}

export interface Critique {
  scope: CritiqueScope
  /** The scene's id, or the chapter's. */
  targetId: ID
  /** A few sentences on how it reads overall. */
  summary: string
  /** What works, a line each (up to three). */
  strengths: string[]
  /** Up to eight, the ones that matter most first. */
  notes: CritiqueNote[]
  /** When it was written (ISO). */
  at: string
  /** A fingerprint of the words it read, to tell when they have changed since. */
  textHash: string
  /** A chapter too long for the model to read whole: its scenes were sent shortened (openings, endings, summaries). */
  shortened: boolean
  /** The record of the request, for "What the AI saw". */
  generationId: ID | null
  /** A re-read after revisions (Critique again, or the chapter writer's rounds). */
  reread?: boolean
  /** Asked for by the chapter writer during its run, not by Adam. */
  by?: 'chapter-writer'
  /** On a re-read: how many of the notes before it are settled (acted on, set aside, or settled by the critic). */
  settledSince?: number
  /**
   * Notes from earlier critiques of the same scene or chapter that Adam acted on or said aren't needed, newest first (at
   * most a dozen): carried from one critique to the next, so the critic never raises them again.
   */
  earlier?: CritiqueNote[]
}

export interface CritiqueRequest {
  /** Made by the interface (any unique id), so Stop can stop it. */
  taskId: ID
  target: CritiqueTarget
  /**
   * A re-read after revisions: Critique again in the tab (the notes before are sent with what became of each, and the
   * critic says which are settled), or the chapter writer's later rounds (contracts/chapterWriter.ts: only notes still
   * clearly worth fixing, and none when it is ready). Left out: a first reading.
   */
  again?: boolean
  /** Who asked: the chapter writer during its run. Left out: Adam. */
  by?: 'chapter-writer'
}

export type CritiqueOutcome = { status: 'complete'; critique: Critique } | { status: 'stopped' } | { status: 'error'; error: string }

/** The latest critique kept for a scene or chapter, and whether its words have changed since. */
export interface SavedCritique {
  critique: Critique
  changed: boolean
  /** The notes still to do whose words are no longer in their scene ("These words have changed"), by id. */
  gone: string[]
  /** What Adam said isn't for this story, newest first. */
  wants: CritiqueWant[]
}

/** Adam acting on a note in the tab. */
export interface CritiqueNoteChange {
  target: CritiqueTarget
  noteId: string
  /** What he did; null brings the note back as still to do (and, for 'unwanted', lets the critic raise its kind again). */
  status: CritiqueNoteStatus | null
  /** For 'done': the words the accepted rewrite put in. */
  newWords?: string
  /** The critique the note is in (its `at`): a note of a critique replaced since is left as it is. */
  at?: string
}

export interface CritiqueApi {
  /**
   * Critiques a scene or a chapter and keeps the result (replacing the one before). Resolves when it has finished,
   * been stopped or failed; throws (plain words) only before it starts: no writer model, or nothing to read.
   */
  startCritique(input: CritiqueRequest): Promise<CritiqueOutcome>
  /** The latest critique kept for the scene or chapter, or null when it has none. */
  getCritique(target: CritiqueTarget): Promise<SavedCritique | null>
  /**
   * Marks a note done, not needed or not for this story (or brings it back), in the kept critique; "Not for this story"
   * also tells every later critique of the story. Returns the critique as kept now (null when it has gone).
   */
  settleCritiqueNote(change: CritiqueNoteChange): Promise<SavedCritique | null>
  /** Lets the critic raise a kind of note again that Adam said isn't for this story. Returns what is left. */
  dropCritiqueWant(target: CritiqueTarget, wantId: string): Promise<CritiqueWant[]>
}

export interface CritiqueEvents {
  // The task events (contracts/tasks.ts) carry how a critique is going.
}
