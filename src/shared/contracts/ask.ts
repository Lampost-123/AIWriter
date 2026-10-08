// Ask the world (milestone 4): a chat panel for brainstorming that can see the memory, answers from it,
// cites the entries it used, and can save anything useful to the memory as Adam's own note with one
// click. Owned by the Ask the world part. See docs/ARCHITECTURE.md, "Milestone 4".
//
// The editor chat (Adam, 2026-10-03): the same chat can look things up for itself (scenes, the outline, search,
// entries, the style guide, a scene's issues) and propose changes: to a scene's words, its card, an entry, a new
// entry, a new scene or chapter, or a rename. It never changes anything on its own and never deletes: each change is
// a Proposal Adam applies (or not) from the chat, and every applied change can be undone.
//
// Each turn is a 'chat' generation record with `params.chatId`, run by the shared task runner (task:*
// events) with the "Chat and brainstorm" model (jobModel('chat')).
//
// A chat belongs to the story it was asked in, and every answer is from that story's point of view (as
// it stands at the open scene, or at the story's end when no scene is open), chosen by the same rules
// as a draft's briefing: an own version of events (a what-if) never reaches another story's chat, and
// a chat never carries on in another story. Answers name the entries they used as [[Entry name]].
import type { EntryKind, ID, Origin, SceneCard } from '../types'

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
   * Saves words from an answer to the memory as Adam's own note: added to the end of an entry's
   * description as it stands where Adam is (the entry's own, or the one a change sets on this story's way,
   * such as a prequel's starting description), marked as typed by him; or as a new note in the world
   * (lore) when `entryId` is null. In an own version of events nothing reaches another story: when the
   * entry's description there also counts elsewhere, the note becomes a page in Lore of its own that
   * first exists in that story.
   */
  saveAskNote(input: SaveNoteInput): Promise<SavedNote>
  /** Takes a note saved with saveAskNote back out (the toast's Undo). */
  undoAskNote(undo: NoteUndo): Promise<void>
  /** The editor chat: records what Adam made of a proposed change (it is applied by the window, through the usual calls). */
  setProposalStatus(generationId: ID, proposalId: string, status: ProposalStatus): Promise<void>
}

export interface AskEvents {
  /** The editor chat looked something up or noted a change: a short line for the answer being written ("Reading Ch 2, Sc 1"). */
  'ask:step': { taskId: ID; generationId: ID; label: string }
  /** The editor chat proposed changes (all of this turn's, so far). */
  'ask:proposals': { taskId: ID; generationId: ID; proposals: Proposal[] }
  /**
   * The editor chat asked the writer one question with options (ask_user, lab switch ASKUSER), which ends its answer.
   * The question and numbered options are also at the end of the answer's text, for a window that doesn't show these.
   */
  'ask:choice': { taskId: ID; generationId: ID; choice: AskChoice }
}

/**
 * A question the editor chat asks the writer instead of guessing (ask_user): 2 to 4 options to pick from. The writer's
 * pick is meant to come back as the next question in the chat (the window's part).
 */
export interface AskChoice {
  question: string
  options: { label: string; detail?: string }[]
  /** The option the chat recommends: an index into `options` (0 = the first). */
  recommended?: number
  /** More than one option may be picked. */
  multi?: boolean
}

/**
 * Where words a proposal changes stand in the scene (lab switch ANCHOR), so they are found there even when the same
 * words occur elsewhere: the paragraph as read_scene numbered it ([12] → 12), its stable paragraph id (attrs.pid; null
 * for a scene saved without ids) and the offset in that paragraph's plain text (characters; a line break counts one,
 * as in the page, so it is also the ProseMirror offset inside the paragraph).
 */
export interface ParaAnchor {
  paragraph: number
  pid: string | null
  offset: number
}

/** How a proposed draft is written (propose_draft, lab switch DRAFT): the writer's own jobs. */
export type DraftMode = 'generate' | 'add_below' | 'continue' | 'redo_beat'

/** What Adam made of a proposed change. */
export type ProposalStatus = 'pending' | 'applied' | 'declined'

/** The parts of a scene card the editor chat may propose. */
export type CardProposal = Partial<Pick<SceneCard, 'goal' | 'conflict' | 'outcome' | 'mood' | 'when' | 'notes' | 'beats'>>

/** The parts of an entry the editor chat may propose (new values; `fields` by the kind's field keys). */
export interface EntryProposal {
  summary?: string
  description?: string
  aliases?: string[]
  fields?: Record<string, string>
}

