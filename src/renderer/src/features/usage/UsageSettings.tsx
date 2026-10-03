// Settings › Usage and cost (milestone 6): what the AI has cost, across every world in the library.
// - The headline: this month's spending and, with a limit, a slim bar of how much of it is used.
// - The monthly limit: one optional field (empty: no limit, no warnings), saved when Adam leaves it or presses
//   Enter; while it holds AI calls, a note says so with "Carry on this month".
// - Spending by day (a bar chart), by model and by job in plain words, tokens alongside, for this month, last
//   month, the last 30 days or all time, across every world or only the open one; and an honest note for
//   calls with no price.
// The page waits for its numbers before showing (a slow load gets its placeholder after 200 ms), and keeps
// showing the last numbers while new ones load, so nothing flashes or jumps.
import { ChartColumn, Coins } from 'lucide-react'
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
import { carryOn, setSpend, useSpend } from './spendStore'
import { PERIODS, callsAndTokens, costNotes, shareOf, tokensWithCache } from './usageWords'

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
