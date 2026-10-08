// Chapter cards (2026-10-08): the scene card parts a chapter's scenes share, set once on the chapter (point of view,
// characters present, location, when, mood, length, notes for the AI). Kept in the world's meta table, one row a
// chapter (`chapter_card:<chapter id>`): no migration. "Copy through": the chapter's values are written into the
// scene cards that follow them, so everything that reads a scene card is unchanged. The rules are in
// src/shared/chapterCard.ts; the SQL in src/main/db/repo.ts. See docs/ARCHITECTURE.md, "Chapter cards".
import type { ChapterCard, ID } from '../types'
import type { SceneCarry } from '../chapterCard'

/** A scene card a chapter card change wrote into, and its parts as they were. */
export interface ChapterCardUpdate {
  sceneId: ID
  before: SceneCarry
}

export interface ChapterCardSaved {
  card: ChapterCard
  /** The scene cards it changed (the scenes that follow it), for "Updated 3 scenes" and its Undo. */
  updated: ChapterCardUpdate[]
}

/** Names the AI gave a chapter card (the outline helper, a chapter's plan): matched to the world's characters and places. */
export interface ChapterCardNames {
  pov?: string
  characters?: string[]
  location?: string
  when?: string
  mood?: string
}

export interface ChapterCardsApi {
  /** The chapter's card; an empty one when it has none. */
  getChapterCard(chapterId: ID): Promise<ChapterCard>
  /** Saves the chapter's card and writes it into the cards of the scenes that follow it, in one go. */
  updateChapterCard(chapterId: ID, card: ChapterCard): Promise<ChapterCardSaved>
  /** Undo for updateChapterCard: the card as it was, and those scenes' parts as they were. Says how many scenes changed back. */
  restoreChapterCard(chapterId: ID, card: ChapterCard, scenes: ChapterCardUpdate[]): Promise<number>
  /**
   * Fills the chapter card's empty parts from names the AI gave (a chapter's plan): names it doesn't know are left
   * out, and nothing already on the card changes. Says what it filled, and what that changed, for its Undo.
   */
  fillChapterCard(chapterId: ID, names: ChapterCardNames): Promise<ChapterCardSaved & { before: ChapterCard; filled: string[] }>
}

export interface ChapterCardsEvents {
  // None.
}
