// Milestone 6: the usage page (spending by day, model and job) and the optional monthly limit (warns at 80%, asks before going over).
// Owned by the Usage and cost part (see docs/ARCHITECTURE.md, "Milestone 6"). Only this part changes this file.
//
// Every AI call is a `generations` row in its world's world.db, with its tokens and cost (the provider's own
// figure, else tokens x the model's prices, else an estimate; see draftCost in src/main/ai/drafts.ts). The
// memory keeper's calls are generation records too (jobs 'memory' and 'summary'); `memory_runs` only adds
// them up, so it is never counted again. The page adds up every world in the library (Adam's account is what
// pays), this month by default. Days and months are Adam's local ones.
//
// The limit: at 80% of it, one quiet toast a month. Once this month's spending reaches it, an AI call Adam
// starts himself is refused before anything is sent, with the code SPEND_LIMIT; the window asks ("This
// month's AI spending has reached your $20 limit." Carry on this month / Not now) and, on Carry on, tries
// the same call once more. Automatic work (the memory keeper, the checks after Mark done) waits instead,
// with a quiet note saying why, until Adam carries on, raises the limit, or the month turns.

/** The UserError code of an AI call refused because this month's spending has reached the limit. */
export const SPEND_LIMIT = 'spend-limit'

/** Which stretch of time the page shows. */
export type UsagePeriod = 'this-month' | 'last-month' | 'last-30-days' | 'all-time'

/** Every world in the library, or only the open one. */
export type UsageScope = 'library' | 'world'

export interface UsageQuery {
  period: UsagePeriod
  scope: UsageScope
}

/** Calls, tokens and dollars for some part of the spending. */
export interface UsageTotals {
  /** AI calls that reached the provider (a request turned down before anything was sent isn't one). */
  calls: number
  /** US dollars, from the calls with a known price. */
  cost: number
  promptTokens: number
  completionTokens: number
  /** Calls with no price at all (the provider didn't say, and the model's prices aren't known), so not in `cost`. */
  unpriced: number
  /** Calls whose price is AI Write's own estimate (the provider reported no tokens). */
  estimated: number
}

/** One bar of the chart: a day, or a month for "All time". */
export interface UsageBar {
  /** "2026-10-03", or "2026-10" for a month. */
  key: string
  /** "3 Oct", or "Oct 2026". */
  label: string
  /** Still to come (the rest of this month): drawn empty. */
  ahead: boolean
  cost: number
  calls: number
  tokens: number
}

/** Spending with one model. */
export interface UsageModelRow extends UsageTotals {
  modelId: string
  /** The provider's name as it was when the calls were made ("OpenRouter"). */
  provider: string
}

/** Spending on one kind of AI work, in Adam's words ("Writing", "Memory"...). */
export interface UsageJobRow extends UsageTotals {
  /** The group's key ('writing', 'memory', ... or a job recorded under another name). */
  key: string
  label: string
}

export interface UsageReport {
  period: UsagePeriod
  scope: UsageScope
  /** The days covered, inclusive ("2026-10-01" to "2026-10-31"). Null for "All time" with nothing spent. */
  from: string | null
  to: string | null
  total: UsageTotals
  /** Days ('day'), or months ('month') for "All time". */
  unit: 'day' | 'month'
  bars: UsageBar[]
  /** Most spent first. */
  models: UsageModelRow[]
  jobs: UsageJobRow[]
  /** Worlds the numbers come from, and worlds that couldn't be read (a damaged or locked file). */
  worlds: number
  unreadable: number
  /** The open world's name, for "Only this world". Null when none is open. */
  worldName: string | null
  /** Any AI call at all, in any world, at any time (false shows the empty state). */
  anyEver: boolean
}

/** Where this month's spending stands against the limit. */
export interface SpendState {
  /** This month, local time ("2026-10"). */
  month: string
  /** This month's spending across the library, US dollars. */
  spent: number
  limit: number | null
  /** 'none' with no limit; 'under'; 'near' from 80%; 'reached' at or past the limit. */
  level: 'none' | 'under' | 'near' | 'reached'
  /** Adam chose "Carry on this month" for this month and this limit. */
  carryOn: boolean
  /** The limit is reached and Adam hasn't carried on: his own AI calls ask first, automatic work waits. */
  paused: boolean
  /** A toast is due (once a month): 'near' at 80%, 'reached' when the limit is reached. */
  toast: 'near' | 'reached' | null
}

/** Calls the interface can make. */
export interface UsageApi {
  /** The spending for the page. Fast after the first time (each world is read again only when it changed). */
  getUsage(query: UsageQuery): Promise<UsageReport>
  getSpendState(): Promise<SpendState>
  /** Sets the monthly limit (null: no limit). Refuses anything but an amount above $0, in plain words. */
  setMonthlyLimit(limit: number | null): Promise<SpendState>
  /** "Carry on this month": nothing asks or waits again until the month turns or the limit changes. */
  carryOnThisMonth(): Promise<SpendState>
  /** The window showed the toast `SpendState.toast` asked for, so it isn't shown again this month. */
  spendToastShown(which: 'near' | 'reached'): Promise<SpendState>
}

/** Events from the main process. */
export interface UsageEvents {
  /** This month's spending or the limit changed (after an AI call finishes, the month turning, a new limit). */
  'usage:spend': SpendState
}

// ---------- Words both sides use ----------

/**
 * Dollars as Adam reads them: 2 decimals ("$12.40"), more for tiny sums so they don't read as nothing
 * ("$0.0042"), "$0.00" for nothing at all.
 */
export function dollars(n: number): string {
  const v = Number.isFinite(n) ? n : 0
  const sign = v < 0 ? '-' : ''
  const a = Math.abs(v)
  if (a >= 0.01 || a === 0) return `${sign}$${a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  // Two significant figures, at most 6 decimals ("$0.0042", "$0.00031").
  const digits = Math.min(6, 1 - Math.floor(Math.log10(a)))
  const s = a.toFixed(digits).replace(/0+$/, '')
  return s.endsWith('.') ? '$0.00' : `${sign}$${s}`
}

/** A limit as Adam typed it: "$20" for whole dollars, else "$12.50". */
export const limitDollars = (n: number): string => (Number.isInteger(n) ? `$${n.toLocaleString('en-US')}` : dollars(n))

/** What the ask says: "This month's AI spending has reached your $20 limit." */
export const reachedWords = (limit: number): string => `This month's AI spending has reached your ${limitDollars(limit)} limit.`
