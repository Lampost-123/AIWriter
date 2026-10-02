// Drafts and history (milestone 4): scene snapshots with compare and restore, and the Drafts tab.
// Owned by the History part. See docs/ARCHITECTURE.md, "Milestone 4".
//
// Snapshots live in a file of their own in each world folder, history.db, beside world.db (whose data
// model stays frozen): every AI change and every Mark done takes one, and writing takes one every 10
// minutes. A missing, locked or damaged history.db never stops a world from opening: History starts
// afresh. Other parts take a snapshot before an AI change goes into the page with
// `snapshotBefore()` (src/renderer/src/features/history/snapshot.ts), which calls takeSnapshot.
//
// Drafts: each scene holds any number of drafts, one of them current. The current draft is the scene's
// own text in world.db (the only one the memory reads); the others are kept in history.db.
import type { ID } from '../types'

/** Why a snapshot was taken. */
export type SnapshotKind = 'ai' | 'done' | 'editing' | 'restore'

export interface SnapshotInfo {
  id: ID
  sceneId: ID
  kind: SnapshotKind
  /** Plain words for the list: "Before Rewrite", "Before a new draft", "Marked done", "While writing", "Before restoring". */
  label: string
  /** The AI call whose change came right after it, when there was one (for "What the AI saw"). */
  generationId: ID | null
  words: number
  createdAt: string
}

/** A snapshot with its text, to compare with the scene now and to restore. */
export interface Snapshot extends SnapshotInfo {
  /** The page as it was (paragraphs, formatting and paragraph ids), stored like a scene's text; null when only the text was known. */
  doc: unknown | null
  text: string
}

export interface TakeSnapshotInput {
  sceneId: ID
  /** 'ai' before an AI change goes in; 'restore' before an earlier version (or a draft) takes the scene's place. */
  kind: 'ai' | 'restore'
  label: string
  generationId?: ID | null
  /** The page as it shows now, Adam's unsaved typing included (EditorBridge.current()). */
  doc: unknown
  text: string
}

/** A scene's snapshots, newest first. */
export interface SceneHistory {
  /** False while this world's history.db can't be reached (nothing is kept meanwhile); `problem` says why. */
  available: boolean
  problem: string | null
  /** Said once History had to start afresh in this world (its history.db was damaged and was moved aside). */
  notice: string | null
  snapshots: SnapshotInfo[]
}

export interface DraftInfo {
  id: ID
  sceneId: ID
  /** "Draft 2", or the name Adam gave it. */
  name: string
  /** True for the scene's current draft: its text is the scene's own text (the one in the page). */
  current: boolean
  /** Its words (for the current draft, the scene's words as last saved). */
  words: number
  /** Its first words, to tell drafts apart (empty for the current draft, which is in the page). */
  excerpt: string
  createdAt: string
  /** When its text was last kept (when it stopped being the current draft). */
  keptAt: string
}

/** A draft with its text, to put in the page. */
export interface DraftText extends DraftInfo {
  doc: unknown | null
  text: string
}

/** A scene's drafts, in the order they were made (Draft 1 first). */
export interface SceneDrafts {
  /** False while this world's history.db can't be reached; `problem` says why. */
  available: boolean
  problem: string | null
  drafts: DraftInfo[]
}

/** The page as it shows now (EditorBridge.current()), sent with a draft change so it is kept as it is. */
export interface PageNow {
  sceneId: ID
  doc: unknown
  text: string
}

export interface HistoryApi {
  /**
   * Keeps the scene's text as it is now, before an AI change or a restore. History is a convenience, so
   * this never fails loudly and never holds the change up: with history.db out of reach it returns null.
   * The same text as the scene's latest snapshot isn't kept twice.
   */
  takeSnapshot(input: TakeSnapshotInput): Promise<SnapshotInfo | null>
  /** The scene's snapshots, newest first (no text). */
  listSnapshots(sceneId: ID): Promise<SceneHistory>
  /** One snapshot with its text. */
  getSnapshot(id: ID): Promise<Snapshot>

  /** The scene's drafts (Draft 1 first); a scene always has its current draft. */
  listDrafts(sceneId: ID): Promise<SceneDrafts>
  /**
   * Starts a new draft as a copy of the current one, which is kept as it is (`page` is that text). The
   * page doesn't change: the copy is what Adam goes on writing in.
   */
  newDraft(page: PageNow): Promise<{ drafts: SceneDrafts; created: DraftInfo; kept: DraftInfo }>
  /** Undoes newDraft: the copy goes, and the draft it was made from is the current one again (with the page as it is). */
  undoNewDraft(sceneId: ID, draftId: ID, keptId: ID): Promise<SceneDrafts>
  /**
   * Makes another draft the current one: the page as it is now (`page`) is kept as the draft it was, and
   * the chosen draft's text comes back to go in the page. A snapshot "Before switching drafts" is taken first.
   */
  switchDraft(page: PageNow, draftId: ID): Promise<{ drafts: SceneDrafts; to: DraftText; from: DraftInfo }>
  /**
   * Marks a draft current without changing any text: Ctrl+Z (or Ctrl+Y) in the page took a switch back
   * (or did it again), so the page already shows that draft's text.
   */
  setCurrentDraft(sceneId: ID, draftId: ID): Promise<SceneDrafts>
  /** Renames a draft; an empty name gives it back its number ("Draft 2"). */
  renameDraft(draftId: ID, name: string): Promise<DraftInfo>
  /** Deletes a draft that isn't the current one; its message's Undo brings it back (restoreDraft). Forgotten for good after 30 days. */
  deleteDraft(draftId: ID): Promise<void>
  /** Undoes deleteDraft (for the Undo toast). */
  restoreDraft(draftId: ID): Promise<void>
}

export interface HistoryEvents {
  /** A scene's history changed (a snapshot was taken, or its drafts changed), so a History page or Drafts tab showing it reloads. */
  'history:changed': { sceneId: ID }
}
