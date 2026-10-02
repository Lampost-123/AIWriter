// The outline helper and next scene ideas (milestone 4). From a premise, the AI suggests acts, chapters
// and scene cards that Adam keeps, edits or discards one by one (nothing is added without a click); on an
// empty scene card, it offers three directions for the scene. Acts appear in the binder from here on.
// Owned by the Outline part. See docs/ARCHITECTURE.md, "Milestone 4".
//
// Calls are 'outline' and 'ideas' generation records run by the shared task runner (task:* events) with
// the "Chat and brainstorm" model (jobModel('chat')). Acts use the `acts` table and chapters.act_id,
// which migration 2 already made.
//
// Acts: each act's chapters follow one another in the story, acts in their own order, after any chapters
// that have no act (those written before the story had acts). Every call here keeps that order, so the
// memory (which goes by the chapters' order) reads the story as the binder shows it.
//
// The AI's replies are plain text in a fixed form (see src/main/outline/prompts.ts), read by the interface
// as they arrive (features/outline/parse.ts); what Adam keeps comes back here as KeepItems.
import type { Act, Chapter, ID } from '../types'

/**
 * Where a chapter goes: into an act, or among the chapters with no act (`actId` null). Just after
 * `afterId`, else just before `beforeId`, else at `index` among that act's other chapters, else at the
 * end of the act. Ids that aren't in that act are ignored.
 */
export interface ChapterPlace {
  actId: ID | null
  afterId?: ID | null
  beforeId?: ID | null
  index?: number
}

/** How much the outline helper suggests. */
export interface OutlineSize {
  /** New acts; 0 for none (the chapters then carry on in the story's last act, if it has acts). */
  acts: number
  /** Chapters in all. */
  chapters: number
  /** Scenes in each chapter. */
  scenes: number
}

export interface OutlineRequest {
  /** Made by the interface (any unique id), so every task event can be matched to it. */
  taskId: ID
  storyId: ID
  /** The premise as it is in the helper's box (the story's own, unless Adam changed it there). */
  premise: string
  size: OutlineSize
}

export interface SceneIdeasRequest {
  taskId: ID
  sceneId: ID
}

/** A reference to an act, chapter or scene: one that exists (`id`), or one made earlier in the same keepOutline call (`key`). */
export interface KeepRef {
  id?: ID | null
  key?: string | null
}

/**
 * One act, chapter or scene the outline helper keeps. Items are made in the order given, so a chapter
 * can go in an act made just before it (by its key). Placed just after `after`, else just before
 * `before`, else at the end of its parent.
 */
export interface KeepItem {
  /** The suggestion's own key, so the reply can say what was made from it. */
  key: string
  kind: 'act' | 'chapter' | 'scene'
  /**
   * A chapter's act (left out: among the chapters with no act, or in the story's last act when the
   * story has acts) or a scene's chapter (needed). Acts go in the story.
   */
  parent?: KeepRef
  after?: KeepRef
  before?: KeepRef
  title: string
  /** An act's purpose, a chapter's goal, or a scene's one-line summary (it goes on the scene card as its goal). */
  text: string
  /** A scene's beats. */
  beats?: string[]
}

export interface KeptItem {
  key: string
  kind: 'act' | 'chapter' | 'scene'
  id: ID
}

export interface OutlineApi {
  // ----- Acts in the binder -----
  /** A new act with no chapters (titled "Act N" unless given a title): just after the act `afterId`, else after every act. */
  createAct(storyId: ID, input?: { title?: string; afterId?: ID | null }): Promise<Act>
  updateAct(id: ID, patch: Partial<Pick<Act, 'title' | 'purpose'>>): Promise<Act>
  /** Deletes an act with its chapters and their scenes (to Recently deleted, as a chapter goes). Says what was deleted with it. */
  deleteAct(id: ID): Promise<{ chapterIds: ID[]; sceneIds: ID[] }>
  /** Undo for deleteAct: the act with the chapters and scenes deleted with it. */
  restoreAct(id: ID): Promise<void>
  /** Before an act is deleted: where the stories that start or end in it will start or end instead, in plain words. */
  actDeleteNotes(id: ID): Promise<string[]>
  /** A new chapter (titled "Chapter N" unless given a title) in an act, or among the chapters with no act. */
  createChapterAt(storyId: ID, place: ChapterPlace & { title?: string }): Promise<Chapter>
  /** Moves a chapter within its act or into another one (see ChapterPlace). */
  placeChapter(chapterId: ID, place: ChapterPlace): Promise<void>
  /**
   * A new act (titled "Act N") starting at this chapter: it takes the chapter and those after it in its
   * act (or, for a chapter with no act, those after it with none), so the story reads in the same order.
   * Says which chapters it took.
   */
  startActAt(chapterId: ID): Promise<{ act: Act; chapterIds: ID[] }>
  /** Undo for startActAt: the act's chapters go back to the end of the act before it (or to no act), and the act goes. */
  joinActBack(id: ID): Promise<void>

  // ----- The outline helper -----
  /**
   * The story has nothing planned or written yet: at most the empty "Chapter 1" and "Scene 1" it was made
   * with. The helper then plans it from the premise, and its page says so. One rule for both (src/main/outline/context.ts).
   */
  outlineBlank(storyId: ID): Promise<boolean>
  /** Asks for an outline; it streams as task events with job 'outline'. Throws (plain words) only before it starts. */
  startOutline(input: OutlineRequest): Promise<{ generationId: ID }>
  /** Adds what Adam kept to the story, with each scene's card filled; says what was made from each item. */
  keepOutline(storyId: ID, items: KeepItem[]): Promise<KeptItem[]>
  /**
   * Undo for keepOutline. What is still as it was made goes for good; anything with words in it, or with
   * something added since, goes to Recently deleted instead. Says which scenes went, so the screen can move off them.
   */
  unkeepOutline(kept: KeptItem[]): Promise<{ sceneIds: ID[] }>

  // ----- Next scene ideas -----
  /** Asks for three directions for a scene; they stream as task events with job 'ideas'. Throws (plain words) only before it starts. */
  startSceneIdeas(input: SceneIdeasRequest): Promise<{ generationId: ID }>
}

export interface OutlineEvents {
  // None: the outline helper and ideas use the task events (contracts/tasks.ts).
}
