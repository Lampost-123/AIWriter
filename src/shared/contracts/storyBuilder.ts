// The Story builder (Adam, 2026-10-17: "one place to build from"): a new story built with the AI in one page, in
// order. 1. Your idea: the plot in Adam's words, the story's style for everything the AI writes in it, anything that
// must or must never happen, his own characters and places, and a recipe if he wants one. 2. Codex: the AI plans
// every character, place, group, item, piece of lore, event, plot thread and word the story needs; he ticks, edits,
// redoes or talks it over, then the World builder lays it all out in full. 3. Outline: acts, chapters and scene cards
// planned from the idea and the finished codex. 4. Done. Owned by the Story builder part. See docs/ARCHITECTURE.md,
// "The Story builder".
//
// What wins when they differ: the idea (and Adam's own entries, marked `mine`), then the recipe, then the AI's own
// ideas. The brief is kept in the world's meta table (key `story_brief:<storyId>`), so no migration. Talking it over
// never changes anything by itself: the AI's revision comes back as a preview Adam applies or declines.

import type { EntryKind, ID } from '../types'
import type { RecipeParts, RecipePartId } from './recipes'

/** How long the story is meant to be: it sets how much the outline lays out. '' lets the recipe or the AI choose. */
export type StoryLength = '' | 'short' | 'novella' | 'novel'

/** A character, place or other thing Adam already has in mind, in his words. The AI keeps it exactly as written. */
export interface BriefEntry {
  kind: EntryKind
  name: string
  about: string
}

/** A question the AI asked about the idea, and Adam's answer in his own words. */
export interface BriefAnswer {
  topic: string
  question: string
  answer: string
}

/** One thing the codex step plans for the story, before anything is made. */
export interface CodexItem {
  /** Stable while the list is on screen (edits, redo and ticks go by it). */
  key: string
  kind: EntryKind
  name: string
  aliases: string[]
  /** Who or what it is, in a sentence or two. */
  about: string
  /** A place: the place it is inside, by name ('' for none). */
  in: string
  /** Lore that is always so, with no exceptions. */
  rule: boolean
  /** An event: when it happens ("Day 3, dusk", or "in the year 312" before the story begins). */
  when: string
  /** A character: the recipe's cast role it plays ("The mentor"); '' for none. */
  role: string
  /** From Adam's own idea: kept exactly as he wrote it, never renamed. */
  mine: boolean
  /** Ticked: it will be made. */
  on: boolean
  /** Already in the world under this name: the build adds to that page rather than making another. */
  existing: { entryId: ID; name: string } | null
}

/** What the codex step made, so the page shows it after a restart. */
export interface CodexBuilt {
  buildId: ID
  /** The build's run in What changed (one Undo takes the whole build back); null while it hasn't saved anything. */
  runId: ID | null
  at: string
}

export interface StoryBrief {
  /** The story's plot, in Adam's own words: as long as he likes. */
  plot: string
  setting: string
  /** Moments or facts that must be in the story. */
  mustHappen: string
  /** What must never happen, or be in it. */
  avoid: string
  length: StoryLength
  /** His own characters, places and other things, kept exactly as written. */
  mine: BriefEntry[]
  /** His answers to "Ask me questions". */
  answers: BriefAnswer[]
  /**
   * The recipe the story follows, with his changes to it for this story only (`tweaks`: the parts he changed). The
   * recipe itself changes only when he saves them back to it.
   */
  recipe: { id: ID; tweaks: Partial<RecipeParts> } | null
  /** The codex step's list, as it stands (null before the AI has planned it). */
  codex: CodexItem[] | null
  built: CodexBuilt | null
}

export const emptyBrief = (): StoryBrief => ({
  plot: '',
  setting: '',
  mustHappen: '',
  avoid: '',
  length: '',
  mine: [],
  answers: [],
  recipe: null,
  codex: null,
  built: null
})

/** One turn of talking it over with the AI. */
export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
}

/** How an AI call that waits for its whole answer ended. `error` is in plain words. */
interface Ended {
  status: 'complete' | 'stopped' | 'error'
  generationId: ID | null
  error: string | null
}

export interface CodexPlan extends Ended {
  items: CodexItem[]
}

export interface CodexChatRequest {
  taskId: ID
  storyId: ID
  /** The list as it is on screen (unticked items included, marked so). */
  items: CodexItem[]
  history: ChatTurn[]
  message: string
}

/** The AI's answer, and its revised list when it changed anything (null: it only answered). */
export interface CodexChatReply extends Ended {
  answer: string
  items: CodexItem[] | null
}

export interface CodexRedoRequest {
  taskId: ID
  storyId: ID
  items: CodexItem[]
  /** The item to do again. */
  key: string
  /** What Adam wants different, in his words ('' for "another take"). */
  note: string
}

export interface CodexRedoReply extends Ended {
  item: CodexItem | null
}

