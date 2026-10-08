// The desk's margin (UI overhaul, phase 3): notes like slips of paper tucked at the page's right edge, each level with
// the line it is about, with a hairline tether to its word. It lives inside the page's own scroll area, so the notes
// scroll with the words and nothing has to follow the scrolling. Notes are measured again only when something could
// have moved them: the window, the page or the sheet changing size (a line added or taken away, a re-wrap, the text size), a change
// that adds or takes away paragraphs, the notes themselves changing, and the fonts arriving; at most four times a second
// while a draft is being written. Typing inside a paragraph moves nothing. Notes that would overlap are pushed down
// (layoutNotes.ts) and glide there (220ms); notes that move with their words move at once. The words never move.
// Below about 1180px (deskFit.ts) the notes fold into small tabs on the sheet's edge that open each note as a pop-up.
// With the scene drawer open (it covers the margin) the notes step away; in focus mode they fade with the rest.
// Phase 3a has the foundation and its first note, the scene card pinned beside the title; entity, check and memory
// notes come next (D3.4, D3.5).
import type { Editor } from '@tiptap/core'
import * as P from '@radix-ui/react-popover'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { ID } from '@shared/types'
import { cn } from '@/lib/cn'
import { editorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'
import { keyboardDriven, reducedMotion } from '@/features/look/motion'
import { MARGIN } from '@/layout/desk/deskFit'
import { changesBlocks, posOfAnchor, type PlacedSlip } from './anchors'
import { layoutNotes } from './layoutNotes'
import { dismissedIn, useMarginStore } from './marginStore'
import { SceneCardSlip } from './slips/SceneCardSlip'
import { Tether } from './Tethers'

/** How far the scene card sits above the title's top (its head level with the eyebrow, its rows beside the title). */
const CARD_ABOVE_TITLE = 28
/** Where a note's tether meets it, down from its top (level with its head). */
const TETHER_Y = 18
/** While a draft is written, the notes are measured at most this often. */
const BUSY_MS = 250
/** A small tilt for each note, straightened on hover (desk.css). */
const TILTS = [-0.4, 0.3, -0.25, 0.2]

interface NoteGeo {
  /** Where it sits (px down the scroll area). */
  top: number
  /** Where it wanted to sit. */
  want: number
  /** The word it is about: where its tether starts. */
  wordX: number
  wordY: number
}

interface Geo {
  /** The notes' left edge (over the sheet's right edge), and the sheet's right edge. */
  left: number
  sheetRight: number
  width: number
  notes: Record<string, NoteGeo>
}

/** What a note shows, by its kind. */
function SlipBody({ slip, sceneId }: { slip: PlacedSlip; sceneId: ID }): React.JSX.Element | null {
  if (slip.kind === 'card') return <SceneCardSlip sceneId={sceneId} />
  return null
}

const LABELS: Partial<Record<PlacedSlip['kind'], string>> = { card: 'Scene card' }

export function MarginLayer({
  editor,
  sceneId,
  scrollerRef,
  sheetRef,
  mode,
  place
}: {
  editor: Editor
  sceneId: ID
  scrollerRef: RefObject<HTMLDivElement | null>
  sheetRef: RefObject<HTMLDivElement | null>
  mode: 'column' | 'tabs'
  /** Where the sheet lies (its left side and width): when it moves without changing size, the notes follow. */
  place: string
}): React.JSX.Element {
  const drawerOpen = useApp((s) => !!s.settings?.layout.inspectorOpen || s.askOpen)
  const dismissed = useMarginStore((s) => dismissedIn(s, sceneId))
  const fontSize = useApp((s) => s.settings?.editor.fontSize)
  const lineHeight = useApp((s) => s.settings?.editor.lineHeight)
  const pageWidth = useApp((s) => s.settings?.editor.pageWidth)

  // The notes to show. Phase 3a: the scene card, pinned beside the title.
  const slips = useMemo<PlacedSlip[]>(
    () => [{ id: 'card', kind: 'card' as const, anchor: 'top' as const, pinned: true }].filter((s) => !dismissed.includes(s.id)),
    [dismissed]
  )
  const slipKey = slips.map((s) => s.id).join(' ')

  const [geo, setGeo] = useState<Geo | null>(null)
  const geoRef = useRef<Geo | null>(null)
  const noteEls = useRef(new Map<string, HTMLDivElement>())
  const rootRef = useRef<HTMLDivElement>(null)
  const slipsRef = useRef(slips)
  slipsRef.current = slips

  /** Measures where each note's line is, and places the notes. */
  const measure = useCallback(() => {
    const scroller = scrollerRef.current
    const sheet = sheetRef.current
    if (!scroller || !sheet || editor.isDestroyed) return
    // Measured from the sheet's own place in the scroll area (its layout, not where it is drawn), so the sheet's rise as
    // the page arrives (a transform) never leaves the notes where the words were for a moment.
    const sheetBox = sheet.getBoundingClientRect()
    if (!sheetBox.width) return
    const y = (v: number): number => v - sheetBox.top + sheet.offsetTop
    const x = (v: number): number => v - sheetBox.left + sheet.offsetLeft
    const sheetRight = sheet.offsetLeft + sheet.offsetWidth
    const left = sheetRight - MARGIN.overlap
    const width = Math.max(200, Math.min(MARGIN.width, scroller.clientWidth - left - 8))
    const view = editor.view
    const textRight = x(view.dom.getBoundingClientRect().right)
    const wants: { id: string; want: number; height: number; pinned?: boolean; wordX: number; wordY: number }[] = []
    for (const slip of slipsRef.current) {
      let want: number
      let wordX: number
      let wordY: number
      if (slip.anchor === 'top') {
        const title = sheet.querySelector<HTMLElement>('.desk-scene-title') ?? sheet.querySelector<HTMLElement>('[data-page-title]')
        if (!title) continue
        const t = title.getBoundingClientRect()
        want = y(t.top) - CARD_ABOVE_TITLE
        wordX = x(t.right) + 14
        wordY = y(t.top + t.height / 2)
      } else {
        const pos = posOfAnchor(view.state.doc, slip.anchor)
        if (pos === null) continue
        let block: Element | null = null
        try {
          const dom = view.domAtPos(pos).node
          block = (dom instanceof Element ? dom : dom.parentElement)?.closest('[data-pid]') ?? null
        } catch {
          block = null
        }
        if (!block) continue
        want = y(block.getBoundingClientRect().top)
        try {
          const c = view.coordsAtPos(pos)
          wordY = y((c.top + c.bottom) / 2)
        } catch {
          wordY = want + 12
        }
        wordX = textRight + 6
      }
      const height = noteEls.current.get(slip.id)?.offsetHeight ?? 0
      wants.push({ id: slip.id, want: Math.round(want), height, pinned: slip.pinned, wordX: Math.round(wordX), wordY: Math.round(wordY) })
    }
    const tops = layoutNotes(wants)
    const notes: Record<string, NoteGeo> = {}
    for (const w of wants) notes[w.id] = { top: tops.get(w.id) ?? w.want, want: w.want, wordX: w.wordX, wordY: w.wordY }
    const next: Geo = { left: Math.round(left), sheetRight: Math.round(sheetRight), width: Math.round(width), notes }
    const was = geoRef.current
    if (was && JSON.stringify(was) === JSON.stringify(next)) return
    geoRef.current = next
    setGeo(next)
  }, [editor, scrollerRef, sheetRef])

  // Measuring is asked for often and done once a frame (and, while a draft is written, at most four times a second).
  const frame = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const last = useRef(0)
  const schedule = useCallback(() => {
    if (frame.current || timer.current) return
    const run = (): void => {
      frame.current = requestAnimationFrame(() => {
        frame.current = 0
        last.current = performance.now()
        measure()
      })
    }
    const wait = editorBridge()?.busy() ? BUSY_MS - (performance.now() - last.current) : 0
    if (wait > 0) {
      timer.current = setTimeout(() => {
        timer.current = undefined
        run()
      }, wait)
    } else run()
  }, [measure])

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current)
      clearTimeout(timer.current)
    },
    []
  )

  // What can move the notes: the page's size, the sheet's size, the notes' own sizes, paragraphs coming and going,
  // the fonts arriving, and the text settings.
  useEffect(() => {
    const ro = new ResizeObserver(schedule)
    ro.observe(editor.view.dom)
    if (sheetRef.current) ro.observe(sheetRef.current)
    // The window's size moves the sheet without changing its size.
    if (scrollerRef.current) ro.observe(scrollerRef.current)
    for (const el of noteEls.current.values()) ro.observe(el)
    const onTr = ({ transaction }: { transaction: Parameters<typeof changesBlocks>[0] }): void => {
      if (changesBlocks(transaction)) schedule()
    }
    editor.on('transaction', onTr)
    // The sheet glides across as the spine opens out or collapses (its sides are a transition): measured once it lands.
    const scroller = scrollerRef.current
    scroller?.addEventListener('transitionend', schedule)
    let live = true
    void document.fonts?.ready.then(() => live && schedule())
    return () => {
      live = false
      ro.disconnect()
      editor.off('transaction', onTr)
      scroller?.removeEventListener('transitionend', schedule)
    }
  }, [editor, sheetRef, scrollerRef, schedule, slipKey, sceneId])
  useLayoutEffect(() => {
    measure()
  }, [measure, slipKey, sceneId, mode, place, fontSize, lineHeight, pageWidth])

  // A note pushed along by the one above it glides there; a note that moved with its words moves at once.
  const placed = useRef(new Map<string, NoteGeo>())
  useLayoutEffect(() => {
    if (!geo) return
    const still = reducedMotion() || keyboardDriven()
    for (const [id, g] of Object.entries(geo.notes)) {
      const was = placed.current.get(id)
      placed.current.set(id, g)
      const el = noteEls.current.get(id)
      if (!was || !el || still) continue
      const pushed = g.top - g.want !== was.top - was.want
      const delta = was.top - g.top
      if (pushed && Math.abs(delta) > 1) {
        el.animate([{ translate: `0 ${delta}px` }, { translate: '0 0' }], { duration: 220, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' })
      }
    }
  }, [geo])

  const setNoteEl = (id: string) => (el: HTMLDivElement | null) => {
    if (el) noteEls.current.set(id, el)
    else noteEls.current.delete(id)
  }

  return (
    <div
      ref={rootRef}
      role="complementary"
      aria-label="Margin notes"
      data-desk-margin={mode}
      data-focus-chrome
      data-away={drawerOpen || undefined}
      className="desk-margin pointer-events-none absolute left-0 top-0 h-0 w-0"
    >
      {slips.map((slip, i) => {
        const g = geo?.notes[slip.id]
        const tilt = slip.kind === 'card' ? 0.35 : TILTS[i % TILTS.length]
        if (mode === 'tabs') {
          return (
            <P.Root key={slip.id}>
              <P.Trigger asChild>
                <button
                  type="button"
                  data-slip-tab={slip.id}
                  data-kind={slip.kind}
                  aria-label={LABELS[slip.kind] ?? 'Note'}
                  title={LABELS[slip.kind] ?? 'Note'}
                  className="desk-slip-tab pointer-events-auto absolute"
                  style={{
                    left: (geo?.sheetRight ?? 0) - 3,
                    top: (g?.want ?? 0) + (slip.anchor === 'top' ? CARD_ABOVE_TITLE : 0),
                    visibility: g ? undefined : 'hidden'
                  }}
                />
              </P.Trigger>
              <P.Portal>
                <P.Content
                  side="bottom"
                  align="end"
                  sideOffset={8}
                  collisionPadding={12}
                  className="desk-slip-pop z-40 w-[300px] data-[state=open]:animate-pop-in"
                >
                  <SlipBody slip={slip} sceneId={sceneId} />
                </P.Content>
              </P.Portal>
            </P.Root>
          )
        }
        return (
          <div
            key={slip.id}
            ref={setNoteEl(slip.id)}
            data-slip={slip.id}
            data-kind={slip.kind}
            className="desk-note pointer-events-auto absolute"
            style={{
              left: geo?.left ?? 0,
              top: g?.top ?? 0,
              width: geo?.width ?? MARGIN.width,
              visibility: g ? undefined : 'hidden',
              ['--slip-tilt' as string]: `${tilt}deg`
            }}
          >
            {g && geo ? <Tether x1={g.wordX - geo.left} y1={g.wordY - g.top} x2={0} y2={slip.kind === 'card' ? g.wordY - g.top : TETHER_Y} /> : null}
            <div className={cn('desk-slip', slip.kind === 'card' && 'is-card')}>
              <SlipBody slip={slip} sceneId={sceneId} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
