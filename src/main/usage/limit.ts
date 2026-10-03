// The monthly spending limit's rules (milestone 6, Usage and cost), pure so they are unit-tested:
// - No limit (the default): nothing is said and nothing waits.
// - From 80% of the limit, one quiet toast a month.
// - Once this month's spending reaches the limit, AI calls are held: Adam's own ask first ("Carry on this
//   month" / "Not now"), automatic work waits. One more toast says so, once a month.
// - "Carry on this month" lets everything go ahead until the month turns or the limit changes.
// What has been said is kept for one month and one limit (`UsageNotice` in Settings), so a new month or a
// new limit starts afresh.

import type { UsageNotice } from '@shared/types'
import type { SpendState } from '@shared/contracts/usage'

/** The share of the limit at which the quiet warning shows. */
export const NEAR_SHARE = 0.8

/** The notice for this month and limit: the one kept when it is about them, else a fresh one. */
export function noticeFor(kept: UsageNotice | null | undefined, month: string, limit: number): UsageNotice {
  return kept && kept.month === month && kept.limit === limit ? { ...kept } : { month, limit, warned: false, reached: false, carryOn: false }
}

/** Where this month's spending stands, from what was spent, the limit and what has been said. */
export function spendStateOf(spent: number, limit: number | null, kept: UsageNotice | null | undefined, month: string): SpendState {
  if (limit == null || !(limit > 0)) {
    return { month, spent, limit: null, level: 'none', carryOn: false, paused: false, toast: null }
  }
  const notice = noticeFor(kept, month, limit)
  // A hair under the limit (sums of many small costs) counts as reaching it.
  const level: SpendState['level'] = spent >= limit - 1e-9 ? 'reached' : spent >= limit * NEAR_SHARE ? 'near' : 'under'
  const paused = level === 'reached' && !notice.carryOn
  const toast =
    level === 'reached' && !notice.reached && !notice.carryOn ? 'reached' : level === 'near' && !notice.warned && !notice.reached ? 'near' : null
  return { month, spent, limit, level, carryOn: notice.carryOn, paused, toast }
}

/** The notice after Adam chose "Carry on this month". */
export const carriedOn = (kept: UsageNotice | null | undefined, month: string, limit: number): UsageNotice => ({
  ...noticeFor(kept, month, limit),
  carryOn: true
})

/** The notice after a toast showed: reaching the limit counts as the 80% warning too. */
export function toastShown(kept: UsageNotice | null | undefined, month: string, limit: number, which: 'near' | 'reached'): UsageNotice {
  const n = noticeFor(kept, month, limit)
  return which === 'reached' ? { ...n, warned: true, reached: true } : { ...n, warned: true }
}

/**
 * A limit as Adam typed it, or why it can't be one. Null means no limit. Dollars and cents only; anything
 * else is refused in plain words.
 */
export function cleanLimit(v: unknown): { ok: true; limit: number | null } | { ok: false; error: string } {
  if (v === null || v === undefined || v === '') return { ok: true, limit: null }
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[$,\s]/g, '')) : NaN
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: 'Enter an amount in dollars above $0, or leave it empty for no limit.' }
  if (n > 1_000_000) return { ok: false, error: 'That limit is more than a million dollars. Enter a smaller amount, or leave it empty for no limit.' }
  const cents = Math.round(n * 100) / 100
  if (cents <= 0) return { ok: false, error: 'Enter an amount in dollars above $0, or leave it empty for no limit.' }
  return { ok: true, limit: cents }
}

/** Milliseconds from `now` to the start of next month (local time), at least a second. */
export function msToNextMonth(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return Math.max(1000, next.getTime() - now.getTime())
}
