// The automatic story flows (spec, Multi-story rules: "Automatic flows"), milestone 3. Owned by the
// Story flows part; the Stories part calls them from its screens. Each runs by itself in the
// background with the memory model, lists what it did under What changed with Undo, and marks any
// judgement call with a question mark Adam can answer any time. Nothing waits on them.
import type { ID } from '../types'

export interface StoryFlowsApi {
  /**
   * "What changed before this story starts?": for a story with a time since the previous story,
   * drafts start-of-story changes for the gap (origin 'ai', such as "Mara: died long ago") and closes
   * plot threads left open with a note such as "left unanswered". Starts the work and returns; the
   * 'story:flow' event says how it went. Runs when Adam fills in the time gap and from story settings.
   */
  fillTimeGap(storyId: ID): Promise<void>
  /**
   * Starting cast for a prequel: drafts a start-of-story full description (origin 'ai') for each
   * character, place, group and item given, and adds the prequel's start as a first-exists point.
   * Starts the work and returns; the 'story:flow' event says how it went.
   */
  draftStartingCast(storyId: ID, entryIds: ID[]): Promise<void>
  /**
   * "When did these happen?": after Adam says yes to "Should <book> now continue after it?", sorts
   * each of the book's start-of-story changes into before the new story (moved to its start), after
   * it (left on the book), or in the new story (removed, a scene there carries it). Each is a
   * question-marked line in What changed. Starts the work and returns.
   */
  sortStartChanges(newStoryId: ID, bookId: ID): Promise<void>
}

/** How a story flow is doing, for a quiet note in story settings. */
export interface StoryFlowStatus {
  storyId: ID
  flow: 'time-gap' | 'starting-cast' | 'when'
  state: 'running' | 'done' | 'failed'
  /** Plain words with a next step when it failed; a short result otherwise ("Added 4 changes"). */
  message: string | null
}

export interface StoryFlowsEvents {
  'story:flow': StoryFlowStatus
}
