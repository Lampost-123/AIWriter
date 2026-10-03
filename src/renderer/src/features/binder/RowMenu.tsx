import * as M from '@radix-ui/react-dropdown-menu'
import { ChevronRight } from '@/components/ui/icons'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * One menu shared by every row in the binder, opened at the mouse on right-click
 * or under a row's "..." button. A single instance keeps long trees light.
 */
export function RowMenu({
  at,
  onClose,
  onCloseFocus,
  children,
  label
}: {
  at: { x: number; y: number } | null
  onClose: () => void
  /** Where focus goes when the menu closes (return false to leave it where it is). */
  onCloseFocus?: () => void
  children: ReactNode
  label: string
}): React.JSX.Element | null {
  if (!at) return null
  return (
    <M.Root open modal={false} onOpenChange={(o) => !o && onClose()}>
      <M.Trigger asChild>
        <span aria-hidden className="pointer-events-none fixed h-px w-px" style={{ left: at.x, top: at.y }} />
      </M.Trigger>
      <M.Portal>
        <M.Content
          aria-label={label}
          align="start"
          sideOffset={2}
          collisionPadding={8}
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            onCloseFocus?.()
          }}
          className="z-50 min-w-[200px] rounded-lg border border-line bg-surface p-1 shadow-pop data-[state=open]:animate-pop-in"
        >
          {children}
        </M.Content>
      </M.Portal>
    </M.Root>
  )
}

export function RowMenuItem({
  icon,
  children,
  hint,
  danger,
  onSelect
}: {
  icon?: ReactNode
  children: ReactNode
  hint?: string
  danger?: boolean
  onSelect: () => void
}): React.JSX.Element {
  return (
    <M.Item
      onSelect={onSelect}
      className={cn(
        'flex h-8 items-center gap-2 rounded-md px-2 text-[13.5px] outline-none data-[highlighted]:bg-surface-2',
        danger ? 'text-danger' : 'text-fg'
      )}
    >
      <span className={cn('flex w-4 shrink-0 justify-center', danger ? 'text-danger' : 'text-muted')}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint ? <span className="pl-4 text-[11.5px] text-faint">{hint}</span> : null}
    </M.Item>
  )
}

export const RowMenuSeparator = (): React.JSX.Element => <M.Separator className="my-1 h-px bg-line" />

/** A menu item that opens a list beside it ("Move to act" and its acts). */
export function RowMenuSub({ icon, label, children }: { icon?: ReactNode; label: string; children: ReactNode }): React.JSX.Element {
  return (
    <M.Sub>
      <M.SubTrigger className="flex h-8 items-center gap-2 rounded-md px-2 text-[13.5px] text-fg outline-none data-[highlighted]:bg-surface-2 data-[state=open]:bg-surface-2">
        <span className="flex w-4 shrink-0 justify-center text-muted">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronRight size={14} className="shrink-0 text-faint" />
      </M.SubTrigger>
      <M.Portal>
        <M.SubContent
          sideOffset={4}
          alignOffset={-5}
          collisionPadding={8}
          className="z-50 min-w-[180px] max-w-[280px] rounded-lg border border-line bg-surface p-1 shadow-pop data-[state=open]:animate-pop-in"
        >
          {children}
        </M.SubContent>
      </M.Portal>
    </M.Sub>
  )
}
