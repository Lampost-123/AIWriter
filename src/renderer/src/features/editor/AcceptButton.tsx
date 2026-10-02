// Accept (Ctrl+Enter) in the scene header. An accepted scene shows as done, in green, and the
// same button reopens it. Its width never changes with its state, so nothing in the header moves.
import { Check, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ID, SceneStatus } from '@shared/types'
import { Spinner, toast } from '@/components/ui'
import { modKey } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { useDelayed } from '@/features/generate/parts'
import { acceptScene, reopenScene } from './accept'
import { onAcceptRequest, requestAccept } from './acceptRequest'

/** Something else (a menu, a dialog, a popover) is open and keeps its own keys. */
const layerOpen = (): boolean => !!document.querySelector('[data-radix-popper-content-wrapper], [role="dialog"][data-state="open"]')

export function AcceptButton({ sceneId, status }: { sceneId: ID; status: SceneStatus }): React.JSX.Element {
  const accepted = status === 'done'
  const [pending, setPending] = useState(false)
  // Accepting takes a moment at most; the spinner only shows if it takes longer than that.
  const slow = useDelayed(pending, 250)
  const acceptedRef = useRef(accepted)
  acceptedRef.current = accepted

  const pendingRef = useRef(false)
  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    try {
      await fn()
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  // Ctrl+Enter, from the page (the editor passes it on) or anywhere else in the writing view.
  useEffect(() => {
    const off = onAcceptRequest(() => {
      if (acceptedRef.current) toast('This scene is already accepted.')
      else void run(() => acceptScene(sceneId))
    })
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key !== 'Enter') return
      // A box that gives Ctrl+Enter its own meaning (the draft direction: Generate) has handled it already.
      if (e.defaultPrevented || e.repeat || layerOpen() || useApp.getState().view.kind !== 'write') return
      e.preventDefault()
      requestAccept()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      off()
      window.removeEventListener('keydown', onKey)
    }
  }, [sceneId])

  const shortcut = `${modKey()}+Enter`
  return (
    <button
      type="button"
      aria-label={accepted ? 'Accepted. Reopen this scene for more work' : `Accept this scene (${shortcut})`}
      title={
        accepted
          ? 'This scene is accepted. Click to reopen it for more work.'
          : `Accept this scene (${shortcut}). The memory catches up with it in the background.`
      }
      // Not disabled while it works, so keyboard focus stays on it.
      aria-busy={pending || undefined}
      onClick={() => void run(() => (accepted ? reopenScene(sceneId) : acceptScene(sceneId)))}
      className={cn(
        'group flex h-8 w-8 shrink-0 items-center justify-center gap-1.5 rounded-md border text-[13px] font-medium outline-none',
        'transition-[background-color,border-color,color] duration-150 focus-visible:ring-2 focus-visible:ring-accent/40',
        // Room for the word only when the header is wide enough; the width then stays put in either state.
        '@min-[680px]:w-[104px] @min-[680px]:px-2.5',
        accepted
          ? 'border-success/35 bg-success-soft text-success hover:border-success/70'
          : 'border-line bg-surface text-fg hover:border-line-strong hover:bg-surface-2'
      )}
    >
      {slow ? (
        <Spinner size={14} />
      ) : accepted ? (
        <>
          <Check size={14} className="group-hover:hidden group-focus-visible:hidden" aria-hidden />
          <RotateCcw size={13} className="hidden group-hover:block group-focus-visible:block" aria-hidden />
        </>
      ) : (
        <Check size={14} aria-hidden />
      )}
      <span className="hidden @min-[680px]:inline">
        {accepted ? (
          <>
            <span className="group-hover:hidden group-focus-visible:hidden">Accepted</span>
            <span className="hidden group-hover:inline group-focus-visible:inline">Reopen</span>
          </>
        ) : (
          'Accept'
        )}
      </span>
    </button>
  )
}
