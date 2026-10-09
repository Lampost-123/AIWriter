// The New look's usage charts (UsageCharts.tsx): which colour each model gets, the scale's round numbers, and how the
// shares are split. Pure, so it is unit-tested (chartLogic.test.ts).
import type { UsageBar, UsageModelRow } from '@shared/contracts/usage'

/** The models' colours, in order of spending: the kind inks (contrast-tested in every theme), then one for the rest. */
export const MODEL_INKS = ['var(--accent)', 'var(--k-place)', 'var(--k-char)', 'var(--k-item)', 'var(--k-event)', 'var(--k-thread)']
export const OTHER_INK = 'var(--k-gloss)'

export const modelKey = (m: { modelId: string; provider: string }): string => `${m.modelId}\t${m.provider}`

/** Each model's colour: the most spent on first; beyond six, the rest share "Other" (null name). */
export function modelColours(models: Pick<UsageModelRow, 'modelId' | 'provider'>[]): Map<string, string> {
  const out = new Map<string, string>()
  models.forEach((m, i) => out.set(modelKey(m), MODEL_INKS[i] ?? OTHER_INK))
  return out
}

/** A model's name as the page shows it: the part after the maker ("claude-sonnet-4.5"), the maker under it. */
export function modelName(modelId: string): { name: string; maker: string | null } {
  const id = modelId.trim()
  if (!id) return { name: 'Unknown model', maker: null }
  const slash = id.indexOf('/')
  return slash > 0 ? { name: id.slice(slash + 1), maker: id.slice(0, slash) } : { name: id, maker: null }
}

/** Round numbers for the chart's scale: 0 and up to four steps at or above `max` (1, 2 or 5 times a power of ten). */
export function niceTicks(max: number, steps = 4): number[] {
  if (!(max > 0) || !Number.isFinite(max)) return [0]
  const rough = max / steps
  const power = 10 ** Math.floor(Math.log10(rough))
  const unit = [1, 2, 2.5, 5, 10].map((m) => m * power).find((u) => u >= rough) ?? 10 * power
  const out: number[] = []
  for (let v = 0; v < max + unit * 0.999; v += unit) out.push(Number(v.toPrecision(12)))
  return out
}

/** One bar's stacked parts, bottom up, by `measure`, in the models' colours (models off the list go to Other). */
export function stackOf(bar: UsageBar, colours: Map<string, string>, measure: 'cost' | 'tokens'): { key: string; ink: string; value: number }[] {
  const parts = bar.models ?? []
  const out: { key: string; ink: string; value: number }[] = []
  let other = 0
  for (const p of parts) {
    const v = measure === 'cost' ? p.cost : p.tokens
    if (!(v > 0)) continue
    const ink = colours.get(modelKey(p))
    if (!ink || ink === OTHER_INK) other += v
    else out.push({ key: modelKey(p), ink, value: v })
  }
  if (other > 0) out.push({ key: 'other', ink: OTHER_INK, value: other })
  // A bar from an older report (no parts): one piece in the first colour.
  if (!parts.length) {
    const v = measure === 'cost' ? bar.cost : bar.tokens
    if (v > 0) out.push({ key: 'all', ink: MODEL_INKS[0], value: v })
  }
  return out
}

/** Shares of a whole (0 to 1) for a donut, with a small floor so a tiny slice still shows; they still add up to 1. */
export function shares(values: number[], floor = 0.012): number[] {
  const total = values.reduce((a, b) => a + Math.max(0, b), 0)
  if (!(total > 0)) return values.map(() => 0)
  const raw = values.map((v) => Math.max(0, v) / total)
  const lifted = raw.map((s) => (s > 0 ? Math.max(floor, s) : 0))
  const sum = lifted.reduce((a, b) => a + b, 0)
  return lifted.map((s) => s / sum)
}

/** "12%", "<1%" for a sliver, "0%" for nothing. */
export function percentWords(share: number): string {
  if (!(share > 0)) return '0%'
  const p = share * 100
  return p < 1 ? '<1%' : `${Math.round(p)}%`
}
