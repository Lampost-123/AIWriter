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
  /** For one draft only, never kept: a Fresh take (DraftOptions.fresh). */
  fresh?: boolean
  /** For one draft only, never kept: Add below carries on from the scene's words (DraftOptions.addBelow). */
  addBelow?: boolean
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
    ...(polish ? { polish: true } : {}),
    ...(o.fresh ? { fresh: true } : {}),
    ...(o.addBelow ? { addBelow: true } : {})
  }
}

/**
 * The direction a draft is written with (2026-10-19, the stale direction): the desk's steer box when it has words. With
 * the box empty, Add below has no direction, unless Adam asked for it from the Draft options, where their Direction is in
 * front of him: Add below says its direction last, as "what happens now", so a direction kept from an earlier whole draft
 * had it write that draft's events again. A whole draft, and anything with no steer box (`steer` left out), takes the
 * Draft options' direction, as before.
 */
export function draftDirection(o: { saved: string; steer?: string; addBelow: boolean; fromOptions: boolean }): string {
  const steer = (o.steer ?? '').trim()
  if (steer) return steer
  if (o.steer !== undefined && o.addBelow && !o.fromOptions) return ''
  return o.saved
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
