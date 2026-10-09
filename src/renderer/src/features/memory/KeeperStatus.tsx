// The memory, quietly, in the top bar: "Reading the scene…" while it reads, a short-lived "Memory
// updated" note after it changed something (it opens What changed), nothing when idle, and a quiet
// note when it can't run at all, with the reason and what to do. It sits in a slot that is always
// there and grows into the bar's free middle to fit its words, so nothing in the bar moves when it
// comes and goes. Nothing in it nags.
import * as P from '@radix-ui/react-popover'
import { Check, CircleAlert } from '@/components/ui/icons'
import { useEffect, useRef, useState } from 'react'
import { Button, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { plainReason } from '@/lib/reason'
import { useApp } from '@/lib/store'
import { PopoverPanel } from '@/features/generate/parts'
import { changesNote, freshUpdate, keeperState, pointsToSettings, readingNote } from './logic'
import { rereadProgress } from './reread'
import type { MemoryStatus } from '@shared/types'

/** How long "Memory updated" stays (longer while the pointer or keyboard is on it). */
const UPDATED_FOR = 30_000

/**
 * True once `on` has held for `after` ms, and then for at least `atLeast` ms, so a quick read
 * never flickers a word into the bar and straight out again.
 */
function useSteady(on: boolean, after = 600, atLeast = 1500): boolean {
  const [shown, setShown] = useState(false)
  const since = useRef(0)
  useEffect(() => {
    if (on && !shown) {
      const t = setTimeout(() => {
        since.current = Date.now()
        setShown(true)
      }, after)
      return () => clearTimeout(t)
    }
    if (!on && shown) {
      const t = setTimeout(() => setShown(false), Math.max(0, atLeast - (Date.now() - since.current)))
      return () => clearTimeout(t)
    }
    return undefined
  }, [on, shown, after, atLeast])
  return shown
}

const slotButton =
  'flex h-7 max-w-full items-center gap-2 rounded-md px-2 text-[12px] outline-none transition-colors duration-150 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/40 animate-fade-in'

/**
 * `quiet`: the desk's top bar, whose status island says "Memory · N changes" itself; this then shows only the reading
 * and the trouble, at its own width (nothing cut short).
 */
export function KeeperStatus({ quiet = false }: { quiet?: boolean }): React.JSX.Element {
  const status = useApp((s) => s.memoryStatus)
  const worldId = useApp((s) => s.world?.id ?? null)
  const navigate = useApp((s) => s.navigate)
  const state = keeperState(status)
  const reading = useSteady(state === 'reading')
  const [open, setOpen] = useState(false)
  const [retrying, setRetrying] = useState(false)

  // "Memory updated" is only for runs since this world was opened, and goes once seen or after a while.
  const opened = useRef({ worldId, at: Date.now() - 2000 })
  if (opened.current.worldId !== worldId) opened.current = { worldId, at: Date.now() - 2000 }
  const [seen, setSeen] = useState<string | null>(null)
  const [held, setHeld] = useState(false)
  const fresh = freshUpdate(status, seen, opened.current.at)
  const update = quiet ? null : fresh
  useEffect(() => {
    if (!update || held) return
    const t = setTimeout(() => setSeen(update.runId), UPDATED_FOR)
    return () => clearTimeout(t)
  }, [update?.runId, held])

  // The note closes by itself once the memory is running again.
  useEffect(() => {
    if (state !== 'error') setOpen(false)
  }, [state])

  const tryAgain = async (): Promise<void> => {
    setRetrying(true)
    try {
      await api.updateMemoryNow()
      setOpen(false)
    } catch (e) {
      toast(plainReason(e))
    } finally {
      setRetrying(false)
    }
  }

  const goTo = (view: Parameters<typeof navigate>[0]): void => {
    setOpen(false)
    navigate(view)
  }
  const openWhatChanged = (): void => {
    if (update) setSeen(update.runId)
    goTo({ kind: 'memory', sceneId: null })
  }

  return (
    // The slot keeps its room while empty and grows to fit its words (up to a limit, the rest in the tooltip): the free
    // middle of the bar gives way, so nothing to its right moves. Quiet (the desk's top bar, where the status island says
    // the rest): no room kept while empty.
    <div className={cn('flex max-w-[220px] shrink-0 justify-end', quiet ? 'min-w-0' : 'min-w-[176px] look-new:min-w-[128px]')} role="status" aria-live="polite">
      {state === 'error' && status?.error ? (
        <P.Root open={open} onOpenChange={setOpen}>
          <P.Trigger
            className={cn(slotButton, 'text-muted hover:text-fg data-[state=open]:bg-surface-2')}
            title="The memory isn't updating. Click to see why."
          >
            <CircleAlert size={14} className="shrink-0 text-ai" aria-hidden />
            <span className="truncate">Memory isn't updating</span>
          </P.Trigger>
          <PopoverPanel className="w-[320px]">
            <h3 className="text-[13.5px] font-semibold text-fg">The memory isn't updating</h3>
            <p className="mt-1 select-text text-[12.5px] leading-relaxed text-muted">{status.error}</p>
            <p className="mt-2 text-[12px] leading-relaxed text-faint">
              Your writing is safe. The memory catches up with every scene once this is sorted.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {pointsToSettings(status.error) ? (
                <Button variant="primary" size="sm" onClick={() => goTo({ kind: 'settings', tab: 'models' })}>
                  Open Settings › Models
                </Button>
              ) : null}
              <Button size="sm" loading={retrying} onClick={() => void tryAgain()}>
                Try again
              </Button>
              <button
                type="button"
                className="ml-auto rounded text-[12px] font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/40"
                onClick={openWhatChanged}
              >
                What changed
              </button>
            </div>
          </PopoverPanel>
        </P.Root>
      ) : status?.rereading ? (
        <RereadNote progress={status.rereading} onWhatChanged={openWhatChanged} />
      ) : reading && status ? (
        <button
          type="button"
          className={cn(slotButton, 'text-faint hover:text-muted')}
          title={status.reading ? readingNote(status) : undefined}
          onClick={openWhatChanged}
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-faint animate-pulse" aria-hidden />
          <span className="truncate">Reading the scene…</span>
        </button>
      ) : update ? (
        <button
          type="button"
          className={cn(slotButton, 'text-faint hover:text-muted')}
          title={`${changesNote(update.changes)}. Click to see what changed.`}
          onClick={openWhatChanged}
          onPointerEnter={() => setHeld(true)}
          onPointerLeave={() => setHeld(false)}
          onFocus={() => setHeld(true)}
          onBlur={() => setHeld(false)}
        >
          <Check size={13} className="shrink-0" aria-hidden />
          <span className="truncate">Memory updated</span>
        </button>
      ) : null}
    </div>
  )
}

/** A re-read Adam asked for (World Memory Overhaul B8): how far it has got, with Stop. */
function RereadNote({ progress, onWhatChanged }: { progress: NonNullable<MemoryStatus['rereading']>; onWhatChanged: () => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [stopping, setStopping] = useState(false)
  const stop = async (): Promise<void> => {
    setStopping(true)
    try {
      await api.stopReread()
      setOpen(false)
      toast('Stopped re-reading. What was read stays in the memory.')
    } catch (e) {
      toast(plainReason(e))
    } finally {
      setStopping(false)
    }
  }
  return (
    <P.Root open={open} onOpenChange={setOpen}>
      <P.Trigger
        className={cn(slotButton, 'text-faint hover:text-muted data-[state=open]:bg-surface-2')}
        title="The memory is reading again. Click to see how far it has got, or stop it."
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-faint animate-pulse" aria-hidden />
        <span className="truncate">{rereadProgress(progress)}</span>
      </P.Trigger>
      <PopoverPanel className="w-[300px]">
        <h3 className="text-[13.5px] font-semibold text-fg">Re-reading</h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
          {progress.total <= 1
            ? 'The memory is reading the scene again from the start.'
            : `The memory is reading ${progress.total} scenes again, one after another: ${progress.left} still to go.`}{' '}
          What it finds shows in What changed.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" loading={stopping} onClick={() => void stop()}>
            Stop
          </Button>
          <button
            type="button"
            className="ml-auto rounded text-[12px] font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/40"
            onClick={() => {
              setOpen(false)
              onWhatChanged()
            }}
          >
            What changed
          </button>
        </div>
      </PopoverPanel>
    </P.Root>
  )
}
