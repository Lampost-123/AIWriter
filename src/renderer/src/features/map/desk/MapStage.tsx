// The desk's relationship map: the stage. Characters as medallions joined by curved ties, on chart paper, filling the
// canvas when it opens; pan by dragging the paper, zoom with the wheel or + and -, 0 to fit; drag a character to move
// it (remembered with the world). Pointing at a character lights its ties and both sides' feelings; a click opens its
// card; a click on a tie opens that tie's history. The arrow keys move between characters, Enter opens, Esc closes.
// As the timeline strip moves, ties draw themselves in, change colour and fade out.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AsOf, ID } from '@shared/types'
import type { MapLink, MapTieHistory, RelationshipMap } from '@shared/contracts/worldViews'
import { Eye, Maximize, Minus, Plus } from '@/components/ui/icons'
import { api } from '@/lib/api'
import { useSize } from '@/features/timeline/viewParts'
import { useEntryMotifs } from '@/features/world/art/artStore'
import { reducedMotion } from '@/features/look/motion'
import type { View } from '../mapLogic'
import {
  arcOf,
  onCurve,
  changeWords,
  degrees,
  hullPath,
  MEDAL,
  medalScale,
  nextOver,
  pairKeyOf,
  rankOf,
  roleWords,
  roomFor,
  sidesOf,
  spreadView,
  stretchFor,
  temperature,
  tieKind,
  TIE_KINDS,
  tieWords,
  zoomAbout,
  type Direction,
  type Pt,
  type Rank,
  type Side,
  type TieKind
} from './deskMapLogic'
import { Medal } from './Medal'
import { Feel, NodeCard, TieCard } from './MapCards'
import { TimeStrip } from './TimeStrip'

/** A character on the stage. */
export interface DNode {
  id: ID
  name: string
  image: string | null
  role: string
  summary: string
  x: number
  y: number
  rank: Rank
}

/** A tie on the stage: a pair, every relationship between them, its kind, words and both sides' feelings (a's first). */
export interface DTie {
  key: string
  a: ID
  b: ID
  links: MapLink[]
  kind: TieKind
  words: string
  sides: [Side, Side]
  temp: ReturnType<typeof temperature>
}

const EXIT = 140
/** How near a tie's line the pointer must be to point at it, in pixels, and the grid it is found in. */
const LINE_HIT = 9
const LINE_CELL = 24
const VIEW = 280
/** Room kept clear round the map: the strip and the note above, the legend below, a little at the sides. */
const PAD = { left: 130, right: 130, top: 196, bottom: 140 }
const RANK_ORDER: Record<Rank, number> = { lead: 0, major: 1, support: 2, minor: 3 }

type Sel = { kind: 'node'; id: ID } | { kind: 'tie'; key: string } | null

