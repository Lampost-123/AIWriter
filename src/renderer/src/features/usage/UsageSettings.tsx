// Settings › Usage and cost (milestone 6): what the AI has cost, across every world in the library.
// - The headline: this month's spending and, with a limit, a slim bar of how much of it is used.
// - The monthly limit: one optional field (empty: no limit, no warnings), saved when Adam leaves it or presses
//   Enter; while it holds AI calls, a note says so with "Carry on this month".
// - Spending by day (a bar chart), by model and by job in plain words, tokens alongside, for this month, last
//   month, the last 30 days or all time, across every world or only the open one; and an honest note for
//   calls with no price.
// The page waits for its numbers before showing (a slow load gets its placeholder after 200 ms), and keeps
// showing the last numbers while new ones load, so nothing flashes or jumps.
import { ChartColumn, Coins } from '@/components/ui/icons'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  dollars,
  limitDollars,
  type UsagePeriod,
  type UsageReport,
  type UsageScope,
  type UsageTotals
} from '@shared/contracts/usage'
import { Button, Card, EmptyState, Field, Input, Notice, SettingsSection, Spinner, toast } from '@/components/ui'
import { api, onEvent } from '@/lib/api'
import { cn } from '@/lib/cn'
import { plainReason } from '@/lib/reason'
import { useApp } from '@/lib/store'
import { Segmented } from '@/features/generate/parts'
import { SpendChart } from './SpendChart'
import { useNewLook } from '@/features/look/look'
import { ModelSplit, RowBars, SpendBars, jobRows, worldRows, type Measure } from './UsageCharts'
import { modelColours, modelKey, modelName } from './chartLogic'
import './usage.css'
import { carryOn, setSpend, useSpend } from './spendStore'
import { PERIODS, callWords, callsAndTokens, costNotes, shareOf, tokenWords, tokensWithCache } from './usageWords'

/** True once `on` has stayed true for `ms`, so quick loads never flash a placeholder. */
function useDelayed(on: boolean, ms = 200): boolean {
  const [late, setLate] = useState(false)
  useEffect(() => {
    if (!on) {
      setLate(false)
      return
    }
    const t = setTimeout(() => setLate(true), ms)
    return () => clearTimeout(t)
  }, [on, ms])
  return late
}

