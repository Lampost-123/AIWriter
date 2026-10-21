import { cn } from '@/lib/cn'
import { FOCUS_RING } from './controls'

/** A row of choices where exactly one is picked (creativity presets, how a block is sent). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  label: string
  className?: string
}): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex rounded-lg border border-line bg-surface-2 p-0.5', className)}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              'h-7 flex-1 rounded-md px-3 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-(--dur-quick) ease-glide',
              FOCUS_RING,
              // Accent tint rather than a raised white tab, so the choice reads clearly in every theme.
              on ? 'bg-accent-soft text-accent shadow-sm' : 'text-muted hover:text-fg'
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
