// "Direction: …" beside Generate (the panels' scene toolbar) while the draft options hold a direction for the next draft,
// so it is never used unseen. It goes once a draft has started with it (store.ts, watchDraftDirections). Its words open
// the draft options; × clears it (with Undo).
import { useEffect } from 'react'
import type { ID } from '@shared/types'
import { X } from '@/components/ui/icons'
import { toast } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { tidyDirection } from '@shared/directions'
import { watchDraftDirections } from './store'

/** The direction the next Generate draft of the scene will be given (tidied), or ''. */
export function useNextDirection(sceneId: ID): string {
  useEffect(() => watchDraftDirections(), [])
  return useApp((s) => tidyDirection(s.draftOptions[sceneId]?.direction ?? ''))
}

/** Clears the scene's direction for the next draft, with Undo. */
export function clearNextDirection(sceneId: ID): void {
  const app = useApp.getState()
  const was = app.draftOptions[sceneId]?.direction ?? ''
  if (!was.trim()) return
  app.setDraftOptions(sceneId, { direction: '' })
  toast('Direction cleared.', {
    action: { label: 'Undo', run: () => useApp.getState().setDraftOptions(sceneId, { direction: was }) }
  })
}

export function DirectionLabel({
  sceneId,
  onOpen,
  className
}: {
  sceneId: ID
  /** Opens the draft options, to change it. */
  onOpen: () => void
  className?: string
}): React.JSX.Element | null {
  const direction = useNextDirection(sceneId)
  if (!direction) return null
  return (
    <span
      data-next-direction=""
      // As wide as the scene's toolbar has room for (it is sized by its own width: the header is a container), so
      // Generate always fits beside it; the words are cut short, and say it all on hover.
      className={cn(
        'inline-flex h-7 min-w-0 max-w-[150px] items-center rounded-md bg-accent-soft text-[12px] text-fg animate-fade-in @min-[760px]:max-w-[190px] @min-[840px]:max-w-[240px]',
        className
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        title={`The next draft follows this direction: “${direction}”. Click to change it.`}
        className="flex h-7 min-w-0 items-center gap-1 rounded-l-md pl-2 pr-1 outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--focus)]"
      >
        <span className="shrink-0 text-muted">Direction:</span>
        <span className="truncate">{direction}</span>
      </button>
      <button
        type="button"
        aria-label="Clear the direction"
        title="Clear the direction (the next draft goes by the scene card)"
        onClick={() => clearNextDirection(sceneId)}
        className="flex h-7 w-6 shrink-0 items-center justify-center rounded-r-md text-muted outline-none transition-colors duration-150 hover:bg-accent/15 hover:text-fg focus-visible:shadow-[inset_0_0_0_1.5px_var(--focus)]"
      >
        <X size={12} aria-hidden />
      </button>
    </span>
  )
}
