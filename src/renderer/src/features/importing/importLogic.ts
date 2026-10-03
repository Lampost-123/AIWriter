// Words the import page and the binder's line say about the import catch-up. Pure, so it is unit-tested.
// Owned by the Manuscript import part.

import type { CatchUpEstimate, CatchUpProgress } from '@shared/contracts/importing'

/** "About $1.40", "Less than a cent", or null when the price isn't known. */
export function dollars(cost: number | null): string | null {
  if (cost == null || !Number.isFinite(cost)) return null
  if (cost < 0.01) return 'Less than a cent'
  if (cost < 10) return `About $${cost.toFixed(2)}`
  return `About $${Math.round(cost).toLocaleString('en-US')}`
}

/** "About $1.40 with Claude Haiku, for 96 scenes in 24 chapters." */
export function costWords(e: CatchUpEstimate): string {
  const n = (k: number, one: string, many: string): string => `${k.toLocaleString('en-US')} ${k === 1 ? one : many}`
  const what = `${n(e.scenes, 'scene', 'scenes')} in ${n(e.chapters, 'chapter', 'chapters')}`
  const price = dollars(e.cost)
  if (!price) return `The cost isn’t known for ${e.model ?? 'this model'}. It reads ${what}.`
  return `${price}${e.model ? ` with ${e.model}` : ''}, for ${what}.`
}

/** "Reading chapter 3 of 24", or what it is doing instead. */
export function catchUpWords(run: CatchUpProgress): string {
  if (run.status === 'stopping') return 'Stopping…'
  if (run.status === 'starting') return 'Getting ready to read…'
  if (run.status === 'paused') return 'Building the memory has paused'
  return `Reading chapter ${run.chapter} of ${run.chapters}`
}
