// Drafts and history (milestone 4): scene snapshots kept in each world folder's history.db, beside
// world.db (never in it). Owned by the History part; see src/shared/contracts/history.ts and
// docs/ARCHITECTURE.md, "Milestone 4".

import type { ID } from '@shared/types'

/** Called once at startup (src/main/index.ts). Groundwork stand-in: the History part fills it in. */
export function initHistory(): void {}

/**
 * A scene's text was just saved (src/main/ipc/core.ts): writing takes a snapshot every 10 minutes.
 * Must never throw or slow the save down. Groundwork stand-in.
 */
export function sceneTextSaved(_sceneId: ID): void {}

/** A scene was just marked done (src/main/ipc/keeper.ts): it takes a snapshot. Must never throw. Groundwork stand-in. */
export function sceneMarkedDone(_sceneId: ID): void {}
