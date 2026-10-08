// The timeline (milestone 3), as Classic shows it (the New look shows the river, TimelineRiver.tsx): a story's scenes and events in the order they happen in the world, read
// from each scene card's When box, with a lane for each character (or plot thread) Adam picks. Clicking
// a scene opens it; clicking an event opens its page. A character in two places on the same day is
// marked calmly, with a sentence saying so. Long timelines draw only the rows on screen.
//
// Each row reads When, then the scene, then the lanes, so the scene stays on screen however many lanes
// Adam picks (more than fit scroll sideways); until he picks, only as many as fit are shown.
import * as P from '@radix-ui/react-popover'
import { CalendarRange, CircleAlert, MapPin, Plus, Rows3, Search } from '@/components/ui/icons'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ID } from '@shared/types'
import type { Timeline, TimelineEntry, TimelinePoint } from '@shared/contracts/worldViews'
import { Badge, Button, EmptyState, Input } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useNewLook } from '@/features/look/look'
import { useApp } from '@/lib/store'
import { PopoverPanel, Segmented } from '@/features/generate/parts'
import { Portrait } from '@/features/views/Portrait'
import { useLanes } from './laneStore'
import { TimelineRiver } from './TimelineRiver'
import {
  clashCount,
  dayBands,
  infoWidth,
  laneChoices,
  lanesThatFit,
  laneSpans,
  laneWidth,
  markOf,
  rowLabel,
  shownLanes,
  WHEN_W,
  type Band,
  type LaneMode,
  type Mark
} from './timelineLogic'
import { StoryFilter, useSize, useViewStory, useWorldView, ViewError, ViewHeader, ViewLoading } from './viewParts'

const ROW = 52
/** The sticky header: each lane's portrait over up to two lines of its name. */
const HEAD = 60
/** Room for the timeline's own scroll bar, so the lanes that fit never make it scroll sideways. */
const SCROLLBAR = 16
/** How long the rows of a clash stay lit after its sentence is clicked. */
const FLASH_MS = 1500
/** Rows drawn above and below the screen, so scrolling never shows a gap. */
const OVERSCAN = 10

const loadTimeline = (storyId: ID): Promise<Timeline> => api.getTimeline(storyId)

/** The timeline: the river in the New look (TimelineRiver.tsx, the desk and the panels), this table in Classic. */
export function TimelineView(): React.JSX.Element {
  return useNewLook() ? <TimelineRiver /> : <ClassicTimeline />
}

function ClassicTimeline(): React.JSX.Element {
  const [storyId, setStoryId] = useViewStory()
  const { data, error, retry } = useWorldView(storyId, loadTimeline)
  const mode = useLanes((s) => s.mode)
  const setMode = useLanes((s) => s.setMode)
  const page = useRef<HTMLDivElement>(null)
  const fit = lanesThatFit(useSize(page).width - SCROLLBAR)
  // Lanes mean nothing until a scene has a date: until then the page only explains the When box.
  const dated = !!data?.points.some((p) => p.dated)

  const isNew = useNewLook()
  const subtitle = (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>Scenes and events in the order they happen in your world.</span>
      {dated ? <Legend mode={mode} /> : null}
    </span>
  )

  return (
    // The New look: each lane's marks in the ink of what it follows (characters violet, plot threads moss).
    <div
      ref={page}
      className="flex h-full flex-col"
      style={isNew ? ({ '--lane-ink': mode === 'characters' ? 'var(--k-char)' : 'var(--k-thread)' } as React.CSSProperties) : undefined}
    >
      <ViewHeader title="Timeline" subtitle={subtitle}>
        <StoryFilter value={storyId} onChange={setStoryId} />
        {data && dated ? (
          <>
            <div className="shrink-0">
              <span className="mb-1 block text-[11.5px] font-medium text-muted">Lanes for</span>
              <Segmented<LaneMode>
                label="Lanes for"
                value={mode}
                onChange={setMode}
                className="whitespace-nowrap"
                options={[
                  { value: 'characters', label: 'Characters' },
                  { value: 'threads', label: 'Plot threads' }
                ]}
              />
            </div>
            <LanePicker timeline={data} mode={mode} fit={fit} />
          </>
        ) : null}
      </ViewHeader>
      {data ? (
        // A fresh body once the first date arrives, so it measures the list it now shows.
        <TimelineBody key={`${data.storyId}:${dated}`} timeline={data} mode={mode} fit={fit} />
      ) : error ? (
        <ViewError what="The timeline" error={error} onRetry={retry} />
      ) : !storyId ? (
        <EmptyState
          icon={<CalendarRange size={20} />}
          title="No story yet"
          className="mt-[10vh]"
          actions={
            <Button variant="primary" icon={<Plus size={15} />} onClick={() => useApp.getState().setNewStoryOpen(true)}>
              New story…
            </Button>
          }
        >
          Add a story in the binder, and its scenes appear here in the order they happen.
        </EmptyState>
      ) : (
        <ViewLoading />
      )}
    </div>
  )
}

