// The usage page's numbers (milestone 6, Usage and cost), made from the worlds' tallies (aggregate.ts): the
// total, a bar for each day (each month for "All time"), and the spending by model and by job, in Adam's
// words. Pure, so it is unit-tested.

import type { UsageBar, UsageJobRow, UsageModelRow, UsagePeriod, UsageReport, UsageScope, UsageTotals } from '@shared/contracts/usage'
import { addUp, emptyBucket, splitKey, type Bucket, type WorldTally } from './aggregate'

/** Each recorded job's group on the page, in Adam's words. Jobs recorded under another name show as they are. */
export const JOB_GROUPS: Record<string, { key: string; label: string }> = {
  draft: { key: 'writing', label: 'Writing' },
  beat: { key: 'writing', label: 'Writing' },
  edit: { key: 'edits', label: 'Rewrites and edits' },
  memory: { key: 'memory', label: 'Memory' },
  summary: { key: 'memory', label: 'Memory' },
  chat: { key: 'chat', label: 'Chat and brainstorm' },
  outline: { key: 'chat', label: 'Chat and brainstorm' },
  ideas: { key: 'chat', label: 'Chat and brainstorm' },
  builder: { key: 'builder', label: 'Character builder' },
  world: { key: 'world', label: 'World builder' },
  speech: { key: 'speech', label: 'Read aloud' },
  check: { key: 'check', label: 'Consistency checks' },
  story: { key: 'story', label: 'Story flows' }
}

export function jobGroup(job: string): { key: string; label: string } {
  const known = JOB_GROUPS[job]
  if (known) return known
  const words = job.replace(/[-_]+/g, ' ').trim()
  return { key: job, label: words ? words[0].toUpperCase() + words.slice(1) : 'Other' }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n: number): string => String(n).padStart(2, '0')
/** "2026-10-03" for a local date. */
export const dayKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
/** "2026-10" for a local date. */
export const monthOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`

const dayLabel = (key: string): string => `${Number(key.slice(8, 10))} ${MONTHS[Number(key.slice(5, 7)) - 1] ?? ''}`
const monthLabel = (key: string): string => `${MONTHS[Number(key.slice(5, 7)) - 1] ?? ''} ${key.slice(0, 4)}`

/** The local days from `from` to `to`, inclusive. */
function daysBetween(from: Date, to: Date): string[] {
  const out: string[] = []
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const end = dayKey(to)
  for (let i = 0; i < 400; i++) {
    const k = dayKey(d)
    out.push(k)
    if (k >= end) break
    d.setDate(d.getDate() + 1)
  }
  return out
}

/** The first and last day a period covers (local), seen from `today`. Null for "All time" (it depends on the data). */
export function periodDays(period: UsagePeriod, today: Date): { from: string; to: string; days: string[] } | null {
  const y = today.getFullYear()
  const m = today.getMonth()
  let from: Date
  let to: Date
  switch (period) {
    case 'this-month':
      from = new Date(y, m, 1)
      to = new Date(y, m + 1, 0)
      break
    case 'last-month':
      from = new Date(y, m - 1, 1)
      to = new Date(y, m, 0)
      break
    case 'last-30-days':
      from = new Date(y, m, today.getDate() - 29)
      to = new Date(y, m, today.getDate())
      break
    default:
      return null
  }
  const days = daysBetween(from, to)
  return { from: days[0], to: days[days.length - 1], days }
}

/** The months from `first` ("2026-03") to `last`, inclusive. */
function monthsBetween(first: string, last: string): string[] {
  const out: string[] = []
  let y = Number(first.slice(0, 4))
  let m = Number(first.slice(5, 7))
  for (let i = 0; i < 1200; i++) {
    const k = `${y}-${pad(m)}`
    out.push(k)
    if (k >= last) break
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return out
}

const totalsOf = (b: Bucket): UsageTotals => ({ ...b, cachedTokens: b.cachedTokens ?? 0 })
const byCost = <T extends UsageTotals>(a: T, b: T): number => b.cost - a.cost || b.calls - a.calls

export interface ReportInput {
  period: UsagePeriod
  scope: UsageScope
  /** The tallies counted (every world's, or only the open world's for scope 'world'). */
  tallies: WorldTally[]
  /** Every world's tallies, to say whether there has ever been an AI call at all. */
  everyTally: WorldTally[]
  today: Date
  worldName: string | null
  unreadable: number
}

export function buildReport(i: ReportInput): UsageReport {
  const range = periodDays(i.period, i.today)
  const inRange = (day: string): boolean => (range ? day >= range.from && day <= range.to : true)
  const days = new Map<string, Bucket[]>()
  const models = new Map<string, { modelId: string; provider: string; parts: Bucket[] }>()
  const jobs = new Map<string, { label: string; parts: Bucket[] }>()
  const all: Bucket[] = []
  for (const t of i.tallies) {
    for (const [key, b] of Object.entries(t.buckets)) {
      const k = splitKey(key)
      if (!inRange(k.day)) continue
      all.push(b)
      const unit = range ? k.day : k.day.slice(0, 7)
      const day = days.get(unit)
      if (day) day.push(b)
      else days.set(unit, [b])
      const mk = `${k.model}\t${k.provider}`
      const mm = models.get(mk) ?? { modelId: k.model, provider: k.provider, parts: [] }
      mm.parts.push(b)
      models.set(mk, mm)
      const g = jobGroup(k.job)
      const jj = jobs.get(g.key) ?? { label: g.label, parts: [] }
      jj.parts.push(b)
      jobs.set(g.key, jj)
    }
  }

  const today = dayKey(i.today)
  const bar = (key: string, label: string, ahead: boolean): UsageBar => {
    const s = addUp(days.get(key) ?? [])
    return { key, label, ahead, cost: s.cost, calls: s.calls, tokens: s.promptTokens + s.completionTokens }
  }
  let bars: UsageBar[]
  let from: string | null = range?.from ?? null
  let to: string | null = range?.to ?? null
  if (range) bars = range.days.map((d) => bar(d, dayLabel(d), d > today))
  else {
    const spent = [...days.keys()].sort()
    if (spent.length) {
      const months = monthsBetween(spent[0], monthOf(i.today) > spent[spent.length - 1] ? monthOf(i.today) : spent[spent.length - 1])
      bars = months.map((m) => bar(m, monthLabel(m), false))
      from = `${months[0]}-01`
      to = today
    } else bars = []
  }

  return {
    period: i.period,
    scope: i.scope,
    from,
    to,
    total: totalsOf(all.length ? addUp(all) : emptyBucket()),
    unit: range ? 'day' : 'month',
    bars,
    models: [...models.values()]
      .map((m): UsageModelRow => ({ modelId: m.modelId, provider: m.provider, ...totalsOf(addUp(m.parts)) }))
      .sort(byCost),
    jobs: [...jobs.entries()].map(([key, j]): UsageJobRow => ({ key, label: j.label, ...totalsOf(addUp(j.parts)) })).sort(byCost),
    worlds: i.tallies.length,
    unreadable: i.unreadable,
    worldName: i.worldName,
    anyEver: i.everyTally.some((t) => Object.values(t.buckets).some((b) => b.calls > 0))
  }
}