/**
 * A change the editor chat proposes. Nothing happens until Adam applies it (and it can be undone after); `why` is the
 * chat's own short reason. `id` is unique within its turn.
 */
export type Proposal = { id: string; status: ProposalStatus; why: string } & (
  | {
      /** Words in a scene: `find` (exactly as in the scene now) becomes `replace` ('' cuts them). */
      kind: 'text'
      sceneId: ID
      sceneLabel: string
      find: string
      replace: string
      /**
       * Where `find` starts (lab switch ANCHOR). `find` is always the scene's exact words, widened when it can be so the
       * page finds them there first; when it couldn't be (the same words, as the page matches them, come earlier),
       * Apply should use this place, not the first one.
       */
      at?: ParaAnchor
    }
  | {
      /**
       * A passage of a scene rewritten, across paragraphs (Adam, 2026-10-04: "push the beats harder" can't be one
       * paragraph's change): from the words `start` to the words `end`, as the scene has them now, becomes `replace`
       * (paragraphs split by a blank line). `original` is the passage as it was, to show.
       */
      kind: 'passage'
      sceneId: ID
      sceneLabel: string
      start: string
      end: string
      original: string
      replace: string
      /**
       * Where the passage stands (lab switch ANCHOR): `start` at its first character, `end` just after its last (an
       * exclusive offset in that paragraph). `start` and `end` are widened when they can be so the page finds them there.
       */
      at?: { start: ParaAnchor; end: ParaAnchor }
    }
  | { kind: 'card'; sceneId: ID; sceneLabel: string; patch: CardProposal }
  | { kind: 'entry'; entryId: ID; entryKind: EntryKind; name: string; patch: EntryProposal }
  | { kind: 'newEntry'; entryKind: EntryKind; name: string; summary: string; description: string }
  | {
      /** A new scene at the end of a chapter, with a card if given. */
      kind: 'newScene'
      chapterId: ID
      chapterLabel: string
      title: string
      card: CardProposal
    }
  | { kind: 'newChapter'; storyId: ID; title: string }
  | { kind: 'rename'; target: 'scene' | 'chapter'; targetId: ID; from: string; to: string }
  | {
      /**
       * A draft for the writer to write (propose_draft, lab switch DRAFT): nothing is written until Adam applies it,
       * which starts the writer's own job for the scene with this direction. `beat` (redo_beat): the card's beat, from
       * 1, with its words as the card had them. `atParagraph` (continue): carry on from the end of this paragraph (left
       * out: from the end of the scene). `length`: words to aim for (left out: the writer's own choice).
       */
      kind: 'draft'
      sceneId: ID
      sceneLabel: string
      mode: DraftMode
      direction: string
      beat?: { index: number; text: string }
      atParagraph?: ParaAnchor
      length?: number
    }
)

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
  /** The editor chat: what it looked up on the way, in plain words. */
  steps?: string[]
  /** The editor chat: the changes it proposes, and what Adam made of each. */
  proposals?: Proposal[]
  /** The editor chat ended its answer with a question with options (ask_user, lab switch ASKUSER). */
  choice?: AskChoice
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
  /** The open scene: the note goes on the entry as it is there (at the story's end when none is open). */
  sceneId?: ID | null
}

export interface SavedNote {
  entryId: ID
  kind: EntryKind
  /** The entry's name (a new note's name). */
  name: string
  /** A new note was made for it. */
  created: boolean
  /** Saved in an own version of events, so it reaches no other story: that story's title. */
  onlyIn: string | null
  /**
   * Added to the entry as it is from a point in a story (the description a change sets there), in plain
   * words: "the start of Young Mara", "Book 2, Ch 3, Sc 1". Null when it went on the entry's own description.
   */
  asOf: string | null
  /** For undoAskNote. */
  undo: NoteUndo
}

/** How to take a saved note back out. */
export type NoteUndo =
  /** A new note: it goes to Recently deleted. */
  | { kind: 'created'; entryId: ID }
  /** Words added to the end of a description: they come out again, and the description is as it was. */
  | { kind: 'added'; entryId: ID; text: string; before: string; origin: Origin | null; byHand: boolean }
  /** Words added to the end of the description a change sets: they come out again, and the change is as it was. */
  | { kind: 'changed'; entryId: ID; changeId: ID; text: string; before: string; origin: Origin }
