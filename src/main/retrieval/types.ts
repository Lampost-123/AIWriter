// Story memory step 5, "recall by meaning, sticky entries, and what was said" (Adam, 2026-10-07): what the briefing is
// given besides the memory, and the search model's contract. Nothing here touches the database.

import type { ID, SaidKind } from '@shared/types'

/** An earlier passage found by searching, sent word for word. */
export interface RecalledPassage {
  /** Where it comes from, in plain words ("Book 1, Ch 2, Sc 3", "Book 1, Ch 2 (summary)"). */
  where: string
  text: string
  /** A passage of a scene's text, or a summary of an earlier scene, chapter or story. */
  kind: 'scene' | 'summary'
  /** Its place in the story, so passages can be sent oldest first. */
  order: number
}

/** Something said earlier that matters later: a promise, a threat or a secret told, in the exact words. */
export interface SaidLine {
  kind: SaidKind
  /** Who said it (their name as of this scene), or '' when they aren't known here. */
  by: string
  /** Who heard it (names), not counting the speaker. */
  heard: string[]
  /** The line, word for word. */
  words: string
  /** What it amounts to, in a few words ("Mara will come back for Tobin before the snow"). */
  fact: string
  /** Where it was said ("Book 1, Ch 2, Sc 3"). */
  where: string
  /** The speaker or someone who heard it is in this scene. */
  here: boolean
  /** Found by searching for what this scene is about (not only because who said or heard it is here). */
  found: boolean
}

/** What step 5 adds to a scene's briefing (ContextInput.recall); null or missing: nothing (switched off). */
export interface RecallInput {
  /** Entries in either of the last two scenes before this one: they stay in the briefing even when not named again. */
  sticky: ID[]
  /** Entries found by searching for what the scene is about, best first. */
  found: ID[]
  /** Earlier passages and summaries found by searching, best first. */
  passages: RecalledPassage[]
  /** Promises, threats and secrets told, with their exact words: those said or heard by someone here first. */
  said: SaidLine[]
}

/**
 * The search model: turns texts into vectors whose closeness is closeness of meaning. The real one is bge-small
 * (BAAI/bge-small-en-v1.5), downloaded once like the speech models; tests use a stand-in.
 */
export interface Embedder {
  /** Which model made the vectors: vectors from another model are never compared with these. */
  readonly model: string
  /** How alike a passage must be to count as a find (each model has its own scale). */
  readonly floor: number
  /** Unit-length vectors for these texts, in order. A query is phrased for searching ('query'); passages as they are. */
  embed(texts: string[], kind: 'query' | 'passage', signal?: AbortSignal): Promise<Float32Array[]>
  /** Lets go of the model (its memory, its threads). */
  close?(): void
}
