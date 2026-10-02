// A scene's draft options as Adam sets them under Generate, and the options a draft (or the
// Context tab's preview of its briefing) is actually built with. Pure, so it is unit-tested.
// The options live in the app store (see lib/store.ts), so Generate and the Context tab share them.

import type { Creativity, DraftOptions } from '@shared/types'

export interface SceneDraftOptions {
  direction: string
  /** Null: use the scene card's target length. */
  targetWords: number | null
  /** Null: use the default from Settings. */
  creativity: Creativity | null
}

export const BLANK_DRAFT_OPTIONS: SceneDraftOptions = { direction: '', targetWords: null, creativity: null }

/** The options a draft of this scene is built with: Adam's choices, else the card's length and the default creativity. */
export function resolveDraftOptions(
  opts: SceneDraftOptions | undefined,
  cardTargetWords: number,
  defaultCreativity: Creativity
): DraftOptions {
  const o = opts ?? BLANK_DRAFT_OPTIONS
  return {
    direction: o.direction.trim(),
    targetWords: o.targetWords ?? cardTargetWords,
    creativity: o.creativity ?? defaultCreativity
  }
}

/** Applies a change to one scene's options, leaving every other scene's alone. */
export function patchDraftOptions(
  all: Record<string, SceneDraftOptions>,
  sceneId: string,
  patch: Partial<SceneDraftOptions>
): Record<string, SceneDraftOptions> {
  return { ...all, [sceneId]: { ...(all[sceneId] ?? BLANK_DRAFT_OPTIONS), ...patch } }
}
