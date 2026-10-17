// Writing style presets (src/shared/stylePresets.ts): one click sets the whole style (genres, content levels, point
// of view, tense and prose style). Shown first in "Story feel" on the Style guide (world and story) and in the Story
// builder's idea step. Presets for adult readers sit behind their own heading, opened with a click.

import { useState } from 'react'
import { Check, ChevronDown, Flame, Palette } from '@/components/ui/icons'
import { STYLE_PRESETS, presetOf, type StylePreset } from '@shared/stylePresets'
import type { StyleGuide } from '@shared/types'
import { cn } from '@/lib/cn'

export function StylePresets({
  value,
  onPick,
  compact = false
}: {
  /** The style as it stands (to mark the preset it matches). */
  value: Partial<StyleGuide> | null
  onPick: (preset: StylePreset) => void
  compact?: boolean
}): React.JSX.Element {
  const current = presetOf(value)
  const [adult, setAdult] = useState(() => !!current?.adult)
  const everyone = STYLE_PRESETS.filter((p) => !p.adult)
  const grown = STYLE_PRESETS.filter((p) => p.adult)
  return (
    <div className="flex flex-col gap-2" data-style-presets>
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
        <Palette size={13} aria-hidden />
        Start from a preset
      </div>
      <p className="-mt-1 text-[12px] leading-[17px] text-faint">One click sets the genre, how far it goes, point of view, tense and prose style. Change any of it after.</p>
      <Grid presets={everyone} current={current} onPick={onPick} compact={compact} />
      <button
        type="button"
        aria-expanded={adult}
        onClick={() => setAdult((a) => !a)}
        className="mt-1 flex items-center gap-1.5 self-start rounded px-1 py-0.5 text-[12.5px] font-medium text-muted transition-colors duration-150 hover:text-fg"
      >
        <Flame size={13} aria-hidden />
        For adult readers
        <ChevronDown size={13} aria-hidden className={cn('transition-transform duration-150', adult && 'rotate-180')} />
      </button>
      {adult ? <Grid presets={grown} current={current} onPick={onPick} compact={compact} /> : null}
    </div>
  )
}

function Grid({ presets, current, onPick, compact }: { presets: StylePreset[]; current: StylePreset | null; onPick: (p: StylePreset) => void; compact: boolean }): React.JSX.Element {
  return (
    <div role="group" className={cn('grid gap-2', compact ? 'grid-cols-[repeat(auto-fill,minmax(150px,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(180px,1fr))]')}>
      {presets.map((p) => {
        const on = current?.id === p.id
        return (
          <button
            key={p.id}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(p)}
            title={p.style.proseStyle}
            data-preset={p.id}
            className={cn(
              'flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors duration-150',
              on ? 'border-accent bg-accent/10' : 'border-line bg-surface hover:border-accent/50'
            )}
          >
            <span className="flex w-full items-center gap-1.5 text-[13px] font-medium text-fg">
              <span className="min-w-0 flex-1 truncate">{p.label}</span>
              {on ? <Check size={13} className="shrink-0 text-accent" aria-hidden /> : null}
            </span>
            <span className="line-clamp-2 text-[11.5px] leading-[16px] text-muted">{p.blurb}</span>
          </button>
        )
      })}
    </div>
  )
}
