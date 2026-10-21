import { forwardRef, useEffect, useId, useRef, type InputHTMLAttributes, type ReactNode } from 'react'
import { Check, Minus } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { DISABLED, FOCUS_RING } from './controls'

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'checked' | 'onChange' | 'children'> {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Words beside the box; clicking them ticks it too. Without them, give the box an aria-label. */
  label?: ReactNode
  /** A quieter line under the label. */
  hint?: ReactNode
  /** Some but not all of a group: a dash in the box. */
  indeterminate?: boolean
}

/** A tick box: the design system's one look for "include this" choices (a Switch is for settings that turn on). */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { checked, onChange, label, hint, indeterminate = false, className, id, disabled, ...rest },
  outerRef
) {
  const inner = useRef<HTMLInputElement | null>(null)
  const autoId = useId()
  const boxId = id ?? autoId
  useEffect(() => {
    if (inner.current) inner.current.indeterminate = indeterminate
  }, [indeterminate])
  const box = (
    <span className="relative grid h-4 w-4 shrink-0 place-items-center">
      <input
        {...rest}
        ref={(el) => {
          inner.current = el
          if (typeof outerRef === 'function') outerRef(el)
          else if (outerRef) outerRef.current = el
        }}
        id={boxId}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className={cn(
          'peer absolute inset-0 m-0 appearance-none rounded-[5px] border border-line-strong bg-page transition-[background-color,border-color] duration-(--dur-quick) ease-glide',
          'hover:border-muted checked:border-accent checked:bg-accent indeterminate:border-accent indeterminate:bg-accent',
          FOCUS_RING,
          DISABLED,
          !label && className
        )}
      />
      {indeterminate ? (
        <Minus size={12} aria-hidden className="pointer-events-none relative text-accent-fg" />
      ) : (
        <Check
          size={12}
          aria-hidden
          className="pointer-events-none relative text-accent-fg opacity-0 transition-opacity duration-(--dur-quick) peer-checked:opacity-100"
        />
      )}
    </span>
  )
  if (!label) return box
  return (
    <label htmlFor={boxId} className={cn('inline-flex items-start gap-2', disabled ? 'opacity-50' : 'cursor-default', className)}>
      <span className="mt-[2px] flex">{box}</span>
      <span className="min-w-0">
        <span className="block text-[13.5px] leading-5 text-fg">{label}</span>
        {hint ? <span className="block text-[12px] leading-relaxed text-muted">{hint}</span> : null}
      </span>
    </label>
  )
})