/** How much an outline lays out. Kept in step with OutlineSize (contracts/outline.ts). */
export interface StoryOutlineRequest {
  taskId: ID
  storyId: ID
  size: { acts: number; chapters: number; scenes: number }
}

/**
 * Talking over a plan of acts, chapters and scene cards (the Story builder's outline, the outline helper's
 * suggestions and a recipe's plan). `current`: the suggestions still waiting for a decision, in the outline form, with
 * Adam's changes to them. It streams as task events with job 'outline': the answer, then, when the AI changed the
 * plan, a line "=== Revised plan ===" and the whole revised plan in the outline form (src/main/storyBuilder/prompts.ts).
 */
export interface PlanChatRequest {
  taskId: ID
  storyId: ID
  current: string
  history: ChatTurn[]
  message: string
  /**
   * What Adam is looking at in Build with AI while he talks (2026-10-20): "his idea", "the cast and world", "the story's
   * open plot threads". Left out for the story line (the plan itself, the talk's own subject).
   */
  looking?: string
}

/**
 * One act, chapter or scene card done again. `target`: it as it stands, in the outline form, with what it holds;
 * `current`: the whole plan around it. It streams as task events with job 'outline', in the outline form.
 */
export interface PlanRedoRequest {
  taskId: ID
  storyId: ID
  current: string
  target: string
  kind: 'act' | 'chapter' | 'scene'
  note: string
}

/** Talking over a recipe's parts (the Story builder's recipe for this story, or the recipe page). */
export interface RecipeChatRequest {
  taskId: ID
  parts: RecipeParts
  history: ChatTurn[]
  message: string
}

/** The AI's answer, and the parts it changed (null: it only answered). */
export interface RecipeChatReply extends Ended {
  answer: string
  parts: Partial<RecipeParts> | null
}

export interface RecipePartRedoRequest {
  taskId: ID
  parts: RecipeParts
  part: RecipePartId
  note: string
}

export interface RecipePartRedoReply extends Ended {
  text: string
}

/** A question about the idea before the codex is planned (the World builder's interview, asked of the brief). */
export interface StoryQuestion extends Ended {
  topic: string
  question: string
}

export interface StoryBuilderApi {
  /** The story's brief (an empty one when there is none yet). */
  getStoryBrief(storyId: ID): Promise<StoryBrief>
  /** Keeps the brief as Adam types (silently). */
  saveStoryBrief(storyId: ID, brief: StoryBrief): Promise<void>
  /** "Ask me questions": the next question about the idea. Stop is stopTask(taskId). */
  askStoryQuestion(input: { taskId: ID; storyId: ID; asked: BriefAnswer[] }): Promise<StoryQuestion>
  /**
   * The codex step's plan: everything the story needs, from the brief (and its recipe), with Adam's own entries
   * first and what the world has already marked. Nothing is made. Stop is stopTask(taskId).
   */
  planStoryCodex(input: { taskId: ID; storyId: ID }): Promise<CodexPlan>
  /** Talks the codex list over; a revision comes back as a preview. Stop is stopTask(taskId). */
  storyCodexChat(input: CodexChatRequest): Promise<CodexChatReply>
  /** Does one item of the codex list again. Stop is stopTask(taskId). */
  redoCodexItem(input: CodexRedoRequest): Promise<CodexRedoReply>
  /**
   * Builds the ticked items in full with the World builder (profiles, links, relationships, themes, the check,
   * voices), in the background; the worldBuilder:* events say how it goes. One Undo (undoWorldBuild) takes it back.
   */
  buildStoryCodex(input: { buildId: ID; storyId: ID; items: CodexItem[] }): Promise<void>
  /**
   * The outline step: a premise (when the story has none) and acts, chapters and scene cards from the brief, the
   * recipe and the codex. Streams as task events with job 'outline', in the outline helper's form.
   */
  startStoryOutline(input: StoryOutlineRequest): Promise<{ generationId: ID }>
  /** Talks a plan of acts, chapters and scenes over (see PlanChatRequest). */
  startPlanChat(input: PlanChatRequest): Promise<{ generationId: ID }>
  /** Does one act, chapter or scene card of a plan again (see PlanRedoRequest). */
  startPlanRedo(input: PlanRedoRequest): Promise<{ generationId: ID }>
  /** Talks a recipe's parts over; changed parts come back as a preview. Stop is stopTask(taskId). */
  recipeChat(input: RecipeChatRequest): Promise<RecipeChatReply>
  /** Writes one part of a recipe again. Stop is stopTask(taskId). */
  redoRecipePart(input: RecipePartRedoRequest): Promise<RecipePartRedoReply>
}

export interface StoryBuilderEvents {
  // None: its AI calls use the task events and the World builder's (contracts/tasks.ts, contracts/worldBuilder.ts).
}
