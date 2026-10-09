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
}

export interface CritiqueRequest {
  /** Made by the interface (any unique id), so Stop can stop it. */
  taskId: ID
  target: CritiqueTarget
}

export type CritiqueOutcome = { status: 'complete'; critique: Critique } | { status: 'stopped' } | { status: 'error'; error: string }

/** The latest critique kept for a scene or chapter, and whether its words have changed since. */
export interface SavedCritique {
  critique: Critique
  changed: boolean
}

export interface CritiqueApi {
  /**
   * Critiques a scene or a chapter and keeps the result (replacing the one before). Resolves when it has finished,
   * been stopped or failed; throws (plain words) only before it starts: no writer model, or nothing to read.
   */
  startCritique(input: CritiqueRequest): Promise<CritiqueOutcome>
  /** The latest critique kept for the scene or chapter, or null when it has none. */
  getCritique(target: CritiqueTarget): Promise<SavedCritique | null>
}

export interface CritiqueEvents {
  // The task events (contracts/tasks.ts) carry how a critique is going.
}
