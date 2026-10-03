// The usage page's words (milestone 6, Usage and cost). Pure, so it is unit-tested.

import type { UsagePeriod, UsageTotals } from '@shared/contracts/usage'

export const PERIODS: { value: UsagePeriod; label: string }[] = [
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'last-30-days', label: 'Last 30 days' },
  { value: 'all-time', label: 'All time' }
]

/** "950 tokens", "12.3k tokens", "2.4M tokens". */
export function tokenWords(n: number): string {
  const v = Math.max(0, Math.round(n))
  if (v < 1000) return `${v.toLocaleString('en-US')} ${v === 1 ? 'token' : 'tokens'}`
  if (v < 1_000_000) return `${trim(v / 1000)}k tokens`
  return `${trim(v / 1_000_000)}M tokens`
}

const trim = (n: number): string => (n >= 100 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, ''))

/** "1 call", "1,204 calls". */
export const callWords = (n: number): string => `${n.toLocaleString('en-US')} ${n === 1 ? 'call' : 'calls'}`

type TokenCounts = Pick<UsageTotals, 'promptTokens' | 'completionTokens'> & { cachedTokens?: number }

/** "41.2k tokens", and "41.2k tokens, 12k from the cache" when the provider reused some of the prompts. */
export function tokensWithCache(t: TokenCounts): string {
  const all = tokenWords(t.promptTokens + t.completionTokens)
  const cached = Math.round(t.cachedTokens ?? 0)
  return cached > 0 ? `${all}, ${tokenWords(cached).replace(/ tokens?$/, '')} from the cache` : all
}

/** "37 calls · 41.2k tokens" (with the cached part, when there is one). */
export const callsAndTokens = (t: Pick<UsageTotals, 'calls'> & TokenCounts): string => `${callWords(t.calls)} · ${tokensWithCache(t)}`

/** The honest notes under the numbers: calls with no price, and prices that are estimates. */
export function costNotes(t: Pick<UsageTotals, 'unpriced' | 'estimated'>): string[] {
  const out: string[] = []
  if (t.unpriced > 0) {
    out.push(
      t.unpriced === 1
        ? '1 call had no price from the provider, so it isn’t in the totals.'
        : `${t.unpriced.toLocaleString('en-US')} calls had no price from the provider, so they aren’t in the totals.`
    )
  }
  if (t.estimated > 0) {
    out.push(
      t.estimated === 1
        ? '1 call’s cost is AI Write’s estimate: the provider didn’t say how much it read and wrote.'
        : `${t.estimated.toLocaleString('en-US')} calls’ costs are AI Write’s estimates: the provider didn’t say how much they read and wrote.`
    )
  }
  return out
}

/** How full the bar under the headline is (0 to 1). */
export const shareOf = (spent: number, limit: number | null): number => (limit && limit > 0 ? Math.min(1, Math.max(0, spent / limit)) : 0)

/** The x-axis labels to show (the first, about every week, and the last, never crowded): indexes into the bars. */
export function labelledBars(count: number): Set<number> {
  const out = new Set<number>()
  if (count <= 0) return out
  const step = count <= 12 ? 1 : count <= 24 ? 3 : 7
  for (let i = 0; i < count; i += step) out.add(i)
  // Always the last one; the one before makes room if it would sit right beside it.
  const last = count - 1
  const before = Math.max(...out)
  if (before !== last && before > 0 && last - before <= Math.ceil(step / 2)) out.delete(before)
  out.add(last)
  return out
}
