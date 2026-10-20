// Build with AI's Threads (2026-10-20): the story's open plot threads, overdue and due first (the promises ledger: when
// each is to be paid off, and those quiet for a long stretch), each with what it promises and how it stands, and Plan
// its payoff: the story line's box asks to move toward paying it off, the thread is ticked among the threads waiting,
// and the story line comes into view to plan it. The plot threads board is a click away for everything else (making,
// dropping, choosing when one is paid off).

import { useMemo } from 'react'
import type { ID } from '@shared/types'
import type { BoardThread } from '@shared/contracts/worldViews'
import { ArrowRight, Sparkles, Spool } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { dueWords, quietWords } from '@/features/threads/boardLogic'
import { openThreadsInOrder, threadUrgency } from './buildLogic'
import { seedPayoff } from './hubStore'

/** The most threads listed before "and N more on the board". */
const THREADS_MOST = 12

export function ThreadsSection({ storyId, threads, onPlan }: { storyId: ID; threads: BoardThread[] | null; onPlan: () => void }): React.JSX.Element {
  const open = useMemo(() => (threads ? openThreadsInOrder(threads) : null), [threads])
  const board = (): void => useApp.getState().navigate({ kind: 'threads' })
  const plan = (t: BoardThread): void => {
    seedPayoff(storyId, t)
    onPlan()
  }
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {open === null ? (
        <div className="build-world-wait" aria-hidden />
      ) : open.length ? (
        <ul className="build-threads" aria-label="Open plot threads">
          {open.slice(0, THREADS_MOST).map((t) => {
            const urgency = threadUrgency(t)
            const due = dueWords(t)
            const quiet = quietWords(t)
            const state = urgency === 'overdue' || urgency === 'due' ? due || 'Overdue' : urgency === 'quiet' ? `Quiet for ${quiet}` : due || (quiet ? `Last touched ${quiet} ago` : '')
            return (
              <li key={t.id} className={cn('build-thread', urgency && `is-${urgency}`)} data-thread-row={t.name}>
                <span className="build-thread-mark" aria-hidden>
                  <Spool size={13} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="build-thread-t">
                    <span className="build-thread-name">{t.name}</span>
                    {state ? <span className={cn('build-thread-state', urgency && `is-${urgency}`)}>{state}</span> : null}
                  </p>
                  {t.promise.trim() ? <p className="build-thread-p">{t.promise.trim()}</p> : null}
                  {t.setUp?.label ? <p className="build-thread-w">Set up in {t.setUp.label}</p> : null}
                </div>
                <button type="button" className="hub-row-btn" onClick={() => plan(t)} title="Plan what happens next so this thread moves toward its payoff" data-plan-payoff={t.id}>
                  <Sparkles size={12} aria-hidden />
                  Plan its payoff
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="build-panel-s">No plot threads are open yet. They open as the story sets them up, and the memory keeps track of each one.</p>
      )}
      <div className="build-panel-row">
        <button type="button" className="hub-link" onClick={board}>
          The plot threads board
          <ArrowRight size={12} aria-hidden />
        </button>
        {open && open.length > THREADS_MOST ? <span className="hub-go-s">and {open.length - THREADS_MOST} more there</span> : null}
      </div>
    </div>
  )
}
