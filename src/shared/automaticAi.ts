// Automatic AI (the AI overhaul, 2026-10-19): one choice for how much the AI does by itself, in place of setting eight
// switches one by one. Each level is a set of those switches; the switches stay in Settings › Models for fine-tuning,
// and a mix that matches no level reads as Custom. The memory keeper isn't here: it keeps the story's memory in step
// with the words, so it always runs. Nothing changes until Adam picks a level. Pure: no Electron, no React.

import type { Settings } from './types'

export type AutomaticAiLevel = 'off' | 'light' | 'full'

/** The switches a level sets, each one an AI call (or several) the app makes without being asked. */
export const AUTOMATIC_AI_KEYS = [
  'planFirst',
  'sceneContracts',
  'continuityBrief',
  'checkNewWords',
  'checkWhenDone',
  'checkAfterDraft',
  'checkSecondOpinion',
  'chapterCritic'
] as const satisfies readonly (keyof Settings)[]

export type AutomaticAiKey = (typeof AUTOMATIC_AI_KEYS)[number]

/**
 * What each level switches on.
 * - Off: nothing but the memory. Check, Critique and planning still work whenever Adam asks.
 * - Light: what keeps drafts on track for little cost: the scene plan and its contract, a quick check of new words, and
 *   a check when a scene is marked done. Left off: the continuity brief (it can read the whole book before every
 *   draft), the check a little after each draft, and second opinions. The critic still reads in Write the whole
 *   chapter, which Adam asks for.
 * - Full: everything, as the app did before.
 */
export const AUTOMATIC_AI_LEVELS: Record<AutomaticAiLevel, Record<AutomaticAiKey, boolean>> = {
  off: {
    planFirst: false,
    sceneContracts: false,
    continuityBrief: false,
    checkNewWords: false,
    checkWhenDone: false,
    checkAfterDraft: false,
    checkSecondOpinion: false,
    chapterCritic: false
  },
  light: {
    planFirst: true,
    sceneContracts: true,
    continuityBrief: false,
    checkNewWords: true,
    checkWhenDone: true,
    checkAfterDraft: false,
    checkSecondOpinion: false,
    chapterCritic: true
  },
  full: {
    planFirst: true,
    sceneContracts: true,
    continuityBrief: true,
    checkNewWords: true,
    checkWhenDone: true,
    checkAfterDraft: true,
    checkSecondOpinion: true,
    chapterCritic: true
  }
}

/** A switch as the app reads it: settings saved before a switch existed have it on. */
function isOn(settings: Partial<Settings>, key: AutomaticAiKey): boolean {
  return settings[key] !== false
}

/** The level the switches add up to, or 'custom' when they match none. */
export function automaticAiLevel(settings: Partial<Settings>): AutomaticAiLevel | 'custom' {
  for (const level of ['off', 'light', 'full'] as const) {
    const want = AUTOMATIC_AI_LEVELS[level]
    if (AUTOMATIC_AI_KEYS.every((k) => isOn(settings, k) === want[k])) return level
  }
  return 'custom'
}

/** The settings change that picks a level. */
export function automaticAiSettings(level: AutomaticAiLevel): Pick<Settings, AutomaticAiKey> {
  return { ...AUTOMATIC_AI_LEVELS[level] }
}
