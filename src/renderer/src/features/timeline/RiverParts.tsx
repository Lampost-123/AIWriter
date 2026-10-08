// The pieces of the New look's timeline, "the river" (UI overhaul): a scene's card and an event's flag on the river, a
// lane's head (the character's or thread's drawing and full name) and what the lane draws along the river (thick where
// a character is present, a strong mark for the point of view; a thread opened, developed and paid off with a knot), and
// the legend in the river's corner. RiverBody.tsx lays them out; riverLogic.ts works out where.
import { memo, type CSSProperties } from 'react'
import type { ID } from '@shared/types'
import type { TimelineEntry, TimelinePoint } from '@shared/contracts/worldViews'
import { CircleAlert, MapPin, Moon, Sun } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { Portrait } from '@/features/views/Portrait'
import type { LaneMode } from './timelineLogic'
import { skyOf, STATUS_WORDS, type LanePath, type RiverItem, type Told } from './riverLogic'

/** A lane's ink, by its place among the lanes shown: eight inks from the desk's kind colours (never amber, the AI's). */
export const laneInk = (k: number): string => `var(--tl-ink-${k % 8})`

/** The little sky on a card: the sun low for dawn and dusk, high for the day, the moon for the night. */
export function Sky({ sky }: { sky: ReturnType<typeof skyOf> }): React.JSX.Element | null {
  if (!sky) return null
  const label = sky === 'dawn' ? 'Dawn' : sky === 'day' ? 'Daytime' : sky === 'dusk' ? 'Dusk' : 'Night'
  return (
    <span className={cn('tl-sky', `is-${sky}`)} title={label} aria-hidden>
      {sky === 'night' ? <Moon size={12} /> : <Sun size={12} />}
    </span>
  )
}

export interface CardData {
  point: TimelinePoint
  pov: TimelineEntry | undefined
  place: TimelineEntry | undefined
  placeMotif: string | undefined
  povMotif: string | undefined
  /** The POV character's lane ink, when it has a lane. */
  povInk: string | undefined
  told: Told
  /** "Ch 5, Sc 2": the scene it's told after (a flashback) or before (told early). */
  toldNear: string
  /** "Ch 1 · Sc 1". */
  eyebrow: string
  label: string
}

