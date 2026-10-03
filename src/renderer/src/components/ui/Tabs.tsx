import * as T from '@radix-ui/react-tabs'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { useNewLook } from '@/features/look/look'
import { GlidePill } from './GlidePill'

export const Tabs = T.Root
export const TabsContent = ({ value, className, children }: { value: string; className?: string; children: ReactNode }): React.JSX.Element => (
  <T.Content value={value} className={cn('min-h-0 flex-1 focus-visible:outline-none', className)}>
    {children}
  </T.Content>
)

export function TabsList({
  items,
  className,
  tall
}: {
  items: { value: string; label: ReactNode; badge?: ReactNode }[]
  className?: string
  /** 48px tall, to line up with the binder and scene headers. */
  tall?: boolean
}): React.JSX.Element {
  // The New look: a soft segmented track, with a raised pill that slides to the chosen tab.
  const isNew = useNewLook()
  return (
    <T.List
      className={cn(
        'flex shrink-0 items-center gap-0.5 border-b border-line px-2',
        'look-new:relative look-new:mx-1.5 look-new:my-2 look-new:gap-0 look-new:overflow-hidden look-new:rounded-[10px] look-new:border-0 look-new:bg-surface-2 look-new:p-[3px] look-new:shadow-[inset_0_0_0_1px_var(--line)]',
        className
      )}
    >
      {isNew ? <GlidePill className="rounded-[7px] shadow-e1" /> : null}
      {items.map((it) => (
        <T.Trigger
          key={it.value}
          value={it.value}
          className={cn(
            'relative -mb-px inline-flex items-center gap-1.5 border-b-2 border-transparent px-2.5 text-[13px] font-medium text-muted transition-colors hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg',
            tall ? 'h-12' : 'h-9',
            'look-new:mb-0 look-new:h-[30px] look-new:shrink-0 look-new:rounded-[7px] look-new:border-0 look-new:px-2.5 look-new:text-[12px] look-new:duration-(--dur-quick)'
          )}
        >
          {it.label}
          {it.badge}
        </T.Trigger>
      ))}
    </T.List>
  )
}
