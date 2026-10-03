// Spending day by day (month by month for "All time"), as slim bars in the accent colour on a quiet baseline:
// one series, so no legend; the top line says what the tallest bar is worth; hovering or focusing a bar says
// its day, dollars, calls and tokens. Drawn with theme tokens only, no chart library.
import { useState } from 'react'
import { dollars, type UsageBar } from '@shared/contracts/usage'
import { cn } from '@/lib/cn'
import { callsAndTokens, labelledBars } from './usageWords'

const HEIGHT = 132

export function SpendChart({ bars, unit }: { bars: UsageBar[]; unit: 'day' | 'month' }): React.JSX.Element {
  const [hover, setHover] = useState<number | null>(null)
  const top = Math.max(0, ...bars.map((b) => b.cost))
  const labels = labelledBars(bars.length)
  const tip = hover != null ? bars[hover] : null
  const summary = `Spending ${unit === 'day' ? 'day by day' : 'month by month'}: the most in one ${unit} was ${dollars(top)}.`
  return (
    <div className="relative select-none" onPointerLeave={() => setHover(null)}>
      <div className="mb-1 flex items-baseline justify-between text-[11.5px] tabular-nums text-faint">
        <span>{top > 0 ? dollars(top) : ''}</span>
        <span>{unit === 'day' ? 'By day' : 'By month'}</span>
      </div>
      <div role="img" aria-label={summary} className="relative" style={{ height: HEIGHT }}>
        {/* The top line and the baseline, recessive. */}
        <div className="absolute inset-x-0 top-0 border-t border-dashed border-line" aria-hidden />
        <div className="absolute inset-x-0 bottom-0 border-t border-line-strong" aria-hidden />
        <div className="absolute inset-0 flex items-end gap-[2px]">
          {bars.map((b, i) => {
            const h = top > 0 ? Math.max(b.cost > 0 ? 3 : 0, Math.round((b.cost / top) * (HEIGHT - 4))) : 0
            return (
              <div
                key={b.key}
                className="relative flex h-full min-w-0 flex-1 items-end justify-center"
                onPointerEnter={() => setHover(i)}
                aria-hidden
              >
                {b.ahead ? null : (
                  <div
                    className={cn(
                      'w-full max-w-[18px] rounded-t-[4px] bg-accent transition-[height,opacity] duration-150',
                      hover != null && hover !== i && 'opacity-60'
                    )}
                    style={{ height: h }}
                  />
                )}
              </div>
            )
          })}
        </div>
        {tip ? (
          <div
            className="pointer-events-none absolute bottom-full z-10 mb-2 w-max max-w-[220px] -translate-x-1/2 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12px] shadow-pop animate-fade-in"
            style={{ left: `${Math.min(88, Math.max(12, ((hover! + 0.5) / bars.length) * 100))}%` }}
          >
            <div className="font-medium text-fg">
              {tip.label}
              {tip.ahead ? '' : `: ${dollars(tip.cost)}`}
            </div>
            <div className="text-muted">{tip.ahead ? 'Still to come' : tip.calls ? callsAndTokens({ calls: tip.calls, promptTokens: tip.tokens, completionTokens: 0 }) : 'No AI use'}</div>
          </div>
        ) : null}
      </div>
      <div className="relative mt-1.5 h-4 text-[11px] tabular-nums text-faint" aria-hidden>
        {bars.map((b, i) =>
          labels.has(i) ? (
            <span
              key={b.key}
              // The first and last labels keep inside the chart's edges.
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
