// The desk's story board, the Plan room's front page (UI overhaul, D5.2): the story's scenes as index cards pinned in a
// column for each chapter, the plot threads as coloured strings from pin to pin (a knot where one is paid off, an arrow
// where it runs on). The strings explain themselves (Adam: "can you explain the logic of these connections?"): a tag
// with the thread's name where it starts, "resolved here" by its knot or "still open" by its arrow, and a line when the
// pointer is on one; hovering a string picks it out, clicking it opens the thread. The legend of the threads sits over
// the board with a line on what the strings are, and the first time a hint says how to read them. Pins say where each
// scene stands, and say so on hover: done green, drafted grey, planned hollow, planned from an AI idea amber. A card opens its scene; its ⋯
// opens its card in the drawer; dragged, it moves (the others make room), with Undo. Cards | Outline switches to a
// compact list. The board scrolls both ways inside the room, so it sits beside the story's spine at any window size.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { CodexCard } from '@shared/contracts/entryViews'
import type { BoardMarks, BoardSceneCard, ThreadsBoard } from '@shared/contracts/worldViews'
import type { ID, Outline, SceneMeta } from '@shared/types'
import { Check, Plus, Sparkles } from '@/components/ui/icons'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import * as actions from '@/features/binder/actions'
import { useOutline, useOutlineStore } from '@/features/binder/outlineStore'
import { keyboardDriven, reducedMotion } from '@/features/look/motion'
import { openOutlineHelper } from '@/features/outline/open'
import { useArrival } from '@/layout/desk/arrival'
import { chapterShelf, scenesOf, storyStats } from '@/features/desk/home/homeLogic'
import { chapterNumeral } from '@/features/desk/spine/spineLayout'
import { numberWords } from '@shared/numberWords'
import { setFocusThread as setFocus, setHoverThread as setHover, useBoardStore } from './boardStore'
import { useEntryMotifs } from '@/features/world/art/artStore'
import { addSceneTo } from './boardActions'
import { IdeasDrawer, ideasForWhatComesNext, openIdeasFor } from './IdeasDrawer'
import { BoardOutline } from './BoardOutline'
import { boardLayout, CARD_H, CARD_W, dropTarget, HEAD_H, makeRoom, PAD_TOP, type BoardLayout, type ThreadIn } from './boardLayout'
import { BoardCard, Pin, pinOf, type PinKind } from './BoardCard'
import { shortName, stringLine, stringTags } from './stringNotes'
import './board.css'
import './strings.css'

const fmt = (x: number): string => x.toLocaleString('en-GB')

