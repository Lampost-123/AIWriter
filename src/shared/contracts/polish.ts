// The polish pass after drafting (Generate's "Polish after drafting" option): once a Generate draft is
// finished, a second call to the writer model, with its own Thinking (`settings.thinking.polish`, Off), reads
// the draft against common weaknesses (clichés, needless explaining, purple prose, flat or repetitive
// sentences, vague detail, odd word choice, tense or point-of-view slips), the genre and the style guide, and
// writes the whole scene revised. Nothing in the scene changes until Adam accepts the revision in the page.
//
// It runs through the shared task runner (task:* events, contracts/tasks.ts) as a 'polish' record of the scene
// with `params.polishOf` (the draft's record); Stop is stopTask(taskId).
import type { ID } from '../types'

export interface PolishInput {
  /** Made by the interface (any unique id), so every task event can be matched to it. */
  taskId: ID
  sceneId: ID
  /** The record of the draft being polished. */
  draftId: ID
  /** The draft as it stands in the page: paragraphs separated by blank lines, *italics*, "* * *" for a scene break. */
  text: string
}

export interface PolishApi {
  /** Starts the polish pass: the revised scene arrives as task events for `taskId`. */
  startPolish(input: PolishInput): Promise<{ generationId: ID }>
}

export interface PolishEvents {
  // The task events (contracts/tasks.ts) carry everything the polish pass needs.
}
