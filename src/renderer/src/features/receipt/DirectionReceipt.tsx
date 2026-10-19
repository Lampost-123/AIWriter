// The direction receipt (2026-10-19; receipt.ts): a small chip over the AI dock once a draft written with a direction has
// been checked, one mark for each of Adam's asks: "✓ Mira lies about the key · ✓ End on the knock · ○ More dialogue",
// with Write it in (a Continue from the end of the scene, steered by what didn't land) and a way to dismiss it. When
// every ask landed it is one quiet ✓ line that fades by itself. Gone once seen, dismissed or written in, when the next
// draft starts, and while Beat by beat has the foot of the page. What the AI saw shows the same for its draft
// (ReceiptInSaw). No AI call of its own: the check as the words land answers each ask.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ID } from '@shared/types'
import { toast } from '@/components/ui'
import { X } from '@/components/ui/icons'
import { api, onEvent } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { useBeats } from '@/features/beats/session'
import { continueAtEnd } from '@/features/edits/continue'
import { useDraft } from '@/features/generate/draftRun'
import { reducedMotion } from '@/features/look/motion'
import { allLanded, isFresh, receiptLabel, receiptOf, toWriteIn, writeInDirection, type Receipt } from './receipt'

/** How long a receipt where every ask landed stays before it fades. */
const LANDED_MS = 4_500
/** The chip's own exit (the desk's exit speed). */
const OUT_MS = 140

/** The drafts whose receipt was seen to the end, dismissed or written in: never shown again this session. */
const seen = new Set<ID>()

/** The latest receipt of the scene's drafts, while it is fresh and not seen; followed as the scene's issues change. */
function useReceipt(sceneId: ID): [Receipt | null, (r: Receipt | null) => void] {
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  useEffect(() => {
    let live = true
    setReceipt(null)
    const load = (): void => {
      api
        .getCheckReport(sceneId)
        .then((report) => {
          if (!live) return
          const got = receiptOf(report)
          const show = got && isFresh(got) && !seen.has(got.recordId) ? got : null
          // The same receipt read again keeps its place (and its fade).
          setReceipt((was) => (was && show && was.recordId === show.recordId && was.at === show.at ? was : show))
        })
        .catch(() => undefined)
    }
    load()
    const off = onEvent('issues:changed', (p) => {
      if (p.sceneIds.includes(sceneId)) load()
    })
    return () => {
      live = false
      off()
    }
  }, [sceneId])
  return [receipt, setReceipt]
}

/** The chip over the AI dock (the desk). */
export function DirectionReceipt({ sceneId }: { sceneId: ID }): React.JSX.Element | null {
  const [receipt, setReceipt] = useReceipt(sceneId)
  const [leaving, setLeaving] = useState(false)
  const drafting = useDraft((d) => d.sceneId === sceneId && d.phase !== 'idle')
  const beatsOn = useBeats((s) => s.session?.sceneId === sceneId)

  /** It goes (quickly, the way it came), and is never shown again. */
  const leave = useCallback(
    (r: Receipt, at = OUT_MS) => {
      seen.add(r.recordId)
      if (reducedMotion() || at === 0) {
        setReceipt(null)
        return
      }
      setLeaving(true)
      setTimeout(() => setReceipt(null), at)
    },
    [setReceipt]
  )
  const leaveRef = useRef(leave)
  leaveRef.current = leave

  useEffect(() => setLeaving(false), [receipt?.recordId])

  // Every ask landed: one quiet line that fades by itself.
  useEffect(() => {
    if (!receipt || !allLanded(receipt)) return
    const t = setTimeout(() => leaveRef.current(receipt), LANDED_MS)
    return () => clearTimeout(t)
  }, [receipt])

  // The next draft starts: this receipt was the last one's.
  useEffect(() => {
    if (drafting && receipt) leaveRef.current(receipt, 0)
  }, [drafting, receipt])

  if (!receipt || drafting || beatsOn) return null
  const done = allLanded(receipt)
  const missing = toWriteIn(receipt)
  const writeIn = (): void => {
    const direction = writeInDirection(receipt)
    if (!direction || useApp.getState().sceneId !== sceneId) return
    leave(receipt, 0)
    if (!continueAtEnd(direction)) toast('There are no words in this scene to carry on from yet.')
  }
  return (
    <div
      role="status"
      aria-label={receiptLabel(receipt)}
      data-direction-receipt={done ? 'landed' : 'missing'}
      data-focus-chrome
      className={cn('desk-chip pointer-events-auto min-w-0 overflow-hidden', !done && 'is-prompt', leaving && 'is-out')}
    >
      {done ? (
        <>
          <span aria-hidden className="shrink-0 font-semibold text-success">
            ✓
          </span>
          <span className="min-w-0 truncate" title={receipt.asks.map((a) => a.text).join(' · ')}>
            {receipt.asks.map((a) => a.text).join(' · ')}
          </span>
        </>
      ) : (
        <>
          <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
            {receipt.asks.map((a, i) => (
              // What landed gives up its room first: what didn't is what Adam needs to read.
              <span
                key={i}
                className={cn('flex items-center gap-1', a.landed ? 'min-w-[5.5ch] shrink' : 'max-w-[30ch] shrink-0')}
                data-ask={a.landed ? 'landed' : 'missing'}
              >
                {i > 0 ? (
                  <span aria-hidden className="mr-0.5 text-faint">
                    ·
                  </span>
                ) : null}
                <span aria-hidden className={cn('shrink-0', a.landed ? 'font-semibold text-success' : 'text-muted')}>
                  {a.landed ? '✓' : '○'}
                </span>
                <span className={cn('min-w-0 truncate', a.landed ? 'text-muted' : 'text-fg')} title={a.text}>
                  {a.text}
                </span>
              </span>
            ))}
          </span>
          {missing.length ? (
            <button
              type="button"
              className="desk-chip-btn shrink-0"
              title={`Continue from the end of the scene with: ${writeInDirection(receipt)}`}
              onClick={writeIn}
            >
              {missing.length === 1 ? 'Write it in' : 'Write them in'}
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Dismiss"
            title="Dismiss"
            className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-muted outline-none transition-colors duration-150 hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
            onClick={() => leave(receipt)}
          >
            <X size={12} aria-hidden />
          </button>
        </>
      )}
    </div>
  )
}

/** The same receipt in What the AI saw, under the direction, for the draft it was checked for. */
export function ReceiptInSaw({ rec }: { rec: { id: ID; sceneId: ID } }): React.JSX.Element | null {
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  useEffect(() => {
    let live = true
    api
      .getCheckReport(rec.sceneId)
      .then((report) => {
        const got = receiptOf(report)
        if (live) setReceipt(got?.recordId === rec.id ? got : null)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [rec.id, rec.sceneId])
  if (!receipt) return null
  return (
    <div role="group" aria-label="How the draft kept to your direction" data-direction-receipt="saw" className="mt-3 animate-fade-in">
      <p className="text-[12px] font-medium text-muted">How the draft kept to it, as checked when it landed</p>
      <ul className="mt-1.5 flex flex-col gap-1 text-[13px] leading-snug">
        {receipt.asks.map((a, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden className={cn('w-3 shrink-0', a.landed ? 'font-semibold text-success' : 'text-muted')}>
              {a.landed ? '✓' : '○'}
            </span>
            <span className="min-w-0 select-text text-fg">
              {a.text}
              <span className="text-faint"> · {a.landed ? 'in the draft' : a.kind === 'length' ? 'not kept to' : 'not in the draft'}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