export function MapStage({
  map,
  groupId,
  index,
  quick,
  onPick
}: {
  map: RelationshipMap
  groupId: ID | null
  /** The stop the strip shows (the one asked for, while it loads). */
  index: number
  quick: boolean
  onPick: (at: AsOf, how: 'key' | 'pointer') => void
}): React.JSX.Element {
  const detail = map.detail
  const motifs = useEntryMotifs()
  const box = useRef<HTMLDivElement>(null)
  const { width, height } = useSize(box)

  // ----- What is on the map -----
  const [moved, setMoved] = useState<Map<ID, Pt>>(() => new Map())
  // The characters and ties, kept as the same objects while they are unchanged (as the strip moves, or a character is
  // dragged), so only what changed draws again: a big cast stays smooth.
  const nodeCache = useRef(new Map<ID, DNode>())
  const tieCache = useRef(new Map<string, { sig: string; tie: DTie }>())
  const { base, ties } = useMemo(() => {
    const deg = degrees(map.links.map((l) => ({ a: { id: l.aId }, b: { id: l.bId } })))
    const maxDeg = Math.max(0, ...deg.values())
    const base: DNode[] = map.nodes.map((n) => {
      const rank = rankOf(n.role, deg.get(n.id) ?? 0, maxDeg)
      const old = nodeCache.current.get(n.id)
      const role = n.role ?? ''
      const summary = n.summary ?? ''
      if (old && old.name === n.name && old.image === n.image && old.role === role && old.summary === summary && old.rank === rank && old.x === n.x && old.y === n.y)
        return old
      return { id: n.id, name: n.name, image: n.image, role, summary, x: n.x, y: n.y, rank }
    })
    nodeCache.current = new Map(base.map((n) => [n.id, n]))
    const here = new Set(base.map((n) => n.id))
    const pairs = new Map<string, MapLink[]>()
    for (const l of map.links) {
      if (!here.has(l.aId) || !here.has(l.bId)) continue
      const key = pairKeyOf(l.aId, l.bId)
      const list = pairs.get(key)
      if (list) list.push(l)
      else pairs.set(key, [l])
    }
    const cache = new Map<string, { sig: string; tie: DTie }>()
    const ties: DTie[] = [...pairs].map(([key, links]) => {
      const sig = JSON.stringify(links.map((l) => [l.aId, l.type, l.aFeels, l.bFeels, l.where]))
      const old = tieCache.current.get(key)
      if (old && old.sig === sig) {
        cache.set(key, old)
        return old.tie
      }
      const [a, b] = key.split('|')
      const sides = sidesOf(links, a, b)
      const tie: DTie = { key, a, b, links, kind: tieKind(links.map((l) => l.type)), words: tieWords(links), sides, temp: temperature(sides) }
      cache.set(key, { sig, tie })
      return tie
    })
    tieCache.current = cache
    return { base, ties }
  }, [map])
  // A small cast's places stretched to the canvas's shape (deskMapLogic.stretchFor); everything on the stage is drawn
  // from the stretched places, and a dragged character's place is kept unstretched.
  const stretch = useMemo(
    () => stretchFor(map.everyone.length ? map.everyone : base, width, height, PAD, Math.max(map.everyone.length, base.length)),
    [map.everyone, base, width, height]
  )
  const stretchRef = useRef(stretch)
  stretchRef.current = stretch
  const shown = useRef(new Map<ID, { from: DNode; node: DNode }>())
  const { nodes, byId } = useMemo(() => {
    const keep = new Map<ID, { from: DNode; node: DNode }>()
    const nodes = base.map((n) => {
      const p = moved.get(n.id) ?? n
      const x = p.x * stretch.ax
      const y = p.y * stretch.ay
      const old = shown.current.get(n.id)
      const node = old && old.from === n && old.node.x === x && old.node.y === y ? old.node : { ...n, x, y }
      keep.set(n.id, { from: n, node })
      return node
    })
    shown.current = keep
    return { nodes, byId: new Map(nodes.map((n) => [n.id, n])) }
  }, [base, moved, stretch])
  const stretched = useCallback((p: Pt): Pt => ({ x: p.x * stretch.ax, y: p.y * stretch.ay }), [stretch])

  const history = useMemo(() => new Map((detail?.history ?? []).map((h) => [pairKeyOf(h.aId, h.bId), h] as [string, MapTieHistory])), [detail])
  const here = useMemo(() => new Set((detail?.here ?? []).map((h) => pairKeyOf(h.aId, h.bId))), [detail])
  const group = groupId ? map.groups.find((g) => g.id === groupId) : undefined
  const members = useMemo(() => (group ? new Set(group.memberIds) : null), [group])

  // Fitted to everyone the strip can show (or the group's members anywhere along it), so nobody turns up outside it.
  const fitTo = useMemo((): Pt[] => {
    const all = group ? new Set(group.allMemberIds) : null
    const list = (all ? map.everyone.filter((p) => all.has(p.id)) : map.everyone).map((p) => stretched(moved.get(p.id) ?? p))
    return list.length ? list : nodes
  }, [map.everyone, group, nodes, moved, stretched])
  const fitRef = useRef(fitTo)
  fitRef.current = fitTo
  const everyone = useMemo(() => (map.everyone.length ? map.everyone.map((p) => ({ id: p.id, ...stretched(moved.get(p.id) ?? p) })) : nodes), [map.everyone, nodes, moved, stretched])
  const everyoneRef = useRef(everyone)
  everyoneRef.current = everyone
  const grouped = useRef(false)
  grouped.current = !!group
  const centre = useMemo(() => {
    if (!everyone.length) return { x: 0, y: 0 }
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
    for (const p of everyone) {
      x0 = Math.min(x0, p.x)
      x1 = Math.max(x1, p.x)
      y0 = Math.min(y0, p.y)
      y1 = Math.max(y1, p.y)
    }
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }
  }, [everyone])

  // ----- The view -----
  const [view, setView] = useState<View>({ tx: 0, ty: 0, k: 1 })
  const viewRef = useRef(view)
  viewRef.current = view
  const sizeRef = useRef({ width, height })
  sizeRef.current = { width, height }
  const fitK = useRef(1)
  const glide = useRef(0)
  const [gliding, setGliding] = useState(false)
  const move = useCallback((next: (v: View) => View, animate: boolean) => {
    cancelAnimationFrame(glide.current)
    const from = viewRef.current
    const to = next(from)
    if (to === from) return
    if (!animate || reducedMotion()) {
      setGliding(false)
      return setView(to)
    }
    const { width: w, height: h } = sizeRef.current
    const mid = (v: View): Pt => ({ x: (w / 2 - v.tx) / v.k, y: (h / 2 - v.ty) / v.k })
    const [a, b] = [mid(from), mid(to)]
    const start = performance.now()
    setGliding(true)
    const frame = (now: number): void => {
      const t = Math.min(1, (now - start) / VIEW)
      const e = 1 - (1 - t) ** 3
      const k = from.k * (to.k / from.k) ** e
      setView(t < 1 ? { k, tx: w / 2 - (a.x + (b.x - a.x) * e) * k, ty: h / 2 - (a.y + (b.y - a.y) * e) * k } : to)
      if (t < 1) glide.current = requestAnimationFrame(frame)
      else setGliding(false)
    }
    glide.current = requestAnimationFrame(frame)
  }, [])
  useEffect(() => () => cancelAnimationFrame(glide.current), [])

  const fitKey = `${groupId ?? ''}|${fitTo.length > 0}`
  const fitted = useRef<string | null>(null)
  const lastSize = useRef({ width: 0, height: 0 })
  const fitNow = useCallback((animate: boolean) => {
    const { width: w, height: h } = sizeRef.current
    // A group is fitted no closer than everyone is, so the rest of the map stays round it.
    const all = spreadView(everyoneRef.current, w, h, PAD)
    const v = grouped.current ? spreadView(fitRef.current, w, h, PAD, Math.max(all.k, 0.0001)) : all
    fitK.current = v.k
    move(() => v, animate)
  }, [move])
  useLayoutEffect(() => {
    if (!width || !height) return
    if (fitted.current !== fitKey) {
      const opening = fitted.current === null
      fitted.current = fitKey
      fitNow(!opening)
    } else if (lastSize.current.width && (lastSize.current.width !== width || lastSize.current.height !== height)) {
      // The window changed size: fit again, so the map keeps filling it.
      fitNow(false)
    }
    lastSize.current = { width, height }
  }, [fitKey, width, height, fitNow])

  const zoomBy = useCallback((f: number) => move((v) => zoomAbout(v, f, sizeRef.current.width / 2, sizeRef.current.height / 2), true), [move])

  // ----- Pointing, choosing -----
  const [hotNode, setHotNode] = useState<ID | null>(null)
  const [hotTie, setHotTie] = useState<string | null>(null)
  const [hotKind, setHotKind] = useState<TieKind | null>(null)
  const [sel, setSel] = useState<Sel>(null)
  const [closing, setClosing] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const select = useCallback((s: Sel) => {
    clearTimeout(closeTimer.current)
    setClosing(false)
    setSel(s)
  }, [])
  const close = useCallback(() => {
    if (!sel) return
    const was = sel
    setClosing(true)
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(
      () => {
        setSel(null)
        setClosing(false)
      },
      reducedMotion() ? 0 : EXIT
    )
    // Back to where Adam was.
    const el = box.current?.querySelector<HTMLElement>(was.kind === 'node' ? `[data-map-node="${CSS.escape(was.id)}"]` : `[data-map-tie="${CSS.escape(was.key)}"]`)
    el?.focus({ preventScroll: true })
  }, [sel])
  useEffect(() => () => clearTimeout(closeTimer.current), [])
  // A chosen character or tie that leaves the map as the strip moves: its card closes.
  useEffect(() => {
    if (sel?.kind === 'node' && !byId.has(sel.id)) setSel(null)
    if (sel?.kind === 'tie' && !ties.some((t) => t.key === sel.key)) setSel(null)
  }, [sel, byId, ties])

  // A card opening over the right of the map: the map slides left just enough to keep the chosen character, or the
  // tie's two ends, and their ties clear of it.
  const selKey = sel ? (sel.kind === 'node' ? `n:${sel.id}` : `t:${sel.key}`) : ''
  // Where the map was before a card slid it aside, and where it slid to: when the card closes, it slides back (unless
  // Adam has moved the map since).
  const cardSlide = useRef<{ from: View; to: View } | null>(null)
  useEffect(() => {
    if (!sel) {
      const slid = cardSlide.current
      cardSlide.current = null
      const v = viewRef.current
      if (slid && Math.abs(v.tx - slid.to.tx) < 1 && Math.abs(v.ty - slid.to.ty) < 1 && v.k === slid.to.k) move(() => slid.from, true)
      return
    }
    const ids = new Set<ID>()
    if (sel.kind === 'node') {
      ids.add(sel.id)
      for (const t of ties) if (t.a === sel.id || t.b === sel.id) ids.add(t.a).add(t.b)
    } else {
      const t = ties.find((x) => x.key === sel.key)
      if (t) ids.add(t.a).add(t.b)
    }
    const v = viewRef.current
    const { width: w } = sizeRef.current
    let maxX = -Infinity
    let minX = Infinity
    for (const id of ids) {
      const n = byId.get(id)
      if (!n) continue
      maxX = Math.max(maxX, n.x * v.k + v.tx + 90)
      minX = Math.min(minX, n.x * v.k + v.tx - 90)
    }
    const edge = w - 392
    if (maxX <= edge) return
    // As far as it needs, but never pushing the leftmost of them off the map.
    const dx = Math.max(edge - maxX, Math.min(0, 24 - minX))
    if (dx < 0) {
      const back = cardSlide.current?.from ?? v
      move((cur) => {
        const to = { ...cur, tx: cur.tx + dx }
        cardSlide.current = { from: back, to }
        return to
      }, true)
    }
    // Only when the card opens for something new.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey])

  // ----- Coming and going as the strip moves -----
  const born = useRef(new Map<string, number>())
  const first = useRef(true)
  const prev = useRef<{ nodes: Map<ID, DNode>; ties: Map<string, DTie> }>({ nodes: new Map(), ties: new Map() })
  const [leaving, setLeaving] = useState<{ nodes: Map<ID, DNode>; ties: Map<string, DTie> }>({ nodes: new Map(), ties: new Map() })
  const signature = `${nodes.map((n) => n.id).join(',')}#${ties.map((t) => t.key).join(',')}`
  useEffect(() => {
    const now = performance.now()
    const nowNodes = new Map(nodes.map((n) => [n.id, n]))
    const nowTies = new Map(ties.map((t) => [t.key, t]))
    const goneNodes = new Map([...prev.current.nodes].filter(([id]) => !nowNodes.has(id)))
    const goneTies = new Map([...prev.current.ties].filter(([key]) => !nowTies.has(key)))
    for (const id of goneNodes.keys()) born.current.delete(`n:${id}`)
    for (const key of goneTies.keys()) born.current.delete(`t:${key}`)
    prev.current = { nodes: nowNodes, ties: nowTies }
    if (first.current) {
      first.current = false
      return
    }
    void now
    if (!goneNodes.size && !goneTies.size) return
    setLeaving({ nodes: goneNodes, ties: goneTies })
    const t = setTimeout(() => setLeaving({ nodes: new Map(), ties: new Map() }), reducedMotion() ? 0 : EXIT + 20)
    return () => clearTimeout(t)
    // Only when who is on the map changes, not as a character is dragged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])
  const isNew = (key: string): boolean => {
    const now = performance.now()
    const at = born.current.get(key)
    if (at === undefined) {
      born.current.set(key, now)
      return true
    }
    return now - at < 700
  }

  // ----- Screen geometry (inside the layer: the pan is its transform) -----
  const k = view.k
  const ms = medalScale(k)
  const sizeOf = (n: DNode): number => Math.round(MEDAL[n.rank] * ms)
  const deg = useMemo(() => degrees(ties.map((t) => ({ a: { id: t.a }, b: { id: t.b } }))), [ties])
  const arcs = useMemo(() => {
    const c = { x: centre.x * k, y: centre.y * k }
    const out = new Map<string, ReturnType<typeof arcOf>>()
    for (const t of ties) {
      const a = byId.get(t.a)!
      const b = byId.get(t.b)!
      out.set(t.key, arcOf({ x: a.x * k, y: a.y * k }, { x: b.x * k, y: b.y * k }, c, t.key))
    }
    return out
  }, [ties, byId, k, centre])
  // Pointing at a tie's line is found here, from points along each curve in a grid, not by the browser: hit-testing
  // hundreds of curved strokes on every move of the mouse (and after every change) is what made a big cast slow.
  const lineGrid = useMemo(() => {
    const grid = new Map<string, { key: string; x: number; y: number }[]>()
    for (const t of ties) {
      const a = byId.get(t.a)!
      const b = byId.get(t.b)!
      const pa = { x: a.x * k, y: a.y * k }
      const pb = { x: b.x * k, y: b.y * k }
      const { c } = arcs.get(t.key)!
      const len = Math.hypot(pb.x - pa.x, pb.y - pa.y)
      const n = Math.max(6, Math.min(80, Math.round(len / 10)))
      for (let i = 1; i < n; i++) {
        const p = onCurve(pa, c, pb, i / n)
        const cell = `${Math.floor(p.x / LINE_CELL)},${Math.floor(p.y / LINE_CELL)}`
        const list = grid.get(cell)
        if (list) list.push({ key: t.key, ...p })
        else grid.set(cell, [{ key: t.key, ...p }])
      }
    }
    return grid
  }, [ties, byId, arcs, k])
  const tieAt = useCallback(
    (x: number, y: number): string | null => {
      let best: string | null = null
      let bestD = LINE_HIT * LINE_HIT
      const gx = Math.floor(x / LINE_CELL)
      const gy = Math.floor(y / LINE_CELL)
      for (let i = gx - 1; i <= gx + 1; i++)
        for (let j = gy - 1; j <= gy + 1; j++)
          for (const p of lineGrid.get(`${i},${j}`) ?? []) {
            const d = (p.x - x) ** 2 + (p.y - y) ** 2
            if (d < bestD) [best, bestD] = [p.key, d]
          }
      return best
    },
    [lineGrid]
  )

  // Which names and pills have room: the leads' names first, then the best-connected ties' words.
  const dragging = useRef(false)
  const lastRoom = useRef<Set<string>>(new Set())
  const room = useMemo(() => {
    if (dragging.current) return lastRoom.current
    const discs = nodes.map((n) => ({ key: n.id, x: n.x * k, y: n.y * k, r: (MEDAL[n.rank] * ms) / 2 + 3 }))
    const byRank = [...nodes].sort((p, q) => RANK_ORDER[p.rank] - RANK_ORDER[q.rank] || (deg.get(q.id) ?? 0) - (deg.get(p.id) ?? 0) || p.name.localeCompare(q.name))
    const names = byRank.map((n) => {
      const r = (MEDAL[n.rank] * ms) / 2
      const hasRole = !!n.role
      const h = hasRole ? 42 : 24
      return { key: `n:${n.id}`, owner: n.id, x: n.x * k, y: n.y * k + r + (n.rank === 'lead' ? 16 : 10) + h / 2, w: Math.min(186, n.name.length * 7.8 + 22), h }
    })
    const pills = [...ties]
      .sort((p, q) => (deg.get(q.a) ?? 0) + (deg.get(q.b) ?? 0) - (deg.get(p.a) ?? 0) - (deg.get(p.b) ?? 0) || (p.key < q.key ? -1 : 1))
      .map((t) => {
        const m = arcs.get(t.key)!.mid
        return { key: `t:${t.key}`, x: m.x, y: m.y, w: Math.min(190, t.words.length * 6.7 + 44), h: 26 }
      })
    const shown = roomFor(discs, [...names, ...pills])
    lastRoom.current = shown
    return shown
  }, [nodes, ties, arcs, k, ms, deg])

  // ----- What is lit -----
  const litNodes = useMemo(() => {
    const focus = hotNode ?? (hotTie ? null : sel?.kind === 'node' ? sel.id : null)
    const tieKey = hotTie ?? (!hotNode && sel?.kind === 'tie' ? sel.key : null)
    if (focus) {
      const s = new Set<ID>([focus])
      for (const t of ties) if (t.a === focus || t.b === focus) s.add(t.a).add(t.b)
      return { nodes: s, ties: new Set(ties.filter((t) => t.a === focus || t.b === focus).map((t) => t.key)), hover: !!hotNode }
    }
    if (tieKey) {
      const t = ties.find((x) => x.key === tieKey)
      return t ? { nodes: new Set([t.a, t.b]), ties: new Set([t.key]), hover: !!hotTie } : null
    }
    return null
  }, [hotNode, hotTie, sel, ties])
  // Pointing opens out the lit ties' pills, both feelings showing, when there are few enough to read.
  const openPills = !!litNodes && litNodes.hover && litNodes.ties.size <= 8
  // While some are lit, their names and words get room among themselves first (the one pointed at before the rest),
  // so a character with many ties shows them without the words piling up; open pills always show.
  const litRoom = useMemo(() => {
    if (!litNodes) return null
    const lit = nodes.filter((n) => litNodes.nodes.has(n.id))
    const discs = lit.map((n) => ({ key: n.id, x: n.x * k, y: n.y * k, r: (MEDAL[n.rank] * ms) / 2 + 3 }))
    const first = hotNode ?? (sel?.kind === 'node' ? sel.id : null)
    const order = [...lit].sort((p, q) => (p.id === first ? -1 : q.id === first ? 1 : RANK_ORDER[p.rank] - RANK_ORDER[q.rank] || (deg.get(q.id) ?? 0) - (deg.get(p.id) ?? 0)))
    const names = order.map((n) => {
      const r = (MEDAL[n.rank] * ms) / 2
      const h = n.role ? 42 : 24
      return { key: `n:${n.id}`, owner: n.id, x: n.x * k, y: n.y * k + r + (n.rank === 'lead' ? 16 : 10) + h / 2, w: Math.min(186, n.name.length * 7.8 + 22), h }
    })
    const pills = ties
      .filter((t) => litNodes.ties.has(t.key))
      .map((t) => {
        const m = arcs.get(t.key)!.mid
        return { key: `t:${t.key}`, x: m.x, y: m.y, w: Math.min(190, t.words.length * 6.7 + 44), h: 26 }
      })
    const shown = roomFor(discs, openPills ? [...names.slice(0, 1), ...names.slice(1), ...pills] : [...names.slice(0, 1), ...pills, ...names.slice(1)])
    if (first) shown.add(`n:${first}`)
    if (openPills) for (const t of litNodes.ties) shown.add(`t:${t}`)
    return shown
  }, [litNodes, nodes, ties, arcs, k, ms, deg, hotNode, sel, openPills])
  const crowd = nodes.length > 20
  const kindNodes = useMemo(() => {
    if (!hotKind) return null
    const s = new Set<ID>()
    for (const t of ties) if (t.kind === hotKind) s.add(t.a).add(t.b)
    return s
  }, [hotKind, ties])

  // ----- Panning, dragging a character -----
  const press = useRef<{ x: number; y: number; tx: number; ty: number; node: DNode | null; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const [panning, setPanning] = useState(false)
  const [dragId, setDragId] = useState<ID | null>(null)
  const raf = useRef(0)
  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-map-node]')
    const node = target ? (byId.get(target.dataset.mapNode!) ?? null) : null
    if (!node && (e.target as HTMLElement).closest('button')) return
    suppressClick.current = false
    press.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, node, moved: false }
  }
  const onLine = useRef(false)
  const lineAt = (e: React.PointerEvent | React.MouseEvent): string | null => {
    if ((e.target as HTMLElement).closest('button')) return null
    const r = box.current!.getBoundingClientRect()
    const v = viewRef.current
    return tieAt(e.clientX - r.left - v.tx, e.clientY - r.top - v.ty)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const p = press.current
    if (!p) {
      if (e.buttons) return
      const key = lineAt(e)
      if (key) {
        onLine.current = true
        if (key !== hotTie) setHotTie(key)
      } else if (onLine.current) {
        onLine.current = false
        setHotTie(null)
      }
      return
    }
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    if (!p.moved) {
      if (Math.hypot(dx, dy) < 4) return
      p.moved = true
      e.currentTarget.setPointerCapture(e.pointerId)
      if (p.node) {
        dragging.current = true
        setDragId(p.node.id)
      } else setPanning(true)
      setHotTie(null)
    }
    if (p.node) {
      const node = p.node
      const { ax, ay } = stretchRef.current
      const at = { x: (node.x + dx / viewRef.current.k) / ax, y: (node.y + dy / viewRef.current.k) / ay }
      cancelAnimationFrame(raf.current)
      raf.current = requestAnimationFrame(() => setMoved((m) => new Map(m).set(node.id, at)))
    } else move((v) => ({ ...v, tx: p.tx + dx, ty: p.ty + dy }), false)
  }
  const endPress = (): void => {
    const p = press.current
    press.current = null
    if (!p) return
    suppressClick.current = p.moved
    setPanning(false)
    if (p.node && p.moved) {
      const id = p.node.id
      dragging.current = false
      setDragId(null)
      // Let the last frame land, then keep the place with the world.
      requestAnimationFrame(() =>
        setMoved((m) => {
          const at = m.get(id)
          if (at) void api.moveMapCharacter(id, at.x, at.y).catch(() => undefined)
          return new Map(m)
        })
      )
    } else if (!p.moved && !p.node) {
      // A click on a tie's line opens its card; on the paper, it puts the card away.
      const key = tieAt(p.x - box.current!.getBoundingClientRect().left - viewRef.current.tx, p.y - box.current!.getBoundingClientRect().top - viewRef.current.ty)
      if (key) select({ kind: 'tie', key })
      else if (sel) close()
    }
  }

  // Wheel to zoom about the pointer (not a React handler, so the page never scrolls).
  useEffect(() => {
    const el = box.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1)
      move((v) => zoomAbout(v, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top), false)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [move])

  // Everything pauses while the window is hidden.
  const [paused, setPaused] = useState(() => document.visibilityState === 'hidden')
  useEffect(() => {
    const on = (): void => setPaused(document.visibilityState === 'hidden')
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])

  // ----- The keyboard -----
  const reveal = useCallback(
    (n: DNode) => {
      const { width: w, height: h } = sizeRef.current
      const right = sel ? 400 : 80
      move((v) => {
        const sx = n.x * v.k + v.tx
        const sy = n.y * v.k + v.ty
        const dx = sx < 90 ? 90 - sx : sx > w - right ? w - right - sx : 0
        const dy = sy < PAD.top ? PAD.top - sy : sy > h - PAD.bottom ? h - PAD.bottom - sy : 0
        return dx || dy ? { ...v, tx: v.tx + dx, ty: v.ty + dy } : v
      }, true)
    },
    [move, sel]
  )
  const focusNode = (id: ID): void => {
    box.current?.querySelector<HTMLElement>(`[data-map-node="${CSS.escape(id)}"]`)?.focus()
  }
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const dirs: Record<string, Direction> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }
    const dir = dirs[e.key]
    const active = document.activeElement as HTMLElement | null
    const fromId = active?.dataset.mapNode
    if (dir && e.shiftKey) {
      const step = 160
      const [dx, dy] = dir === 'left' ? [step, 0] : dir === 'right' ? [-step, 0] : dir === 'up' ? [0, step] : [0, -step]
      move((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }), true)
    } else if (dir) {
      const from = fromId ? byId.get(fromId) : undefined
      if (!from) {
        const start = (detail?.povId && byId.get(detail.povId)) || [...nodes].sort((p, q) => RANK_ORDER[p.rank] - RANK_ORDER[q.rank] || (deg.get(q.id) ?? 0) - (deg.get(p.id) ?? 0))[0]
        if (start) focusNode(start.id)
      } else {
        const next = nextOver(nodes, from, dir)
        if (next) focusNode(next.id)
      }
    } else if (e.key === '+' || e.key === '=') zoomBy(1.25)
    else if (e.key === '-' || e.key === '_') zoomBy(0.8)
    else if (e.key === '0') fitNow(true)
    else if (e.key === 'Escape') {
      if (sel) close()
      else if (hotNode || hotTie) {
        setHotNode(null)
        setHotTie(null)
        box.current?.focus()
      } else return
    } else return
    e.preventDefault()
    e.stopPropagation()
  }

  const onNodeFocus = useCallback(
    (id: ID) => {
      setHotNode(id)
      const n = byId.get(id)
      if (n) reveal(n)
    },
    [byId, reveal]
  )
  const onNodeClick = useCallback((id: ID) => select({ kind: 'node', id }), [select])
  const onTieClick = useCallback((key: string) => select({ kind: 'tie', key }), [select])

  const names = (id: ID): string => byId.get(id)?.name ?? 'Someone'
  const note = detail ? changeWords(detail.here, names) : null
  const atStop = detail?.atStop ?? index
  const stop = map.stops[atStop]
  const kindsShown = useMemo(() => {
    const c = new Map<TieKind, number>()
    for (const t of ties) c.set(t.kind, (c.get(t.kind) ?? 0) + 1)
    return TIE_KINDS.filter((x) => c.has(x.kind)).map((x) => ({ ...x, n: c.get(x.kind)! }))
  }, [ties])
  const hasMap = nodes.length > 0
  const regionPts = members ? nodes.filter((n) => members.has(n.id)).map((n) => ({ x: n.x * k, y: n.y * k })) : []
  const regionTop = regionPts.length ? regionPts.reduce((best, p) => (p.y < best.y ? p : best), regionPts[0]) : null
  const stagger = nodes.length <= 40

  const allLeavingTies = [...leaving.ties.values()].filter((t) => !ties.some((x) => x.key === t.key))
  const allLeavingNodes = [...leaving.nodes.values()].filter((n) => !byId.has(n.id))

  return (
    <div
      className="dm-stage"
      data-quiet={litNodes ? '' : undefined}
      data-crowd={crowd || undefined}
      data-selected={selKey || undefined}
      data-hot-kind={hotKind ?? undefined}
      data-paused={paused || undefined}
    >
      <div
        ref={box}
        role="group"
        aria-label="Relationship map"
        aria-describedby="dm-help"
        tabIndex={hasMap ? 0 : -1}
        className="dm-canvas"
        data-panning={panning || undefined}
        data-on-line={hotTie && onLine.current ? '' : undefined}
        onKeyDown={hasMap ? onKeyDown : undefined}
        onPointerDown={hasMap ? onPointerDown : undefined}
        onPointerMove={onPointerMove}
        onPointerUp={endPress}
        onPointerCancel={endPress}
        onPointerLeave={() => {
          if (onLine.current) {
            onLine.current = false
            setHotTie(null)
          }
        }}
        onClickCapture={(e) => {
          if (!suppressClick.current) return
          suppressClick.current = false
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        {hasMap ? (
          <div className="dm-layer" data-gliding={gliding || undefined} style={{ transform: `translate3d(${view.tx}px, ${view.ty}px, 0)` }}>
            {/* Every tie, on a layer of its own: pointing dims it as a whole (no repaint), and the lit ties are drawn again on
                top. */}
            <svg className="dm-lines dm-lines-base" width={1} height={1} aria-hidden>
              {regionPts.length ? (
                <>
                  <path className="dm-region" d={hullPath(regionPts)} strokeWidth={Math.max(110, MEDAL.lead * ms * 1.6)} />
                </>
              ) : null}
              {ties.map((t) => (
                <TieLine
                  key={t.key}
                  tie={t}
                  d={arcs.get(t.key)!.d}
                  lit={false}
                  out={!!members && (!members.has(t.a) || !members.has(t.b))}
                  isKind={false}
                  fresh={isNew(`t:${t.key}`)}
                  here={here.has(t.key)}
                />
              ))}
              {allLeavingTies.map((t) => {
                const a = prev.current.nodes.get(t.a) ?? leaving.nodes.get(t.a)
                const b = prev.current.nodes.get(t.b) ?? leaving.nodes.get(t.b)
                const pa = byId.get(t.a) ?? a
                const pb = byId.get(t.b) ?? b
                if (!pa || !pb) return null
                const d = arcOf({ x: pa.x * k, y: pa.y * k }, { x: pb.x * k, y: pb.y * k }, { x: centre.x * k, y: centre.y * k }, t.key).d
                return <TieLine key={`gone:${t.key}`} tie={t} d={d} lit={false} out={false} isKind={false} fresh={false} here={false} leaving />
              })}
            </svg>
            {litNodes || hotKind ? (
              <svg className="dm-lines dm-lines-top" width={1} height={1} aria-hidden>
                {ties
                  .filter((t) => (litNodes ? litNodes.ties.has(t.key) : t.kind === hotKind))
                  .map((t) => (
                    <TieLine key={t.key} tie={t} d={arcs.get(t.key)!.d} lit out={false} isKind fresh={false} here={false} top />
                  ))}
              </svg>
            ) : null}
            {regionTop && group ? (
              <span className="dm-region-name" style={{ left: regionTop.x, top: regionTop.y - Math.max(55, MEDAL.lead * ms * 0.8) - 8 }}>
                {group.name}
              </span>
            ) : null}
            {ties.map((t) => {
              const m = arcs.get(t.key)!.mid
              const lit = !!litNodes?.ties.has(t.key)
              return (
                <Pill
                  key={t.key}
                  tie={t}
                  x={m.x}
                  y={m.y}
                  aName={byId.get(t.a)!.name}
                  bName={byId.get(t.b)!.name}
                  show={litRoom && lit ? litRoom.has(`t:${t.key}`) : room.has(`t:${t.key}`)}
                  lit={lit}
                  open={openPills && lit}
                  out={!!members && (!members.has(t.a) || !members.has(t.b))}
                  isKind={hotKind === t.kind}
                  fresh={isNew(`p:${t.key}`)}
                  onHot={setHotTie}
                  onClick={onTieClick}
                />
              )
            })}
            {nodes.map((n, i) => (
              <Node
                key={n.id}
                node={n}
                x={n.x * k}
                y={n.y * k}
                size={sizeOf(n)}
                motif={motifs.get(n.id) ?? null}
                pov={detail?.povId === n.id}
                showName={litRoom && litNodes?.nodes.has(n.id) ? litRoom.has(`n:${n.id}`) : room.has(`n:${n.id}`)}
                lit={!!litNodes?.nodes.has(n.id)}
                hot={hotNode === n.id}
                sel={sel?.kind === 'node' && sel.id === n.id}
                out={!!members && !members.has(n.id)}
                isKind={!!kindNodes?.has(n.id)}
                fresh={isNew(`n:${n.id}`)}
                delay={stagger ? Math.min(240, RANK_ORDER[n.rank] * 50 + i * 6) : 0}
                dragging={dragId === n.id}
                onHot={setHotNode}
                onFocusNode={onNodeFocus}
                onClick={onNodeClick}
              />
            ))}
            {allLeavingNodes.map((n) => (
              <Node
                key={`gone:${n.id}`}
                node={n}
                x={n.x * k}
                y={n.y * k}
                size={sizeOf(n)}
                motif={motifs.get(n.id) ?? null}
                pov={false}
                showName={false}
                lit={false}
                hot={false}
                sel={false}
                out={false}
                isKind={false}
                fresh={false}
                delay={0}
                dragging={false}
                leaving
              />
            ))}
          </div>
        ) : null}
      </div>
      <p id="dm-help" className="sr-only">
        Use the arrow keys to move between characters and Enter to see one’s ties; Shift and the arrow keys move the map. Drag a
        character to move it. Scroll or press + and − to zoom, 0 to fit.
      </p>

      {detail && map.stops.length ? <TimeStrip stops={map.stops} info={detail.stops} index={index} onPick={onPick} /> : null}

      {note && stop && (note.lines.length || stop.sceneId) ? (
        <div key={`${atStop}:${map.storyId}`} className="dm-float dm-note" data-map-note data-quiet-note={note.lines.length ? undefined : ''} role="status">
          {note.lines.length ? (
            <>
              <span className="dm-note-k">
                <i />
                {note.lead}
              </span>
              <span>
                {note.lines.join('; ')}
                {note.more ? <span className="dm-note-more"> · and {note.more} more</span> : null}
              </span>
            </>
          ) : (
            <span>No ties change in this scene.</span>
          )}
        </div>
      ) : null}

      {hasMap ? (
        <div className="dm-float dm-legend" data-map-legend>
          <span className="dm-caps">Ties</span>
          {kindsShown.map((x) => (
            <button
              key={x.kind}
              type="button"
              className="dm-lg"
              data-kind={x.kind}
              onPointerEnter={() => setHotKind(x.kind)}
              onPointerLeave={() => setHotKind(null)}
              onFocus={() => setHotKind(x.kind)}
              onBlur={() => setHotKind(null)}
              aria-label={`${x.label}: ${x.n}`}
            >
              <Swatch kind={x.kind} />
              {x.label} <b>{x.n}</b>
            </button>
          ))}
          <span className="dm-lg-sep" />
          <span className="dm-lg">
            <i className="dm-mood" data-mood="warm" />
            Warm
          </span>
          <span className="dm-lg">
            <i className="dm-mood" data-mood="mixed" />
            Mixed
          </span>
          <span className="dm-lg">
            <i className="dm-mood" data-mood="cold" />
            Tense
          </span>
          {detail?.povId && byId.has(detail.povId) ? (
            <>
              <span className="dm-lg-sep" />
              <span className="dm-lg">
                <Eye size={14} className="text-accent" />
                Point of view
              </span>
            </>
          ) : null}
        </div>
      ) : null}

      {hasMap && map.everyone.length > 30 && width ? (
        <MiniMap
          places={everyone}
          lead={nodes.filter((n) => n.rank === 'lead').map((n) => n.id)}
          view={view}
          width={width}
          height={height}
          onCentre={(p) => move((v) => ({ ...v, tx: width / 2 - p.x * v.k, ty: height / 2 - p.y * v.k }), true)}
        />
      ) : null}

      {hasMap ? (
        <div className="dm-float dm-zoom">
          <button type="button" className="dm-icon-btn" aria-label="Zoom out" onClick={() => zoomBy(0.8)}>
            <Minus size={16} />
          </button>
          <span className="dm-zoom-v">{Math.round((view.k / (fitK.current || 1)) * 100)}%</span>
          <button type="button" className="dm-icon-btn" aria-label="Zoom in" onClick={() => zoomBy(1.25)}>
            <Plus size={16} />
          </button>
          <span className="dm-zoom-sep" />
          <button type="button" className="dm-icon-btn" aria-label="Fit everyone on screen" onClick={() => fitNow(true)}>
            <Maximize size={15} />
          </button>
        </div>
      ) : null}

      {sel?.kind === 'node' && byId.get(sel.id) ? (
        <NodeCard
          key={sel.id}
          node={byId.get(sel.id)!}
          ties={ties}
          nodes={byId}
          motifs={motifs}
          povId={detail?.povId ?? null}
          history={history}
          atStop={atStop}
          asOf={stop?.label ?? map.label}
          storyId={map.storyId}
          closing={closing}
          onClose={close}
          onTie={(key) => select({ kind: 'tie', key })}
        />
      ) : sel?.kind === 'tie' && ties.find((t) => t.key === sel.key) ? (
        <TieCard
          key={sel.key}
          tie={ties.find((t) => t.key === sel.key)!}
          nodes={byId}
          motifs={motifs}
          history={history.get(sel.key)}
          atStop={atStop}
          storyId={map.storyId}
          closing={closing}
          onClose={close}
          onNode={(id) => select({ kind: 'node', id })}
        />
      ) : null}
    </div>
  )
}

/** A tie kind's line, for the legend. */
function Swatch({ kind }: { kind: TieKind }): React.JSX.Element {
  const dash = kind === 'rival' ? '4 3.5' : kind === 'mentor' ? '8 3' : kind === 'other' ? '1 3.5' : undefined
  return (
    <svg className="dm-swatch" width={26} height={10} viewBox="0 0 26 10" aria-hidden>
      <path d="M2 5h22" stroke="var(--tie)" strokeWidth={kind === 'family' ? 5 : kind === 'love' ? 3 : 2.2} strokeDasharray={dash} strokeLinecap={dash ? 'butt' : 'round'} />
      {kind === 'family' ? <path d="M2 5h22" stroke="var(--raise)" strokeWidth={1.4} /> : null}
    </svg>
  )
}

const SOLID = new Set<TieKind>(['family', 'love', 'friend', 'duty'])

const TieLine = memo(function TieLine({
  tie: t,
  d,
  lit,
  out,
  isKind,
  fresh,
  here,
  leaving = false,
  top = false
}: {
  tie: DTie
  d: string
  lit: boolean
  out: boolean
  isKind: boolean
  fresh: boolean
  here: boolean
  leaving?: boolean
  /** Drawn again over the dimmed map, lit. */
  top?: boolean
}): React.JSX.Element {
  return (
    <g
      className={['dm-tie', lit && 'is-lit', out && 'is-out', isKind && 'is-kind', fresh && 'is-new', here && 'is-here', leaving && 'is-leaving'].filter(Boolean).join(' ')}
      data-kind={t.kind}
      data-top={top || undefined}
    >
      {lit || here ? <path className="dm-tie-glow" d={d} /> : null}
      {/* Drawn in along its length on arriving (a solid line; a dashed one fades in). */}
      <path className="dm-tie-line" d={d} pathLength={fresh && SOLID.has(t.kind) ? 1 : undefined} />
      {t.kind === 'family' ? <path className="dm-tie-gap" d={d} /> : null}
    </g>
  )
})

const Pill = memo(function Pill({
  tie: t,
  x,
  y,
  aName,
  bName,
  show,
  lit,
  open,
  out,
  isKind,
  fresh,
  onHot,
  onClick
}: {
  tie: DTie
  x: number
  y: number
  aName: string
  bName: string
  show: boolean
  lit: boolean
  open: boolean
  out: boolean
  isKind: boolean
  fresh: boolean
  onHot: (key: string | null) => void
  onClick: (key: string) => void
}): React.JSX.Element {
  const [a, b] = t.sides
  const label = `${aName} and ${bName}: ${t.words || 'tied'}. ${aName} feels ${a.feels || 'nothing noted'}. ${bName} feels ${b.feels || 'nothing noted'}.`
  return (
    <button
      type="button"
      data-map-tie={t.key}
      data-kind={t.kind}
      aria-label={label}
      className={['dm-pill', !show && 'is-hidden', lit && 'is-lit', open && 'is-open', out && 'is-out', isKind && 'is-kind', fresh && 'is-new']
        .filter(Boolean)
        .join(' ')}
      style={{ left: x, top: y }}
      onPointerEnter={() => onHot(t.key)}
      onPointerLeave={() => onHot(null)}
      onFocus={() => onHot(t.key)}
      onBlur={() => onHot(null)}
      onClick={() => onClick(t.key)}
    >
      {/* The same words element open or not, so a click that opens it on the way in still lands. */}
      <span key={t.words} className="dm-pill-words">
        {t.words || 'Tied'}
      </span>
      {open ? (
        <>
          <Feel side={a} name={aName} short />
          <Feel side={b} name={bName} short />
        </>
      ) : a.mood || b.mood ? (
        <span className="dm-moods" aria-hidden>
          <i className="dm-mood" data-mood={a.mood ?? undefined} />
          <i className="dm-mood" data-mood={b.mood ?? undefined} />
        </span>
      ) : null}
    </button>
  )
})

const Node = memo(function Node({
  node: n,
  x,
  y,
  size,
  motif,
  pov,
  showName,
  lit,
  hot,
  sel,
  out,
  isKind,
  fresh,
  delay,
  dragging,
  leaving = false,
  onHot,
  onFocusNode,
  onClick
}: {
  node: DNode
  x: number
  y: number
  size: number
  motif: string | null
  pov: boolean
  showName: boolean
  lit: boolean
  hot: boolean
  sel: boolean
  out: boolean
  isKind: boolean
  fresh: boolean
  delay: number
  dragging: boolean
  leaving?: boolean
  onHot?: (id: ID | null) => void
  onFocusNode?: (id: ID) => void
  onClick?: (id: ID) => void
}): React.JSX.Element {
  const role = roleWords(n.role)
  return (
    <button
      type="button"
      data-map-node={leaving ? undefined : n.id}
      data-rank={n.rank}
      data-pov={pov || undefined}
      data-dragging={dragging || undefined}
      aria-label={n.name}
      aria-description={[role, pov ? 'point of view in this scene' : ''].filter(Boolean).join(', ') || undefined}
      tabIndex={leaving ? -1 : 0}
      className={['dm-node', lit && 'is-lit', hot && 'is-hot', sel && 'is-sel', out && 'is-out', isKind && 'is-kind', fresh && 'is-new', leaving && 'is-leaving']
        .filter(Boolean)
        .join(' ')}
      style={{ transform: `translate3d(${x}px, ${y}px, 0)`, '--s': `${size}px`, '--dm-delay': `${delay}ms` } as React.CSSProperties}
      onPointerEnter={() => onHot?.(n.id)}
      onPointerLeave={() => onHot?.(null)}
      onFocus={() => onFocusNode?.(n.id)}
      onBlur={() => onHot?.(null)}
      onClick={() => onClick?.(n.id)}
    >
      <Medal id={n.id} name={n.name} image={n.image} motif={motif} size={size}>
        {pov ? <span className="dm-pov-orbit" /> : null}
        <span className="dm-sel" />
        {pov ? (
          <span className="dm-pov" title="Point of view in this scene">
            <Eye size={13} />
          </span>
        ) : null}
      </Medal>
      <span className={['dm-label', !showName && 'is-hidden'].filter(Boolean).join(' ')}>
        <span className="dm-name">{n.name}</span>
        {role ? <span className="dm-role">{role}</span> : null}
      </span>
    </button>
  )
})

/** For a big cast: the whole map small, the window's part of it outlined; a click goes there. */
function MiniMap({
  places,
  lead,
  view,
  width,
  height,
  onCentre
}: {
  places: (Pt & { id: ID })[]
  lead: ID[]
  view: View
  width: number
  height: number
  onCentre: (p: Pt) => void
}): React.JSX.Element {
  const W = 200
  const H = 136
  const P = 10
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const p of places) {
    x0 = Math.min(x0, p.x)
    x1 = Math.max(x1, p.x)
    y0 = Math.min(y0, p.y)
    y1 = Math.max(y1, p.y)
  }
  const s = Math.min((W - 2 * P) / Math.max(1, x1 - x0), (H - 2 * P) / Math.max(1, y1 - y0))
  const ox = (W - (x1 - x0) * s) / 2 - x0 * s
  const oy = (H - (y1 - y0) * s) / 2 - y0 * s
  const leads = new Set(lead)
  const vx = (-view.tx / view.k) * s + ox
  const vy = (-view.ty / view.k) * s + oy
  const vw = (width / view.k) * s
  const vh = (height / view.k) * s
  return (
    <svg
      className="dm-float dm-mini"
      data-map-minimap
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="The whole map, with the part in the window outlined"
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        onCentre({ x: ((e.clientX - r.left) * (W / r.width) - ox) / s, y: ((e.clientY - r.top) * (H / r.height) - oy) / s })
      }}
    >
      {places.map((p, i) => (
        <circle key={i} cx={p.x * s + ox} cy={p.y * s + oy} r={leads.has(p.id) ? 3.2 : 1.8} className={leads.has(p.id) ? 'dm-mini-lead' : undefined} />
      ))}
      <rect x={vx} y={vy} width={vw} height={vh} rx={3} />
    </svg>
  )
}
