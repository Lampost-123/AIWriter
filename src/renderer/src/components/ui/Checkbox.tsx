import { forwardRef, useEffect, useId, useRef, type InputHTMLAttributes, type ReactNode } from 'react'
import { Check, Minus } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { DISABLED, FOCUS_RING } from './controls'

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'checked' | 'onChange' | 'children' | 'size'> {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Words beside the box; clicking them ticks it too. Without them, give the box an aria-label (or wrap it in a <label>);
   * `className` then sits on the box itself, for its margins. */
  label?: ReactNode
  /** A quieter line under the label. */
  hint?: ReactNode
  /** Some but not all of a group: a dash in the box. */
  indeterminate?: boolean
  /** `sm`: a 14px box and 12.5px words, for dense lists and option panels. */
  size?: 'md' | 'sm'
}

/** A tick box: the design system's one look for "include this" choices (a Switch is for settings that turn on). */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { checked, onChange, label, hint, indeterminate = false, size = 'md', className, id, disabled, ...rest },
  outerRef
) {
  const inner = useRef<HTMLInputElement | null>(null)
  const autoId = useId()
  const boxId = id ?? autoId
  useEffect(() => {
    if (inner.current) inner.current.indeterminate = indeterminate
  }, [indeterminate])
  const sm = size === 'sm'
  const tick = sm ? 10 : 12
  const box = (
    <span className={cn('relative grid shrink-0 place-items-center', sm ? 'h-3.5 w-3.5' : 'h-4 w-4', !label && className)}>
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
          'peer absolute inset-0 m-0 appearance-none border border-line-strong',
          sm ? 'rounded-[4px]' : 'rounded-[5px]',
          'bg-page transition-[background-color,border-color] duration-(--dur-quick) ease-glide',
          'hover:border-muted checked:border-accent checked:bg-accent indeterminate:border-accent indeterminate:bg-accent',
          FOCUS_RING,
          DISABLED
        )}
      />
      {indeterminate ? (
        <Minus size={tick} aria-hidden className="pointer-events-none relative text-accent-fg" />
      ) : (
        <Check
          size={tick}
          aria-hidden
          className="pointer-events-none relative text-accent-fg opacity-0 transition-opacity duration-(--dur-quick) peer-checked:opacity-100"
        />
      )}
    </span>
  )
  if (!label) return box
  return (
    <label htmlFor={boxId} className={cn('inline-flex cursor-default items-start gap-2', className)}>
      <span className="mt-[2px] flex">{box}</span>
      {/* Greyed out once, like the box (controls.ts DISABLED), not dimmed again by the label. */}
      <span className={cn('min-w-0', disabled && 'opacity-50')}>
        <span className={cn('block text-fg', sm ? 'text-[12.5px] leading-[18px]' : 'text-[13.5px] leading-5')}>{label}</span>
        {hint ? <span className="block text-[12px] leading-relaxed text-muted">{hint}</span> : null}
      </span>
    </label>
  )
})
