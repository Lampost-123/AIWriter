// Settings › Usage and cost in the New look: real charts, drawn to scale with theme tokens only (no chart library).
// - SpendBars: a bar a day (a month for "All time"), stacked by model in each model's colour, on a scale of round
//   numbers with faint gridlines; in dollars or in tokens. Hovering a bar says its day and each model's part. The bars
//   grow up from the baseline when the stretch of time or the measure changes (a few ms apart), at once with less motion.
// - ModelSplit: a ring split by model, with its legend: each model's dollars, share and tokens.
// - WorldBars and JobBars: each world's and each kind of work's dollars as bars on one scale.
import { useId, useMemo, useState } from 'react'
import { dollars, type UsageBar, type UsageJobRow, type UsageModelRow, type UsageTotals, type UsageWorldRow } from '@shared/contracts/usage'
import { cn } from '@/lib/cn'
import { callWords, labelledBars, tokenWords, tokensWithCache } from './usageWords'
import { OTHER_INK, modelColours, modelKey, modelName, niceTicks, percentWords, shares, stackOf } from './chartLogic'

export type Measure = 'cost' | 'tokens'

/** A short number for the scale: "$0.40", "$12", "250k", "1.5M". */
function scaleWords(v: number, measure: Measure): string {
  if (measure === 'cost') return v === 0 ? '$0' : v >= 10 ? `$${Math.round(v)}` : dollars(v)
  return v === 0 ? '0' : tokenWords(v).replace(/ tokens?$/, '')
}

const PLOT_H = 196

