import { useState } from 'react'
import { Input } from '@/components/ui'
import { cn } from '@/lib/cn'
import { parseList } from '../entryLogic'

/**
 * A comma-separated list typed as plain text ("nicknames, titles, the old woman").
 * The text is kept as typed, so a trailing comma or space doesn't vanish mid-word.
 */
export function CommaListInput({
  value,
  onChange,
  placeholder,
  id,
  className
}: {
  value: string[]
  onChange: (v: string[]) => void
  placeholder?: string
  id?: string
  className?: string
}): React.JSX.Element {
  const [text, setText] = useState(() => value.join(', '))
  return (
    <Input
      id={id}
      value={text}
      placeholder={placeholder}
      className={className}
      onChange={(e) => {
        setText(e.target.value)
        onChange(parseList(e.target.value))
      }}
      onBlur={() => setText(parseList(text).join(', '))}
    />
  )
}

/** A text box with a few one-click choices underneath ("Close third person", "First person"). */
export function PresetInput({
  value,
  onChange,
  presets,
  placeholder,
  id,
  'aria-describedby': describedBy
}: {
  value: string
  onChange: (v: string) => void
  presets: readonly string[]
  placeholder?: string
  id?: string
  'aria-describedby'?: string
}): React.JSX.Element {
  const current = value.trim().toLocaleLowerCase()
  return (
    <div className="flex flex-col gap-1.5">
      <Input id={id} value={value} placeholder={placeholder} aria-describedby={describedBy} onChange={(e) => onChange(e.target.value)} />
      <div className="flex flex-wrap gap-1">
        {presets.map((p) => {
          const active = p.toLocaleLowerCase() === current
          return (
            <button
              key={p}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(active ? '' : p)}
              className={cn(
                'h-6 rounded-full border px-2.5 text-[12px] transition-colors duration-150',
                active ? 'border-accent/40 bg-accent-soft text-accent' : 'border-line text-muted hover:border-line-strong hover:bg-surface-2 hover:text-fg'
              )}
            >
              {p}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export const POV_PRESETS = ['First person', 'Close third person', 'Third person omniscient', 'Second person'] as const
export const TENSE_PRESETS = ['Past tense', 'Present tense'] as const
