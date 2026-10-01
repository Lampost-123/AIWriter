import * as S from '@radix-ui/react-switch'
import { cn } from '@/lib/cn'

export function Switch({
  checked,
  onChange,
  id,
  className,
  'aria-describedby': describedBy
}: {
  checked: boolean
  onChange: (v: boolean) => void
  id?: string
  className?: string
  'aria-describedby'?: string
}): React.JSX.Element {
  return (
    <S.Root
      id={id}
      checked={checked}
      onCheckedChange={onChange}
      aria-describedby={describedBy}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-line-strong transition-colors duration-150 data-[state=checked]:bg-accent',
        'focus-visible:outline-2 focus-visible:outline-offset-2',
        className
      )}
    >
      <S.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-page shadow-sm transition-transform duration-150 data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-accent-fg" />
    </S.Root>
  )
}
