// Search across the world, the command palette and the shortcuts list (milestone 3). Owned by the Search part.
// See docs/ARCHITECTURE.md, "Milestone 3".
//
// One search box (Ctrl+K) looks through the manuscript, the memory, summaries and notes. The main
// process keeps an index of the open world's words (src/main/search/), so a search takes a few
// milliseconds however big the world is. Every word typed must match (in any order), ignoring case
// and accents; the last word matches the start of a word while Adam is still typing it.
import type { EntryKind, ID } from '../types'

export interface SearchApi {
  /**
   * Finds every word of `query` across the open world: scenes (title, text and card), entries,
   * summaries, notes, chapters and stories, and the style guide. Results come grouped, each group
   * with its best few first and how many match in all. An empty query finds nothing.
   */
  search(query: string, options?: SearchOptions): Promise<SearchResults>
  /**
   * Places Adam was recently (scenes and entries), as results with their names and where they are
   * now. Ones that were deleted since are left out.
   */
  searchPlaces(places: SearchPlace[]): Promise<SearchHit[]>
  /** Gets the open world's search ready ahead of the first search, so that one is instant too. */
  prepareSearch(): Promise<void>
}

export interface SearchEvents {}

/** The groups results come in. Entry kinds each have their own group. */
export type SearchGroupId = EntryKind | 'scenes' | 'summaries' | 'notes' | 'stories' | 'style'

export interface SearchOptions {
  /** Results per group (default 4). */
  limit?: number
  /** Groups Adam asked to see more of ("Show more"): these list up to 50. */
  expand?: SearchGroupId[]
  /** The story Adam is working in: its scenes come before other stories' when they match as well. */
  storyId?: ID | null
}

export interface SearchResults {
  /** The query as it was searched. */
  query: string
  /** Only groups with something in them, in the order they are shown. */
  groups: SearchGroup[]
  /** How long the search took in the main process, in milliseconds. */
  ms: number
}

export interface SearchGroup {
  id: SearchGroupId
  /** "Scenes", "Characters", "Summaries", "Notes", "Chapters and stories", "Style guide". */
  label: string
  /** How many match in all; the group lists the first `hits.length` of them. */
  total: number
  hits: SearchHit[]
}

/** A piece of text, with the words that matched the search marked. */
export interface TextPart {
  text: string
  hit?: boolean
}

export interface SearchHit {
  /**
   * Unique within one set of results, and starting with what it is (the palette's icons go by it):
   * 'scene:<id>', 'entry:<id>', 'summary:<level>:<id>', 'note:scene:<id>', 'note:entry:<id>',
   * 'chapter:<id>', 'story:<id>', 'style' or 'style:<storyId>'.
   */
  key: string
  /** Its name or title, with the matching words marked. */
  title: TextPart[]
  /** Where it is, or what it is, in plain words: "Book 1, Ch 12, Sc 3", "Private notes". */
  detail: string
  /** The words around the match (empty when there is nothing to add to the title). */
  snippet: TextPart[]
  /** The snippet is the manuscript's own prose (shown in the prose font). */
  prose: boolean
  /** What opening it does. */
  open: SearchOpen
}

/** A part of a scene's card, by the name of its field (the scene's summary is shown on the card too). */
export type CardPart = 'goal' | 'conflict' | 'outcome' | 'mood' | 'when' | 'beats' | 'notes' | 'summary'

/**
 * What opening a result does:
 * - 'scene': opens the scene; with `words`, selects and scrolls to them; with `card`, shows the scene card in the
 *   scene panel, scrolled to that part of it
 * - 'entry': opens the entry's page
 * - 'story': opens the story at `sceneId` (or where Adam last was in it)
 * - 'style': the world's style guide, or (with `storyId`) that story's settings
 */
export type SearchOpen =
  | { kind: 'scene'; sceneId: ID; storyId: ID; words: string | null; card: CardPart | null }
  | { kind: 'entry'; entryId: ID; entryKind: EntryKind }
  | { kind: 'story'; storyId: ID; sceneId: ID | null }
  | { kind: 'style'; storyId: ID | null }

/** A place Adam visited, for the palette's "Recent" list. */
export interface SearchPlace {
  kind: 'scene' | 'entry'
  id: ID
}