/** Loads something for the board, again whenever `deps` change; the last value stays while the next loads. */
export function useBoardData<T>(load: () => Promise<T> | null, deps: unknown[]): T | null {
  const [value, setValue] = useState<T | null>(null)
  const key = JSON.stringify(deps)
  useEffect(() => {
    let live = true
    const p = load()
    if (!p) return
    p.then((v) => live && setValue(v)).catch(() => undefined)
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return value
}

/** The threads for the strings: where each is set up and paid off, from the cards and the memory. */
export function threadsIn(board: ThreadsBoard | null, cards: Record<ID, BoardSceneCard> | null): ThreadIn[] {
  if (!board) return []
  return board.threads.map((t) => {
    const ids = new Set<ID>()
    if (t.setUp?.sceneId) ids.add(t.setUp.sceneId)
    if (t.paidOff?.sceneId) ids.add(t.paidOff.sceneId)
    let paid = t.paidOff?.sceneId ?? null
    for (const [sceneId, c] of Object.entries(cards ?? {})) {
      if (c.setsUpIds.includes(t.id)) ids.add(sceneId)
      if (c.paysOffIds.includes(t.id)) {
        ids.add(sceneId)
        paid ??= sceneId
      }
    }
    return { id: t.id, sceneIds: [...ids], paidOffSceneId: paid, open: t.column !== 'resolved' }
  })
}

/** Moves a scene in the outline on screen at once (the move itself follows), so the card never jumps back first. */
function moveOnScreen(o: Outline, id: ID, chapterId: ID, index: number): Outline {
  const scene = o.scenes.find((s) => s.id === id)
  if (!scene) return o
  const from = scene.chapterId
  const target = scenesOf(o, chapterId).filter((s) => s.id !== id)
  target.splice(Math.max(0, Math.min(index, target.length)), 0, { ...scene, chapterId })
  const renumber = (list: SceneMeta[]): SceneMeta[] => list.map((s, position) => ({ ...s, position }))
  const left = from === chapterId ? [] : renumber(scenesOf(o, from).filter((s) => s.id !== id))
  const moved = new Map([...renumber(target), ...left].map((s) => [s.id, s]))
  return { ...o, scenes: o.scenes.map((s) => moved.get(s.id) ?? s) }
}

interface Drag {
  id: ID
  /** Where the pointer went down, in screen pixels, and the card's offset from it. */
  startX: number
  startY: number
  dx: number
  dy: number
  /** Moved far enough to be a drag (not a click). */
  moving: boolean
  pointerId: number
}

export function StoryBoard({ storyId, chapterId, ideasFor }: { storyId: ID; chapterId?: ID; ideasFor?: ID }): React.JSX.Element {
  const { outline } = useOutline()
  const sceneId = useApp((s) => s.sceneId)
  const outlineRev = useApp((s) => s.outlineRev)
  const briefingRev = useApp((s) => s.briefingRev)
  const memoryRev = useApp((s) => s.memoryRev)
  const entriesRev = useApp((s) => s.entriesRev)
  const view = useBoardStore((s) => s.view)
  const arriving = useArrival('board')

  const cards = useBoardData(() => api.listSceneCards(storyId), [storyId, outlineRev, briefingRev])
  const board = useBoardData(() => api.getThreadsBoard(storyId), [storyId, outlineRev, briefingRev, memoryRev])
  const codex = useBoardData<CodexCard[]>(() => api.listCodex(), [entriesRev, memoryRev])
  const marksRev = useBoardStore((s) => s.marksRev)
  const marks = useBoardData<BoardMarks>(() => api.getBoardMarks(), [outlineRev, marksRev])
  const people = useMemo(() => new Map((codex ?? []).map((c) => [c.id, c])), [codex])
  const ai = useMemo(() => new Set(marks?.aiIdeas ?? []), [marks])

  const columns = useMemo(() => (outline ? outline.chapters.map((c) => ({ id: c.id, sceneIds: scenesOf(outline, c.id).map((s) => s.id) })) : []), [outline])
  const threads = useMemo(() => threadsIn(board, cards), [board, cards])
  const layout = useMemo(() => boardLayout(columns, threads), [columns, threads])
  const stats = outline ? storyStats(outline) : null
  const drawerFor = useBoardStore((s) => s.ideasFor)
  const empty = (id: ID): boolean => cards?.[id]?.empty ?? true
  // Opened from the plot threads board's "Plan its pay-off": the drawer for what comes next, aimed at that thread.
  const ideasNext = useBoardStore((s) => s.ideasNext)
  useEffect(() => {
    if (!ideasNext || !outline || !cards) return
    useBoardStore.setState({ ideasNext: false })
    void ideasForWhatComesNext(outline, (id) => cards[id]?.empty ?? true)
  }, [ideasNext, outline, cards])
  // Nothing is picked out when the board opens again.
  useEffect(() => () => useBoardStore.setState({ focus: null, hover: null }), [])
  // Opened from the home's "Add to the plan": the drawer for that scene.
  useEffect(() => {
    if (ideasFor) openIdeasFor(ideasFor)
    return () => useBoardStore.setState({ ideasFor: null })
  }, [ideasFor])

  return (
    // (No heading of its own: the room's "Plan" above it is the page's name, and the room's links say Story board.)
    <div data-desk-board data-arrive={arriving || undefined} role="region" aria-label="Story board" className="desk-board">
      <div className="board-head">
        <div className="board-head-l min-w-0">
          {stats ? (
            <p className="board-meta tabular-nums">
              {fmt(stats.chapters)} {stats.chapters === 1 ? 'chapter' : 'chapters'} · {fmt(stats.scenes)} {stats.scenes === 1 ? 'scene' : 'scenes'} ·{' '}
              {fmt(stats.words)} words
            </p>
          ) : null}
          {/* The plot threads, beside the board's buttons: hover one to pick out its string; click to keep it picked. */}
          {view === 'cards' && board ? <Legend threads={board.threads} drawn={new Set(layout.strings.map((s) => s.id))} /> : null}
        </div>
        <div className="board-ctl">
          <ViewSwitch />
          <button type="button" className="board-btn-pri" onClick={() => void newScene(outline, sceneId)}>
            <Plus size={15} />
            <span>New scene</span>
          </button>
          <button type="button" className="board-btn-ai" aria-expanded={!!drawerFor} disabled={!outline?.chapters.length} onClick={() => outline && void ideasForWhatComesNext(outline, empty)}>
            <Sparkles size={15} />
            <span>Ideas for what comes next</span>
          </button>
        </div>
      </div>
      {view === 'cards' && board ? <BoardNote strings={layout.strings.length > 0} /> : null}
      <div className="board-body">
        {outline ? (
          view === 'outline' ? (
            <BoardOutline outline={outline} cards={cards} people={people} ai={ai} />
          ) : (
            <Cards outline={outline} layout={layout} cards={cards} people={people} ai={ai} board={board} chapterId={chapterId} storyId={storyId} />
          )
        ) : null}
        {outline ? <IdeasDrawer outline={outline} people={codex ?? []} /> : null}
      </div>
    </div>
  )
}

/** A planned scene at the end of the chapter Adam is in (or the last), staying on the board. */
async function newScene(outline: Outline | null, sceneId: ID | null): Promise<void> {
  if (!outline) return
  const here = outline.scenes.find((s) => s.id === sceneId)?.chapterId ?? outline.chapters[outline.chapters.length - 1]?.id
  if (!here) return
  await addSceneTo(here)
}

/** Cards | Outline: a paper pill glides between them. */
function ViewSwitch(): React.JSX.Element {
  const view = useBoardStore((s) => s.view)
  const set = (v: 'cards' | 'outline'): void => useBoardStore.setState({ view: v })
  return (
    <div className="board-seg" role="group" aria-label="Show the story as">
      <span className={cn('board-seg-pill', view === 'outline' && 'is-right')} aria-hidden />
      <button type="button" className={cn('board-seg-btn', view === 'cards' && 'is-on')} aria-pressed={view === 'cards'} onClick={() => set('cards')}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3.5" y="4.5" width="7.5" height="15" rx="1.5" />
          <rect x="13" y="4.5" width="7.5" height="9" rx="1.5" />
        </svg>
        <span>Cards</span>
      </button>
      <button type="button" className={cn('board-seg-btn', view === 'outline' && 'is-on')} aria-pressed={view === 'outline'} onClick={() => set('outline')}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M9.5 7h10.5M9.5 12h10.5M9.5 17h10.5" />
          <circle cx="5" cy="7" r="1.1" />
          <circle cx="5" cy="12" r="1.1" />
          <circle cx="5" cy="17" r="1.1" />
        </svg>
        <span>Outline</span>
      </button>
    </div>
  )
}

function Cards({
  outline,
  layout,
  cards,
  people,
  ai,
  board,
  chapterId,
  storyId
}: {
  outline: Outline
  layout: BoardLayout
  cards: Record<ID, BoardSceneCard> | null
  people: Map<ID, CodexCard>
  ai: Set<ID>
  board: ThreadsBoard | null
  chapterId?: ID
  storyId: ID
}): React.JSX.Element {
  const scroller = useRef<HTMLDivElement>(null)
  const sceneId = useApp((s) => s.sceneId)
  const fresh = useBoardStore((s) => s.fresh)
  const focus = useBoardStore((s) => s.focus)
  const hover = useBoardStore((s) => s.hover)
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  dragRef.current = drag
  const justDragged = useRef(false)
  const shelf = useMemo(() => chapterShelf(outline, sceneId), [outline, sceneId])
  const scenes = useMemo(() => new Map(outline.scenes.map((s) => [s.id, s])), [outline])
  const motifs = useEntryMotifs()
  const lit = hover ?? focus
  const litScenes = new Set(lit ? (layout.strings.find((s) => s.id === lit)?.sceneIds ?? []) : [])
  // What the strings say about themselves: their tags, and the line under the pointer.
  const threadInfo = useMemo(() => new Map(threadsIn(board, cards).map((t) => [t.id, t])), [board, cards])
  const names = useMemo(() => new Map((board?.threads ?? []).map((t) => [t.id, t.name])), [board])
  const tags = useMemo(() => stringTags(layout), [layout])
  const canvas = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<{ id: ID; x: number; y: number } | null>(null)
  const lineOf = (id: ID): string => {
    const s = layout.strings.find((x) => x.id === id)
    const t = threadInfo.get(id)
    return s ? stringLine(layout, s, names.get(id) ?? 'A plot thread', t?.paidOffSceneId ?? null, t?.open ?? true) : ''
  }
  const tipAt = (id: ID, e: React.PointerEvent): void => {
    const r = canvas.current?.getBoundingClientRect()
    if (r) setTip({ id, x: e.clientX - r.left, y: e.clientY - r.top })
  }
  // Opened from the plot threads board's "Open on the story board": that thread picked out, its string in view.
  const focusThread = useBoardStore((s) => s.focusThread)
  useEffect(() => {
    if (!focusThread) return
    useBoardStore.setState({ focusThread: null })
    setFocus(focusThread)
    const s = layout.strings.find((x) => x.id === focusThread)
    const el = scroller.current
    if (s && el) el.scrollLeft = Math.max(0, s.start.x - 160)
  }, [focusThread, layout])

  // The chapter asked for (from the home's shelf), or Adam's own, in view; a new card too.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const want = chapterId ?? outline.scenes.find((s) => s.id === sceneId)?.chapterId
    const col = layout.columns.find((c) => c.id === want)
    if (col && col.x + CARD_W > el.clientWidth) el.scrollLeft = col.x - 40
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId])
  useEffect(() => {
    if (!fresh) return
    const box = layout.cards.get(fresh)
    const el = scroller.current
    if (!box || !el) return
    el.scrollTo({ left: Math.max(0, box.x - 80), top: Math.max(0, box.y - 120), behavior: reducedMotion() || keyboardDriven() ? 'auto' : 'smooth' })
    const t = setTimeout(() => useBoardStore.setState({ fresh: null }), 1400)
    return () => clearTimeout(t)
  }, [fresh, layout])

  // A used idea's card flies from the drawer to its place on the board.
  const flyFrom = useBoardStore((s) => s.flyFrom)
  useEffect(() => {
    if (!flyFrom) return
    useBoardStore.setState({ flyFrom: null })
    const el = scroller.current?.querySelector<HTMLElement>(`[data-board-card="${CSS.escape(flyFrom.sceneId)}"]`)
    const box = layout.cards.get(flyFrom.sceneId)
    if (!el || !box || !scroller.current) return
    const sc = scroller.current
    if (box.x < sc.scrollLeft || box.x + CARD_W > sc.scrollLeft + sc.clientWidth) sc.scrollLeft = Math.max(0, box.x - 80)
    if (box.y < sc.scrollTop || box.y + CARD_H > sc.scrollTop + sc.clientHeight) sc.scrollTop = Math.max(0, box.y - 80)
    const to = el.getBoundingClientRect()
    const from = flyFrom.rect
    const s = from.width / to.width
    const spring = getComputedStyle(el).getPropertyValue('--motion-spring').trim() || 'cubic-bezier(0.2, 0.8, 0.2, 1)'
    el.animate(
      [
        { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${s}) rotate(3deg)`, opacity: 0.7 },
        { transform: `rotate(${box.tilt}deg)`, opacity: 1 }
      ],
      { duration: 520, easing: spring }
    )
  }, [flyFrom, layout])

  // Where the dragged card would land, and the others making room.
  const target = useMemo(() => {
    if (!drag?.moving) return null
    const box = layout.cards.get(drag.id)
    if (!box) return null
    return dropTarget(layout, { x: box.x + CARD_W / 2 + drag.dx, y: box.y + CARD_H / 2 + drag.dy }, drag.id)
  }, [drag, layout])
  const room = useMemo(() => (drag?.moving ? makeRoom(layout, drag.id, target) : new Map<ID, number>()), [drag, layout, target])

  const startDrag = (e: ReactPointerEvent<HTMLElement>, id: ID): void => {
    if (e.button !== 0) return
    setDrag({ id, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, moving: false, pointerId: e.pointerId })
  }
  useEffect(() => {
    if (!drag) return
    const el = scroller.current
    const startScroll = { left: el?.scrollLeft ?? 0, top: el?.scrollTop ?? 0 }
    const move = (e: PointerEvent): void => {
      const d = dragRef.current
      if (!d || e.pointerId !== d.pointerId) return
      const dx = e.clientX - d.startX + (el ? el.scrollLeft - startScroll.left : 0)
      const dy = e.clientY - d.startY + (el ? el.scrollTop - startScroll.top : 0)
      const moving = d.moving || Math.hypot(dx, dy) > 5
      if (moving && el) {
        // Near the board's edge, it scrolls on.
        const r = el.getBoundingClientRect()
        if (e.clientX > r.right - 48) el.scrollLeft += 14
        else if (e.clientX < r.left + 48) el.scrollLeft -= 14
        if (e.clientY > r.bottom - 40) el.scrollTop += 12
        else if (e.clientY < r.top + 40) el.scrollTop -= 12
      }
      setDrag({ ...d, dx, dy, moving })
    }
    const end = (e: PointerEvent): void => {
      const d = dragRef.current
      if (!d || e.pointerId !== d.pointerId) return
      setDrag(null)
      if (!d.moving) return
      justDragged.current = true
      setTimeout(() => (justDragged.current = false), 0)
      const box = layout.cards.get(d.id)
      const t = box ? dropTarget(layout, { x: box.x + CARD_W / 2 + d.dx, y: box.y + CARD_H / 2 + d.dy }, d.id) : null
      if (!t || !box || (t.chapterId === box.chapterId && t.index === box.index)) return
      void moveCard(d.id, t.chapterId, t.index)
    }
    const cancel = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      const d = dragRef.current
      setDrag(null)
      // Let go after Esc, the card isn't clicked open.
      if (d?.moving) {
        const swallow = (ev: Event): void => {
          ev.stopPropagation()
          ev.preventDefault()
        }
        window.addEventListener('click', swallow, { capture: true, once: true })
        setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 2000)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    window.addEventListener('keydown', cancel)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      window.removeEventListener('keydown', cancel)
    }
    // Only when a drag starts or ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.id, drag?.pointerId, layout])

  /** From the keyboard: Alt+↑/↓ within its chapter, Alt+←/→ to the chapter before or after. */
  const keyMove = (e: React.KeyboardEvent, id: ID): void => {
    if (!e.altKey || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return
    e.preventDefault()
    const box = layout.cards.get(id)
    if (!box) return
    const ci = layout.columns.findIndex((c) => c.id === box.chapterId)
    const count = (cid: ID): number => [...layout.cards.values()].filter((c) => c.chapterId === cid).length
    if (e.key === 'ArrowUp' && box.index > 0) void moveCard(id, box.chapterId, box.index - 1)
    if (e.key === 'ArrowDown' && box.index < count(box.chapterId) - 1) void moveCard(id, box.chapterId, box.index + 1)
    const other = layout.columns[ci + (e.key === 'ArrowLeft' ? -1 : 1)]
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && other) void moveCard(id, other.id, Math.min(box.index, count(other.id)))
  }

  return (
    <div className={cn('board-wrap', drag?.moving && 'is-dragging')}>
      <div ref={scroller} className="board-scroller" data-board-scroller>
        <div ref={canvas} className="board-canvas" style={{ width: layout.width, height: layout.height }} data-lit={lit ?? undefined}>
          {layout.columns.map((col, i) => {
            const c = shelf[i]
            const total = c?.scenes.length ?? 0
            return (
              <div key={col.id} className="board-colhead" style={{ left: col.x, top: PAD_TOP, '--d': `${100 + i * 70}ms` } as CSSProperties} data-board-chapter={col.id}>
                <span className="board-numeral">{c?.numeral}</span>
                <span className="desk-caps board-ch-label">{c?.label}</span>
                <span className={cn('board-ch-title', !c?.title && 'is-untitled')}>{c?.title || 'Untitled'}</span>
                <span className="board-prog" aria-hidden>
                  <i style={{ transform: `scaleX(${total ? (c?.done ?? 0) / total : 0})` }} />
                </span>
                <span className="board-prog-l tabular-nums">{total ? `${c?.done} of ${total} done` : 'No scenes yet'}</span>
              </div>
            )
          })}
          {layout.columns.map((col, i) => (
            <button
              key={`g-${col.id}`}
              type="button"
              className="board-ghost"
              style={{ left: col.ghost.x, top: col.ghost.y, width: col.ghost.w, height: col.ghost.h, '--d': `${260 + i * 70}ms` } as CSSProperties}
              onClick={() => void addSceneTo(col.id)}
            >
              <span className="board-gh-plus">
                <Plus size={16} />
              </span>
              <span className="board-gh-title">Add a scene</span>
            </button>
          ))}
          <NextChapter layout={layout} outline={outline} storyId={storyId} />

          {[...layout.cards.values()].map((box, i) => {
            const scene = scenes.get(box.id)
            if (!scene) return null
            const dragging = drag?.moving && drag.id === box.id
            const shift = room.get(box.id) ?? 0
            return (
              <BoardCard
                key={box.id}
                box={box}
                scene={scene}
                card={cards?.[box.id] ?? null}
                people={people}
                ai={ai.has(box.id) && scene.wordCount === 0}
                current={box.id === sceneId}
                fresh={box.id === fresh}
                lifted={litScenes.has(box.id)}
                delay={260 + i * 40}
                style={
                  dragging
                    ? { transform: `translate(${drag.dx}px, ${drag.dy}px) rotate(1.5deg) scale(1.03)`, zIndex: 20, transition: 'none' }
                    : shift
                      ? { transform: `translateY(${shift}px) rotate(${box.tilt}deg)` }
                      : undefined
                }
                dragging={!!dragging}
                onPointerDown={(e) => startDrag(e, box.id)}
                onOpen={() => {
                  if (justDragged.current) return
                  useApp.getState().selectScene(box.id)
                }}
                onKeyDown={(e) => keyMove(e, box.id)}
                placeMotif={cards?.[box.id]?.locationId ? motifs.get(cards[box.id].locationId!) : undefined}
                onIdeas={scene.status === 'planned' && scene.wordCount === 0 && (cards?.[box.id]?.empty ?? false) ? () => openIdeasFor(box.id) : undefined}
              />
            )
          })}

          <svg className="board-strings" width={layout.width} height={layout.height} aria-hidden>
            <defs>
              <radialGradient id="board-open-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0" stopColor="currentColor" stopOpacity=".7" />
                <stop offset="1" stopColor="currentColor" stopOpacity="0" />
              </radialGradient>
            </defs>
            {layout.strings.map((s, i) => (
              <g key={s.id} className={cn('board-str', lit && lit !== s.id && 'is-dim', lit === s.id && 'is-lit')} style={{ color: `var(--thread-${s.ink})`, '--d': `${900 + i * 150}ms` } as CSSProperties} data-thread={s.id}>
                <path className="s-halo" d={s.d} />
                <path className="s-sh" d={s.d} pathLength={1} />
                <path className="s-main" d={s.d} pathLength={1} />
                {s.knot ? (
                  <g className="s-knot">
                    <circle cx={s.knot.x} cy={s.knot.y} r={3.3} />
                    <path d={`M${s.knot.x - 2.4} ${s.knot.y + 2.6}q-2.6 3.2 -6.6 4`} />
                  </g>
                ) : null}
                {s.end ? (
                  <g className="s-end">
                    <circle className="s-end-glow" cx={s.end.x} cy={s.end.y} r={12} fill="url(#board-open-glow)" />
                    <path className="s-arrow" d={`M${s.end.x - 8} ${s.end.y - 5.5} L${s.end.x + 1} ${s.end.y} L${s.end.x - 8} ${s.end.y + 5.5}`} />
                  </g>
                ) : null}
                {/* Under the pointer: picks the string out, says what it is, and opens the thread. */}
                <path
                  className="s-hit"
                  d={s.d}
                  onPointerEnter={(e) => {
                    setHover(s.id)
                    tipAt(s.id, e)
                  }}
                  onPointerMove={(e) => tipAt(s.id, e)}
                  onPointerLeave={() => {
                    setHover(null)
                    setTip(null)
                  }}
                  onClick={() => openThread(s.id)}
                />
              </g>
            ))}
          </svg>
          {tags.map((t) => {
            const ink = layout.strings.find((s) => s.id === t.id)?.ink ?? 1
            const name = names.get(t.id) ?? 'A plot thread'
            return (
              <button
                key={`${t.kind}-${t.id}`}
                type="button"
                data-thread-tag={t.id}
                data-tag={t.kind}
                className={cn('board-tag', `is-${t.kind}`, `to-${t.side}`, lit === t.id && 'is-lit', lit && lit !== t.id && 'is-dim')}
                style={{ left: t.x, top: t.y, maxWidth: t.max, '--ink': `var(--thread-${ink})` } as CSSProperties}
                title={`${lineOf(t.id)}. Open this plot thread.`}
                aria-label={t.kind === 'opens' ? `${name}: opens here. Open this plot thread` : t.kind === 'resolved' ? `${name}: resolved here. Open this plot thread` : `${name}: still open. Open this plot thread`}
                onPointerEnter={() => setHover(t.id)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(t.id)}
                onBlur={() => setHover(null)}
                onClick={() => openThread(t.id)}
              >
                {t.kind === 'opens' ? (
                  <>
                    <i className="board-tag-dot" aria-hidden />
                    <span className="board-tag-name">{shortName(name)}</span>
                    <em>opens</em>
                  </>
                ) : t.kind === 'resolved' ? (
                  <>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                      <circle cx="6" cy="5" r="3" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M4 7.6 q -1.5 2.2 -3.5 2.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    <em>resolved here</em>
                  </>
                ) : (
                  <>
                    <em>still open</em>
                  </>
                )}
              </button>
            )
          })}
          {tip ? (
            <div className="board-tip" style={{ left: tip.x, top: tip.y } as CSSProperties} role="tooltip">
              {lineOf(tip.id)}
            </div>
          ) : null}
          {[...layout.cards.values()].map((box, i) => {
            const scene = scenes.get(box.id)
            if (!scene) return null
            const shift = drag?.moving && drag.id === box.id ? { x: drag.dx, y: drag.dy } : { x: 0, y: room.get(box.id) ?? 0 }
            return (
              <Pin
                key={`p-${box.id}`}
                kind={pinOf(scene, ai.has(box.id))}
                title={PIN_WORDS[pinOf(scene, ai.has(box.id))]}
                style={{ left: box.x + CARD_W / 2 - 5 + shift.x, top: box.y + 8 + shift.y, '--d': `${400 + i * 40}ms`, zIndex: drag?.id === box.id ? 21 : undefined } as CSSProperties}
              />
            )
          })}
        </div>
      </div>
      {/* For the keyboard and screen readers: where a dragged card would land. */}
      <p className="sr-only" aria-live="polite">
        {target && drag ? `Drop in ${shelf[layout.columns.findIndex((c) => c.id === target.chapterId)]?.label ?? 'this chapter'}, place ${target.index + 1}` : ''}
      </p>
    </div>
  )
}

/** Moves a card: on screen at once, then for real (with Undo, as in the binder). */
async function moveCard(id: ID, chapterId: ID, index: number): Promise<void> {
  useOutlineStore.getState().patch((o) => moveOnScreen(o, id, chapterId, index))
  await actions.moveScene(id, chapterId, index)
}

/** The column for the next chapter: add it, or plan it with the AI (the chapter planner, or the outline helper for a blank story). */
function NextChapter({ layout, outline, storyId }: { layout: BoardLayout; outline: Outline; storyId: ID }): React.JSX.Element {
  const n = outline.chapters.length + 1
  const blank = !outline.scenes.some((s) => s.wordCount > 0) && outline.scenes.length <= 1
  const plan = async (): Promise<void> => {
    if (blank) return openOutlineHelper(storyId)
    const id = await actions.addChapter(storyId)
    if (id) useApp.getState().navigate({ kind: 'outline', storyId, chapterId: id })
  }
  return (
    <div className="board-next" style={{ left: layout.next.x, top: PAD_TOP } as CSSProperties}>
      <div className="board-colhead is-next" style={{ position: 'relative', '--d': `${100 + outline.chapters.length * 70}ms` } as CSSProperties}>
        <span className="board-numeral is-faint">{chapterNumeral(n)}</span>
        <span className="desk-caps board-ch-label">Chapter {numberWords(n)}</span>
        <span className="board-ch-title is-untitled">Not planned yet</span>
        <span className="board-prog is-dashed" aria-hidden />
      </div>
      <div className="board-ghost is-next" style={{ position: 'relative', height: layout.next.ghost.h, marginTop: HEAD_H - 64 } as CSSProperties}>
        <span className="board-gh-plus">
          <Plus size={18} />
        </span>
        <span className="board-gh-title">Chapter {numberWords(n)}</span>
        <span className="board-gh-sub">{blank ? 'Plan the story from its premise, or add a chapter.' : 'Add it, or plan it from the open threads.'}</span>
        <span className="board-gh-actions">
          <button type="button" className="board-btn-sec" onClick={() => void actions.addChapter(storyId)}>
            Add a chapter
          </button>
          <button type="button" className="board-btn-ai" onClick={() => void plan()}>
            {blank ? 'Outline helper' : 'Plan it with AI'}
          </button>
        </span>
      </div>
    </div>
  )
}

/** What each pin says on hover. */
const PIN_WORDS: Record<PinKind, string> = { done: 'Done', drafted: 'Drafted', planned: 'Planned', ai: 'Planned with AI' }

const openThread = (id: ID): void => useApp.getState().navigate({ kind: 'entries', entryKind: 'thread', entryId: id })

const HINT_KEY = 'aiwrite.board.stringsHint'

/** The first time the board shows strings, the legend says how to read them, until Got it. */
function useStringsHint(): [boolean, () => void] {
  const [seen, setSeen] = useState(() => {
    try {
      return localStorage.getItem(HINT_KEY) === 'seen'
    } catch {
      return false
    }
  })
  const dismiss = (): void => {
    setSeen(true)
    try {
      localStorage.setItem(HINT_KEY, 'seen')
    } catch {
      // Shown again next time, then.
    }
  }
  return [!seen, dismiss]
}

/**
 * Under the board's head: what the strings are, in a line (the first time, how to read them, with Got it), and what the
 * pins say.
 */
function BoardNote({ strings }: { strings: boolean }): React.JSX.Element {
  const [hint, gotIt] = useStringsHint()
  return (
    <div className="board-note">
      {hint && strings ? (
        <div className="board-lg-explain board-hint" role="note" aria-label="How to read the strings">
          <svg className="board-hint-art" width="58" height="22" viewBox="0 0 58 22" fill="none" aria-hidden>
            <circle cx="5" cy="15" r="3.5" className="h-pin" />
            <path d="M5 15 C 18 2, 32 2, 44 11 S 52 16, 55 15" className="h-str" />
            <circle cx="29" cy="5.5" r="2.4" className="h-knot" />
            <path d="M50 11.5 L 55.5 15 L 50 18.5" className="h-str" />
          </svg>
          <span className="min-w-0 flex-1">
            <b>Reading the strings:</b> each is a plot thread, from the scene that opens a question (its tag) to a <b>knot</b> where it is answered, or
            an <b>arrow</b> while it is still open. Hover one to pick it out; click it to open it.
          </span>
          <button type="button" className="board-btn-sec board-hint-ok" onClick={gotIt}>
            Got it
          </button>
        </div>
      ) : (
        <p className="board-lg-explain">
          <span className="desk-caps board-lg-label">Plot threads</span>
          <span>Coloured strings are plot threads: they run from the scene that opens a question to the scene that answers it.</span>
        </p>
      )}
      <div className="board-pinkey" aria-label="Pins">
        <span className="board-pinkey-k">Pins:</span>
        <span>
          <Pin kind="done" inline /> Done
        </span>
        <span>
          <Pin kind="drafted" inline /> Drafted
        </span>
        <span>
          <Pin kind="planned" inline /> Planned
        </span>
        <span>
          <Pin kind="ai" inline /> Planned with AI
        </span>
      </div>
    </div>
  )
}

/** The plot threads beside the board's buttons: hover one to pick out its string and its cards; click to keep it picked. */
function Legend({ threads, drawn }: { threads: ThreadsBoard['threads']; drawn: Set<ID> }): React.JSX.Element {
  const focus = useBoardStore((s) => s.focus)
  return (
    <div className="board-legend" role="group" aria-label="Plot threads">
      <div className="board-lg-chips">
        {threads.length ? (
          threads.map((t, i) => {
            const ink = `var(--thread-${(i % 6) + 1})`
            const state = t.column === 'resolved' ? 'Resolved' : t.column === 'planned' ? 'Planned' : 'Open'
            return (
              <button
                key={t.id}
                type="button"
                className={cn('board-lg', `is-${t.column}`, !drawn.has(t.id) && 'is-off')}
                style={{ '--ink': ink } as CSSProperties}
                aria-pressed={focus === t.id}
                title={[t.setUp?.label ? `Set up in ${t.setUp.label}` : 'Not set up in a scene yet', t.paidOff?.label ? `Paid off in ${t.paidOff.label}` : ''].filter(Boolean).join('. ')}
                onPointerEnter={() => setHover(t.id)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(t.id)}
                onBlur={() => setHover(null)}
                onClick={() => setFocus(focus === t.id ? null : t.id)}
              >
                <svg width="24" height="12" viewBox="0 0 24 12" fill="none" aria-hidden>
                  <path d="M3 3.5C8 10.5 16 10.5 21 3.5" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
                  <circle cx="3" cy="3.5" r="2.3" fill="var(--success)" />
                  {t.column === 'resolved' ? (
                    <circle cx="20.5" cy="4" r="2.6" fill="var(--card)" stroke="var(--ink)" strokeWidth="1.5" />
                  ) : (
                    <circle cx="21" cy="3.5" r="2.3" fill="var(--lamp-2)" />
                  )}
                </svg>
                <span className="board-lg-q">{t.name}</span>
                <span className={cn('board-lg-st', `is-${t.column}`)}>
                  {t.column === 'resolved' ? <Check size={12} /> : <span className="board-lg-dot" aria-hidden />}
                  {state}
                </span>
              </button>
            )
          })
        ) : (
          <span className="board-lg-none">No plot threads yet: set them up on a scene’s card, or let the memory find them.</span>
        )}
      </div>
    </div>
  )
}
