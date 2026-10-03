import { Droplet, Heart, MessageSquareWarning, type IconType } from '@/components/ui/icons'
import { useId } from 'react'
import { INTENSITY, type IntensityScale } from '@shared/intensity'
import type { ContentIntensity } from '@shared/types'
import { cn } from '@/lib/cn'
import { scaleShown, toggleLevel, type FeelMode } from './feelLogic'

const ICONS: Record<IntensityScale, IconType> = { romance: Heart, violence: Droplet, language: MessageSquareWarning }

/**
 * Romance, violence and language, four steps each. A scale with no step picked is left to the genre; clicking
 * the picked step again leaves it to the genre once more. On a story, a scale it hasn't set shows the world's
 * step with a dashed edge. The hint under each sits in room kept for its longest line, so nothing below moves.
 */
export function IntensityControls({
  value,
  below,
  mode,
  onChange
}: {
  value: ContentIntensity
  below: ContentIntensity
  mode: FeelMode
  onChange: (next: ContentIntensity) => void
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-2.5">
      {INTENSITY.map((info) => (
        <ScaleRow key={info.scale} scale={info.scale} value={value} below={below} mode={mode} onChange={onChange} />
      ))}
    </div>
  )
}

function ScaleRow({
  scale,
  value,
  below,
  mode,
  onChange
}: {
  scale: IntensityScale
  value: ContentIntensity
  below: ContentIntensity
  mode: FeelMode
  onChange: (next: ContentIntensity) => void
}): React.JSX.Element {
  const info = INTENSITY.find((i) => i.scale === scale)!
  const shown = scaleShown(value, below, scale, mode)
  const Icon = ICONS[scale]
  const ids = { label: useId(), hint: useId() }
  return (
    <>
      <div id={ids.label} className="flex h-8 w-[92px] items-center gap-2 text-[13px] font-medium text-fg">
        <Icon size={15} strokeWidth={1.75} className="shrink-0 text-muted" aria-hidden />
        {info.label}
      </div>
      <div className="min-w-0">
        <div role="group" aria-labelledby={ids.label} aria-describedby={ids.hint} className="flex rounded-lg border border-line bg-surface-2 p-0.5">
          {info.steps.map((step) => {
            const on = shown.picked === step.level
            const theirs = shown.inherited === step.level
            return (
              <button
                key={step.level}
                type="button"
                aria-pressed={on}
                title={on ? `${step.hint} Click again to ${shown.clearTo}.` : step.hint}
                onClick={() => onChange(toggleLevel(value, scale, step.level))}
                className={cn(
                  'h-7 min-w-0 flex-1 truncate rounded-md border px-2 text-[12.5px] font-medium transition-[background-color,color,border-color,box-shadow] duration-150',
                  on
                    ? 'border-transparent bg-accent-soft text-accent shadow-sm'
                    : theirs
                      ? 'border-dashed border-line-strong text-fg hover:bg-surface'
                      : 'border-transparent text-muted hover:text-fg'
                )}
              >
                {step.label}
              </button>
            )
          })}
        </div>
        {/* Every hint shares one cell, so the room is the longest one's and never jumps. */}
        <div id={ids.hint} className="mt-1 grid text-[12px] leading-[17px] text-faint">
          {shown.hints.map((h) => (
            <p key={h} aria-hidden={h !== shown.hint} className={cn('col-start-1 row-start-1', h !== shown.hint && 'invisible', h === shown.hint && !shown.picked && 'italic')}>
              {h}
            </p>
          ))}
        </div>
      </div>
    </>
  )
}
