// The direction receipt (2026-10-19; receipt.ts): a small chip over the AI dock once a draft written with a direction has
// been checked, one mark for each of Adam's asks: "✓ Mira lies about the key · ✓ End on the knock · ○ More dialogue",
// with Write it in (a Continue from the end of the scene, steered by what didn't land) and a way to dismiss it. When
// every ask landed it is one quiet ✓ line that fades by itself. Gone once seen, dismissed or written in, when the next
// draft starts, and while Beat by beat has the foot of the page. What the AI saw shows the same for its draft
// (ReceiptInSaw). No AI call of its own: the check as the words land answers each ask.
// With "Write in what a draft missed" on (autoWriteIn.ts), the app writes in what didn't land once by itself, as Write it
// in would, and the chip then says what was written in (the Continue waits below for Adam to keep or not).
// On the desk it lies over the AI dock; in the panels it has the foot of the page, in the band the director's line and
// the pointer to a draft below share (SceneView), taking the same turns (desk/dock/foot.ts).
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ID } from '@shared/types'
import { toast } from '@/components/ui'
import { X } from '@/components/ui/icons'
import { api, onEvent } from '@/lib/api'
import { cn } from '@/lib/cn'
import { editorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'
import { useBeats } from '@/features/beats/session'
import { continueAtEnd } from '@/features/edits/continue'
import { waitingSuggestion } from '@/features/edits/session'
import { useDraft } from '@/features/generate/draftRun'
import { usePolish } from '@/features/generate/polishRun'
import { reducedMotion } from '@/features/look/motion'
import { useDirector } from '@/features/director/store'
import { setReceiptShown, useFoot } from '@/features/desk/dock/foot'
import { allLanded, isFresh, receiptLabel, receiptOf, toWriteIn, writeInDirection, type Receipt } from './receipt'
import { autoWriteInFor, claimAutoWriteIn, markWrittenIn, wasClaimed, wasStartedHere, watchDraftsStarted, writtenInFor } from './autoWriteIn'

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

/** Nothing else is being written into the scene: no draft, no polish, no change waiting to be kept. */
function quietFor(sceneId: ID): boolean {
  const bridge = editorBridge()
  return (
    useApp.getState().sceneId === sceneId &&
    !!bridge &&
    bridge.sceneId === sceneId &&
    !bridge.busy() &&
    !waitingSuggestion() &&
    usePolish.getState().sceneId !== sceneId
  )
}

/** Where the receipt shows: over the desk's AI dock, or at the foot of the panels' page. */
type Place = 'desk' | 'panels'

/** The chip's own look: the desk's (desk.css .desk-chip), or a pill of the panels' own at the foot of the page. */
function chipClass(place: Place, o: { button: boolean; leaving: boolean }): string {
  if (place === 'desk') return cn('desk-chip pointer-events-auto min-w-0 overflow-hidden', o.button && 'is-prompt', o.leaving && 'is-out')
  return cn(
    'pointer-events-auto inline-flex h-8 min-w-0 max-w-full items-center gap-2 overflow-hidden whitespace-nowrap rounded-full border border-line bg-surface pl-3 text-[12.5px] leading-none text-muted shadow-pop',
    o.button ? 'pr-1' : 'pr-3.5',
    o.leaving ? 'animate-[fade-out_140ms_ease-out_forwards]' : 'animate-fade-in'
  )
}

/** Write it in: the desk's warm ink; in the panels the AI's amber, as the change box's own button. */
const WRITE_IN: Record<Place, string> = {
  desk: 'desk-chip-btn shrink-0',
  panels:
    'h-6 shrink-0 rounded-full bg-[linear-gradient(180deg,color-mix(in_srgb,var(--ai)_88%,white),var(--ai))] px-2.5 text-[11.5px] font-semibold text-ai-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.2),var(--elev-1)] outline-none transition-[filter,scale] duration-(--dur-quick) hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)] active:scale-[0.96] active:duration-(--dur-press)'
}

const DISMISS =
  'grid h-5 w-5 shrink-0 place-items-center rounded-full text-muted outline-none transition-colors duration-150 hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-[var(--focus)]'

/** The chip over the AI dock (the desk), or at the foot of the page (the panels). */
export function DirectionReceipt({ sceneId, place = 'desk' }: { sceneId: ID; place?: Place }): React.JSX.Element | null {
  const [receipt, setReceipt] = useReceipt(sceneId)
  const [leaving, setLeaving] = useState(false)
  const drafting = useDraft((d) => d.sceneId === sceneId && d.phase !== 'idle')
  const beatsOn = useBeats((s) => s.session?.sceneId === sceneId)
  const autoOn = useApp((s) => s.settings?.autoWriteIn === true)
  // What was written in by itself for the receipt's draft (kept for the session: autoWriteIn.ts).
  const [written, setWritten] = useState<string[] | null>(null)

  useEffect(() => watchDraftsStarted(), [])
  useEffect(() => setWritten(receipt ? writtenInFor(receipt.recordId) : null), [receipt])

  // Write in what a draft missed: once a draft, by itself, as Write it in would, when nothing else is being written here.
  useEffect(() => {
    if (!receipt || drafting || beatsOn) return
    const direction = autoWriteInFor(receipt, { on: autoOn, startedHere: wasStartedHere(receipt.recordId), claimed: wasClaimed(receipt.recordId) })
    if (!direction || !quietFor(sceneId) || !claimAutoWriteIn(receipt.recordId)) return
    if (!continueAtEnd(direction)) return
    markWrittenIn(receipt)
    setWritten(writtenInFor(receipt.recordId))
  }, [receipt, autoOn, drafting, beatsOn, sceneId])

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

  // The foot takes turns (desk/dock/foot.ts): the director's line first; the receipt, then the next-beat chip. While the
  // AI writes the receipt waits; while a change waits for Accept or Reject, only a receipt with nothing to press shows
  // (what was written in below, or every ask landed), so Accept and Reject are the dock's only choice.
  const directing = useDirector((d) => !!d.byScene[sceneId])
  const dockKind = useFoot((f) => f.dock[sceneId] ?? 'idle')
  const quietDock = dockKind === 'idle' || (dockKind === 'review' && !!receipt && (!!written?.length || allLanded(receipt)))
  const visible = !!receipt && !drafting && !beatsOn && !directing && quietDock
  useEffect(() => {
    setReceiptShown(sceneId, visible)
    return () => setReceiptShown(sceneId, false)
  }, [sceneId, visible])

  // Every ask landed: one quiet line that fades by itself, once it has been in sight for a moment.
  useEffect(() => {
    if (!receipt || !visible || !allLanded(receipt)) return
    const t = setTimeout(() => leaveRef.current(receipt), LANDED_MS)
    return () => clearTimeout(t)
  }, [receipt, visible])

  // The next draft starts: this receipt was the last one's.
  useEffect(() => {
    if (drafting && receipt) leaveRef.current(receipt, 0)
  }, [drafting, receipt])

  if (!visible || !receipt) return null
  if (written?.length) return <WrittenIn receipt={receipt} written={written} place={place} leaving={leaving} onDismiss={() => leave(receipt)} />
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
      className={chipClass(place, { button: !done, leaving })}
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
              className={WRITE_IN[place]}
              title={`Continue from the end of the scene with: ${writeInDirection(receipt)}`}
              onClick={writeIn}
            >
              {missing.length === 1 ? 'Write it in' : 'Write them in'}
            </button>
          ) : null}
          <button type="button" aria-label="Dismiss" title="Dismiss" className={DISMISS} onClick={() => leave(receipt)}>
            <X size={12} aria-hidden />
          </button>
        </>
      )}
    </div>
  )
}