export function SpendBars({
  bars,
  unit,
  models,
  measure
}: {
  bars: UsageBar[]
  unit: 'day' | 'month'
  models: UsageModelRow[]
  measure: Measure
}): React.JSX.Element {
  const [hover, setHover] = useState<number | null>(null)
  const colours = useMemo(() => modelColours(models), [models])
  const value = (b: UsageBar): number => (measure === 'cost' ? b.cost : b.tokens)
  const top = Math.max(0, ...bars.map(value))
  const ticks = niceTicks(top)
  const scaleTop = ticks[ticks.length - 1] || 1
  const labels = labelledBars(bars.length)
  const tip = hover != null ? bars[hover] : null
  const most = bars.reduce((best, b, i) => (value(b) > value(bars[best] ?? b) ? i : best), 0)
  const summary = `${measure === 'cost' ? 'Spending' : 'Tokens'} ${unit === 'day' ? 'day by day' : 'month by month'}: the most in one ${unit} was ${
    measure === 'cost' ? dollars(top) : tokenWords(top)
  }${bars[most] && top > 0 ? `, on ${bars[most].label}` : ''}.`
  // A new stretch of time or measure: the bars grow again from the baseline. New figures in the same stretch (a call
  // finishing meanwhile) ease the bars to their new heights instead.
  const drawKey = `${measure}:${bars[0]?.key ?? ''}:${bars.length}`
  return (
    <div className="uc-bars relative select-none" onPointerLeave={() => setHover(null)}>
      <div role="img" aria-label={summary} className="relative flex" style={{ height: PLOT_H }}>
        {/* The scale, its numbers on the left and faint lines across. */}
        <div aria-hidden className="relative w-12 shrink-0">
          {ticks.map((t) => (
            <span key={t} className="uc-tick-label" style={{ bottom: `${(t / scaleTop) * 100}%` }}>
              {scaleWords(t, measure)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          {ticks.map((t) => (
            <span key={t} aria-hidden className={cn('uc-grid', t === 0 && 'is-base')} style={{ bottom: `${(t / scaleTop) * 100}%` }} />
          ))}
          <div key={drawKey} className="absolute inset-0 flex items-end gap-[3px]">
            {bars.map((b, i) => {
              const stack = stackOf(b, colours, measure)
              const h = (value(b) / scaleTop) * 100
              return (
                <div
                  key={b.key}
                  className={cn('uc-col relative flex h-full min-w-0 flex-1 items-end justify-center', hover != null && hover !== i && 'is-dim')}
                  onPointerEnter={() => setHover(i)}
                  aria-hidden
                >
                  {b.ahead ? (
                    <span className="uc-ahead" />
                  ) : h > 0 ? (
                    <span className="uc-bar" style={{ height: `max(3px, ${h}%)`, animationDelay: `${Math.min(i * 12, 360)}ms` }}>
                      {stack.map((p) => (
                        <span key={p.key} style={{ flexGrow: p.value, background: p.ink }} />
                      ))}
                    </span>
                  ) : null}
                </div>
              )
            })}
          </div>
          {tip ? <BarTip bar={tip} at={hover!} count={bars.length} colours={colours} measure={measure} /> : null}
        </div>
      </div>
      <div aria-hidden className="relative ml-12 mt-2 h-4 text-[11px] tabular-nums text-faint">
        {bars.map((b, i) =>
          labels.has(i) ? (
            <span
              key={b.key}
              className={cn('absolute whitespace-nowrap', i > 0 && i < bars.length - 1 && '-translate-x-1/2')}
              style={i === 0 ? { left: 0 } : i === bars.length - 1 ? { right: 0 } : { left: `${((i + 0.5) / bars.length) * 100}%` }}
            >
              {b.label}
            </span>
          ) : null
        )}
      </div>
    </div>
  )
}

function BarTip({ bar, at, count, colours, measure }: { bar: UsageBar; at: number; count: number; colours: Map<string, string>; measure: Measure }): React.JSX.Element {
  const parts = (bar.models ?? []).filter((p) => (measure === 'cost' ? p.cost : p.tokens) > 0).slice(0, 5)
  return (
    <div
      role="tooltip"
      className="uc-tip pointer-events-none absolute bottom-full z-10 mb-2 w-max min-w-[180px] max-w-[280px] -translate-x-1/2 rounded-[10px] px-3 py-2 text-[12px]"
      style={{ left: `${Math.min(84, Math.max(16, ((at + 0.5) / count) * 100))}%` }}
    >
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-medium text-fg">{bar.label}</span>
        {bar.ahead ? null : <span className="tabular-nums text-fg">{measure === 'cost' ? dollars(bar.cost) : tokenWords(bar.tokens)}</span>}
      </div>
      {bar.ahead ? (
        <div className="text-muted">Still to come</div>
      ) : bar.calls ? (
        <>
          <div className="mb-1 text-muted">
            {callWords(bar.calls)} · {measure === 'cost' ? tokenWords(bar.tokens) : dollars(bar.cost)}
          </div>
          {parts.map((p) => (
            <div key={modelKey(p)} className="flex items-center gap-2 tabular-nums text-muted">
              <span className="h-2 w-2 shrink-0 rounded-[3px]" style={{ background: colours.get(modelKey(p)) ?? OTHER_INK }} />
              <span className="min-w-0 flex-1 truncate">{modelName(p.modelId).name}</span>
              <span>{measure === 'cost' ? dollars(p.cost) : tokenWords(p.tokens)}</span>
            </div>
          ))}
        </>
      ) : (
        <div className="text-muted">No AI use</div>
      )}
    </div>
  )
}

/** The models as a ring of shares, and its legend. */
export function ModelSplit({ models, measure }: { models: UsageModelRow[]; measure: Measure }): React.JSX.Element {
  const colours = useMemo(() => modelColours(models), [models])
  const values = models.map((m) => (measure === 'cost' ? m.cost : m.promptTokens + m.completionTokens))
  const split = shares(values)
  const raw = shares(values, 0)
  const total = values.reduce((a, b) => a + b, 0)
  const R = 46
  const C = 2 * Math.PI * R
  let start = 0
  const titleId = useId()
  return (
    <div className="flex flex-col items-center gap-5 @[520px]:flex-row @[520px]:items-start">
      <svg viewBox="0 0 120 120" className="uc-ring h-[148px] w-[148px] shrink-0" role="img" aria-labelledby={titleId}>
        <title id={titleId}>
          {models.length === 1 ? 'All on one model.' : `Split across ${models.length} models; the most on ${modelName(models[0]?.modelId ?? '').name}.`}
        </title>
        <circle cx="60" cy="60" r={R} className="uc-ring-track" />
        <g transform="rotate(-90 60 60)">
          {split.map((s, i) => {
            if (!(s > 0)) return null
            const gap = split.filter((x) => x > 0).length > 1 ? 1.6 : 0
            const len = Math.max(0.5, s * C - gap)
            const el = (
              <circle
                key={modelKey(models[i])}
                cx="60"
                cy="60"
                r={R}
                className="uc-ring-part"
                stroke={colours.get(modelKey(models[i]))}
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={-start}
                style={{ animationDelay: `${i * 70}ms` }}
              />
            )
            start += s * C
            return el
          })}
        </g>
        <text x="60" y="57" textAnchor="middle" className="uc-ring-total">
          {measure === 'cost' ? dollars(total) : tokenWords(total).replace(/ tokens?$/, '')}
        </text>
        <text x="60" y="73" textAnchor="middle" className="uc-ring-sub">
          {measure === 'cost' ? 'in all' : 'tokens'}
        </text>
      </svg>
      <ul aria-label="By model" className="flex w-full min-w-0 flex-col">
        {models.map((m, i) => {
          const n = modelName(m.modelId)
          return (
            <li key={modelKey(m)} className="flex items-start gap-2.5 border-t border-line py-2 first:border-t-0 first:pt-0">
              <span className="mt-[5px] h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: colours.get(modelKey(m)) }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-[13px] font-medium text-fg" title={m.modelId}>
                    {n.name}
                  </span>
                  <span className="shrink-0 text-[13px] tabular-nums text-fg">{dollars(m.cost)}</span>
                </div>
                <div className="mt-0.5 flex items-baseline justify-between gap-3 text-[11.5px] tabular-nums text-muted">
                  <span className="min-w-0 truncate">
                    {[n.maker, m.provider].filter(Boolean).join(' · ')} · {callWords(m.calls)}
                  </span>
                  <span className="shrink-0">
                    {percentWords(raw[i])} · {tokensWithCache(m)}
                  </span>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

interface BarRow {
  key: string
  name: string
  sub: string | null
  t: UsageTotals
  mark?: React.ReactNode
}

/** Rows of dollars on one scale (by world, by job). */
export function RowBars({ label, rows, tone = 'accent' }: { label: string; rows: BarRow[]; tone?: 'accent' | 'place' }): React.JSX.Element {
  const most = Math.max(0, ...rows.map((r) => r.t.cost))
  const total = rows.reduce((a, r) => a + r.t.cost, 0)
  return (
    <ul aria-label={label} className="flex flex-col gap-3">
      {rows.map((r, i) => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-fg">
              <span className="truncate" title={r.name}>
                {r.name}
              </span>
              {r.mark}
            </span>
            <span className="shrink-0 text-[13px] tabular-nums text-fg">{dollars(r.t.cost)}</span>
          </div>
          <div className="uc-row-track mt-1.5" aria-hidden>
            <span
              className={cn('uc-row-fill', tone === 'place' && 'is-place')}
              style={{ width: `${most > 0 ? Math.max(1.5, (r.t.cost / most) * 100) : 0}%`, animationDelay: `${i * 50}ms` }}
            />
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-3 text-[11.5px] tabular-nums text-muted">
            <span className="min-w-0 truncate">{r.sub ? `${r.sub} · ${callWords(r.t.calls)}` : callWords(r.t.calls)}</span>
            <span className="shrink-0">
              {total > 0 ? `${percentWords(r.t.cost / total)} · ` : ''}
              {tokensWithCache(r.t)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  )
}

export const worldRows = (worlds: UsageWorldRow[]): BarRow[] =>
  worlds.map((w) => ({
    key: `${w.recipes ? 'recipes' : 'world'}:${w.name}`,
    name: w.name,
    sub: w.recipes ? 'Belongs to no world' : null,
    t: w,
    mark: w.open ? <span className="rounded-full bg-accent-soft px-1.5 py-px text-[10.5px] font-medium text-accent">Open</span> : null
  }))

export const jobRows = (jobs: UsageJobRow[]): BarRow[] => jobs.map((j) => ({ key: j.key, name: j.label, sub: null, t: j }))