/** A scene's card on the river (an index card, like the story board's), or an event's flag. */
export const RiverCard = memo(function RiverCard({
  item,
  n,
  data,
  height,
  here,
  picked,
  out,
  tabbable,
  arriving,
  onPick,
  onKey
}: {
  item: RiverItem
  /** Its index along the river (data-card-n), which the hover and keyboard use. */
  n: number
  data: CardData
  height: number
  here: boolean
  picked: boolean
  /** Left out by the filter: it steps back. */
  out: boolean
  tabbable: boolean
  arriving: boolean
  onPick: (n: number) => void
  onKey: (e: React.KeyboardEvent, n: number) => void
}): React.JSX.Element {
  const p = data.point
  const style = { transform: `translate3d(${item.x}px,0,0)`, width: item.w, height, '--d': `${Math.min(700, n * 35)}ms` } as CSSProperties
  if (p.kind === 'event') {
    return (
      <div role="listitem" className={cn('tl-slot', arriving && 'is-arriving')} style={style}>
        <button
          type="button"
          data-card-n={n}
          data-event
          aria-label={data.label}
          aria-pressed={picked}
          tabIndex={tabbable ? 0 : -1}
          onClick={() => onPick(n)}
          onKeyDown={(e) => onKey(e, n)}
          className={cn('tl-event', picked && 'is-picked', out && 'is-out')}
        >
          <span className="tl-ev-stem" aria-hidden />
          <span className="tl-ev-flag">
            <span className="tl-ev-k">Event</span>
            <span className="tl-ev-name">{p.title}</span>
            {p.when ? <span className="tl-ev-when">{p.when}</span> : null}
          </span>
          <span className="tl-ev-gem" aria-hidden />
        </button>
      </div>
    )
  }
  const sky = skyOf(p.key)
  return (
    <div role="listitem" className={cn('tl-slot', arriving && 'is-arriving')} style={style}>
      <button
        type="button"
        data-card-n={n}
        data-river-card={p.id}
        aria-label={data.label}
        aria-pressed={picked}
        aria-current={here ? 'location' : undefined}
        tabIndex={tabbable ? 0 : -1}
        onClick={() => onPick(n)}
        onKeyDown={(e) => onKey(e, n)}
        className={cn('tl-card', here && 'is-here', picked && 'is-picked', out && 'is-out', data.told && `is-${data.told}`)}
      >
        <span className="tl-c-rules" aria-hidden />
        <span className="tl-c-top">
          <span className="tl-c-eyebrow">{data.eyebrow}</span>
          <span className="tl-c-status" title={STATUS_WORDS[p.status]}>
            <span className={cn('tl-pin', `is-${p.status === 'revised' ? 'drafted' : p.status}`)} aria-hidden />
          </span>
        </span>
        <span className="tl-c-title" title={p.title}>
          {p.title}
        </span>
        <span className="tl-c-when" title={p.when || 'No date'}>
          <Sky sky={sky} />
          <span className={cn('truncate', !p.dated && 'italic text-faint')}>{p.when || 'No date'}</span>
          {p.when && !p.dated ? <span className="tl-c-nodate">No date</span> : null}
        </span>
        {data.place ? (
          <span className="tl-c-place" title={data.place.name}>
            <Portrait entry={data.place} size={22} motif={data.placeMotif} />
            <span className="truncate">{data.place.name}</span>
          </span>
        ) : (
          <span className="tl-c-place is-none">
            <MapPin size={13} aria-hidden />
            <span>No place yet</span>
          </span>
        )}
        {height >= 224 && (p.goal || p.beats[0]) ? (
          <span className="tl-c-goal" title={p.goal || p.beats[0]}>
            {p.goal || p.beats[0]}
          </span>
        ) : null}
        <span className="tl-c-foot">
          {data.pov ? (
            <span
              className="tl-c-pov"
              style={{ '--ink': data.povInk ?? 'var(--k-char)' } as CSSProperties}
              title={`Told through ${data.pov.name}`}
            >
              <Portrait entry={data.pov} size={24} motif={data.povMotif} />
              <span className="truncate">{data.pov.name}</span>
            </span>
          ) : (
            <span className="tl-c-pov is-none">No point of view</span>
          )}
          <span className="tl-c-words tabular-nums" title={`${p.words.toLocaleString('en-GB')} words`}>
            {p.words ? p.words.toLocaleString('en-GB') : '–'}
          </span>
        </span>
        {data.told ? (
          <span
            className="tl-c-told"
            title={data.told === 'flashback' ? `A flashback: told after ${data.toldNear}` : `Told early, before ${data.toldNear}`}
          >
            {data.told === 'flashback' ? 'Flashback' : 'Told early'}
          </span>
        ) : null}
        {p.clashes.length ? (
          <span className="tl-c-clash" title="A character in two places on the same day">
            <CircleAlert size={13} aria-hidden />
          </span>
        ) : null}
        {here ? <span className="tl-c-here">You are here</span> : null}
      </button>
    </div>
  )
})

/** A lane's head: its drawing (or portrait), its full name, never cut short, and how often it's on the river. */
export const LaneHead = memo(function LaneHead({
  lane,
  ink,
  height,
  motif,
  stats,
  mode,
  onOpen
}: {
  lane: TimelineEntry
  ink: string
  height: number
  motif: string | undefined
  stats: string
  mode: LaneMode
  onOpen: (lane: TimelineEntry, el: HTMLElement) => void
}): React.JSX.Element {
  const size = Math.round(Math.max(28, Math.min(52, height * 0.38)))
  return (
    <button
      type="button"
      data-lane-head={lane.id}
      className={cn('tl-lh', height < 72 && 'is-tight', mode === 'threads' && 'is-thread')}
      style={{ '--ink': ink, height } as CSSProperties}
      aria-label={`${lane.name}: ${stats}. Open ${mode === 'threads' ? 'its' : 'their'} page`}
      title={`${lane.name} · open ${mode === 'threads' ? 'its' : 'their'} page`}
      onClick={(e) => onOpen(lane, e.currentTarget)}
    >
      <span className="tl-lh-edge" aria-hidden />
      <span className="tl-lh-art">
        <Portrait entry={lane} size={size} motif={motif} />
      </span>
      <span className="tl-lh-text">
        <span className="tl-lh-name">{lane.name}</span>
        {height >= 64 ? <span className="tl-lh-stats">{stats}</span> : null}
      </span>
    </button>
  )
})

