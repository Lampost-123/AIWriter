// A scene's draft options as Adam sets them under Generate, and the options a draft (or the
// Context tab's preview of its briefing) is actually built with. Pure, so it is unit-tested.
// The options live in the app store (see lib/store.ts), so Generate and the Context tab share them.

import type { Creativity, DraftOptions } from '@shared/types'

export interface SceneDraftOptions {
  direction: string
  /** Null: use the scene card's length (which may be Auto). 'auto': Auto for this draft, even if the card has a word count. */
  targetWords: number | 'auto' | null
  /** Null: use the default from Settings. */
  creativity: Creativity | null
}

export const BLANK_DRAFT_OPTIONS: SceneDraftOptions = { direction: '', targetWords: null, creativity: null }

/**
 * The options a draft of this scene is built with: Adam's choices, else the card's length and the
 * default creativity. `cardWords` is the card's length (cardLength: null when it is Auto); a length of
 * null in the result is Auto.
 */
export function resolveDraftOptions(
  opts: SceneDraftOptions | undefined,
  cardWords: number | null,
  defaultCreativity: Creativity,
  /** "Polish after drafting" is on (Adam's last choice, for every scene: see polishRun.ts). */
  polish = false
): DraftOptions {
  const o = opts ?? BLANK_DRAFT_OPTIONS
  return {
    direction: o.direction.trim(),
    targetWords: o.targetWords === 'auto' ? null : (o.targetWords ?? cardWords),
    creativity: o.creativity ?? defaultCreativity,
    ...(polish ? { polish: true } : {})
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

/** The length a draft of this scene will aim for (null: Auto), from the options and the card's length (cardLength). */
export const draftLength = (opts: SceneDraftOptions | undefined, cardWords: number | null): number | null =>
  opts?.targetWords === 'auto' ? null : (opts?.targetWords ?? cardWords)
