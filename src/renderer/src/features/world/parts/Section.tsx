import { ChevronRight } from '@/components/ui/icons'
import { useId, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * What a section's heading says it holds. The New look says it as a number and a word, so the sections read alike:
 * "3 of 5 filled" for fields, "2 relationships" for a list (Classic keeps its "3 of 5" and "2"). Nothing when it
 * holds nothing.
 */
export function sectionMeta(n: number, one: string, many: string, of?: number): ReactNode {
  if (!n) return null
  return (
    <>
      {of === undefined ? n : `${n} of ${of}`}
      <span className="hidden look-new:inline"> {n === 1 || of !== undefined ? one : many}</span>
    </>
  )
}

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
  // Fade in only when Adam opens it, not every time a form with it already open appears.
  const [toggled, setToggled] = useState(false)
  return (
    <section className="border-t border-line">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => {
          setToggled(true)
          onToggle()
        }}
        className="group flex h-11 w-full items-center gap-2 rounded-md text-left focus-visible:outline-offset-0"
      >
        <ChevronRight size={15} className={cn('shrink-0 text-faint transition-transform duration-150 group-hover:text-muted', open && 'rotate-90')} />
        <span className="flex-1 text-[13.5px] font-semibold text-fg">{title}</span>
        {meta ? <span className="text-[12px] tabular-nums text-faint">{meta}</span> : null}
      </button>
      {open ? (
        <div id={contentId} className={cn('pb-5 pl-[23px]', toggled && 'animate-fade-in')}>
          {children}
        </div>
      ) : null}
    </section>
  )
}