/**
 * What a lane draws along the stretch of river on screen (left to right, in river pixels): a faint guide; a thin line
 * from its first mark to its last; thick runs where present (or while a thread is open); and the marks.
 */
export const LaneStrip = memo(function LaneStrip({
  laneId,
  path,
  items,
  from,
  to,
  left,
  right,
  height,
  mode,
  out,
  arriving,
  order
}: {
  laneId: ID
  path: LanePath | null
  items: RiverItem[]
  /** The cards on screen, [from, to). */
  from: number
  to: number
  left: number
  right: number
  height: number
  mode: LaneMode
  out: ReadonlySet<number>
  arriving: boolean
  /** Its place among the lanes, for the drawing-in's stagger. */
  order: number
}): React.JSX.Element {
  const y = Math.round(height / 2)
  const thick = Math.max(5, Math.min(9, Math.round(height * 0.075)))
  const r = Math.max(5, Math.min(8, Math.round(height * 0.06)))
  const cx = (n: number): number => items[n].x + items[n].w / 2
  const width = Math.max(1, right - left)
  const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` })
  const marks = path ? path.marks.filter((m) => m.item >= from && m.item < to) : []
  const lineDelay = order * 70
  // Enters and leaves: a bar just past the end of the thick run.
  const capAt = Math.min(34, (items[0]?.w ?? 200) * 0.16) + 7
  return (
    <svg
      className="tl-strip"
      style={{ left, width, height }}
      width={width}
      height={height}
      viewBox={`${left} 0 ${width} ${height}`}
      aria-hidden
      data-lane={laneId}
    >
      <line className="tl-guide" x1={left} x2={right} y1={y} y2={y} />
      {path ? (
        <>
          <line
            className={cn('tl-span', arriving && 'tl-draw')}
            pathLength={1}
            style={arriving ? delay(lineDelay) : undefined}
            x1={cx(path.first)}
            x2={cx(path.last)}
            y1={y}
            y2={y}
          />
          {path.openEnd ? (
            <line className="tl-tail" x1={cx(path.last)} x2={items[items.length - 1].x + items[items.length - 1].w + 24} y1={y} y2={y} />
          ) : null}
          {path.runs.map(([a, b]) => {
            if (b < from - 1 || a > to) return null
            const pad = mode === 'characters' ? Math.min(34, items[a].w * 0.16) : 0
            const x1 = cx(a) - pad
            const x2 = mode === 'threads' && path.openEnd && b === items.length - 1 ? cx(b) : cx(b) + pad
            return (
              <line
                key={a}
                className={cn('tl-run', arriving && 'tl-draw')}
                pathLength={1}
                style={{ strokeWidth: thick, ...(arriving ? delay(lineDelay + 120) : {}) }}
                x1={x1}
                x2={x2}
                y1={y}
                y2={y}
              />
            )
          })}
          {marks.map((m) => {
            const x = cx(m.item)
            const cls = cn('tl-mark', `is-${m.kind}`, out.has(m.item) && 'is-out', arriving && 'tl-pop')
            const st = arriving ? delay(lineDelay + 260 + Math.min(600, (m.item - from) * 40)) : undefined
            const first = m.item === path.first
            const last = m.item === path.last && !path.openEnd
            const tag =
              mode === 'characters'
                ? m.kind === 'pov'
                  ? 'point of view'
                  : first
                    ? 'enters'
                    : last
                      ? 'leaves'
                      : ''
                : m.kind === 'opened'
                  ? 'set up'
                  : m.kind === 'developed'
                    ? 'developed'
                    : m.kind === 'both'
                      ? 'set up and paid off'
                      : 'paid off'
            return (
              <g key={m.item} className={cls} data-col={m.item} style={st}>
                {m.kind === 'pov' ? (
                  <>
                    <circle className="tl-halo" cx={x} cy={y} r={r + 10} />
                    <circle className="tl-dot is-pov" cx={x} cy={y} r={r + 4} />
                  </>
                ) : m.kind === 'present' ? (
                  <circle className="tl-ring" cx={x} cy={y} r={r} />
                ) : m.kind === 'event' ? (
                  <rect className="tl-dot" x={x - r} y={y - r} width={r * 2} height={r * 2} rx={1.5} transform={`rotate(45 ${x} ${y})`} />
                ) : m.kind === 'opened' ? (
                  <circle className="tl-ring is-wide" cx={x} cy={y} r={r + 2} />
                ) : m.kind === 'developed' ? (
                  <circle className="tl-dot" cx={x} cy={y} r={r - 1} />
                ) : (
                  <>
                    <circle className="tl-dot" cx={x} cy={y} r={r + 5} />
                    <path className="tl-knot" d={`M${x - 4.6} ${y + 0.4}l3.2 3.2 6-6.6`} />
                    {m.kind === 'both' ? <circle className="tl-ring is-outer" cx={x} cy={y} r={r + 8.5} /> : null}
                  </>
                )}
                {first && mode === 'characters' ? <path className="tl-cap" d={`M${x - capAt} ${y - 8}v16`} /> : null}
                {last && mode === 'characters' ? <path className="tl-cap" d={`M${x + capAt} ${y - 8}v16`} /> : null}
                {tag && height >= 64 ? (
                  <text className="tl-nl" x={x} y={y + r + 19}>
                    {tag}
                  </text>
                ) : null}
              </g>
            )
          })}
        </>
      ) : null}
    </svg>
  )
})

/** The legend in the river's corner: what the marks mean. */
export function Legend({ mode }: { mode: LaneMode }): React.JSX.Element {
  const row = (svg: React.JSX.Element, label: string): React.JSX.Element => (
    <li key={label} className="tl-lg">
      <svg width="34" height="18" viewBox="0 0 34 18" aria-hidden>
        {svg}
      </svg>
      {label}
    </li>
  )
  return (
    <ul className="tl-legend" aria-label="What the marks mean">
      {mode === 'characters'
        ? [
            row(
              <>
                <line className="tl-run" x1="2" x2="32" y1="9" y2="9" style={{ strokeWidth: 6 }} />
                <circle className="tl-halo" cx="17" cy="9" r="9" />
                <circle className="tl-dot is-pov" cx="17" cy="9" r="6.5" />
              </>,
              'Point of view'
            ),
            row(
              <>
                <line className="tl-run" x1="2" x2="32" y1="9" y2="9" style={{ strokeWidth: 6 }} />
                <circle className="tl-ring" cx="17" cy="9" r="5" />
              </>,
              'Present'
            ),
            row(
              <>
                <line className="tl-span" x1="2" x2="32" y1="9" y2="9" />
                <path className="tl-cap" d="M8 3v12" />
                <path className="tl-cap" d="M26 3v12" />
              </>,
              'Enters · leaves'
            ),
            row(<rect className="tl-dot" x="12" y="4" width="10" height="10" rx="1.5" transform="rotate(45 17 9)" />, 'In an event')
          ]
        : [
            row(<circle className="tl-ring is-wide" cx="17" cy="9" r="6" />, 'Set up'),
            row(
              <>
                <line className="tl-run" x1="2" x2="32" y1="9" y2="9" style={{ strokeWidth: 6 }} />
                <circle className="tl-dot" cx="17" cy="9" r="4.5" />
              </>,
              'Developed'
            ),
            row(
              <>
                <circle className="tl-dot" cx="17" cy="9" r="8" />
                <path className="tl-knot" d="M12.6 9.4l3.2 3.2 6-6.6" />
              </>,
              'Paid off'
            ),
            row(<line className="tl-tail" x1="2" x2="32" y1="9" y2="9" />, 'Still open')
          ]}
    </ul>
  )
}
