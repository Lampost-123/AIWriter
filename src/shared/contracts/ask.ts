// Ask the world (milestone 4): a chat panel for brainstorming that can see the memory, answers from it,
// cites the entries it used, and can save anything useful to the memory as Adam's own note with one
// click. It never changes the manuscript or the memory on its own. Owned by the Ask the world part.
// See docs/ARCHITECTURE.md, "Milestone 4".
//
// Each turn is a 'chat' generation record with `params.chatId`, run by the shared task runner (task:*
// events) with the "Chat and brainstorm" model (jobModel('chat')).
//
// A chat belongs to the story it was asked in, and every answer is from that story's point of view (as
// it stands at the open scene, or at the story's end when no scene is open), chosen by the same rules
// as a draft's briefing: an own version of events (a what-if) never reaches another story's chat, and
// a chat never carries on in another story. Answers name the entries they used as [[Entry name]].
import type { EntryKind, ID, Origin } from '../types'

export interface AskApi {
  /**
   * Asks a question, in a chat (null starts a new one), from the point of view of the open story and
   * scene. Resolves once the question is on its way, with the new turn (its answer still empty); the
   * answer streams as task events for `taskId` and can be stopped with stopTask. Throws (plain words)
   * when nothing could be sent: no model set up, an empty question, a chat from another story.
   */
  askWorld(input: AskInput): Promise<AskTurn>
  /** The chats asked in a story (null: with no story open), most recent first; the last 30. */
  listChats(storyId: ID | null): Promise<ChatSummary[]>
  /** A chat's turns, oldest first. A turn still being answered has the text that has arrived so far. */
  getChat(chatId: ID): Promise<AskTurn[]>
  /**
   * Saves words from an answer to the memory as Adam's own note: added to an entry's description (his
   * words, marked as typed by him), or as a new note in the world (lore) when `entryId` is null. In an
   * own version of events, a note added to an entry from outside it is kept for that story only, so it
   * never reaches another story.
   */
  saveAskNote(input: SaveNoteInput): Promise<SavedNote>
  /** Takes a note saved with saveAskNote back out (the toast's Undo). */
  undoAskNote(undo: NoteUndo): Promise<void>
}

export interface AskEvents {}

export interface AskInput {
  /** Made by the interface (any unique id), so every task event can be matched to it. */
  taskId: ID
  /** The chat to carry on, or null for a new chat. */
  chatId: ID | null
  question: string
  /** The open story and scene: the answer is from this point of view. */
  storyId: ID | null
  sceneId: ID | null
}

/** One question and its answer. */
export interface AskTurn {
  /** The turn's record, for "What the AI saw". */
  generationId: ID
  chatId: ID
  question: string
  /** The answer (so far, while it streams), naming the entries it used as [[Entry name]]. */
  answer: string
  status: 'streaming' | 'complete' | 'stopped' | 'error'
  /** Plain words with a next step, when status is 'error'. */
  error: string | null
  /** USD; null when unknown. */
  cost: number | null
  /** The provider didn't report the cost, so `cost` is AI Write's own estimate. */
  costEstimated: boolean
  /** The answer ran into its length limit, so it stops before its end. */
  cutOff: boolean
  createdAt: string
}

/** A chat in the list of earlier chats. */
export interface ChatSummary {
  chatId: ID
  /** Its first question, cut short. */
  title: string
  turns: number
  /** When the last question was asked. */
  updatedAt: string
}

export interface SaveNoteInput {
  /** The words to keep: an answer, or part of one. The [[ ]] around names are taken out. */
  text: string
  /** The entry to add the note to; null makes a new note in the world (lore). */
  entryId: ID | null
  /** For a new note: the question the answer was for, which names it. */
  question?: string
  /** The story Adam is working in, so a note saved in an own version of events stays in it. */
  storyId: ID | null
}

export interface SavedNote {
  entryId: ID
  kind: EntryKind
  /** The entry's name (a new note's name). */
  name: string
  /** A new note was made for it. */
  created: boolean
  /** The note was kept for one story only (an own version of events): that story's title. */
  onlyIn: string | null
  /** For undoAskNote. */
  undo: NoteUndo
}

/** How to take a saved note back out. */
export type NoteUndo =
  /** A new note: it goes to Recently deleted. */
  | { kind: 'created'; entryId: ID }
  /** Words added to the end of a description: they come out again, and the description is as it was. */
  | { kind: 'added'; entryId: ID; text: string; before: string; origin: Origin | null; byHand: boolean }
  /** Kept for one story only, as a start-of-story change: the change goes. */
  | { kind: 'change'; entryId: ID; changeId: ID }
