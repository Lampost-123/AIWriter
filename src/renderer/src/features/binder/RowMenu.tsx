import * as M from '@radix-ui/react-dropdown-menu'
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
      <span className={cn('flex w-4 justify-center', danger ? 'text-danger' : 'text-muted')}>{icon}</span>
      <span className="flex-1">{children}</span>
      {hint ? <span className="pl-4 text-[11.5px] text-faint">{hint}</span> : null}
    </M.Item>
  )
}

export const RowMenuSeparator = (): React.JSX.Element => <M.Separator className="my-1 h-px bg-line" />
