// Story screens: the New story dialog, story settings and story cards (milestone 3). Owned by the Stories part.
// See docs/ARCHITECTURE.md, "Milestone 3". The rules behind every call are in the spec's "Multi-story
// rules" tab; the work is done in src/main/stories/ over the same shape the memory's line is built on.
import type { ID, Series, Story } from '../types'
import type { StoryPlacement } from '../api'

/** A story's "What is it?" as it is being chosen, before anything is saved: a new story (storyId null) or a change to one. */
export interface StoryDraft {
  storyId: ID | null
  title: string
  seriesId: ID | null
  placement: StoryPlacement
  /** Other side stories to end after a chapter first (the New story dialog's "End Ash after Ch 1", applied on Create). */
  endFirst?: EndFirst[]
}

/** A still-running side story ended after a chapter of its book, so a new story starting there knows it. */
export interface EndFirst {
  storyId: ID
  endRefId: ID
}

/**
 * A choice that would quietly lose history, in plain words, with the likely alternatives (spec:
 * "Suggested start in the New story dialog"): continuing after a side story, or a prequel to a book
 * that isn't first in its series.
 */
export interface StoryWarning {
  kind: 'after-side' | 'prequel-not-first'
  message: string
  options: { label: string; placement: StoryPlacement }[]
}

/** Another side story of the same book, still running where this one starts (so this one doesn't know it). */
export interface StillRunning {
  storyId: ID
  title: string
  /**
   * Where it could end so that it ends before this story starts: the button's label ("End Ash after Ch 1")
   * and the chapter ("Ch 1"); null when no chapter ends early enough.
   */
  endFirst: { endRefId: ID; label: string; chapter: string } | null
}

/** What a story would know with a placement, worked out without saving anything. */
export interface StoryPreview {
  /** "This story knows what happened in: Book 1; Kell's Road; Book 2 up to the end of Ch 5." ('' when `problem` is set.) */
  knows: string
  /** Why it can't be saved, in plain words ("Book 2 can't start during Kell's Road, because..."); null when it can. */
  problem: string | null
  warnings: StoryWarning[]
  stillRunning: StillRunning[]
  /** What it is, in one line: "Continues after Book 2", "Side story during Book 2, after Ch 5". */
  summary: string
  /** The grey line on its card; null for a story that simply continues. */
  label: string | null
}

/** The suggested start for a new story in a series, with a title and what it would know. */
export interface StorySuggestion {
  placement: StoryPlacement
  title: string
  preview: StoryPreview
}

export interface NewStoryInput {
  title: string
  /** The series it goes in; ignored when `newSeries` names a new one. */
  seriesId: ID | null
  newSeries?: string
  placement: StoryPlacement
  /** Time since the previous story, such as "200 years". */
  timeGap?: string
  /** Side stories still running where it starts that end after a chapter first, in the same go. */
  endFirst?: EndFirst[]
}

/** A story in another's question or note: its id and title. */
export interface StoryRef {
  storyId: ID
  title: string
}

export interface CreatedStory {
  story: Story
  /** Its first scene, to open. */
  sceneId: ID
  /** "Should Book 2 now continue after it?": earlier books of its series that continue after the same story. */
  mightFollow: StoryRef[]
  /** The side stories it ended first ("Ash now ends after Ch 1"), with what each was before, for Undo. */
  endedFirst: (StoryRef & { chapter: string; was: StoryPlacement })[]
}

/** What story settings shows about a story beyond its own fields. */
export interface StoryDetails {
  story: Story
  /**
   * What it is now, as the memory has it: a start or end at a deleted story, chapter or scene is already
   * moved to where it now is (the story's own fields still point at what was deleted, so restoring it
   * puts things back). Edit and undo from this one; setStoryPlacement refuses the other.
   */
  placement: StoryPlacement
  /** What it knows with its saved placement. */
  preview: StoryPreview
  /** Stories that start in this one, with where each would start if this one were deleted ("after Book 1, Ch 1"). */
  startingHere: (StoryRef & { wouldStart: string })[]
  /**
   * "Should Book 2 now continue after it?": earlier books of its series that continue after the same
   * story, until Adam answers No here (declineFollow).
   */
  mightFollow: StoryRef[]
  /** For a prequel and the stories that continue after it: the book they lead into and which story leads in. */
  leadsInto: { book: StoryRef; leader: StoryRef; marked: boolean } | null
  /** A prequel's starting cast so far: entries with a start-of-story description or a first-exists point at its start. */
  cast: ID[]
}

/** A scene or chapter about to move in the binder (the same arguments as moveScene and moveChapter). */
export type OutlineMove = { kind: 'scene'; id: ID; chapterId: ID; index: number } | { kind: 'chapter'; id: ID; index: number }

export interface StoriesApi {
  /** What a story would know with this placement, its warnings and its card line, without saving anything. */
  previewStory(draft: StoryDraft): Promise<StoryPreview>
  /**
   * The suggested start for a new story in a series (null with `newSeries`: a new series), following the
   * spec's "Suggested start in the New story dialog". `fromStoryId` is the story Adam is working in: a new
   * or empty series gets the suggestion for its series.
   */
  suggestStart(input: { seriesId: ID | null; newSeries?: string; fromStoryId: ID | null }): Promise<StorySuggestion>
  /** Makes a story with its placement, its first chapter and scene (and a new series, if named) in one go. */
  createStoryAs(input: NewStoryInput): Promise<CreatedStory>
  getStoryDetails(storyId: ID): Promise<StoryDetails>
  /** What a story is now, as the memory has it (see StoryDetails.placement): the one to change or put back. */
  getStoryPlacement(storyId: ID): Promise<StoryPlacement>
  /**
   * The story cards: every story in reading order ("Shelf order is reading order", for display only),
   * and the grey line on each card by story id (stories that simply continue have none).
   */
  listShelf(): Promise<{ order: ID[]; labels: Record<ID, string> }>
  /** Adam's "No" to "Should Book 2 now continue after it?" for this story: story settings stops asking. */
  declineFollow(storyId: ID): Promise<void>
  createSeries(name: string): Promise<Series>
  updateSeries(id: ID, patch: Partial<Pick<Series, 'name' | 'themes' | 'tone'>>): Promise<Series>
  /** Marks this story as the one that leads into its prequel chain's book (on), or goes back to the last one in the chain (off). */
  setLeadsIn(storyId: ID, on: boolean): Promise<void>
  /**
   * Before a scene or chapter moves in the binder: what the move would change for stories that start
   * or end in that story, in plain words, and where it is now (to move it back).
   */
  previewMove(move: OutlineMove): Promise<{ notes: string[]; from: { chapterId: ID | null; index: number } }>
  /** Before a scene or chapter is deleted: where the stories that start or end after it will start or end instead. */
  deleteNotes(kind: 'scene' | 'chapter', id: ID): Promise<string[]>
}

export interface StoriesEvents {}
