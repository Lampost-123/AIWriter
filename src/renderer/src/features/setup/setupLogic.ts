// The first run's logic (milestone 6): the steps in order, the writer model it recommends, and where the first
// scene's guide is. Pure, so it is unit-tested; FirstRun.tsx and FirstSceneGuide.tsx show it.

import type { ModelInfo, SceneCard } from '@shared/types'
import { SETUP_STEPS, type SetupStep } from '@shared/contracts/setup'

// ---------- Steps ----------

/** Each step's short name, for the progress line. */
export const STEP_NAMES: Record<SetupStep, string> = {
  world: 'Your world',
  connect: 'Connect',
  model: 'Writer model',
  style: 'Style',
  builder: 'Lay it out'
}

export const stepNumber = (step: SetupStep): number => SETUP_STEPS.indexOf(step) + 1

export const nextStep = (step: SetupStep): SetupStep | null => SETUP_STEPS[SETUP_STEPS.indexOf(step) + 1] ?? null

export const previousStep = (step: SetupStep): SetupStep | null => SETUP_STEPS[SETUP_STEPS.indexOf(step) - 1] ?? null

// ---------- The writer model it recommends ----------

/**
 * Makers whose models write good prose, best first, each with why in plain words. Shown as a suggestion with a
 * "Use this" button: never chosen for Adam without his say.
 */
const WRITER_PICKS: { match: RegExp; why: string }[] = [
  { match: /^anthropic\/claude-[\w.-]*sonnet[\w.-]*$/i, why: 'Natural, careful prose that follows a scene card closely, at a fair price.' },
  { match: /^anthropic\/claude-[\w.-]*opus[\w.-]*$/i, why: 'Rich, careful prose. It costs more per word than most.' },
  { match: /^google\/gemini-[\d.]+-pro[\w.-]*$/i, why: 'Good prose and reads a great deal at once, at a fair price.' },
  { match: /^openai\/gpt-[\d.]+[\w.-]*$/i, why: 'Good, dependable prose at a fair price.' },
  { match: /^deepseek\/deepseek-[\w.-]+$/i, why: 'Good prose for very little.' }
]

/** The numbers in a model's id, to put newer versions first ("claude-sonnet-4.5" before "claude-3.7-sonnet"). */
const versionOf = (id: string): number[] => (id.match(/\d+/g) ?? []).map(Number)

function newer(a: string, b: string): number {
  const x = versionOf(a)
  const y = versionOf(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (y[i] ?? -1) - (x[i] ?? -1)
    if (d) return d
  }
  return 0
}

/**
 * The writer model to suggest from a provider's list: the newest of the first maker on WRITER_PICKS that the
 * list has, leaving out special editions (":free", ":thinking", "-preview", "-mini" and the like). Null when none fits.
 */
export function recommendWriter(models: ModelInfo[]): { model: ModelInfo; why: string } | null {
  const plain = models.filter((m) => !/[:]|-(preview|mini|nano|lite|flash|exp|beta|instruct|vision|audio)\b/i.test(m.id))
  for (const pick of WRITER_PICKS) {
    const found = plain.filter((m) => pick.match.test(m.id)).sort((a, b) => newer(a.id, b.id))
    if (found.length) return { model: found[0], why: pick.why }
  }
  return null
}

// ---------- The first scene's guide ----------

export type GuideStep = 'card' | 'generate' | 'edit' | 'done'

export const GUIDE_STEPS: GuideStep[] = ['card', 'generate', 'edit', 'done']

/** True once the scene card says something about the scene (who, where, when or what happens). */
export function cardFilled(card: SceneCard | null): boolean {
  if (!card) return false
  const words = [card.goal, card.conflict, card.outcome, card.mood, card.when, card.notes, ...card.beats]
  return words.some((w) => w.trim() !== '') || !!card.povId || !!card.locationId || card.presentIds.length > 0
}

export interface GuideFacts {
  card: boolean
  /** Words in the scene now. */
  words: number
  /** A draft is being written into it. */
  drafting: boolean
  /** Adam has changed the words himself since the draft. */
  edited: boolean
  /** The scene is marked done. */
  done: boolean
}

/** Where the guide is: the step to show, or 'finished' once the scene is marked done. */
export function guideStep(f: GuideFacts): GuideStep | 'finished' {
  if (f.done) return 'finished'
  if (f.drafting || f.words === 0) return f.card || f.drafting ? 'generate' : 'card'
  return f.edited ? 'done' : 'edit'
}
