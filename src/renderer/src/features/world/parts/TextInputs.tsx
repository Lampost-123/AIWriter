import { useState } from 'react'
import { Input } from '@/components/ui'
import { Check, Clock, Eye, Globe2, Hand, History, UserRound, type IconType } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { useNewLook } from '@/features/look/look'
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
  const isNew = useNewLook()
  // The New look: the presets as cards, each with its icon and a few words showing what it reads like.
  if (isNew && presets.every((p) => PRESET_CARDS[p])) {
    return (
      <div className="flex flex-col gap-2">
        <Input id={id} value={value} placeholder={placeholder} aria-describedby={describedBy} onChange={(e) => onChange(e.target.value)} />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(138px,1fr))] gap-2">
          {presets.map((p) => {
            const active = p.toLocaleLowerCase() === current
            const { icon: Icon, sample } = PRESET_CARDS[p]
            return (
              <button
                key={p}
                type="button"
                aria-pressed={active}
                aria-label={p}
                title={sample}
                onClick={() => onChange(active ? '' : p)}
                className={cn(
                  'relative rounded-card bg-page p-3 text-left transition-[transform,translate,scale,box-shadow] duration-(--dur-quick) ease-glide',
                  'hover:-translate-y-px active:duration-(--dur-press) active:scale-[0.97]',
                  active ? 'shadow-[var(--elev-2),inset_0_0_0_2px_var(--accent)]' : 'shadow-[var(--elev-1),inset_0_0_0_1px_var(--line)] hover:shadow-[var(--elev-2),inset_0_0_0_1px_var(--line)]'
                )}
              >
                <Icon size={20} selected={active} className="text-accent" />
                <span className="mt-2 block text-[13px] font-medium leading-tight text-fg">{p}</span>
                <span className="mt-0.5 block truncate font-serif text-[11.5px] italic text-faint">{sample}</span>
                <span
                  aria-hidden
                  className={cn(
                    'absolute right-2.5 top-2.5 grid h-[18px] w-[18px] place-items-center rounded-full bg-accent text-accent-fg transition-transform duration-(--dur-base) ease-spring',
                    active ? 'scale-100' : 'scale-0'
                  )}
                >
                  <Check size={12} />
                </span>
              </button>
            )
          })}
        </div>
      </div>
    )
  }
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

/** The New look's preset cards: each preset's icon and a few words of what it reads like. */
const PRESET_CARDS: Record<string, { icon: IconType; sample: string }> = {
  'First person': { icon: UserRound, sample: 'I climbed the stairs.' },
  'Close third person': { icon: Eye, sample: 'She climbed, counting.' },
  'Third person omniscient': { icon: Globe2, sample: 'The whole town slept.' },
  'Second person': { icon: Hand, sample: 'You climb the stairs.' },
  'Past tense': { icon: History, sample: 'She climbed the stairs.' },
  'Present tense': { icon: Clock, sample: 'She climbs the stairs.' }
}
export const TENSE_PRESETS = ['Past tense', 'Present tense'] as const
