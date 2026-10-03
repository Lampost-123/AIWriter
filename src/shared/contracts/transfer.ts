// Milestone 6: a whole world as one .aiwrite file (export, import, make a copy), exporting a story, chapter or selection (Word, EPUB, PDF, Markdown, plain text) and the series bible (PDF, Markdown).
// Owned by the World files and export part (see docs/ARCHITECTURE.md, "Milestone 6"). Only this part changes this file.
//
// The work is done in src/main/transfer/; src/main/ipc/transfer.ts connects it to the save and open
// dialogs. Every call that writes a file asks where with the system's own dialog first and returns null
// when Adam cancels it. Long calls report how they are getting on with 'transfer:progress', matched by
// the `jobId` the interface makes.

import type { ID, WorldSummary } from '../types'

/** Calls the interface can make. */
export interface TransferApi {
  /**
   * Exports a story, one chapter of it, or some of its chapters and scenes, to a file Adam picks.
   * Chapters and scenes in Recently deleted are never exported. Null when the save dialog is cancelled.
   */
  exportStory(input: ExportStoryInput): Promise<Exported | null>
  /** Exports the series bible (codex, timeline, plot threads) as of a story's end. Null when cancelled. */
  exportBible(input: ExportBibleInput): Promise<Exported | null>
  /**
   * Saves a whole world (the open one, or any in the library) as one .aiwrite file: its world.db, its
   * history.db and its images, never its backups or any API key. Null when cancelled.
   */
  exportWorldFile(input: ExportWorldInput): Promise<Exported | null>
  /**
   * Asks for a .aiwrite file and unpacks it into a new folder in the library, as a world of its own (a new
   * id, so it never collides with the one it came from). The interface then opens it. Null when cancelled.
   * Refuses, in plain words, a damaged file, one that isn't an AI Write world, or one from a newer AI Write.
   */
  importWorldFile(input: { jobId: ID }): Promise<WorldSummary | null>
  /** Makes a copy of a world in the library, named "<name> (copy)", with its history and images. Doesn't open it. */
  copyWorld(input: { jobId: ID; worldId: ID }): Promise<WorldSummary>
  /** Shows an exported file in the system's file browser, selected. */
  showExported(path: string): Promise<void>
}

/** Events from the main process. */
export interface TransferEvents {
  'transfer:progress': TransferProgress
}

export type ManuscriptFormat = 'docx' | 'epub' | 'pdf' | 'markdown' | 'text'
export type BibleFormat = 'pdf' | 'markdown'

/** What of the story goes out. A selection keeps the story's order and its chapter headings. */
export type ManuscriptScope =
  | { kind: 'story' }
  | { kind: 'chapter'; chapterId: ID }
  /** These scenes (any order); each chapter holding one of them gets its heading. */
  | { kind: 'selection'; sceneIds: ID[] }

export interface ExportStoryInput {
  /** Made by the interface, so 'transfer:progress' can be matched to it. */
  jobId: ID
  storyId: ID
  scope: ManuscriptScope
  format: ManuscriptFormat
}

export interface ExportBibleInput {
  jobId: ID
  /** Entries, the timeline and the plot threads are as of this story's end. */
  storyId: ID
  format: BibleFormat
}

export interface ExportWorldInput {
  jobId: ID
  /** Null for the open world. */
  worldId: ID | null
}

export interface Exported {
  /** Where the file was saved. */
  path: string
  /** Its name, for the toast: "Exported ‘The Ferry.docx’". */
  fileName: string
  /** Something Adam should know, in plain words (a world whose history couldn't be read and was left out); null when all went in. */
  note: string | null
}

export interface TransferProgress {
  jobId: ID
  /** Plain words: "Copying the world", "Packing the file". */
  step: string
  /** 0 to 1, or null when how far along isn't known. */
  fraction: number | null
}
