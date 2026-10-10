// The one chapter writer run going now, if any, so other parts can leave its scenes alone: a draft, a beat or
// variants started in one of them is turned down while it works (ipc/ai.ts, beats, variants). No Electron imports.

import type { ID } from '@shared/types'
import type { ChapterRun } from './run'

let active: ChapterRun | null = null

export const activeRun = (): ChapterRun | null => active

export function setActiveRun(run: ChapterRun | null): void {
  active = run
}

/** True while the chapter writer is working on this scene. */
export const chapterWriterHolds = (sceneId: ID): boolean => !!active && active.sceneIds.includes(sceneId)

/** Said when something else would write into a scene the chapter writer is working on. */
export const HELD = 'The AI is writing this chapter. Stop it first (in the top bar), or wait for it to finish.'