export function UsageSettings(): React.JSX.Element {
  const worldOpen = useApp((s) => !!s.world)
  const [period, setPeriod] = useState<UsagePeriod>('this-month')
  const [scope, setScope] = useState<UsageScope>('library')
  const [month, setMonth] = useState<UsageReport | null>(null)
  const [report, setReport] = useState<UsageReport | null>(null)
  const [loading, setLoading] = useState(false)
  const spend = useSpend((s) => s.state)
  const ask = useRef(0)
  const isNew = useNewLook()
  // The New look: the charts in dollars or in tokens.
  const [measure, setMeasure] = useState<Measure>('cost')

  const load = useCallback(async (): Promise<void> => {
    const mine = ++ask.current
    setLoading(true)
    try {
      const wantScope = worldOpen ? scope : 'library'
      const headline = api.getUsage({ period: 'this-month', scope: 'library' })
      const chosen = period === 'this-month' && wantScope === 'library' ? headline : api.getUsage({ period, scope: wantScope })
      const [h, c, s] = await Promise.all([headline, chosen, api.getSpendState()])
      if (mine !== ask.current) return
      setMonth(h)
      setReport(c)
      setSpend(s)
    } catch (e) {
      if (mine === ask.current) toast(plainReason(e), { tone: 'danger' })
    } finally {
      if (mine === ask.current) setLoading(false)
    }
  }, [period, scope, worldOpen])

  useEffect(() => {
    void load()
  }, [load])

  // An AI call finishing elsewhere (the memory reading a scene) shows here a moment later.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const off = onEvent('usage:spend', () => {
      clearTimeout(t)
      t = setTimeout(() => void load(), 400)
    })
    return () => {
      off()
      clearTimeout(t)
    }
  }, [load])

  const ready = !!month && !!report
  const late = useDelayed(!ready)
  if (!ready) {
    return (
      <div className="flex h-40 items-center justify-center" aria-busy>
        {late ? <Spinner size={18} /> : null}
      </div>
    )
  }

  const limit = spend?.limit ?? null
  if (isNew) {
    return (
      <NewUsage
        month={month}
        report={report}
        limit={limit}
        loading={loading}
        worldOpen={worldOpen}
        period={period}
        setPeriod={setPeriod}
        scope={scope}
        setScope={setScope}
        measure={measure}
        setMeasure={setMeasure}
      />
    )
  }
  return (
    <div className="flex flex-col gap-9 animate-fade-in">
      <Headline month={month} limit={limit} />
      <LimitSection />
      {month.anyEver || report.anyEver ? (
        <SettingsSection
          title="Spending"
          description={
            scope === 'world' && worldOpen && report.worldName
              ? `Only ${report.worldName}.`
              : `Every world in your library${report.worlds > 1 ? ` (${report.worlds} worlds)` : ''}.`
          }
          actions={loading ? <Spinner size={14} /> : null}
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Segmented label="Which stretch of time" value={period} onChange={setPeriod} options={PERIODS} className="shrink-0 whitespace-nowrap" />
            {worldOpen ? (
              <Segmented
                className="shrink-0 whitespace-nowrap"
                label="Which worlds"
                value={scope}
                onChange={setScope}
                options={[
                  { value: 'library', label: 'All worlds' },
                  { value: 'world', label: 'This world' }
                ]}
              />
            ) : null}
          </div>
          <Card className="p-4">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <div className="text-[22px] font-semibold tabular-nums text-fg">{dollars(report.total.cost)}</div>
              <div className="text-[12.5px] tabular-nums text-muted">{callsAndTokens(report.total)}</div>
            </div>
            {report.bars.length ? (
              // A stretch with no AI use keeps the chart's room (nothing jumps between stretches) and says so.
              <div className="relative">
                <SpendChart bars={report.bars} unit={report.unit} />
                {report.total.calls === 0 ? (
                  <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[13px] text-muted">
                    No AI use in this stretch of time.
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="py-6 text-center text-[13px] text-muted">No AI use in this stretch of time.</p>
            )}
          </Card>
          {report.total.calls > 0 ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Breakdown
                title="By model"
                rows={report.models.map((m) => ({ key: `${m.modelId}\t${m.provider}`, name: m.modelId || 'Unknown model', sub: m.provider, t: m }))}
              />
              <Breakdown title="By job" rows={report.jobs.map((j) => ({ key: j.key, name: j.label, sub: null, t: j }))} />
            </div>
          ) : null}
          <Notes report={report} />
        </SettingsSection>
      ) : (
        <Card>
          <EmptyState icon={<ChartColumn size={20} />} title="No AI use yet">
            Once you generate a draft, or the memory reads a scene, what each AI call cost shows here, day by day, by
            model and by job.
          </EmptyState>
        </Card>
      )}
    </div>
  )
}

