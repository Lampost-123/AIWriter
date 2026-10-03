// Milestone 6: importing an existing manuscript (Word, Markdown, plain text), split into chapters and scenes by its headings with a preview to adjust the split, then the import catch-up that builds the memory from it.
// Owned by the Manuscript import part (see docs/ARCHITECTURE.md, "Milestone 6"). Only this part changes this file.
//
// How it goes: chooseManuscript reads the file in the main process into blocks (paragraphs, headings and
// scene breaks, with bold and italic kept). The import page proposes the split from those blocks and lets
// Adam adjust it (features/importing/split.ts); importManuscript then writes the story, its acts, chapters
// and scenes in one transaction, with editor documents shaped as the editor saves them. Imported scenes are
// left unread by the memory (not "waiting": nothing is read, and nothing costs anything, until Adam asks).
// The import catch-up (startCatchUp) has the memory keeper read them chapter by chapter in the background,
// on the memory model; it survives a restart (the world's meta key 'import_catchup') and Stop ends it.

import type { ID } from '../types'

export type ManuscriptFormat = 'docx' | 'markdown' | 'text'

/** A stretch of words with the same look. `text` may hold '\n' for a line break inside the paragraph. */
export interface ManuscriptRun {
  text: string
  bold?: boolean
  italic?: boolean
}

/**
 * One block of the file, in order:
 * - 'para': an ordinary paragraph.
 * - 'heading': a heading. `level` is its level in the file (1 the highest) when the file says so (Word heading
 *   styles and outline levels, Markdown #); null for a line recognised by its words ("Chapter 12", "Prologue")
 *   or by its Word style's name ("Chapter Title"). `hint` says what its words or style make it look like.
 * - 'break': a scene break mark ("* * *", "#", "---"); `text` is the mark.
 * - 'title': the book's title (Word's Title style). Never part of the story's text.
 */
export interface ManuscriptBlock {
  kind: 'para' | 'heading' | 'break' | 'title'
  /** The plain words ('\n' for a line break). */
  text: string
  /** Paragraphs only: the words with their bold and italic. */
  runs?: ManuscriptRun[]
  level?: number | null
  hint?: 'part' | 'chapter' | 'scene' | null
  /** A page break comes just before it (Word). Used to find chapters in a file with no headings at all. */
  pageBreak?: boolean
}

/** A file read for importing. */
export interface Manuscript {
  /** "The Ferry.docx". */
  fileName: string
  format: ManuscriptFormat
  /** The book's title: Word's Title (or the document's title), Markdown's front matter or first # heading, else the file's name. */
  title: string
  blocks: ManuscriptBlock[]
  words: number
}

// ---------- The plan Adam imports ----------

export interface ImportPlanScene {
  title: string
  /** Each paragraph as runs; an empty list is a scene break inside the scene (a line across the page). */
  paragraphs: ManuscriptRun[][]
}

export interface ImportPlanChapter {
  title: string
  /** Index into ImportPlan.acts; null for a chapter in no act (before the first act). */
  act: number | null
  scenes: ImportPlanScene[]
}

export interface ImportPlan {
  /** The story's title. */
  title: string
  /** Acts, in order, when the file has a level above chapters. Empty for none. */
  acts: { title: string }[]
  chapters: ImportPlanChapter[]
  /**
   * The world was made for this book (from the Welcome screen): its empty first story ("Book 1", with
   * nothing written) gives way to the imported one rather than staying beside it.
   */
  newWorld?: boolean
}

export interface ImportResult {
  storyId: ID
  /** The first scene, to open. */
  sceneId: ID
  acts: number
  chapters: number
  scenes: number
  words: number
}

// ---------- The import catch-up ----------

/** What building the memory from an imported story would take, before it starts. */
export interface CatchUpEstimate {
  storyId: ID
  /** Scenes and chapters the memory hasn't read yet, and their words. */
  scenes: number
  chapters: number
  words: number
  /** USD, roughly; null when the memory model's prices aren't known. */
  cost: number | null
  /** The memory model, as Settings › Models names it; null when there is none. */
  model: string | null
  /** Plain words when there is no model to read with (the fix is in Settings › Models). */
  problem: string | null
}

export interface CatchUpProgress {
  storyId: ID
  storyTitle: string
  /** The chapter being read (1 is the story's first chapter), and how many the story has. */
  chapter: number
  chapters: number
  /** Scenes with words read so far, of all the story's scenes with words. */
  read: number
  scenes: number
  /** 'paused': it couldn't go on (no model, out of credit...); `error` says why and Try again carries on. */
  status: 'starting' | 'reading' | 'stopping' | 'paused'
  error: string | null
  /** Other stories waiting their turn after this one. */
  waiting: number
}

export interface CatchUpState {
  /** The catch-up going on (or paused) in the open world; null when there is none. */
  running: CatchUpProgress | null
  /** Stories with scenes the memory hasn't read since they were imported: story id to how many. */
  unread: Record<ID, number>
  /**
   * The last catch-up to finish since the world opened (for its toast): the story, when, and how many scenes
   * couldn't be read (they show "Memory not updated", and the memory tries them again by itself).
   */
  finished: { storyId: ID; storyTitle: string; at: string; missed: number } | null
}

/** Calls the interface can make. */
export interface ImportingApi {
  /** Asks for a Word, Markdown or text file and reads it. Null when Adam cancels. Plain-words errors for files it can't read. */
  chooseManuscript(): Promise<Manuscript | null>
  /** Imports the plan into the open world as a new story, all or nothing. */
  importManuscript(plan: ImportPlan): Promise<ImportResult>
  /** The catch-up going on and which stories have unread scenes. */
  getCatchUp(): Promise<CatchUpState>
  /** Roughly what building the memory from a story's unread scenes would cost, with the memory model. */
  estimateCatchUp(storyId: ID): Promise<CatchUpEstimate>
  /** Starts (or, after a pause, carries on) building the memory from a story's unread scenes, in the background. */
  startCatchUp(storyId: ID): Promise<void>
  /** Stops the catch-up. What has been read stays in the memory; the rest stays unread, to build later. Resolves once stopped. */
  stopCatchUp(): Promise<void>
}

/** Events from the main process. */
export interface ImportingEvents {
  /** The catch-up moved on (a chapter started, a scene was read, it paused, stopped or finished). */
  'importing:catchUp': CatchUpState
}