/** The marks, in words, beside the page's sentence. */
function Legend({ mode }: { mode: LaneMode }): React.JSX.Element {
  const items: [Mark, string][] =
    mode === 'characters'
      ? [
          ['pov', 'Point of view'],
          ['present', 'Present']
        ]
      : [
          ['setUp', 'Set up'],
          ['paidOff', 'Paid off'],
          ['both', 'Set up and paid off']
        ]
  return (
    <span className="flex items-center gap-3 text-[12px] text-faint" aria-hidden>
      {items.map(([mark, label]) => (
        <span key={label} className="flex items-center gap-1.5">
          <MarkDot mark={mark} />
          {label}
        </span>
      ))}
    </span>
  )
}

const worldKey = (mode: LaneMode): string => `${useApp.getState().world?.id ?? ''}:${mode}`

/** Picks which lanes show: every character (or plot thread) on the timeline, busiest first. */
function LanePicker({ timeline, mode, fit }: { timeline: Timeline; mode: LaneMode; fit: number }): React.JSX.Element {
  const key = worldKey(mode)
  const chosen = useLanes((s) => s.chosen[key])
  const choose = useLanes((s) => s.choose)
  const [query, setQuery] = useState('')
  const choices = useMemo(() => laneChoices(timeline, mode), [timeline, mode])
  const shown = useMemo(() => new Set(shownLanes(timeline, mode, chosen, fit).map((e) => e.id)), [timeline, mode, chosen, fit])
  const q = query.trim().toLocaleLowerCase()
  const listed = q ? choices.filter((c) => c.entry.name.toLocaleLowerCase().includes(q)) : choices
  const noun = mode === 'characters' ? 'characters' : 'plot threads'

  const toggle = (id: ID, on: boolean): void => {
    const order = choices.map((c) => c.entry.id)
    const next = new Set(shown)
    if (on) next.add(id)
    else next.delete(id)
    choose(
      key,
      order.filter((x) => next.has(x))
    )
  }

  return (
    <P.Root onOpenChange={(open) => !open && setQuery('')}>
      <P.Trigger asChild>
        <Button icon={<Rows3 size={15} />} disabled={!choices.length}>
          Lanes {choices.length ? <span className="tabular-nums text-faint">{`${shown.size} of ${choices.length}`}</span> : null}
        </Button>
      </P.Trigger>
      <PopoverPanel align="end" className="w-[300px] p-0">
        <div className="border-b border-line px-3 pb-2 pt-2.5">
          <p className="text-[12.5px] font-medium text-fg">Show a lane for</p>
          {choices.length > 10 ? (
            <div className="relative mt-2">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${noun}`}
                aria-label={`Search ${noun}`}
                className="pl-8"
              />
            </div>
          ) : null}
        </div>
        <div role="group" aria-label="Lanes" className="max-h-[300px] overflow-y-auto p-1">
          {listed.map(({ entry, count }) => (
            <label
              key={entry.id}
              className="flex cursor-default items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-fg hover:bg-surface-2"
            >
              <input
                type="checkbox"
                checked={shown.has(entry.id)}
                onChange={(e) => toggle(entry.id, e.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--accent)]"
              />
              <Portrait entry={entry} size={20} />
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              <span
                className="text-[11.5px] tabular-nums text-faint"
                title={`In ${count} ${count === 1 ? 'scene or event' : 'scenes and events'} on the timeline`}
              >
                {count}
              </span>
            </label>
          ))}
          {!listed.length ? <p className="px-2 py-3 text-center text-[12.5px] text-muted">No {noun} match.</p> : null}
        </div>
        <div className="flex items-center justify-between border-t border-line px-2 py-1.5">
          <Button variant="ghost" size="sm" onClick={() => choose(key, null)}>
            Show the busiest
          </Button>
          <Button variant="ghost" size="sm" onClick={() => choose(key, [])}>
            Hide all
          </Button>
        </div>
      </PopoverPanel>
    </P.Root>
  )
}

/** Opens a scene in the writing view, or an event's page. */
function openPoint(p: TimelinePoint): void {
  const app = useApp.getState()
  if (p.kind === 'scene' && p.storyId) app.selectScene(p.id, p.storyId)
  else app.navigate({ kind: 'entries', entryKind: 'event', entryId: p.id })
}

/** Takes Adam to the scene card of the scene he is in (or the first on the timeline), to fill in When. */
function openSceneCard(fallback: TimelinePoint | undefined): void {
  const app = useApp.getState()
  app.setInspectorTab('card')
  if (app.settings && !app.settings.layout.inspectorOpen) void app.updateSettings({ layout: { inspectorOpen: true } })
  if (!app.sceneId && fallback?.kind === 'scene' && fallback.storyId) app.selectScene(fallback.id, fallback.storyId)
  else app.navigate({ kind: 'write' })
}

function TimelineBody({ timeline, mode, fit }: { timeline: Timeline; mode: LaneMode; fit: number }): React.JSX.Element {
  const key = worldKey(mode)
  const chosen = useLanes((s) => s.chosen[key])
  const here = useApp((s) => s.sceneId)
  const lanes = useMemo(() => shownLanes(timeline, mode, chosen, fit), [timeline, mode, chosen, fit])
  const laneIds = useMemo(() => lanes.map((l) => l.id), [lanes])
  const spans = useMemo(() => laneSpans(timeline.points, laneIds, mode), [timeline, laneIds, mode])
  const bands = useMemo(() => dayBands(timeline.points), [timeline])
  const places = useMemo(() => new Map(timeline.entries.map((e) => [e.id, e])), [timeline])

  const scroller = useRef<HTMLDivElement>(null)
  const { width, height } = useSize(scroller)
  const [scrollTop, setScrollTop] = useState(0)
  const [focused, setFocused] = useState<number | null>(null)
  const pendingFocus = useRef<number | null>(null)
  const n = timeline.points.length
  const anyDated = timeline.points.some((p) => p.dated)

  // Opens where Adam is: the scene he is writing, a third of the way down.
  const opened = useRef(false)
  useLayoutEffect(() => {
    if (opened.current || !height || !scroller.current) return
    opened.current = true
    const i = timeline.points.findIndex((p) => p.id === here)
    if (i > 0) scroller.current.scrollTop = Math.max(0, i * ROW - height / 3)
  }, [height, here, timeline])

  const reveal = useCallback(
    (i: number) => {
      const el = scroller.current
      if (!el || i < 0 || i >= n) return
      const top = i * ROW
      const view = el.clientHeight - HEAD // the sticky header row
      if (top < el.scrollTop) el.scrollTop = top
      else if (top + ROW > el.scrollTop + view) el.scrollTop = top + ROW - view
      pendingFocus.current = i
      setFocused(i)
      setScrollTop(el.scrollTop)
    },
    [n]
  )

  // A row asked to take focus does so once it is drawn.
  useEffect(() => {
    const i = pendingFocus.current
    if (i === null) return
    const row = scroller.current?.querySelector<HTMLElement>(`[data-point="${i}"]`)
    if (row) {
      pendingFocus.current = null
      row.focus({ preventScroll: true })
    }
  })

  // Clicking a clash's sentence brings its first scene into view and lights up all its scenes for a moment.
  const [flash, setFlash] = useState<Set<ID> | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(flashTimer.current), [])
  const showClash = (c: number): void => {
    const i = timeline.points.findIndex((p) => p.clashes.includes(c))
    const el = scroller.current
    if (i < 0 || !el) return
    const top = i * ROW
    if (top < el.scrollTop || top + HEAD + ROW > el.scrollTop + el.clientHeight) el.scrollTop = Math.max(0, top - el.clientHeight / 3)
    pendingFocus.current = i
    setFocused(i)
    setScrollTop(el.scrollTop)
    clearTimeout(flashTimer.current)
    setFlash(new Set(timeline.clashes[c]?.sceneIds ?? []))
    flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const at = Number((document.activeElement as HTMLElement | null)?.dataset.point ?? NaN)
    if (Number.isNaN(at)) return
    const page = Math.max(1, Math.floor((scroller.current?.clientHeight ?? ROW) / ROW) - 1)
    const to =
      e.key === 'ArrowDown'
        ? at + 1
        : e.key === 'ArrowUp'
          ? at - 1
          : e.key === 'PageDown'
            ? at + page
            : e.key === 'PageUp'
              ? at - page
              : e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? n - 1
                  : null
    if (to === null) return
    e.preventDefault()
    reveal(Math.max(0, Math.min(n - 1, to)))
  }

  if (!anyDated) {
    return (
      <div className="flex flex-1 items-start justify-center overflow-auto pt-[10vh]">
        <EmptyState
          icon={<CalendarRange size={20} />}
          title="No dates yet"
          actions={
            <Button variant="primary" onClick={() => openSceneCard(timeline.points[0])}>
              Go to the scene card
            </Button>
          }
        >
          Give a scene a date in the When box on its scene card, in your own words: “Day 12, Year 3, at dusk” or “12 March 1204”. Scenes and
          events with a date appear here in the order they happen in your world, with a lane for each character.
        </EmptyState>
      </div>
    )
  }

  const first = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN)
  const last = Math.min(n - 1, Math.ceil((scrollTop + height) / ROW) + OVERSCAN)
  const rows: number[] = []
  for (let i = first; i <= last; i++) rows.push(i)
  // One row at a time takes Tab (the last one focused, or the scene Adam is in); the arrow keys move from it.
  const hereIndex = timeline.points.findIndex((p) => p.id === here)
  const active = focused !== null && focused < n ? focused : Math.max(0, hereIndex)
  if (active < first || active > last) rows.push(active)
  const laneW = laneWidth(width, lanes.length, mode)
  const infoW = infoWidth(width, lanes.length, laneW)
  const rowWidth = Math.max(width, WHEN_W + infoW + lanes.length * laneW)

  return (
    <>
      {timeline.clashes.length ? <Clashes timeline={timeline} onShow={showClash} /> : null}
      <div
        ref={scroller}
        className="relative min-h-0 flex-1 overflow-auto"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        onKeyDown={onKeyDown}
      >
        {/* The lane names repeat in each row's own name, so screen readers skip this header. */}
        <div aria-hidden className="sticky top-0 z-10 flex border-b border-line bg-bg" style={{ width: rowWidth, height: HEAD }}>
          <div
            className="flex shrink-0 items-end px-6 pb-2 text-[11.5px] font-semibold uppercase tracking-wide text-faint"
            style={{ width: WHEN_W }}
          >
            When
          </div>
          <div
            className="flex shrink-0 items-end px-3 pb-2 text-[11.5px] font-semibold uppercase tracking-wide text-faint"
            style={{ width: infoW }}
          >
            Scene
          </div>
          {lanes.map((l) => (
            <LaneHead key={l.id} lane={l} width={laneW} wrap={mode === 'threads'} />
          ))}
        </div>
        <div role="list" aria-label="Timeline" className="relative" style={{ height: n * ROW, width: rowWidth }}>
          {rows.map((i) => (
            <Row
              key={timeline.points[i].kind + timeline.points[i].id}
              index={i}
              point={timeline.points[i]}
              lanes={laneIds}
              mode={mode}
              spans={spans}
              band={bands[i]}
              here={timeline.points[i].id === here}
              lit={!!flash?.has(timeline.points[i].id)}
              infoW={infoW}
              laneW={laneW}
              tabbable={i === active}
              location={timeline.points[i].locationId ? places.get(timeline.points[i].locationId!)?.name : undefined}
              label={rowLabel(timeline.points[i], timeline.clashes)}
              clashText={timeline.points[i].clashes.map((c) => timeline.clashes[c]?.text).join(' ')}
              onFocusRow={setFocused}
            />
          ))}
        </div>
      </div>
    </>
  )
}

/** A lane's portrait and name. A plot thread's name runs to a few words, so it wraps onto a second line. */
function LaneHead({ lane, width, wrap }: { lane: TimelineEntry; width: number; wrap: boolean }): React.JSX.Element {
  return (
    <div className="flex shrink-0 flex-col items-center justify-end gap-1 pb-1.5" style={{ width }} title={lane.name}>
      <Portrait entry={lane} size={22} />
      <span
        className={cn(
          'w-full px-1 text-center text-[11px] leading-[13px] font-medium text-muted',
          wrap ? 'line-clamp-2 break-words' : 'truncate'
        )}
      >
        {lane.name}
      </span>
    </div>
  )
}

/** The clashes found, in plain words; each one shows its scenes. */
function Clashes({ timeline, onShow }: { timeline: Timeline; onShow: (c: number) => void }): React.JSX.Element {
  const [all, setAll] = useState(false)
  const list = all ? timeline.clashes : timeline.clashes.slice(0, 3)
  return (
    <section aria-label="Clashes" className="shrink-0 border-b border-line px-6 py-3">
      <div className="flex items-start gap-2.5 rounded-lg border border-line-strong bg-surface-2 px-3 py-2.5 text-[13px] animate-fade-in">
        <CircleAlert size={15} className="mt-0.5 shrink-0 text-muted" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-fg">
            {clashCount(timeline.clashes.length)} on the timeline
            <span className="font-normal text-muted"> · a character in two places on the same day</span>
          </p>
          <ul className="mt-1 flex max-h-[30vh] flex-col gap-0.5 overflow-y-auto">
            {list.map((c) => {
              const n = timeline.clashes.indexOf(c)
              return (
                <li key={n}>
                  <button
                    type="button"
                    onClick={() => onShow(n)}
                    title="Show these scenes"
                    className="rounded text-left text-fg underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/40"
                  >
                    {c.text}
                  </button>
                </li>
              )
            })}
          </ul>
          {timeline.clashes.length > 3 ? (
            <button
              type="button"
              onClick={() => setAll((v) => !v)}
              className="mt-1 rounded text-[12.5px] font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              {all ? 'Show fewer' : `Show all ${timeline.clashes.length}`}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  )
}

const Row = memo(function Row({
  index,
  point,
  lanes,
  mode,
  spans,
  band,
  here,
  lit,
  infoW,
  laneW,
  location,
  label,
  clashText,
  tabbable,
  onFocusRow
}: {
  index: number
  point: TimelinePoint
  lanes: ID[]
  mode: LaneMode
  spans: Map<ID, { first: number; last: number }>
  band: Band
  here: boolean
  /** One of the scenes of a clash just clicked. */
  lit: boolean
  infoW: number
  laneW: number
  location: string | undefined
  label: string
  clashText: string
  tabbable: boolean
  onFocusRow: (i: number) => void
}): React.JSX.Element {
  const p = point
  return (
    <div role="listitem" className="absolute inset-x-0" style={{ top: index * ROW, height: ROW }}>
      <button
        type="button"
        data-point={index}
        aria-label={label}
        aria-current={here ? 'location' : undefined}
        onClick={() => openPoint(p)}
        tabIndex={tabbable ? 0 : -1}
        onFocus={() => onFocusRow(index)}
        title={p.kind === 'scene' ? 'Open this scene' : 'Open this event'}
        className={cn(
          'group flex h-full w-full items-stretch text-left outline-none transition-colors duration-150 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60',
          lit ? 'bg-accent-soft' : here && 'bg-accent-soft/50'
        )}
      >
        <span className="relative flex shrink-0 flex-col justify-center pl-6 pr-3" style={{ width: WHEN_W }}>
          {here ? <span aria-hidden className="absolute inset-y-1 left-0 w-[3px] rounded-r bg-accent" /> : null}
          {band !== 'none' ? (
            <span
              aria-hidden
              className={cn(
                'absolute left-3 w-[3px] bg-line-strong',
                band === 'first' ? 'bottom-0 top-3 rounded-t' : band === 'last' ? 'bottom-3 top-0 rounded-b' : 'inset-y-0'
              )}
            />
          ) : null}
          {p.dated ? (
            <span className="truncate text-[12.5px] text-fg/90" title={p.when}>
              {p.when}
            </span>
          ) : p.when ? (
            <>
              <span className="truncate text-[12.5px] text-muted" title={p.when}>
                {p.when}
              </span>
              <span className="text-[11px] italic text-faint">No date</span>
            </>
          ) : (
            <span className="text-[12.5px] italic text-faint">No date</span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2 pl-3 pr-4" style={{ width: infoW }}>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              {p.kind === 'event' ? <Badge className="shrink-0">Event</Badge> : null}
              <span className="truncate text-[13.5px] font-medium text-fg">{p.title}</span>
            </span>
            <span className="flex items-center gap-1.5 truncate text-[12px] text-muted">
              {p.kind === 'scene' ? (
                <span className="shrink-0">{p.place}</span>
              ) : (
                <span className="shrink-0">Opens the event’s page</span>
              )}
              {location ? (
                <>
                  <span aria-hidden>·</span>
                  <MapPin size={12} className="shrink-0 text-faint" aria-hidden />
                  <span className="truncate">{location}</span>
                </>
              ) : null}
            </span>
          </span>
          {clashText ? (
            <span className="flex shrink-0 items-center text-muted" title={clashText}>
              <CircleAlert size={16} aria-hidden />
            </span>
          ) : null}
        </span>
        {lanes.map((id) => (
          <LaneCell key={id} mark={markOf(p, id, mode)} span={spans.get(id)} index={index} width={laneW} />
        ))}
      </button>
    </div>
  )
})

function LaneCell({
  mark,
  span,
  index,
  width
}: {
  mark: Mark
  span: { first: number; last: number } | undefined
  index: number
  width: number
}): React.JSX.Element {
  const inside = span && index >= span.first && index <= span.last && span.first !== span.last
  return (
    <span className="relative flex shrink-0 items-center justify-center" style={{ width }}>
      {inside ? (
        <span
          aria-hidden
          className="absolute left-1/2 w-[2px] -translate-x-1/2 bg-line-strong"
          style={{ top: index === span.first ? '50%' : 0, bottom: index === span.last ? '50%' : 0 }}
        />
      ) : null}
      {mark ? <MarkDot mark={mark} /> : null}
    </span>
  )
}

/** A lane's mark: filled for the point of view or a pay-off, a ring for being present or a set-up. */
function MarkDot({ mark }: { mark: Mark }): React.JSX.Element {
  const filled = mark === 'pov' || mark === 'paidOff'
  return (
    <span
      aria-hidden
      className={cn(
        'relative z-[1] inline-block h-3 w-3 rounded-full border-2 border-(--lane-ink,var(--accent))',
        filled ? 'bg-(--lane-ink,var(--accent))' : 'bg-bg',
        mark === 'both' && 'bg-[linear-gradient(90deg,var(--lane-ink,var(--accent))_50%,var(--bg)_50%)]'
      )}
    />
  )
}
