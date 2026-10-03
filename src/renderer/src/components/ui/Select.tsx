import * as S from '@radix-ui/react-select'
import { Check, ChevronDown } from '@/components/ui/icons'
import { cn } from '@/lib/cn'

export interface SelectOption {
  value: string
  label: string
  hint?: string
}

const NONE = '__none__'

export function Select({
  value,
  onChange,
  options,
  placeholder = 'Choose…',
  id,
  className,
  allowNone,
  noneLabel = 'None'
}: {
  value: string | null
  onChange: (v: string | null) => void
  options: SelectOption[]
  placeholder?: string
  id?: string
  className?: string
  /** Adds a "None" option that maps to null. */
  allowNone?: boolean
  noneLabel?: string
}): React.JSX.Element {
  return (
    <S.Root value={value ?? (allowNone ? NONE : undefined)} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <S.Trigger
        id={id}
        className={cn(
          'inline-flex h-8 w-full items-center justify-between gap-2 rounded-md border border-line bg-page px-2.5 text-left text-[13.5px] text-fg transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 data-[placeholder]:text-faint',
          className
        )}
      >
        <span className="truncate">
          <S.Value placeholder={placeholder} />
        </span>
        <S.Icon>
          <ChevronDown size={14} className="text-muted" />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-[320px] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-line bg-surface shadow-pop data-[state=open]:animate-pop-in"
        >
          <S.Viewport className="p-1">
            {allowNone ? <Item value={NONE} label={noneLabel} /> : null}
            {options.map((o) => (
              <Item key={o.value} value={o.value} label={o.label} hint={o.hint} />
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  )
}

function Item({ value, label, hint }: SelectOption): React.JSX.Element {
  return (
    <S.Item
      value={value}
      className="relative flex cursor-default select-none items-center gap-2 rounded-md py-1.5 pl-7 pr-2 text-[13.5px] text-fg outline-none data-[highlighted]:bg-surface-2"
    >
      <S.ItemIndicator className="absolute left-2">
        <Check size={14} className="text-accent" />
      </S.ItemIndicator>
      <S.ItemText>{label}</S.ItemText>
      {hint ? <span className="ml-auto text-[12px] text-faint">{hint}</span> : null}
    </S.Item>
  )
}
