// The river itself (the New look's timeline, UI overhaul): one scrolling sheet with the day (or chapter) bands and the
// scene cards along the top, the river's axis under them with the time gaps and the flashbacks' arcs, and a lane for each
// character (or plot thread) filling the room below, its head held at the left. Only what is on screen is drawn, so a
// world of hundreds of scenes and dozens of lanes scrolls smoothly. Hovering a scene lights its people's lanes; hovering a
// lane lights that character's path and scenes; a click opens the side card. Arrows move between scenes, Enter opens,
// Esc closes.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { ID } from '@shared/types'
import type { Timeline, TimelineEntry, TimelinePoint } from '@shared/contracts/worldViews'
import { cn } from '@/lib/cn'
import { keyboardDriven, reducedMotion } from '@/features/look/motion'
import { rowLabel, type LaneMode } from './timelineLogic'
import {
  cardWidth,
  lanePath,
  laneHeight,
  layoutRiver,
  matchesFilter,
  STATUS_WORDS,
  stepTo,
  toldOrder,
  visibleRange,
  wordsLabel,
  type Zoom
} from './riverLogic'
import { Legend, LaneHead, LaneStrip, RiverCard, type CardData } from './RiverParts'
import { useHidden } from './RiverArt'
import { SideCard } from './SideCard'
import { useSize } from './viewParts'

/** The band labels over the cards, and the axis under them. */
const BAND_H = 44
const AXIS_H = 54
/** Drawn beyond the screen either side (and in steps this size, so scrolling redraws only now and then). */
const CHUNK = 480
/** How long the lanes take to draw in, all told (their staggered starts included). */
const ARRIVAL_MS = 2200

export interface RiverActions {
  openPoint: (p: TimelinePoint) => void
  openEntry: (e: TimelineEntry) => void
  editCard: (p: TimelinePoint) => void
}

