// The relationship map (milestone 3): characters as portraits joined by their relationships, as of a
// point on the as-of slider and as seen in one story, with a group filter. The layout comes from the
// main process and stays put, so moving the slider only shows and hides characters and lines.
// Drag or use the arrow keys to move around; scroll or press + and - to zoom, 0 to fit. Clicking a
// character opens its page; hovering or focusing a line shows how each feels.
import { Maximize, Network, ZoomIn, ZoomOut } from 'lucide-react'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AsOf, ID } from '@shared/types'
import type { MapNode, RelationshipMap as MapData } from '@shared/contracts/worldViews'
import { Button, EmptyState, IconButton, Select } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { AsOfSlider } from '@/features/views/AsOfSlider'
import { AsSeenIn } from '@/features/views/AsSeenIn'
import { Portrait } from '@/features/views/Portrait'
import { useSize, useViewStory, useWorldView, ViewError, ViewHeader, ViewLoading } from '@/features/timeline/viewParts'
import {
  countText,
  feelsText,
  fitView,
  LABELS_ZOOM,
  NAMES_ZOOM,
  reveal,
  tieLabel,
  tieName,
  visibleGraph,
  whereText,
  zoomAt,
  type Tie,
  type View
} from './mapLogic'

/** How far the arrow keys move the map (with Shift, further). */
const STEP = 60
/** Half a portrait: names sit under it, and the point of a character is its portrait's centre. */
const HALF = 22

export function RelationshipMap(): React.JSX.Element {
  const [storyId, setStoryId] = useViewStory()
  const sceneId = useApp((s) => s.sceneId)
  const [at, setAt] = useState<AsOf | null>(null)
  const [groupId, setGroupId] = useState<ID | null>(null)
  const groupName = useRef('')

  // With no point picked, the map opens at the scene Adam is in (or the story's end); a picked point waits
  // a moment, so dragging the slider asks only for where it settles.
  const load = useCallback((id: ID) => api.getRelationshipMap(id, at, at ? null : sceneId), [at, sceneId])
  const key = at ? JSON.stringify(at) : `scene:${sceneId ?? ''}`
  const { data, error, retry } = useWorldView(storyId, load, key, at ? 60 : 0)

  const pickStory = (id: ID): void => {
    setStoryId(id)
    setAt(null)
    setGroupId(null)
  }
  const pickGroup = (id: ID | null): void => {
    groupName.current = data?.groups.find((g) => g.id === id)?.name ?? ''
    setGroupId(id)
  }

  // The group picked stays on offer when the slider moves to where nobody belongs to it yet.
  const groupOptions = useMemo(() => {
    const options = (data?.groups ?? []).map((g) => ({ value: g.id, label: g.name }))
    if (groupId && !options.some((o) => o.value === groupId)) options.push({ value: groupId, label: groupName.current || 'This group' })
    return options
  }, [data, groupId])

  const visible = useMemo(() => (data ? visibleGraph(data, groupId) : null), [data, groupId])

  return (
    <div className="flex h-full flex-col">
      <ViewHeader title="Relationship map" subtitle="How your characters are tied to each other, and how each feels about it.">
        <AsSeenIn value={storyId} onChange={pickStory} className="w-[200px]" />
        {groupOptions.length ? (
          <label className="w-[200px]">
            <span className="mb-1 block text-[11.5px] font-medium text-muted">Group</span>
            <Select value={groupId} onChange={pickGroup} options={groupOptions} allowNone noneLabel="Everyone" />
          </label>
        ) : null}
      </ViewHeader>
      {data && visible ? (
        <>
          {data.any ? (
            <div className="flex shrink-0 items-end gap-6 border-b border-line px-6 py-2.5">
              <AsOfSlider stops={data.stops} value={at ?? data.at} onChange={setAt} className="min-w-0 flex-1" />
              <span className="shrink-0 pb-0.5 text-[12px] tabular-nums text-faint">
                {countText(visible.nodes.length, visible.ties.length)}
              </span>
            </div>
          ) : null}
          <MapCanvas
            key={data.storyId}
            map={data}
            nodes={visible.nodes}
            ties={visible.ties}
            fitKey={`${groupId ?? ''}|${visible.nodes.length > 0}`}
            empty={
              !data.any ? (
                <EmptyState
                  icon={<Network size={20} />}
                  title="No relationships yet"
                  actions={
                    <Button onClick={() => useApp.getState().navigate({ kind: 'entries', entryKind: 'character', entryId: null })}>
                      Go to characters
                    </Button>
                  }
                >
                  Relationships come from your story. As you write, the memory notes how characters are tied to each other (sister, rival,
                  owes money) and how each feels about it. You can also add them yourself under Relationships on a character’s page.
                </EmptyState>
              ) : groupId && !visible.nodes.length ? (
                <EmptyState
                  icon={<Network size={20} />}
                  title={`Nobody in ${groupName.current || 'this group'} yet`}
                  actions={<Button onClick={() => pickGroup(null)}>Show everyone</Button>}
                >
                  No one belongs to {groupName.current || 'this group'} as of {data.label}.
                </EmptyState>
              ) : !visible.nodes.length ? (
                <EmptyState
                  icon={<Network size={20} />}
                  title="No relationships at this point"
                  actions={<Button onClick={() => data.stops.length && setAt(data.stops[data.stops.length - 1].at)}>Go to the end</Button>}
                >
                  Nobody is tied to anyone yet as of {data.label}. Move the slider on to watch relationships form.
                </EmptyState>
              ) : null
            }
          />
        </>
      ) : error ? (
        <ViewError what="The relationship map" error={error} onRetry={retry} />
      ) : !storyId ? (
        <EmptyState icon={<Network size={20} />} title="No story yet" className="mt-[10vh]">
          Add a story in the binder, and the relationships between its characters appear here.
        </EmptyState>
      ) : (
        <ViewLoading />
      )}
    </div>
  )
}

