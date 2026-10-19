// The story index (overhaul phase 1): a look-up table that says, scene by scene, who is where, with what, and what
// changed, kept as dated facts. Its rows (migration 5) are built from what the world already holds, with no AI call
// (build.ts), and read back by the look-ups (lookup.ts) and the free checks (checks.ts). Types only.

import type { ID } from '@shared/types'

/**
 * How a scene's row was filled: from what the world holds alone (no AI), or with where things stand read from the scene's
 * words by the AI (its physical details: storyIndex/fill.ts), or by Adam ('hand': not built yet).
 */
export type IndexFilled = 'free' | 'ai' | 'hand'

/** The kinds of dated fact. */
export type IndexFactKind = 'where' | 'wearing' | 'carrying' | 'condition' | 'knows' | 'relationship' | 'thread' | 'status'

/**
 * Where a fact comes from: the scene card, the memory's changes, where things stand (the stage tracker), or Adam (a change
 * he made himself, or a value he set in Recall).
 */
export type IndexOrigin = 'card' | 'memory' | 'tracker' | 'hand'

/** What a scene does to a plot thread. */
export type ThreadEvent = 'opened' | 'moved' | 'closed'

/** One scene's row. */
export interface IndexScene {
  sceneId: ID
  storyId: ID
  /** Its place in its story: 1 for the first live scene of the first chapter, and on. */
  position: number
  /** "Ch 3, Sc 2", counting live chapters and scenes from 1. */
  label: string
  /** What happens, in a line or two (the scene's summary); '' when there is none yet. */
  gist: string
  /** Who is there: the card's people, those the words name as there, and those the memory saw there. */
  present: ID[]
  /** What the words only name: people thought of, talked of or far away, and places, things and the rest. */
  mentioned: ID[]
  /** The card's place. */
  placeEntryId: ID | null
  /** The card's When, as Adam wrote it. */
  whenText: string
  sourceHash: string
  filled: IndexFilled
  updatedAt: string
}

/**
 * A dated fact, or where one stops (`value` ''). `slot` tells facts of one kind apart: '' for where (from the words),
 * 'card' for where (from the card), carrying and condition; the piece for wearing ("grey coat"); the fact's id for knows;
 * 'with:<entry id>' for a relationship; 'life' for being dead, 'note:<change id>' for any other status.
 */
export interface IndexFact {
  id: ID
  storyId: ID
  /** Null for a fact about the scene itself. */
  entryId: ID | null
  kind: IndexFactKind
  slot: string
  value: string
  fromSceneId: ID
  /** The scene a later one stops it in; null while it is still true. */
  untilSceneId: ID | null
  /** The scene whose build made the row (it goes when that scene is built again). */
  sourceSceneId: ID
  /** The story's words that show it, when known. */
  quote: string
  origin: IndexOrigin
  createdAt: string
}

/** A fact as a scene's build makes it (the rest is filled in when it is written). */
export type NewIndexFact = Pick<IndexFact, 'entryId' | 'kind' | 'slot' | 'value' | 'fromSceneId' | 'quote' | 'origin'>

export interface IndexThreadEvent {
  id: ID
  storyId: ID
  threadEntryId: ID
  sceneId: ID
  event: ThreadEvent
  note: string
}

export type NewThreadEvent = Pick<IndexThreadEvent, 'threadEntryId' | 'event' | 'note'>

/** A fact with where its start and end are in the story (the look-ups read these). */
export interface PlacedFact extends IndexFact {
  fromPosition: number
  fromLabel: string
  /** Null while it is still true. */
  untilPosition: number | null
  untilLabel: string | null
}
