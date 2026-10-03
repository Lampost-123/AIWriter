// One button in the scene's slim toolbar (milestone 4: Variants, Beat by beat, History, Listen), so they
// all look and behave alike. Its words show when the header has room and it shrinks to its icon when not
// (the header is a size container: see SceneHeader). The tooltip always names it, with its shortcut.
import { forwardRef, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface ToolButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: ReactNode
  /** Its name, shown beside the icon when the header has room, and always its accessible name. */
  label: string
  /** Pressed in (a panel or mode it opens is showing). */
  active?: boolean
  /** The header width from which the words show beside the icon. */
  wordsFrom?: 'always' | 'wide' | 'never'
}

export const ToolButton = forwardRef<HTMLButtonElement, ToolButtonProps>(function ToolButton(
  { icon, label, active, wordsFrom = 'wide', className, title, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      title={title ?? label}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[12.5px] font-medium text-muted outline-none transition-colors duration-150',
        'hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-50',
        active && 'bg-surface-2 text-fg',
        className
      )}
      {...rest}
    >
      <span className="flex h-4 w-4 items-center justify-center" aria-hidden>
        {icon}
      </span>
      {wordsFrom === 'never' ? null : <span className={cn('pr-0.5', wordsFrom === 'wide' && 'hidden @min-[980px]:inline')}>{label}</span>}
    </button>
  )
})
