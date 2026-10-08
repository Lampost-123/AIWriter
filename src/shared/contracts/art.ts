// The desk's drawings and book covers (UI overhaul, D5.4). The drawing for each entry and the cover for each story are
// worked out from their words (src/shared/motifs.ts), so nothing is stored for them; only Adam's own choices are, in
// the world's `meta` (key `art_choices`, as JSON), so they travel with the world in backups and world files. They never
// reach the AI's briefing or search, and they never touch an entry's history or "last worked on".

import type { ID } from '../types'

export interface ArtApi {
  /** Adam's choices of drawing for entries and of cover for stories (choices for things since deleted are left out). */
  getArtChoices(): Promise<ArtChoices>
  /** Chooses an entry's drawing (an id from MOTIFS), or null to go back to the one its words call for. */
  setEntryMotif(entryId: ID, motif: string | null): Promise<ArtChoices>
  /** Chooses a story's cover: its drawing and its colour (a hue, 0 to 359), or null to go back to its own. */
  setStoryCover(storyId: ID, cover: StoryCoverChoice | null): Promise<ArtChoices>
}

export interface ArtEvents {}

export interface EntryArtChoice {
  motif: string
  /** Who chose it: Adam, or (later) the AI's "Suggest drawings". */
  by: 'adam' | 'ai'
}

export interface StoryCoverChoice {
  motif?: string
  hue?: number
}

export interface ArtChoices {
  entries: Record<ID, EntryArtChoice>
  stories: Record<ID, StoryCoverChoice>
}