function Headline({ month, limit }: { month: UsageReport; limit: number | null }): React.JSX.Element {
  const spent = month.total.cost
  const share = shareOf(spent, limit)
  return (
    <Card className="p-5">
      <div className="text-[12px] font-medium uppercase tracking-wide text-faint">This month</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <span className="text-[30px] font-semibold leading-tight tabular-nums text-fg">{dollars(spent)}</span>
        {limit != null ? <span className="text-[14px] text-muted">of your {limitDollars(limit)} limit</span> : null}
      </div>
      <div className="mt-1 text-[12.5px] tabular-nums text-muted">
        {month.total.calls ? callsAndTokens(month.total) : 'No AI use yet this month.'}
        {month.worlds > 1 ? ` · across ${month.worlds} worlds` : ''}
      </div>
      {limit != null ? (
        <div
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3"
          role="progressbar"
          aria-label="This month's spending against your limit"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(share * 100)}
        >
          <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${share * 100}%` }} />
        </div>
      ) : null}
    </Card>
  )
}

function LimitSection(): React.JSX.Element {
  const spend = useSpend((s) => s.state)
  const limit = spend?.limit ?? null
  const [text, setText] = useState(limit == null ? '' : String(limit))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [carrying, setCarrying] = useState(false)
  const focused = useRef(false)

  // The field follows the saved limit (changed elsewhere, or tidied when saved) while Adam isn't typing in it.
  useEffect(() => {
    if (!focused.current) setText(limit == null ? '' : String(limit))
  }, [limit])

  const save = async (): Promise<void> => {
    const cleaned = text.replace(/[$,\s]/g, '')
    const value = cleaned === '' ? null : Number(cleaned)
    if (value === limit) {
      setError(null)
      return
    }
    setSaving(true)
    try {
      const s = await api.setMonthlyLimit(value)
      setSpend(s)
      setError(null)
      setText(s.limit == null ? '' : String(s.limit))
    } catch (e) {
      setError(plainReason(e))
    } finally {
      setSaving(false)
    }
  }

  const carry = async (): Promise<void> => {
    setCarrying(true)
    try {
      await carryOn()
    } catch (e) {
      toast(plainReason(e), { tone: 'danger' })
    } finally {
      setCarrying(false)
    }
  }

  return (
    <SettingsSection
      title="Monthly limit"
      description="An amount you'd rather not go past in a month, across every world. Leave it empty for no limit."
    >
      <Field
        label="Limit in US dollars"
        error={error}
        hint={
          limit == null
            ? 'No limit set; warnings off.'
            : 'A quiet note at 80%. Once it is reached, AI Write asks before starting anything you ask for, and memory updates wait until you say carry on.'
        }
        className="max-w-[420px]"
      >
        {(id) => (
          <div className="relative w-[160px]">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13.5px] text-faint" aria-hidden>
              $
            </span>
            <Input
              id={id}
              inputMode="decimal"
              placeholder="No limit"
              value={text}
              className={cn('pl-6 tabular-nums', saving && 'opacity-70')}
              onFocus={() => (focused.current = true)}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => {
                focused.current = false
                void save()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void save()
                }
              }}
            />
          </div>
        )}
      </Field>
      {spend?.paused && spend.limit != null ? (
        <div className="mt-3">
          <Notice
            action={
              <Button size="sm" variant="primary" loading={carrying} onClick={() => void carry()}>
                Carry on this month
              </Button>
            }
          >
            This month’s spending has reached your {limitDollars(spend.limit)} limit. AI Write asks before starting anything you
            ask for, and memory updates and the checks after Mark done are waiting.
          </Notice>
        </div>
      ) : spend?.carryOn && spend.limit != null ? (
        <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-muted">
          <Coins size={14} className="shrink-0 text-faint" aria-hidden />
          You chose to carry on past the limit this month. It applies again next month, or as soon as you change it.
        </p>
      ) : null}
    </SettingsSection>
  )
}

interface BreakdownRow {
  key: string
  name: string
  sub: string | null
  t: UsageTotals
}

function Breakdown({ title, rows }: { title: string; rows: BreakdownRow[] }): React.JSX.Element {
  const most = Math.max(0, ...rows.map((r) => r.t.cost))
  return (
    <Card className="p-4">
      <h3 className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-faint">{title}</h3>
      <ul className="flex flex-col">
        {rows.map((r) => (
          <li key={r.key} className="border-t border-line py-2 first:border-t-0 first:pt-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-[13px] font-medium text-fg" title={r.name}>
                {r.name}
              </span>
              <span className="shrink-0 text-[13px] tabular-nums text-fg">{dollars(r.t.cost)}</span>
            </div>
            <div className="mt-0.5 flex items-baseline justify-between gap-3 text-[11.5px] tabular-nums text-muted">
              <span className="min-w-0 truncate">{r.sub ? `${r.sub} · ${r.t.calls.toLocaleString('en-US')} ${r.t.calls === 1 ? 'call' : 'calls'}` : `${r.t.calls.toLocaleString('en-US')} ${r.t.calls === 1 ? 'call' : 'calls'}`}</span>
              <span className="shrink-0">{tokensWithCache(r.t)}</span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <div className="h-full rounded-full bg-accent/70" style={{ width: `${most > 0 ? (r.t.cost / most) * 100 : 0}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function Notes({ report }: { report: UsageReport }): React.JSX.Element | null {
  const notes = costNotes(report.total)
  if (report.unreadable > 0) {
    notes.push(
      report.unreadable === 1
        ? "1 world in your library couldn't be read, so it isn't counted."
        : `${report.unreadable} worlds in your library couldn't be read, so they aren't counted.`
    )
  }
  if (!notes.length) return null
  return (
    <div className="mt-3 flex flex-col gap-1 text-[12.5px] leading-relaxed text-muted">
      {notes.map((n) => (
        <p key={n}>{n}</p>
      ))}
    </div>
  )
}

// ---------- The New look ----------

const MEASURES: { value: Measure; label: string }[] = [
  { value: 'cost', label: 'Dollars' },
  { value: 'tokens', label: 'Tokens' }
]

/**
 * The New look: the month at a glance in four tiles, the limit, then the spending as charts: a bar a day stacked by
 * model (in dollars or tokens), the split by model as a ring, and the spending by world and by kind of work.
 */
function NewUsage(p: {
  month: UsageReport
  report: UsageReport
  limit: number | null
  loading: boolean
  worldOpen: boolean
  period: UsagePeriod
  setPeriod: (v: UsagePeriod) => void
  scope: UsageScope
  setScope: (v: UsageScope) => void
  measure: Measure
  setMeasure: (v: Measure) => void
}): React.JSX.Element {
  const { month, report, limit } = p
  const any = month.anyEver || report.anyEver
  const colours = modelColours(report.models)
  const worlds = report.byWorld ?? []
  return (
    <div className="@container flex flex-col gap-7 animate-fade-in">
      <Tiles month={month} limit={limit} />
      <LimitSection />
      {any ? (
        <SettingsSection
          title="Spending"
          description={
            p.scope === 'world' && p.worldOpen && report.worldName
              ? `Only ${report.worldName}.`
              : `Every world in your library${report.worlds > 1 ? ` (${report.worlds} worlds)` : ''}.`
          }
          actions={p.loading ? <Spinner size={14} /> : null}
        >
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Segmented label="Which stretch of time" value={p.period} onChange={p.setPeriod} options={PERIODS} className="shrink-0 whitespace-nowrap" />
            {p.worldOpen ? (
              <Segmented
                className="shrink-0 whitespace-nowrap"
                label="Which worlds"
                value={p.scope}
                onChange={p.setScope}
                options={[
                  { value: 'library', label: 'All worlds' },
                  { value: 'world', label: 'This world' }
                ]}
              />
            ) : null}
            <span className="flex-1" />
            <Segmented label="Show the charts in" value={p.measure} onChange={p.setMeasure} options={MEASURES} className="shrink-0 whitespace-nowrap" />
          </div>
          <div className="uc-card p-5">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
              <div>
                <p className="st-caps">{report.unit === 'day' ? 'By day' : 'By month'}</p>
                <div className="mt-0.5 text-[26px] font-semibold leading-tight tabular-nums text-fg">
                  {p.measure === 'cost' ? dollars(report.total.cost) : tokenWords(report.total.promptTokens + report.total.completionTokens)}
                </div>
                <div className="mt-0.5 text-[12.5px] tabular-nums text-muted">
                  {p.measure === 'cost' ? callsAndTokens(report.total) : `${dollars(report.total.cost)} · ${callWords(report.total.calls)}`}
                </div>
              </div>
              {report.models.length ? (
                <ul aria-label="Colours" className="flex max-w-[560px] flex-wrap justify-end gap-x-4 gap-y-1.5">
                  {report.models.slice(0, 7).map((m) => (
                    <li key={modelKey(m)} className="flex items-center gap-1.5 text-[12px] text-muted">
                      <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: colours.get(modelKey(m)) }} />
                      {modelName(m.modelId).name}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {report.bars.length ? (
              <div className="relative">
                <SpendBars bars={report.bars} unit={report.unit} models={report.models} measure={p.measure} />
                {report.total.calls === 0 ? (
                  <p className="pointer-events-none absolute inset-x-0 top-[40%] text-center text-[13px] text-muted">No AI use in this stretch of time.</p>
                ) : null}
              </div>
            ) : (
              <p className="py-6 text-center text-[13px] text-muted">No AI use in this stretch of time.</p>
            )}
          </div>
          {report.total.calls > 0 ? (
            <div className="mt-4 grid gap-4 @[880px]:grid-cols-2">
              <div className="uc-card @container p-5 @[880px]:row-span-2">
                <h3 className="uc-h3">By model</h3>
                <ModelSplit models={report.models} measure={p.measure} />
              </div>
              {worlds.length ? (
                <div className="uc-card p-5">
                  <h3 className="uc-h3">By world</h3>
                  <RowBars label="By world" rows={worldRows(worlds)} tone="place" />
                </div>
              ) : null}
              <div className="uc-card p-5">
                <h3 className="uc-h3">By job</h3>
                <RowBars label="By job" rows={jobRows(report.jobs)} />
              </div>
            </div>
          ) : null}
          <Notes report={report} />
        </SettingsSection>
      ) : (
        <div className="uc-card">
          <EmptyState icon={<ChartColumn size={20} />} title="No AI use yet">
            Once you generate a draft, or the memory reads a scene, what each AI call cost shows here, day by day, by model, by world
            and by job.
          </EmptyState>
        </div>
      )}
    </div>
  )
}

/** This month at a glance: the spending (with the limit as a ring), the calls, the tokens and the busiest day. */
function Tiles({ month, limit }: { month: UsageReport; limit: number | null }): React.JSX.Element {
  const spent = month.total.cost
  const share = shareOf(spent, limit)
  const days = month.bars.filter((b) => !b.ahead)
  const busiest = days.reduce<(typeof days)[number] | null>((best, b) => (!best || b.cost > best.cost ? b : best), null)
  const tokens = month.total.promptTokens + month.total.completionTokens
  const R = 21
  const C = 2 * Math.PI * R
  return (
    <div className="grid grid-cols-2 gap-3 @[760px]:grid-cols-4">
      <div className="uc-tile is-main">
        <p className="st-caps">This month</p>
        <div className="mt-1 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[28px] font-semibold leading-tight tabular-nums text-fg">{dollars(spent)}</div>
            <div className="text-[12px] text-muted">
              {limit != null ? `of your ${limitDollars(limit)} limit` : month.worlds > 1 ? `across ${month.worlds} worlds` : 'across your library'}
            </div>
          </div>
          {limit != null ? (
            <svg
              viewBox="0 0 52 52"
              className="uc-limit h-[52px] w-[52px] shrink-0"
              role="progressbar"
              aria-label="This month's spending against your limit"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(share * 100)}
            >
              <circle cx="26" cy="26" r={R} className="uc-ring-track" />
              <circle
                cx="26"
                cy="26"
                r={R}
                className={cn('uc-limit-fill', share >= 1 ? 'is-full' : share >= 0.8 && 'is-near')}
                strokeDasharray={`${share * C} ${C}`}
                transform="rotate(-90 26 26)"
              />
              <text x="26" y="30" textAnchor="middle" className="uc-limit-text">
                {Math.round(share * 100)}%
              </text>
            </svg>
          ) : null}
        </div>
      </div>
      <div className="uc-tile">
        <p className="st-caps">AI calls</p>
        <div className="mt-1 text-[24px] font-semibold leading-tight tabular-nums text-fg">{month.total.calls.toLocaleString('en-US')}</div>
        <div className="text-[12px] text-muted">this month</div>
      </div>
      <div className="uc-tile">
        <p className="st-caps">Tokens</p>
        <div className="mt-1 text-[24px] font-semibold leading-tight tabular-nums text-fg">{tokenWords(tokens).replace(/ tokens?$/, '')}</div>
        <div className="text-[12px] text-muted">
          {month.total.cachedTokens > 0 ? `${tokenWords(month.total.cachedTokens).replace(/ tokens?$/, '')} from the cache` : 'read and written'}
        </div>
      </div>
      <div className="uc-tile">
        <p className="st-caps">Busiest day</p>
        <div className="mt-1 text-[24px] font-semibold leading-tight tabular-nums text-fg">{busiest && busiest.cost > 0 ? dollars(busiest.cost) : '—'}</div>
        <div className="text-[12px] text-muted">{busiest && busiest.cost > 0 ? busiest.label : 'Nothing yet this month'}</div>
      </div>
    </div>
  )
}
