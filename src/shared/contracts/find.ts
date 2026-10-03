// Writing by hand: find and replace across the whole story (Ctrl+Shift+F). Owned by the Find part.
// Finding in the open scene (Ctrl+F) happens in the window alone (features/find/); this is the story-wide
// part, done in the main process (src/main/find/) so stored scenes change without opening them.
//
// How a replace goes:
//  - The window saves the open scene first, then sends the page as it shows (`page`), with the ranges of any
//    AI suggestion waiting in it (`keep`: matches touching them are never changed).
//  - Every scene that changes gets a History snapshot first ("Before find and replace"). Stored scenes are
//    changed in their stored documents (bold, italic and paragraph ids kept) and saved the way a normal
//    save is, so the memory keeper and search see the new text. The open scene is not written here: the
//    reply says what to change in it (`page`), and the window makes that change through the editor.
//  - The reply's `token` is for Undo: undoReplaceInStory puts every scene back that hasn't changed since
//    (and the name, when an entry was renamed). Nothing about it is stored: it lasts while the app runs.
import type { EntryKind, ID } from '../types'

export interface StoryFindOptions {
  matchCase: boolean
  wholeWord: boolean
}

/** The open scene as the page shows it (EditorBridge.current()), sent so unsaved typing is read too. */
export interface PageForFind {
  sceneId: ID
  doc: unknown
  text: string
  /** Document ranges no replacement may touch (an AI suggestion waiting in the page). */
  keep?: { from: number; to: number }[]
}

export interface StoryFindInput extends StoryFindOptions {
  storyId: ID
  query: string
  page: PageForFind | null
}

/** One match, with a little text around it (in plain text, for the prose font). */
export interface StoryMatch {
  /** Unique within its scene ("from:to" document positions); replaceInStory names the ticked ones by it. */
  id: string
  before: string
  text: string
  after: string
}

export interface StorySceneMatches {
  sceneId: ID
  chapterId: ID
  /** Counted from 1 among the story's chapters, and among the chapter's scenes. */
  chapterNumber: number
  sceneNumber: number
  chapterTitle: string
  sceneTitle: string
  matches: StoryMatch[]
}

/** An entry whose name is the words being found (ignoring case): the window offers to rename it in memory too. */
export interface RenameOffer {
  entryId: ID
  kind: EntryKind
  name: string
}

export interface StoryFindResult {
  query: string
  /** Scenes with matches, in reading order. */
  scenes: StorySceneMatches[]
  /** Every match in the story. */
  total: number
  /** The matches listed (at most MAX_LISTED); replacing reaches only listed ones. */
  listed: number
  /** Matches in the open scene inside an AI suggestion waiting there: not listed, never changed. */
  heldBack: number
  rename: RenameOffer | null
}

/** A story lists at most this many matches; find again after replacing them for the rest. */
export const MAX_LISTED = 2000

export interface StoryReplaceInput extends StoryFindInput {
  /** The words that go in (may be empty: the matches are taken out). */
  replacement: string
  /** The ticked matches, by scene. */
  picks: { sceneId: ID; matchIds: string[] }[]
  /** Also rename this entry to the replacement (keeping its old name as another name). */
  rename: { entryId: ID; name: string } | null
}

/** What to change in the page: put `doc`'s [newFrom, newTo) in place of each [from, to) of the page now. */
export interface PageChange {
  sceneId: ID
  doc: unknown
  ranges: { from: number; to: number; newFrom: number; newTo: number }[]
}

export interface SkippedScene {
  sceneId: ID
  title: string
}

export interface StoryReplaceResult {
  /** For undoReplaceInStory; null when nothing changed. */
  token: ID | null
  /** How many matches were replaced, and in how many scenes (the open scene's included). */
  replaced: number
  scenes: number
  /** Scenes left as they were because a draft was being written into them. */
  skipped: SkippedScene[]
  /** The open scene's change, for the window to make through the editor (null when it has none). */
  page: PageChange | null
  renamed: { entryId: ID; from: string; to: string } | null
}

export interface StoryUndoResult {
  /** Scenes put back (the open scene's included when `page` is set). */
  scenes: number
  /** Scenes changed again since, so left as they are. */
  skipped: SkippedScene[]
  /** The open scene's change back, for the window to make through the editor. */
  page: PageChange | null
  /** 'undone': the old name is back; 'changed': the entry was changed again since, so it was left; null: no rename. */
  rename: 'undone' | 'changed' | null
}

export interface FindApi {
  /** Every match of `query` in the story's scenes (the open scene as the page shows it), grouped by scene. */
  findInStory(input: StoryFindInput): Promise<StoryFindResult>
  /** Replaces the ticked matches (see the top of this file). */
  replaceInStory(input: StoryReplaceInput): Promise<StoryReplaceResult>
  /** Undoes a replaceInStory: every scene not changed since goes back, and the entry's name and other names. */
  undoReplaceInStory(token: ID, page: PageForFind | null): Promise<StoryUndoResult>
}

export interface FindEvents {}
