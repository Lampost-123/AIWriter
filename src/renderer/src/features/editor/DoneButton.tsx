// Mark done (Ctrl+Enter) in the scene header. A scene marked done shows as Done, in green, and the
// same button reopens it. Its width never changes with its state, so nothing in the header moves.
import { Check, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ID, SceneStatus } from '@shared/types'
import { Spinner, toast } from '@/components/ui'
import { modKey } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { useDelayed } from '@/features/generate/parts'
import { markSceneDone, reopenScene } from './markDone'
import { onMarkDoneRequest, requestMarkDone } from './doneShortcut'

/** Something else (a menu, a dialog, a popover) is open and keeps its own keys. */
const layerOpen = (): boolean => !!document.querySelector('[data-radix-popper-content-wrapper], [role="dialog"][data-state="open"]')

export function DoneButton({ sceneId, status }: { sceneId: ID; status: SceneStatus }): React.JSX.Element {
  const done = status === 'done'
  const [pending, setPending] = useState(false)
  // It takes a moment at most; the spinner only shows if it takes longer than that.
  const slow = useDelayed(pending, 250)
  const doneRef = useRef(done)
  doneRef.current = done
  const pendingRef = useRef(false)

  const run = useRef(async (fn: () => Promise<unknown>): Promise<void> => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    try {
      await fn()
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }).current

  // Ctrl+Enter, from the page (the editor passes it on) or anywhere else in the writing view.
  useEffect(() => {
    const off = onMarkDoneRequest(() => {
      if (doneRef.current) toast('This scene is already marked done.')
      else void run(() => markSceneDone(sceneId))
    })
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key !== 'Enter') return
      // A box that gives Ctrl+Enter its own meaning (the draft direction: Generate) has handled it already.
      if (e.defaultPrevented || e.repeat || layerOpen() || useApp.getState().view.kind !== 'write') return
      e.preventDefault()
      requestMarkDone()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      off()
      window.removeEventListener('keydown', onKey)
    }
  }, [sceneId, run])

  const shortcut = `${modKey()}+Enter`
  return (
    <button
      type="button"
      aria-label={done ? 'Done. Reopen this scene for more work' : `Mark scene done (${shortcut})`}
      title={done ? 'This scene is done. Click to reopen it for more work.' : `Mark scene done (${shortcut})`}
      // Not disabled while it works, so keyboard focus stays on it.
      aria-busy={pending || undefined}
      onClick={() => void run(() => (done ? reopenScene(sceneId) : markSceneDone(sceneId)))}
      className={cn(
        'group flex h-8 w-8 shrink-0 items-center justify-center gap-1.5 rounded-md border text-[13px] font-medium outline-none',
        'transition-[background-color,border-color,color] duration-150 focus-visible:ring-2 focus-visible:ring-accent/40',
        // Room for the words only when the header is wide enough (see SceneHeader); the width then stays put in either state.
        '@min-[700px]:w-[112px] @min-[700px]:px-2.5',
        done
          ? 'border-success/35 bg-success-soft text-success hover:border-success/70'
          : 'border-line bg-surface text-fg hover:border-line-strong hover:bg-surface-2'
      )}
    >
      {slow ? (
        <Spinner size={14} />
      ) : done ? (
        <>
          <Check size={14} className="group-hover:hidden group-focus-visible:hidden" aria-hidden />
          <RotateCcw size={13} className="hidden group-hover:block group-focus-visible:block" aria-hidden />
        </>
      ) : (
        <Check size={14} aria-hidden />
      )}
      <span className="hidden @min-[700px]:inline">
        {done ? (
          <>
            <span className="group-hover:hidden group-focus-visible:hidden">Done</span>
            <span className="hidden group-hover:inline group-focus-visible:inline">Reopen</span>
          </>
        ) : (
          'Mark done'
        )}
      </span>
    </button>
  )
}
