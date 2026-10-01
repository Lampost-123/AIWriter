import * as D from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: number
}

/** Use for setup flows only. Routine actions never open a modal (see the spec's "no jank" rules). */
export function Dialog({ open, onOpenChange, title, description, children, footer, width = 480 }: DialogProps): React.JSX.Element {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/30 data-[state=open]:animate-fade-in" />
        <D.Content
          style={{ width }}
          className="fixed left-1/2 top-[14vh] z-50 max-h-[76vh] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-auto rounded-xl border border-line bg-surface p-5 shadow-pop focus:outline-none data-[state=open]:animate-pop-in"
        >
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <D.Title className="text-[15px] font-semibold text-fg">{title}</D.Title>
              {description ? <D.Description className="mt-1 text-[13px] text-muted">{description}</D.Description> : null}
            </div>
            <D.Close className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Close">
              <X size={16} />
            </D.Close>
          </div>
          {children}
          {footer ? <div className={cn('mt-5 flex justify-end gap-2')}>{footer}</div> : null}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