/**
 * The receipt once what didn't land was written in by itself: each ask, "+" for one written in below (amber: the AI's
 * words, waiting to be kept or not, as any Continue), and a way to dismiss it.
 */
function WrittenIn({
  receipt,
  written,
  place,
  leaving,
  onDismiss
}: {
  receipt: Receipt
  written: string[]
  place: Place
  leaving: boolean
  onDismiss: () => void
}): React.JSX.Element {
  const isWritten = (text: string): boolean => written.includes(text)
  const label = `Your direction: ${receipt.asks
    .map((a) => `${a.text.replace(/[.!?]+$/, '')}, ${a.landed ? 'done' : isWritten(a.text) ? 'written in below for you to keep or not' : 'not yet'}`)
    .join('; ')}.`
  return (
    <div
      role="status"
      aria-label={label}
      data-direction-receipt="written"
      data-focus-chrome
      // (The panels' pill keeps the room after Dismiss its other prompts keep; the desk's chip keeps its own.)
      className={chipClass(place, { button: place === 'panels', leaving })}
    >
      <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        {receipt.asks.map((a, i) => (
          <span
            key={i}
            className={cn('flex items-center gap-1', a.landed ? 'min-w-[5.5ch] shrink' : 'max-w-[30ch] shrink-0')}
            data-ask={a.landed ? 'landed' : isWritten(a.text) ? 'written' : 'missing'}
          >
            {i > 0 ? (
              <span aria-hidden className="mr-0.5 text-faint">
                ·
              </span>
            ) : null}
            <span aria-hidden className={cn('shrink-0 font-semibold', a.landed ? 'text-success' : isWritten(a.text) ? 'text-ai' : 'font-normal text-muted')}>
              {a.landed ? '✓' : isWritten(a.text) ? '+' : '○'}
            </span>
            <span className={cn('min-w-0 truncate', a.landed ? 'text-muted' : 'text-fg')} title={a.text}>
              {a.text}
            </span>
          </span>
        ))}
      </span>
      <span className="shrink-0 text-[12px] text-faint">Written in below</span>
      <button type="button" aria-label="Dismiss" title="Dismiss" className={DISMISS} onClick={onDismiss}>
        <X size={12} aria-hidden />
      </button>
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
              <span className="text-faint">
                {' · '}
                {a.landed ? 'in the draft' : a.kind === 'length' ? 'not kept to' : 'not in the draft'}
                {!a.landed && writtenInFor(rec.id)?.includes(a.text) ? ', written in after it by itself' : ''}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
