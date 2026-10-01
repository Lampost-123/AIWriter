import * as T from '@radix-ui/react-tabs'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export const Tabs = T.Root
export const TabsContent = ({ value, className, children }: { value: string; className?: string; children: ReactNode }): React.JSX.Element => (
  <T.Content value={value} className={cn('min-h-0 flex-1 focus-visible:outline-none', className)}>
    {children}
  </T.Content>
)

export function TabsList({ items, className }: { items: { value: string; label: ReactNode; badge?: ReactNode }[]; className?: string }): React.JSX.Element {
  return (
    <T.List className={cn('flex shrink-0 items-center gap-0.5 border-b border-line px-2', className)}>
      {items.map((it) => (
        <T.Trigger
          key={it.value}
          value={it.value}
          className="relative -mb-px inline-flex h-9 items-center gap-1.5 border-b-2 border-transparent px-2.5 text-[13px] font-medium text-muted transition-colors hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg"
        >
          {it.label}
          {it.badge}
        </T.Trigger>
      ))}
    </T.List>
  )
}