const openCharacter = (id: ID): void => useApp.getState().navigate({ kind: 'entries', entryKind: 'character', entryId: id })

/** The map itself: pans and zooms, keeps its view as the slider moves, and fits itself when the group changes. */
function MapCanvas({
  map,
  nodes,
  ties,
  fitKey,
  empty
}: {
  map: MapData
  nodes: MapNode[]
  ties: Tie[]
  fitKey: string
  empty: React.ReactNode
}): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const { width, height } = useSize(box)
  const [view, setView] = useState<View>({ tx: 0, ty: 0, k: 1 })
  const [smooth, setSmooth] = useState(false)
  const [hotNode, setHotNode] = useState<ID | null>(null)
  const [hotTie, setHotTie] = useState<string | null>(null)
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes

  // Fits the map to the window when it opens, when the group changes, and when characters first appear.
  const fitted = useRef<string | null>(null)
  const lastSize = useRef({ width: 0, height: 0 })
  useLayoutEffect(() => {
    if (!width || !height) return
    if (fitted.current !== fitKey) {
      fitted.current = fitKey
      setSmooth(lastSize.current.width > 0)
      setView(fitView(nodesRef.current, width, height))
    } else {
      // The window changed size: keep what was in the middle in the middle.
      const dw = width - lastSize.current.width
      const dh = height - lastSize.current.height
      if (dw || dh) setView((v) => ({ ...v, tx: v.tx + dw / 2, ty: v.ty + dh / 2 }))
    }
    lastSize.current = { width, height }
  }, [fitKey, width, height])

  const move = useCallback((next: (v: View) => View, animate: boolean) => {
    setSmooth(animate)
    setView(next)
  }, [])
  const zoomBy = (factor: number): void => move((v) => zoomAt(v, factor, width / 2, height / 2), true)
  const fit = (): void => move(() => fitView(nodesRef.current, width, height), true)

  // Scroll to zoom about the pointer. Not a React handler, so the page itself never scrolls or zooms.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1)
      const factor = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015))
      setSmooth(false)
      setView((v) => zoomAt(v, factor, e.clientX - r.left, e.clientY - r.top))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Dragging anywhere moves the map; a drag that started on a character doesn't open it.
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null)
  const dragged = useRef(false)
  const [dragging, setDragging] = useState(false)
  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    dragged.current = false
    drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.moved) {
      if (Math.hypot(dx, dy) < 4) return
      d.moved = true
      e.currentTarget.setPointerCapture(e.pointerId)
      setDragging(true)
      setHotTie(null)
    }
    move((v) => ({ ...v, tx: d.tx + dx, ty: d.ty + dy }), false)
  }
  const endDrag = (): void => {
    dragged.current = !!drag.current?.moved
    drag.current = null
    setDragging(false)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const step = e.shiftKey ? STEP * 3 : STEP
    const pan = (dx: number, dy: number): void => move((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }), true)
    switch (e.key) {
      case 'ArrowLeft':
        pan(step, 0)
        break
      case 'ArrowRight':
        pan(-step, 0)
        break
      case 'ArrowUp':
        pan(0, step)
        break
      case 'ArrowDown':
        pan(0, -step)
        break
      case '+':
      case '=':
        zoomBy(1.25)
        break
      case '-':
      case '_':
        zoomBy(0.8)
        break
      case '0':
        fit()
        break
      default:
        return
    }
    e.preventDefault()
  }

  // A character reached with Tab is brought into view.
  const onFocusNode = useCallback(
    (n: MapNode) => {
      setHotNode(n.id)
      move((v) => reveal(v, n.x, n.y, width, height), true)
    },
    [move, width, height]
  )
  const onFocusTie = useCallback(
    (t: Tie) => {
      setHotTie(t.key)
      move((v) => reveal(v, (t.a.x + t.b.x) / 2, (t.a.y + t.b.y) / 2, width, height), true)
    },
    [move, width, height]
  )

  const names = useMemo(() => new Map(map.nodes.map((n) => [n.id, n.name])), [map])
  const tie = hotTie ? ties.find((t) => t.key === hotTie) : undefined
  const hasMap = nodes.length > 0

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={box}
        role="group"
        aria-label="Relationship map"
        aria-describedby="map-help"
        tabIndex={hasMap ? 0 : -1}
        onKeyDown={hasMap ? onKeyDown : undefined}
        onPointerDown={hasMap ? onPointerDown : undefined}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={(e) => {
          if (!dragged.current) return
          dragged.current = false
          e.preventDefault()
          e.stopPropagation()
        }}
        className={cn(
          'absolute inset-0 select-none overflow-clip bg-bg outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40',
          hasMap && (dragging ? 'cursor-grabbing' : 'cursor-grab')
        )}
      >
        {hasMap ? (
          <div
            className={cn('absolute left-0 top-0 origin-top-left', smooth && 'transition-transform duration-200 ease-out')}
            style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.k})` }}
          >
            <Layer
              nodes={nodes}
              ties={ties}
              names={names}
              hotNode={hotNode}
              hotTie={hotTie}
              showLabels={view.k >= LABELS_ZOOM}
              showNames={view.k >= NAMES_ZOOM}
              onHotNode={setHotNode}
              onHotTie={setHotTie}
              onFocusNode={onFocusNode}
              onFocusTie={onFocusTie}
            />
          </div>
        ) : null}
        {tie && !dragging ? <TieCard tie={tie} view={view} names={names} /> : null}
      </div>
      {!hasMap ? (
        <div className="pointer-events-none absolute inset-0 flex items-start justify-center pt-[8vh] [&>*]:pointer-events-auto">
          {empty}
        </div>
      ) : null}
      {hasMap ? (
        <>
          <p
            id="map-help"
            className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-bg/85 px-1.5 py-0.5 text-[11.5px] text-faint"
          >
            Drag or use the arrow keys to move around. Scroll or press + and − to zoom, 0 to fit.
          </p>
          <div className="absolute bottom-3 right-3 flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5 shadow-soft">
            <IconButton label="Zoom in" onClick={() => zoomBy(1.25)}>
              <ZoomIn size={16} />
            </IconButton>
            <IconButton label="Zoom out" onClick={() => zoomBy(0.8)}>
              <ZoomOut size={16} />
            </IconButton>
            <IconButton label="Fit the map to the window" onClick={fit}>
              <Maximize size={15} />
            </IconButton>
          </div>
        </>
      ) : null}
    </div>
  )
}

/**
 * Everything drawn on the map, in map units. Kept apart from the view, so moving and zooming only
 * changes one transform and never redraws a few hundred characters.
 */
const Layer = memo(function Layer({
  nodes,
  ties,
  names,
  hotNode,
  hotTie,
  showLabels,
  showNames,
  onHotNode,
  onHotTie,
  onFocusNode,
  onFocusTie
}: {
  nodes: MapNode[]
  ties: Tie[]
  names: Map<ID, string>
  hotNode: ID | null
  hotTie: string | null
  showLabels: boolean
  showNames: boolean
  onHotNode: (id: ID | null) => void
  onHotTie: (key: string | null) => void
  onFocusNode: (n: MapNode) => void
  onFocusTie: (t: Tie) => void
}): React.JSX.Element {
  // Pointing at a character lights up its relationships and the characters at their other end.
  const near = useMemo(() => {
    if (!hotNode) return null
    const ids = new Set<ID>([hotNode])
    for (const t of ties) if (t.a.id === hotNode || t.b.id === hotNode) ids.add(t.a.id).add(t.b.id)
    return ids
  }, [hotNode, ties])
  const lit = (t: Tie): boolean => t.key === hotTie || (!!hotNode && (t.a.id === hotNode || t.b.id === hotNode))
  const name = (id: ID): string => names.get(id) ?? 'Someone'

  return (
    <>
      <svg className="absolute left-0 top-0 overflow-visible" width={1} height={1} aria-hidden>
        {ties.map((t) => {
          const on = lit(t)
          return (
            <g key={t.key} className={cn('transition-opacity duration-150', (near || hotTie) && !on && 'opacity-25')}>
              <line
                x1={t.a.x}
                y1={t.a.y}
                x2={t.b.x}
                y2={t.b.y}
                stroke={on ? 'var(--accent)' : 'var(--line-strong)'}
                strokeWidth={on ? 2 : 1.5}
                vectorEffect="non-scaling-stroke"
              />
              {/* A wider, invisible line, so the relationship is easy to point at. */}
              <line
                x1={t.a.x}
                y1={t.a.y}
                x2={t.b.x}
                y2={t.b.y}
                stroke="transparent"
                strokeWidth={12}
                vectorEffect="non-scaling-stroke"
                pointerEvents="stroke"
                onPointerEnter={() => onHotTie(t.key)}
                onPointerLeave={() => onHotTie(null)}
              />
            </g>
          )
        })}
      </svg>
      {nodes.map((n) => (
        <button
          key={n.id}
          type="button"
          aria-label={n.name}
          title={`Open ${n.name}’s page`}
          onClick={() => openCharacter(n.id)}
          onPointerEnter={() => onHotNode(n.id)}
          onPointerLeave={() => onHotNode(null)}
          onFocus={() => onFocusNode(n)}
          onBlur={() => onHotNode(null)}
          className={cn(
            'group absolute z-[2] flex w-[124px] -translate-x-1/2 flex-col items-center gap-1 rounded-lg outline-none animate-fade-in transition-opacity duration-150',
            near && !near.has(n.id) && 'opacity-30'
          )}
          style={{ left: n.x, top: n.y - HALF }}
        >
          <Portrait
            entry={{ name: n.name, kind: 'character', image: n.image }}
            size={HALF * 2}
            className="shadow-soft ring-2 ring-bg transition-shadow duration-150 group-hover:ring-accent/60 group-focus-visible:ring-accent"
          />
          {showNames ? (
            <span className="max-w-full truncate rounded bg-bg/85 px-1.5 text-[12px] font-medium leading-[18px] text-fg group-focus-visible:text-accent">
              {n.name}
            </span>
          ) : null}
        </button>
      ))}
      {ties.map((t) => {
        const label = tieLabel(t)
        const on = lit(t)
        return (
          <button
            key={t.key}
            type="button"
            aria-label={tieName(t, name)}
            onPointerEnter={() => onHotTie(t.key)}
            onPointerLeave={() => onHotTie(null)}
            onFocus={() => onFocusTie(t)}
            onBlur={() => onHotTie(null)}
            className={cn(
              'absolute z-[1] max-w-[150px] -translate-x-1/2 -translate-y-1/2 truncate rounded-full border bg-surface px-2 text-[11px] leading-[18px] outline-none transition-[opacity,color,border-color] duration-150 focus-visible:ring-2 focus-visible:ring-accent/50',
              on ? 'border-accent/50 text-fg' : 'border-line text-muted',
              (near || hotTie) && !on && 'opacity-25',
              // Too small to read: hidden, but still reached with Tab (it shows itself when focused).
              (!showLabels || !label) && 'pointer-events-none opacity-0 focus-visible:opacity-100'
            )}
            style={{ left: (t.a.x + t.b.x) / 2, top: (t.a.y + t.b.y) / 2 }}
          >
            {label || 'Tied'}
          </button>
        )
      })}
    </>
  )
})

/** How each feels about a relationship, beside its line. Drawn at screen size, whatever the zoom. */
function TieCard({ tie, view, names }: { tie: Tie; view: View; names: Map<ID, string> }): React.JSX.Element {
  const name = (id: ID): string => names.get(id) ?? 'Someone'
  const x = ((tie.a.x + tie.b.x) / 2) * view.k + view.tx
  const y = ((tie.a.y + tie.b.y) / 2) * view.k + view.ty
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-20 w-max max-w-[280px] -translate-x-1/2 rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px] leading-relaxed shadow-pop animate-fade-in"
      style={{ left: x, top: y + 16 }}
    >
      <p className="font-medium text-fg">
        {tie.a.name} and {tie.b.name}
      </p>
      {tie.links.map((l, i) => {
        const feels = feelsText(l, name)
        return (
          <div key={i} className={cn(i > 0 && 'mt-1.5 border-t border-line pt-1.5')}>
            {l.type ? <p className="text-accent">{l.type}</p> : null}
            {feels.map((f) => (
              <p key={f} className="text-muted">
                {f}
              </p>
            ))}
            <p className="text-[11.5px] text-faint">{whereText(l)}</p>
          </div>
        )
      })}
    </div>
  )
}
