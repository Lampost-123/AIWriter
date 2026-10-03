// The menu on each world card and story row of the start screen (as the Welcome screen's world menu was).

import * as M from '@radix-ui/react-dropdown-menu'
import { MoreHorizontal, type IconType } from '@/components/ui/icons'
import { Fragment, useRef } from 'react'
import { cn } from '@/lib/cn'

export interface CardMenuItem {
  label: string
  icon: IconType
  run: () => void
  /** Red: deleting. */
  danger?: boolean
  /** A line above it. */
  apart?: boolean
  /** It moves the keyboard elsewhere (a name box, a dialog), so it runs once the menu has closed. */
  afterClose?: boolean
}

const itemClass = 'flex items-center gap-2 rounded-md px-2 py-1.5 text-[13.5px] outline-none data-[highlighted]:bg-surface-2'

export function CardMenu({ label, items, className }: { label: string; items: CardMenuItem[]; className?: string }): React.JSX.Element {
  const next = useRef<(() => void) | null>(null)
  return (
    <M.Root modal={false}>
      <M.Trigger
        aria-label={label}
        title="More"
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-faint outline-none transition-colors duration-150 hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/40 data-[state=open]:bg-surface-2 data-[state=open]:text-fg',
          className
        )}
      >
        <MoreHorizontal size={15} />
      </M.Trigger>
      <M.Portal>
        <M.Content
          align="end"
          sideOffset={4}
          onCloseAutoFocus={(e) => {
            const run = next.current
            next.current = null
            if (!run) return
            e.preventDefault()
            run()
          }}
          className="z-50 min-w-[200px] rounded-lg border border-line bg-surface p-1 shadow-pop data-[state=open]:animate-pop-in"
        >
          {items.map((item) => {
            const Icon = item.icon
            return (
              <Fragment key={item.label}>
                {item.apart ? <M.Separator className="my-1 h-px bg-line" /> : null}
                <M.Item
                  onSelect={() => {
                    if (item.afterClose) next.current = item.run
                    else item.run()
                  }}
                  className={cn(itemClass, item.danger ? 'text-danger' : 'text-fg')}
                >
                  <Icon size={14} className={item.danger ? 'text-danger' : 'text-muted'} /> {item.label}
                </M.Item>
              </Fragment>
            )
          })}
        </M.Content>
      </M.Portal>
    </M.Root>
  )
}