export function RiverBody({
  timeline,
  mode,
  zoom,
  lanes,
  filter,
  here,
  motifs,
  jump,
  actions
}: {
  timeline: Timeline
  mode: LaneMode
  zoom: Zoom
  lanes: TimelineEntry[]
  filter: ReadonlySet<ID>
  here: ID | null
  motifs: Map<ID, string>
  /** Goes up by one each time "Jump to now" is pressed. */
  jump: number
  actions: RiverActions
}): React.JSX.Element {
  const scroller = useRef<HTMLDivElement>(null)
  const hidden = useHidden()
  const { width: viewW, height: viewH } = useSize(scroller)
  const points = timeline.points

  // Sizes from the window: wider lane heads, cards and lanes on a big screen.
  const labelW = Math.round(Math.max(236, Math.min(320, viewW * 0.18)))
  const riverView = Math.max(200, viewW - labelW)
  const cardW = cardWidth(riverView)
  const cardH = Math.round(Math.max(176, Math.min(258, viewH * 0.22)))
  const headH = BAND_H + cardH + AXIS_H
  const layout = useMemo(
    () =>
      layoutRiver(timeline, zoom, {
        cardW,
        cardMax: Math.round(cardW * 1.25),
        eventW: Math.round(cardW * 0.62),
        gap: Math.round(cardW * 0.1),
        unit: Math.round(cardW * 0.12),
        pad: 32,
        minWidth: riverView
      }),
    [timeline, zoom, cardW, riverView]
  )
  const { items } = layout
  const itemOf = useMemo(() => new Map(items.map((it, n) => [it.i, n])), [items])
  const told = useMemo(() => toldOrder(points), [points])
  const byOrder = useMemo(() => new Map(points.map((p, i) => [p.order, i])), [points])
  const byId = useMemo(() => new Map(timeline.entries.map((e) => [e.id, e])), [timeline])
  const chapters = useMemo(() => new Map(timeline.chapters.map((c) => [c.id, c])), [timeline])
  const many = useMemo(() => new Set(timeline.chapters.map((c) => c.storyId)).size > 1, [timeline])
  const laneIds = useMemo(() => lanes.map((l) => l.id), [lanes])
  const inks = useMemo(() => new Map(lanes.map((l, k) => [l.id, `var(--tl-ink-${k % 8})`])), [lanes])
  const paths = useMemo(() => laneIds.map((id) => lanePath(points, items, id, mode)), [points, items, laneIds, mode])
  const out = useMemo(() => new Set(items.flatMap((it, n) => (matchesFilter(points[it.i], filter) ? [] : [n]))), [items, points, filter])
  const laneH = laneHeight(viewH - headH, lanes.length, 56, 196)
  const [picked, setPicked] = useState<ID | null>(null)
  const pickedN = picked ? items.findIndex((it) => points[it.i].id === picked) : -1
  const sideW = pickedN >= 0 ? Math.min(400, Math.max(320, Math.round(viewW * 0.26))) : 0
  const canvasW = labelW + layout.width + sideW
  const canvasH = Math.max(viewH, headH + lanes.length * laneH)

  // Where each scene is told from, in words, for its card's flashback note.
  const placeShort = useCallback(
    (p: TimelinePoint | undefined): string => {
      if (!p) return ''
      const c = p.chapterId ? chapters.get(p.chapterId) : undefined
      return p.place.replace(/^.*?, (Ch \d+, Sc \d+)$/, '$1') || (c ? `Ch ${c.no}` : p.title)
    },
    [chapters]
  )
  const toldNear = useCallback(
    (i: number): string => {
      const t = told[i]
      if (!t) return ''
      const near = byOrder.get(points[i].order + (t === 'flashback' ? -1 : 1))
      return near === undefined ? '' : placeShort(points[near])
    },
    [told, byOrder, points, placeShort]
  )

  // ----- Scrolling: what's on screen, in steps of CHUNK -----
  const [view, setView] = useState({ left: 0, top: 0 })
  const frame = useRef(0)
  const onScroll = (): void => {
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      const el = scroller.current
      if (!el) return
      const left = Math.floor(el.scrollLeft / CHUNK) * CHUNK
      const top = Math.floor(el.scrollTop / CHUNK) * CHUNK
      setView((v) => (v.left === left && v.top === top ? v : { left, top }))
    })
  }
  useEffect(() => () => cancelAnimationFrame(frame.current), [])
  const L = Math.max(0, view.left - CHUNK)
  const R = Math.min(layout.width, view.left + riverView + CHUNK * 2)
  const [from, to] = visibleRange(items, L, R)
  const laneFrom = Math.max(0, Math.floor((view.top - CHUNK) / laneH))
  const laneTo = Math.min(lanes.length, Math.ceil((view.top + viewH + CHUNK * 2) / laneH))

  // ----- The lanes draw in once, when the river first shows (and again for the other kind of lane) -----
  const [arriving, setArriving] = useState(() => !reducedMotion())
  useEffect(() => {
    if (!arriving) return
    const t = setTimeout(() => setArriving(false), ARRIVAL_MS)
    return () => clearTimeout(t)
  }, [arriving])
  // A new layout (by day or by chapter, a filter): the cards glide to their new places.
  const [gliding, setGliding] = useState(false)
  const firstZoom = useRef(zoom)
  useEffect(() => {
    if (firstZoom.current === zoom) return
    firstZoom.current = zoom
    setGliding(true)
    const t = setTimeout(() => setGliding(false), 420)
    return () => clearTimeout(t)
  }, [zoom])

  // ----- Opening where Adam is: the scene he's in, a third of the way across -----
  const hereN = here ? items.findIndex((it) => points[it.i].id === here) : -1
  const opened = useRef(false)
  useLayoutEffect(() => {
    const el = scroller.current
    if (opened.current || !viewW || !el) return
    opened.current = true
    if (hereN > 0) el.scrollLeft = Math.max(0, items[hereN].x - riverView / 3)
  }, [viewW, hereN, items, riverView])

  // ----- The keyboard: one card takes Tab; the arrows move from it -----
  const [active, setActive] = useState<number | null>(null)
  const act = active !== null && active < items.length ? active : Math.max(0, hereN)
  const pendingFocus = useRef<number | null>(null)
  const reveal = useCallback(
    (n: number, how: 'nearest' | 'centre' = 'nearest', smooth = false) => {
      const el = scroller.current
      const it = items[n]
      if (!el || !it) return
      let to = el.scrollLeft
      if (how === 'centre') to = it.x + it.w / 2 - riverView * 0.42
      else if (it.x < el.scrollLeft + 24) to = it.x - 48
      else if (it.x + it.w > el.scrollLeft + riverView - sideW - 24) to = it.x + it.w - riverView + sideW + 48
      to = Math.max(0, to)
      if (to !== el.scrollLeft) el.scrollTo({ left: to, behavior: smooth && !reducedMotion() && !keyboardDriven() ? 'smooth' : 'auto' })
    },
    [items, riverView, sideW]
  )
  useEffect(() => {
    const n = pendingFocus.current
    if (n === null) return
    const card = scroller.current?.querySelector<HTMLElement>(`[data-card-n="${n}"]`)
    if (card) {
      pendingFocus.current = null
      card.focus({ preventScroll: true })
    }
  })
  const pick = useCallback(
    (n: number) => {
      const p = points[items[n]?.i]
      if (!p) return
      setActive(n)
      setPicked((was) => (was === p.id ? null : p.id))
    },
    [points, items]
  )
  const onKey = useCallback(
    (e: React.KeyboardEvent, n: number) => {
      if (e.key === 'Enter' && points[items[n].i].id === picked) {
        // Enter on the card already open in the side card: into the scene.
        e.preventDefault()
        actions.openPoint(points[items[n].i])
        return
      }
      if (e.key === 'Escape' && picked) {
        e.preventDefault()
        e.stopPropagation()
        setPicked(null)
        return
      }
      const page = Math.max(1, Math.floor(riverView / (cardW + 20)) - 1)
      const to = stepTo(n, e.key, items.length, page)
      if (to === null) return
      e.preventDefault()
      setActive(to)
      if (picked) setPicked(points[items[to].i].id)
      reveal(to)
      pendingFocus.current = to
    },
    [points, items, picked, actions, riverView, cardW, reveal]
  )
  // Esc anywhere in the river (the side card's buttons too) closes the side card.
  const onRootKey = (e: React.KeyboardEvent): void => {
    if (e.key !== 'Escape' || !picked) return
    e.preventDefault()
    e.stopPropagation()
    const n = pickedN
    setPicked(null)
    if (n >= 0) {
      setActive(n)
      pendingFocus.current = n
    }
  }

  // ----- Jump to now -----
  const [flash, setFlash] = useState(false)
  const lastJump = useRef(jump)
  useEffect(() => {
    if (jump === lastJump.current) return
    lastJump.current = jump
    if (hereN < 0) return
    reveal(hereN, 'centre', true)
    setActive(hereN)
    pendingFocus.current = hereN
    setFlash(true)
    const t = setTimeout(() => setFlash(false), 1400)
    return () => clearTimeout(t)
  }, [jump, hereN, reveal])

  // ----- Hover: a scene lights its people's lanes; a lane lights its path and its scenes -----
  const [hot, setHot] = useState<{ kind: 'scene'; n: number } | { kind: 'lane'; id: ID } | null>(null)
  const onOver = (e: React.PointerEvent): void => {
    const t = e.target as HTMLElement
    const card = t.closest<HTMLElement>('[data-card-n]')
    if (card) {
      const n = Number(card.dataset.cardN)
      if (hot?.kind !== 'scene' || hot.n !== n) setHot({ kind: 'scene', n })
      return
    }
    const row = t.closest<HTMLElement>('[data-lane-row]')
    if (row) {
      const id = row.dataset.laneRow!
      if (hot?.kind !== 'lane' || hot.id !== id) setHot({ kind: 'lane', id })
      return
    }
    if (hot) setHot(null)
  }
  const hotCss = useMemo(() => {
    if (!hot) return ''
    if (hot.kind === 'scene') {
      const p = points[items[hot.n]?.i]
      if (!p) return ''
      const ids = mode === 'characters' ? [...new Set([...(p.povId ? [p.povId] : []), ...p.presentIds])] : [...p.setsUpIds, ...p.paysOffIds]
      const lit = ids.filter((id) => laneIds.includes(id))
      return [
        lit.length ? `${lit.map((id) => `.tl [data-lane-row="${id}"]`).join(',')}{opacity:1 !important;}` : '',
        lit.length ? `${lit.map((id) => `.tl [data-lane-head="${id}"]`).join(',')}{--lit:1;}` : '',
        `.tl .tl-mark[data-col="${hot.n}"]{--grow:1.32;}`
      ].join('')
    }
    const k = laneIds.indexOf(hot.id)
    const path = paths[k]
    const cards = path ? path.marks.map((m) => `.tl [data-card-n="${m.item}"]`) : []
    return [
      `.tl [data-lane-row="${hot.id}"]{opacity:1 !important;}`,
      `.tl [data-lane-row="${hot.id}"] .tl-strip{--lit:1;}`,
      cards.length ? `${cards.join(',')}{--lit:1;opacity:1 !important;}` : ''
    ].join('')
  }, [hot, points, items, mode, laneIds, paths])
  const hotN = hot?.kind === 'scene' ? hot.n : null

  // ----- The pieces on screen -----
  const cardData = (n: number): CardData => {
    const it = items[n]
    const p = points[it.i]
    const c = p.chapterId ? chapters.get(p.chapterId) : undefined
    const sc = p.place.match(/Sc (\d+)$/)?.[1]
    const eyebrow = c ? `${many ? `${c.story} · ` : ''}Ch ${c.no}${sc ? ` · Sc ${sc}` : ''}` : p.place
    const pov = p.povId ? byId.get(p.povId) : undefined
    const place = p.locationId ? byId.get(p.locationId) : undefined
    const t = told[it.i]
    const near = toldNear(it.i)
    const base = rowLabel(p, timeline.clashes)
    const extra =
      p.kind === 'scene'
        ? [
            `${STATUS_WORDS[p.status]}, ${wordsLabel(p.words).toLowerCase()}`,
            t === 'flashback' ? `A flashback, told after ${near}` : t === 'early' ? `Told early, before ${near}` : ''
          ]
        : []
    return {
      point: p,
      pov,
      place,
      placeMotif: place ? motifs.get(place.id) : undefined,
      povMotif: pov ? motifs.get(pov.id) : undefined,
      povInk: pov ? inks.get(pov.id) : undefined,
      told: t,
      toldNear: near,
      eyebrow,
      label: [base, ...extra.filter(Boolean).map((s) => `${s}.`)].join(' ')
    }
  }
  const cx = (n: number): number => items[n].x + items[n].w / 2
  const shown: number[] = []
  for (let n = from; n < to; n++) shown.push(n)
  if ((act < from || act >= to) && act < items.length) shown.push(act)
  const arcs = zoom === 'day' ? shown.filter((n) => told[items[n].i]) : []
  const laneStats = (k: number): string => {
    const path = paths[k]
    if (!path) return 'Not on these scenes'
    const scenes = path.marks.length
    if (mode === 'characters') {
      const pov = path.marks.filter((m) => m.kind === 'pov').length
      return `In ${scenes} ${scenes === 1 ? 'scene' : 'scenes'}${pov ? ` · point of view in ${pov}` : ''}`
    }
    const resolved = path.marks.some((m) => m.kind === 'resolved' || m.kind === 'both')
    return path.openEnd ? 'Still open' : resolved ? 'Paid off' : `${scenes} ${scenes === 1 ? 'mark' : 'marks'}`
  }
  const openLane = useCallback((lane: TimelineEntry) => actions.openEntry(lane), [actions])
  const picker = pickedN >= 0 ? points[items[pickedN].i] : null

  return (
    <div
      className={cn('tl-body', hot && `is-hot is-hot-${hot.kind}`, gliding && 'is-gliding', arriving && 'is-arriving', flash && 'is-flash')}
      onKeyDown={onRootKey}
      data-paused={hidden || undefined}
      style={{ '--label-w': `${labelW}px`, '--card-h': `${cardH}px`, '--head-h': `${headH}px` } as CSSProperties}
    >
      {hotCss ? <style>{hotCss}</style> : null}
      <div ref={scroller} className="tl-scroller" onScroll={onScroll} onPointerOver={onOver} onPointerLeave={() => setHot(null)}>
        <div className="tl-canvas" style={{ width: canvasW, height: canvasH }}>
          {/* The day or chapter bands, the whole height of the river. */}
          <div className="tl-bands" aria-hidden>
            {layout.bands.map((b) => (
              <span key={b.key} className={cn('tl-band', b.alt && 'is-alt')} style={{ left: labelW + b.x0, width: b.x1 - b.x0 }} />
            ))}
          </div>
          {/* The warp: a faint line down from each card through the lanes, and the hovered scene's column. */}
          <svg
            className="tl-warp"
            style={{ left: labelW + L, top: headH, width: Math.max(1, R - L), height: canvasH - headH }}
            viewBox={`${L} 0 ${Math.max(1, R - L)} ${canvasH - headH}`}
            aria-hidden
          >
            {shown.map((n) => (
              <line
                key={n}
                className={cn(points[items[n].i].kind === 'event' && 'is-event')}
                x1={cx(n)}
                x2={cx(n)}
                y1={0}
                y2={canvasH - headH}
              />
            ))}
            {hotN !== null && items[hotN] ? (
              <rect className="tl-hotcol" x={cx(hotN) - 22} y={0} width={44} height={canvasH - headH} rx={22} />
            ) : null}
          </svg>

          {/* The head: bands' names, the cards, the axis. It stays at the top as the lanes scroll. */}
          <div className="tl-head" style={{ height: headH, width: canvasW }}>
            <div className="tl-corner" style={{ width: labelW, height: headH }}>
              <p className="tl-corner-k">{mode === 'characters' ? 'Characters' : 'Plot threads'}</p>
              <Legend mode={mode} />
            </div>
            <div className="tl-head-river" style={{ left: labelW, width: layout.width }}>
              <div className="tl-bandnames" aria-hidden>
                {layout.bands.map((b) => (
                  <span
                    key={b.key}
                    className={cn('tl-bandname', zoom === 'chapter' && 'is-chapter', b.alt && 'is-alt')}
                    style={{ left: b.x0, width: b.x1 - b.x0 }}
                  >
                    <span className="tl-bandname-in">
                      {b.eyebrow ? <span className="tl-bandname-k">{b.eyebrow}</span> : null}
                      <span className="tl-bandname-t">{b.label || (zoom === 'day' ? 'A day' : '')}</span>
                    </span>
                  </span>
                ))}
              </div>
              <div role="list" aria-label="Timeline" className="tl-cards" style={{ top: BAND_H, height: cardH }}>
                {shown.map((n) => (
                  <RiverCard
                    key={points[items[n].i].kind + points[items[n].i].id}
                    item={items[n]}
                    n={n}
                    data={cardData(n)}
                    height={cardH}
                    here={points[items[n].i].id === here}
                    picked={n === pickedN}
                    out={out.has(n)}
                    tabbable={n === act}
                    arriving={arriving}
                    onPick={pick}
                    onKey={onKey}
                  />
                ))}
              </div>
              <div className="tl-axis" style={{ top: BAND_H + cardH, height: AXIS_H }} aria-hidden>
                <svg style={{ left: L, width: Math.max(1, R - L), height: AXIS_H }} viewBox={`${L} 0 ${Math.max(1, R - L)} ${AXIS_H}`}>
                  <line className="tl-axis-line" x1={L} x2={R} y1={14} y2={14} />
                  {shown.map((n) => (
                    <g key={n} className={cn('tl-tick', points[items[n].i].kind === 'event' && 'is-event', n === hereN && 'is-here')}>
                      <line x1={cx(n)} x2={cx(n)} y1={0} y2={14} />
                      <circle cx={cx(n)} cy={14} r={n === hereN ? 5 : 3.2} />
                      {n === hereN ? <circle className="tl-pulse" cx={cx(n)} cy={14} r={5} /> : null}
                    </g>
                  ))}
                  {arcs.map((n) => {
                    const i = items[n].i
                    const near = byOrder.get(points[i].order + (told[i] === 'flashback' ? -1 : 1))
                    const m = near === undefined ? undefined : itemOf.get(near)
                    if (m === undefined) return null
                    const a = cx(m)
                    const b = cx(n)
                    const mid = (a + b) / 2
                    return (
                      <path
                        key={`arc${n}`}
                        className={cn('tl-arc', `is-${told[i]}`)}
                        d={`M${a} 18 C ${a} 48, ${mid} 52, ${mid} 52 S ${b} 48, ${b} 18`}
                      />
                    )
                  })}
                </svg>
                {layout.gaps
                  .filter((g) => g.x >= L && g.x <= R)
                  .map((g) => (
                    <span key={g.x} className="tl-gap" style={{ left: g.x }}>
                      {g.label}
                    </span>
                  ))}
              </div>
            </div>
          </div>

          {/* The lanes. */}
          <div role="list" aria-label="Lanes" className="tl-lanes">
            {lanes.length ? null : (
              <p className="tl-nolanes" style={{ top: headH + 24, left: 24 }}>
                {mode === 'threads' && !paths.length
                  ? 'No plot threads are set up or paid off in these scenes yet.'
                  : 'No lanes shown. Pick some with Lanes, above.'}
              </p>
            )}
            {lanes.slice(laneFrom, laneTo).map((lane, j) => {
              const k = laneFrom + j
              return (
                <div
                  key={lane.id}
                  role="listitem"
                  data-lane-row={lane.id}
                  className={cn('tl-lane-row', k % 2 === 1 && 'is-alt')}
                  style={{ top: headH + k * laneH, height: laneH, width: canvasW, '--ink': inks.get(lane.id) } as CSSProperties}
                >
                  <LaneHead
                    lane={lane}
                    ink={inks.get(lane.id)!}
                    height={laneH}
                    motif={motifs.get(lane.id)}
                    stats={laneStats(k)}
                    mode={mode}
                    onOpen={openLane}
                  />
                  <div className="tl-strip-box" style={{ left: labelW, width: layout.width, height: laneH }}>
                    <LaneStrip
                      laneId={lane.id}
                      path={paths[k]}
                      items={items}
                      from={from}
                      to={to}
                      left={L}
                      right={R}
                      height={laneH}
                      mode={mode}
                      out={out}
                      arriving={arriving}
                      order={k}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      {picker ? (
        <SideCard
          key="side"
          timeline={timeline}
          point={picker}
          told={told[items[pickedN].i]}
          toldNear={toldNear(items[pickedN].i)}
          eyebrow={cardData(pickedN).eyebrow}
          motifs={motifs}
          inks={inks}
          onClose={() => {
            setPicked(null)
            pendingFocus.current = pickedN
          }}
          onOpenPoint={actions.openPoint}
          onOpenEntry={actions.openEntry}
          onEditCard={actions.editCard}
        />
      ) : null}
    </div>
  )
}
