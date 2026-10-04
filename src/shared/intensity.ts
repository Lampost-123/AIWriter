// Content intensity: how far romance, violence and language go on the page. Each scale has four steps, and
// each step is one clear sentence for the writer model, in both directions ("keep it off the page" matters as
// much as "explicit is fine"). A scale left unset leaves it to the genre. The content limits box in the style
// guide still wins: the prompt says so.

import type { ContentIntensity, IntensityLevel } from './types'

export type IntensityScale = keyof ContentIntensity

export interface IntensityStep {
  level: IntensityLevel
  label: string
  /** A few words under the control when this step is picked. */
  hint: string
  /** What the writer model is told. */
  prompt: string
}

export interface IntensityScaleInfo {
  scale: IntensityScale
  label: string
  steps: readonly [IntensityStep, IntensityStep, IntensityStep, IntensityStep]
}

export const INTENSITY: readonly IntensityScaleInfo[] = [
  {
    scale: 'romance',
    label: 'Romance',
    steps: [
      {
        level: 1,
        label: 'None',
        hint: 'No romance or sexual content.',
        prompt: 'Romance: leave out romantic and sexual content entirely; relationships stay platonic on the page.'
      },
      {
        level: 2,
        label: 'Fade to black',
        hint: 'Attraction and kisses; intimacy happens off the page.',
        prompt: 'Romance: attraction, tension and kisses are fine, but cut away before anything sexual; intimacy happens off the page.'
      },
      {
        level: 3,
        label: 'On the page',
        hint: 'Intimate scenes shown, without graphic detail.',
        prompt: 'Romance: intimate scenes can play out on the page, with emotion and sensation, but without graphic anatomical detail.'
      },
      {
        level: 4,
        label: 'Explicit',
        hint: 'Sex scenes written in full.',
        prompt: 'Romance: when adults have sex on the page, write the acts in full with blunt body words and direct talk; do not fade out, skip ahead, or hide them behind euphemism.'
      }
    ]
  },
  {
    scale: 'violence',
    label: 'Violence',
    steps: [
      {
        level: 1,
        label: 'Off-page',
        hint: 'Violence happens off the page.',
        prompt: 'Violence: keep it off the page; show only its aftermath and what it means to the characters.'
      },
      {
        level: 2,
        label: 'Restrained',
        hint: 'Shown briefly, without lingering on injury.',
        prompt: 'Violence: show fights and harm briefly and clearly, without lingering on wounds or blood.'
      },
      {
        level: 3,
        label: 'Vivid',
        hint: 'Physical and visceral, with real consequences.',
        prompt: 'Violence: make it vivid and physical, with injuries and pain described concretely and consequences that last.'
      },
      {
        level: 4,
        label: 'Graphic',
        hint: 'Brutal detail when the scene calls for it.',
        prompt: 'Violence: graphic, brutal detail is acceptable when the scene calls for it; don\'t soften it.'
      }
    ]
  },
  {
    scale: 'language',
    label: 'Language',
    steps: [
      {
        level: 1,
        label: 'Clean',
        hint: 'No swearing.',
        prompt: 'Language: no swearing or crude language at all, in dialogue or narration.'
      },
      {
        level: 2,
        label: 'Mild',
        hint: 'Occasional mild words.',
        prompt: 'Language: occasional mild swearing ("damn", "hell") is fine; nothing stronger.'
      },
      {
        level: 3,
        label: 'Strong',
        hint: 'Strong swearing where it fits.',
        prompt: 'Language: strong swearing is fine where it fits the character and the moment.'
      },
      {
        level: 4,
        label: 'Anything goes',
        hint: 'No limits on language.',
        prompt: 'Language: no limits; characters swear as freely and crudely as they would.'
      }
    ]
  }
]

const isLevel = (v: unknown): v is IntensityLevel => v === 1 || v === 2 || v === 3 || v === 4

/** Only the scales with a known step, from stored data. */
export function cleanIntensity(v: unknown): ContentIntensity {
  const out: ContentIntensity = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out
  for (const { scale } of INTENSITY) {
    const level = (v as Record<string, unknown>)[scale]
    if (isLevel(level)) out[scale] = level
  }
  return out
}

/** The step picked on a scale, or null when it is left to the genre. */
export function intensityStep(intensity: ContentIntensity, scale: IntensityScale): IntensityStep | null {
  const level = intensity[scale]
  const info = INTENSITY.find((i) => i.scale === scale)
  return info && isLevel(level) ? info.steps[level - 1] : null
}

/** One line per scale that is set, for the prompt. Empty when none is. */
export function intensityLines(intensity: ContentIntensity): string[] {
  return INTENSITY.flatMap(({ scale }) => {
    const step = intensityStep(intensity, scale)
    return step ? [step.prompt] : []
  })
}

/** True when any scale is set above its second step (where some models refuse). */
export function intensityHigh(intensity: ContentIntensity): boolean {
  return INTENSITY.some(({ scale }) => (intensity[scale] ?? 0) > 2)
}
