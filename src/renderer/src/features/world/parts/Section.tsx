import { ChevronRight } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** A collapsible group of fields. Closed sections don't render their fields, which keeps long forms quick. */
export function Section({
  title,
  meta,
  open,
  onToggle,
  children
}: {
  title: string
  meta?: ReactNode
  open: boolean
  onToggle: () => void
  children: ReactNode
}): React.JSX.Element {
  const contentId = useId()
  return (
    <section className="border-t border-line">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={onToggle}
        className="group flex h-11 w-full items-center gap-2 rounded-md text-left focus-visible:outline-offset-0"
      >
        <ChevronRight size={15} className={cn('shrink-0 text-faint transition-transform duration-150 group-hover:text-muted', open && 'rotate-90')} />
        <span className="flex-1 text-[13.5px] font-semibold text-fg">{title}</span>
        {meta ? <span className="text-[12px] tabular-nums text-faint">{meta}</span> : null}
      </button>
      {open ? (
        <div id={contentId} className="animate-fade-in pb-5 pl-[23px]">
          {children}
        </div>
      ) : null}
    </section>
  )
}
