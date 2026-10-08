// Mark done (Ctrl+Enter) in the scene header. A scene marked done shows as Done, in green, and the
// same button reopens it. Its width never changes with its state, so nothing in the header moves.
import { Check, RotateCcw } from '@/components/ui/icons'
import { useEffect, useRef, useState } from 'react'
import type { ID, SceneStatus } from '@shared/types'
import { Spinner, toast } from '@/components/ui'
import { DrawnTick } from '@/components/ui/DrawnTick'
import { useNewLook } from '@/features/look/look'
import { modKey } from '@/lib/api'
import { cn } from '@/lib/cn'
import { layerOpen } from '@/lib/layers'
import { useApp } from '@/lib/store'
import { useDelayed } from '@/features/generate/parts'
import { markSceneDone, reopenScene } from './markDone'
import { onMarkDoneRequest, requestMarkDone } from './doneShortcut'

export function DoneButton({ sceneId, status }: { sceneId: ID; status: SceneStatus }): React.JSX.Element {
  const done = status === 'done'
  const isNew = useNewLook()
  // The New look: the tick draws itself when the scene is marked done (not when it opens done).
  const [justDone, setJustDone] = useState(false)
  const was = useRef({ done, sceneId })
  useEffect(() => {
    const before = was.current
    was.current = { done, sceneId }
    // Another scene opening (done or not) isn't this one being marked done.
    setJustDone(done && !before.done && before.sceneId === sceneId)
  }, [done, sceneId])
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
        'group flex h-8 w-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border text-[13px] font-medium outline-none',
        'transition-[background-color,border-color,color] duration-150 focus-visible:ring-2 focus-visible:ring-accent/40',
        // Room for the words only when the header is wide enough (see SceneHeader); the width then stays put in either state.
        '@min-[860px]:w-[112px] @min-[860px]:px-2.5',
        // The New look: its words show whenever there is room for them beside the tools, on one line. Both labels
        // fit the least width, so it stays put; a wider fallback font makes it grow rather than wrap.
        'look-new:@min-[540px]:w-auto look-new:@min-[540px]:min-w-[112px] look-new:@min-[540px]:px-3',
        // The New look: a raised pill that presses in quickly (90ms) and comes back up softly (220ms, with its colour).
        'look-new:h-[30px] look-new:rounded-full look-new:transition-[background-color,border-color,color,transform,scale] look-new:duration-(--dur-base) look-new:ease-glide look-new:active:duration-(--dur-press) look-new:active:scale-[0.96]',
        done
          ? 'border-success/35 bg-success-soft text-success hover:border-success/70 look-new:border-transparent look-new:bg-raise look-new:text-fg look-new:shadow-[var(--elev-1),inset_0_0_0_1px_var(--line)] look-new:hover:bg-raise'
          : 'border-line bg-surface text-fg hover:border-line-strong hover:bg-surface-2 look-new:border-transparent look-new:bg-raise look-new:shadow-[var(--elev-1),inset_0_0_0_1px_var(--line)] look-new:hover:bg-raise'
      )}
    >
      {slow ? (
        <Spinner size={14} />
      ) : done ? (
        <>
          {isNew ? (
            <DrawnTick size={15} draw={justDone} className="text-success" />
          ) : (
            <Check size={14} className="group-hover:hidden group-focus-visible:hidden" aria-hidden />
          )}
          <RotateCcw size={13} className="hidden group-hover:block group-focus-visible:block look-new:hidden!" aria-hidden />
        </>
      ) : (
        <Check size={14} aria-hidden />
      )}
      <span className="hidden @min-[860px]:inline look-new:@min-[540px]:inline">
        {done && isNew ? (
          // The New look: the status pill beside it says Done, so this says what it does.
          'Reopen'
        ) : done ? (
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
