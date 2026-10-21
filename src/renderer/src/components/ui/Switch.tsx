import * as S from '@radix-ui/react-switch'
import { cn } from '@/lib/cn'
import { DISABLED, FOCUS_RING } from './controls'

/** An on/off switch: the design system's look for a setting that turns on (a Checkbox is for "include this"). */
export function Switch({
  checked,
  onChange,
  id,
  className,
  disabled,
  'aria-label': ariaLabel,
  'aria-describedby': describedBy
}: {
  checked: boolean
  onChange: (v: boolean) => void
  id?: string
  className?: string
  disabled?: boolean
  /** Names the switch when no <label htmlFor> points at it. */
  'aria-label'?: string
  'aria-describedby'?: string
}): React.JSX.Element {
  return (
    <S.Root
      id={id}
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-line-strong transition-colors duration-(--dur-quick) ease-glide data-[state=checked]:bg-accent',
        FOCUS_RING,
        DISABLED,
        className
      )}
    >
      <S.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-page shadow-sm transition-transform duration-(--dur-quick) ease-glide data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-accent-fg" />
    </S.Root>
  )
}
