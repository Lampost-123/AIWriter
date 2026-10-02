// The as-of slider: drag through a story's line (every story it follows on from, then its own
// scenes) to see the memory at any point. Small marks show where the entry changes; the buttons
// jump between them. Keyboard: arrows move one scene, Home and End go to the ends.
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { AsOf, AsOfStop } from '@shared/types'
import { IconButton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { nextChange, stopIndex } from './asOfLogic'

export function AsOfSlider({
  stops,
  value,
  onChange,
  label = 'As of',
  className
}: {
  stops: AsOfStop[]
  value: AsOf | null
  onChange: (at: AsOf) => void
  /** Words before the place: "As of Book 1, Ch 2, Sc 3". */
  label?: string
  className?: string
}): React.JSX.Element | null {
  if (!stops.length) return null
  const found = stopIndex(stops, value)
  const index = found >= 0 ? found : stops.length - 1
  const current = stops[index]
  const marks = stops.map((s, i) => (s.changes > 0 ? i : -1)).filter((i) => i >= 0)
  const prev = nextChange(stops, index, -1)
  const next = nextChange(stops, index, 1)
  const at = (i: number): string => (stops.length > 1 ? `${(i / (stops.length - 1)) * 100}%` : '50%')
  const go = (i: number | null): void => {
    if (i !== null && stops[i]) onChange(stops[i].at)
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex h-6 items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">
          {label} <span className="font-medium text-fg">{current.label}</span>
        </span>
        {marks.length ? (
          <>
            <IconButton size="sm" label="Previous change" disabled={prev === null} onClick={() => go(prev)}>
              <ChevronLeft size={14} />
            </IconButton>
            <IconButton size="sm" label="Next change" disabled={next === null} onClick={() => go(next)}>
              <ChevronRight size={14} />
            </IconButton>
          </>
        ) : null}
      </div>
      <div className="relative h-5">
        <input
          type="range"
          min={0}
          max={stops.length - 1}
          step={1}
          value={index}
          aria-label={label}
          aria-valuetext={current.label}
          onChange={(e) => go(Number(e.target.value))}
          className="absolute inset-x-0 top-1/2 h-5 w-full -translate-y-1/2 cursor-pointer accent-[var(--accent)]"
        />
        {/* Where the entry changes: quiet marks under the track, never in the way of dragging. */}
        <div aria-hidden className="pointer-events-none absolute inset-x-[7px] bottom-[-3px] h-1">
          {marks.map((i) => (
            <span key={i} className="absolute h-1 w-1 -translate-x-1/2 rounded-full bg-accent/70" style={{ left: at(i) }} />
          ))}
        </div>
      </div>
    </div>
  )
}
