// Drafts and history (milestone 4): scene snapshots and drafts kept in each world folder's history.db,
// beside world.db (never in it). Owned by the History part; see src/shared/contracts/history.ts and
// docs/ARCHITECTURE.md, "Milestone 4".
//   store.ts         history.db's layout and every SQL statement for it, the keeping rules
//   open.ts          opening history.db: made when missing, set aside and started afresh when damaged
//   worldHistory.ts  one open world's history: when snapshots are taken, drafts, problems in plain words
// This file connects it to the open world, the saves and the window.

import type { ID } from '@shared/types'
import { maybeCurrentWorld, onWorldClosing, onWorldOpened } from '../world'
import { emit } from '../events'
import { isDrafting } from '../ai/drafts'
import { WorldHistory } from './worldHistory'

let history: WorldHistory | null = null

/** How often writing keeps a snapshot: 10 minutes, or AIWRITE_HISTORY_WRITING_MS (for the app tests). */
const writingEveryMs = (): number | undefined => {
  const v = Number(process.env.AIWRITE_HISTORY_WRITING_MS)
  return Number.isFinite(v) && v > 0 ? v : undefined
}

/** Called once at startup (src/main/index.ts). */
export function initHistory(): void {
  onWorldOpened((w) => {
    history?.close()
    history = new WorldHistory({
      folder: w.folder,
      worldDb: w.db,
      changed: (sceneId) => emit('history:changed', { sceneId }),
      drafting: isDrafting,
      writingEveryMs: writingEveryMs()
    })
    history.start()
  })
  onWorldClosing((w) => {
    if (history && history.worldDb === w.db) {
      history.close()
      history = null
    }
  })
}

/** The open world's history (null when no world is open). */
export const currentHistory = (): WorldHistory | null => (history && maybeCurrentWorld()?.db === history.worldDb ? history : null)

/**
 * A scene's text was just saved (src/main/ipc/core.ts): writing takes a snapshot every 10 minutes.
 * Never throws, and never slows the save down (the snapshot is taken once the save has returned).
 */
export function sceneTextSaved(sceneId: ID): void {
  try {
    currentHistory()?.textSaved(sceneId)
  } catch (e) {
    console.warn('History missed a save', e)
  }
}

/** A scene was just marked done (src/main/ipc/keeper.ts): it takes a snapshot. Never throws. */
export function sceneMarkedDone(sceneId: ID): void {
  try {
    currentHistory()?.markedDone(sceneId)
  } catch (e) {
    console.warn('History missed a scene marked done', e)
  }
}
