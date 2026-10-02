// Drafts and history (milestone 4): scene snapshots with compare and restore, and the Drafts tab.
// Owned by the History part. See docs/ARCHITECTURE.md, "Milestone 4".
//
// Snapshots live in a file of their own in each world folder, history.db, beside world.db (whose data
// model stays frozen): every AI change and every Mark done takes one, and writing takes one every 10
// minutes. A missing, locked or damaged history.db never stops a world from opening: History starts
// afresh. Other parts take a snapshot before an AI change goes into the page with
// `snapshotBefore()` (src/renderer/src/features/history/snapshot.ts), which calls takeSnapshot.
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

export interface HistoryApi {
  /**
   * Keeps the scene's text as it is now, before an AI change or a restore. History is a convenience, so
   * this never fails loudly and never holds the change up: with history.db out of reach it returns null.
   * The same text as the scene's latest snapshot isn't kept twice.
   */
  takeSnapshot(input: TakeSnapshotInput): Promise<SnapshotInfo | null>
  // The History part adds the rest here (the list, one snapshot, restore, drafts...).
}

export interface HistoryEvents {
  /** A scene's history changed (a snapshot was taken), so a History page showing it reloads. */
  'history:changed': { sceneId: ID }
}
