import * as D from '@radix-ui/react-dialog'
import { X } from '@/components/ui/icons'
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
  /** Where the keyboard goes once it closes (call preventDefault to choose); by default, back to what opened it. */
  onCloseAutoFocus?: (e: Event) => void
}

/** Use for setup flows only. Routine actions never open a modal (see the spec's "no jank" rules). */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 480,
  onCloseAutoFocus
}: DialogProps): React.JSX.Element {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        {/* data-dialog-overlay, data-dialog: in the New look they fade out when closed with the pointer (styles.css). */}
        <D.Overlay data-dialog-overlay="" className="fixed inset-0 z-40 bg-overlay data-[state=open]:animate-fade-in" />
        <D.Content
          data-dialog=""
          // Start in the first text box, never on the close button (typing a space there would close the dialog).
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            const content = e.currentTarget as HTMLElement
            const field = content.querySelector<HTMLElement>('[data-autofocus], input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled])')
            ;(field ?? content).focus()
          }}
          onCloseAutoFocus={onCloseAutoFocus}
          style={{ width }}
          className="fixed left-1/2 top-[14vh] z-50 max-h-[76vh] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-auto rounded-xl border border-line bg-surface p-5 shadow-pop focus:outline-none data-[state=open]:animate-pop-in look-new:rounded-2xl look-new:border-transparent look-new:bg-raise look-new:p-6 look-new:shadow-[var(--elev-3),0_0_0_1px_var(--line)] look-new:data-[state=open]:[animation:pop-in_var(--dur-base)_var(--motion-spring)]"
        >
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <D.Title className="text-[15px] font-semibold text-fg look-new:font-heading look-new:text-[18px] look-new:tracking-[-0.01em]">{title}</D.Title>
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
