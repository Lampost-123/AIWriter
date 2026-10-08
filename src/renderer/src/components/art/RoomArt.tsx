// The desk's room drawings (UI overhaul, Check room, Ask and history): small engraved scenes in a rounded plate, drawn in
// SVG in the theme's own colours (roomArt.css), each with one or two slow, quiet movements.
//  - Lighthouse: the Check room's consistency. Its beam sweeps the night sea, looking for what disagrees; while a check
//    runs (the AI at work) the beam turns the lamp's amber and sweeps faster. `clear` is the wider scene for "all clear":
//    a calm sea, the beam's path on the water, a small boat passing safely.
//  - Ledger: what the memory changed. A quill writes a line into an open ledger, then lifts and starts the next.
//  - Lanterns: Ask the world. Two lanterns in conversation, a mote of light passing between them; brighter while an
//    answer is being written.
//  - Pages: a scene's history. Earlier versions as a stack of pages, the top one breathing; a ribbon marks one.
//  - Echo: repetition (a bell, its rings going out). Loom: plot threads (three threads weaving, knotted).
//  - Briefing: what the AI saw (the lamp over an open briefing; the lamp's light is the AI's amber).
// Every loop is slow (seconds), moves by transform, opacity or a line's dashes only, keeps still while the window is
// away or Adam is typing (stillWatch.ts), and with less motion each drawing rests on its first frame.
import { useEffect, useId } from 'react'
import { cn } from '@/lib/cn'
import { watchArtStill } from './stillWatch'
import './roomArt.css'

interface ArtProps {
  className?: string
  /** 'busy': the AI at work (the lamp's amber, a quicker movement). */
  state?: 'idle' | 'busy'
}

function useWatch(): string {
  useEffect(watchArtStill, [])
  return useId().replace(/:/g, '')
}

/** The plate every scene is drawn in: a soft sky (or desk) and a fine border. */
function Plate({ id, w, h, tone = 'sky', children }: { id: string; w: number; h: number; tone?: 'sky' | 'desk'; children: React.ReactNode }): React.JSX.Element {
  return (
    <>
      <defs>
        <clipPath id={`${id}-clip`}>
          <rect x="0.5" y="0.5" width={w - 1} height={h - 1} rx="18" />
        </clipPath>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className={tone === 'sky' ? 'ra-sky-top' : 'ra-desk-top'} />
          <stop offset="1" className={tone === 'sky' ? 'ra-sky-bot' : 'ra-desk-bot'} />
        </linearGradient>
      </defs>
      <g clipPath={`url(#${id}-clip)`}>
        <rect width={w} height={h} fill={`url(#${id}-sky)`} />
        {children}
      </g>
      <rect x="0.5" y="0.5" width={w - 1} height={h - 1} rx="18" className="ra-frame" />
    </>
  )
}

const STARS: [number, number, number][] = [
  [22, 22, 1.1],
  [48, 40, 0.8],
  [78, 16, 1.2],
  [104, 34, 0.7],
  [128, 14, 0.9],
  [212, 18, 1],
  [228, 44, 0.7],
  [150, 30, 0.6]
]

/** The lighthouse on its rock, the lamp at (0, 0) of its own group. */
function Tower(): React.JSX.Element {
  return (
    <g className="ra-tower">
      {/* The rock. */}
      <path className="ra-rock" d="M-46 60 C -38 48 -26 44 -14 42 L 14 42 C 26 44 40 50 52 60 Z" />
      <path className="ra-rock-line" d="M-30 52 q 8 -4 16 -2 M 18 50 q 9 -3 18 1" />
      {/* The tower, tapering, with two bands. */}
      <path className="ra-tower-body" d="M-9 44 L -6 8 L 6 8 L 9 44 Z" />
      <path className="ra-band" d="M-8.1 34 L 8.1 34 L 8.6 39 L -8.6 39 Z" />
      <path className="ra-band" d="M-7.1 22 L 7.1 22 L 7.5 26.5 L -7.5 26.5 Z" />
      <path className="ra-tower-shade" d="M2 8 L 6 8 L 9 44 L 4 44 Z" />
      <rect className="ra-door" x="-2.2" y="37" width="4.4" height="7" rx="2.2" />
      {/* The gallery, the lamp room and its cap. */}
      <path className="ra-ink" d="M-10 8 L 10 8" />
      <path className="ra-ink ra-fine" d="M-9 8 v -3 M -4.5 8 v -3 M 0 8 v -3 M 4.5 8 v -3 M 9 8 v -3 M -10 5 L 10 5" />
      <rect className="ra-lamp-room" x="-6" y="-7" width="12" height="12" rx="1" />
      <path className="ra-ink ra-fine" d="M-2 -7 v 12 M 2 -7 v 12" />
      <path className="ra-cap" d="M-8 -7 Q 0 -16 8 -7 Z" />
      <path className="ra-ink" d="M0 -14 v -4" />
      <circle className="ra-lamp-core" cx="0" cy="-1" r="2.2" />
    </g>
  )
}

/** The beam: two wedges from the lamp, turning (scaleX narrows a wedge as it swings toward or away from us). */
function Beam({ id, reach }: { id: string; reach: number }): React.JSX.Element {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-beam-l`} x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" className="ra-beam-0" />
          <stop offset="1" className="ra-beam-1" />
        </linearGradient>
        <linearGradient id={`${id}-beam-r`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" className="ra-beam-0" />
          <stop offset="1" className="ra-beam-1" />
        </linearGradient>
        <radialGradient id={`${id}-glow`}>
          <stop offset="0" className="ra-glow-0" />
          <stop offset="1" className="ra-glow-1" />
        </radialGradient>
      </defs>
      <circle className="ra-glow lp" r="26" cy="-1" fill={`url(#${id}-glow)`} />
      <g className="ra-beam ra-beam-left lp">
        <path d={`M0 -1 L ${-reach} -15 L ${-reach} 13 Z`} fill={`url(#${id}-beam-l)`} />
      </g>
      <g className="ra-beam ra-beam-right lp">
        <path d={`M0 -1 L ${reach * 0.5} -9 L ${reach * 0.5} 7 Z`} fill={`url(#${id}-beam-r)`} />
      </g>
    </>
  )
}

function Waves({ y, w, className }: { y: number; w: number; className?: string }): React.JSX.Element {
  // Two periods of the same wave, so sliding by one period loops without a seam.
  const period = 24
  let d = `M${-period} ${y}`
  for (let x = -period; x < w + period * 2; x += period) d += ` q ${period / 4} -2.2 ${period / 2} 0 t ${period / 2} 0`
  return <path className={cn('ra-wave', className)} d={d} />
}

export function LighthouseArt({ className, state = 'idle', clear = false }: ArtProps & { clear?: boolean }): React.JSX.Element {
  const id = useWatch()
  const w = clear ? 360 : 240
  const h = clear ? 200 : 150
  const sea = clear ? 146 : 112
  const tx = clear ? 252 : 174
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={cn('ra la ra-lighthouse', clear && 'is-clear', className)}
      data-state={state}
      aria-hidden
      data-room-art="lighthouse"
    >
      <Plate id={id} w={w} h={h}>
        {/* The moon and the stars. */}
        <path className="ra-moon" d={clear ? 'M58 30 a 13 13 0 1 0 14 18 a 10 10 0 1 1 -14 -18 z' : 'M40 26 a 11 11 0 1 0 12 15 a 8.5 8.5 0 1 1 -12 -15 z'} />
        {STARS.map(([x, y, r], i) => (
          <circle key={i} className="ra-star lp" cx={clear ? x * 1.5 : x} cy={y} r={r} style={{ animationDelay: `${(i * 0.7) % 4}s` }} />
        ))}
        {/* The sea, in two bands, its waves drifting. */}
        <rect className="ra-sea" x="0" y={sea} width={w} height={h - sea} />
        <rect className="ra-sea-deep" x="0" y={sea + (clear ? 24 : 18)} width={w} height={h} />
        <g className="ra-drift lp">
          <Waves y={sea + 6} w={w} />
          <Waves y={sea + (clear ? 30 : 24)} w={w} className="ra-wave-2" />
        </g>
        {clear ? (
          <>
            {/* The beam's path on the water, shimmering. */}
            <g className="ra-path lp">
              <path className="ra-glint" d={`M${tx - 120} ${sea + 12} h 70 M ${tx - 100} ${sea + 20} h 50 M ${tx - 80} ${sea + 30} h 34 M ${tx - 60} ${sea + 40} h 20`} />
            </g>
            {/* A small boat, passing safely. */}
            <g transform={`translate(${tx - 168} ${sea - 2})`}>
              <g className="ra-bob lp">
                <path className="ra-hull" d="M-14 0 h 28 l -4 6 h -20 z" />
                <path className="ra-sail" d="M0 -1 V -24 L 11 -3 Z" />
                <path className="ra-sail ra-sail-2" d="M-2 -2 V -18 L -11 -3 Z" />
              </g>
            </g>
            {/* Two gulls. */}
            <path className="ra-ink ra-fine ra-gull lp" d={`M${tx - 60} 52 q 4 -4 8 0 q 4 -4 8 0 M ${tx - 34} 40 q 3 -3 6 0 q 3 -3 6 0`} />
          </>
        ) : null}
        <g transform={`translate(${tx} ${sea - (clear ? 62 : 48)}) scale(${clear ? 1.35 : 1.08})`}>
          <Beam id={id} reach={clear ? 240 : 190} />
          <Tower />
        </g>
      </Plate>
    </svg>
  )
}

export function LedgerArt({ className }: ArtProps): React.JSX.Element {
  const id = useWatch()
  return (
    <svg viewBox="0 0 240 150" className={cn('ra la ra-ledger', className)} aria-hidden data-room-art="ledger">
      <Plate id={id} w={240} h={150} tone="desk">
        {/* The desk's light. */}
        <ellipse className="ra-pool" cx="120" cy="86" rx="110" ry="54" />
        {/* The ledger: two pages over a spine, ruled, the left one written. */}
        <path className="ra-book-shadow" d="M30 118 L 120 126 L 210 118 L 210 124 L 120 132 L 30 124 Z" />
        <path className="ra-page" d="M28 40 Q 74 30 120 42 L 120 124 Q 74 112 28 120 Z" />
        <path className="ra-page ra-page-r" d="M212 40 Q 166 30 120 42 L 120 124 Q 166 112 212 120 Z" />
        <path className="ra-ink ra-fine" d="M120 42 V 124" />
        {[56, 66, 76, 86, 96, 106].map((y, i) => (
          <g key={y}>
            <path className="ra-rule" d={`M38 ${y - 3 + i * 0.6} Q 78 ${y - 9 + i * 0.6} 112 ${y - 1}`} />
            <path className="ra-rule" d={`M128 ${y - 1} Q 162 ${y - 9 + i * 0.6} 202 ${y - 3 + i * 0.6}`} />
          </g>
        ))}
        <path className="ra-margin" d="M48 40 L 48 118" />
        <path className="ra-script" d="M52 52 q 6 -3 12 0 t 12 -1 t 14 0 M 52 62 q 8 -3 16 0 t 16 -1 t 10 0 M 52 72 q 6 -3 12 0 t 18 0 M 52 82 q 7 -3 14 0 t 12 -1 t 14 0 M 52 92 q 6 -3 10 0" />
        <path className="ra-tick" d="M41 50 l 2 2 l 3 -4 M 41 60 l 2 2 l 3 -4 M 41 70 l 2 2 l 3 -4" />
        {/* The line being written, and the quill writing it. */}
        <path className="ra-writing lp" d="M134 60 q 6 -3 12 0 t 12 -1 t 12 0 t 12 0" pathLength={100} />
        <g className="ra-quill lp">
          <g transform="translate(134 60)">
            <path className="ra-feather" d="M0 0 C 6 -10 18 -34 40 -48 C 34 -30 22 -14 3 -1 Z" />
            <path className="ra-ink ra-fine" d="M1 -1 C 12 -16 24 -32 38 -46" />
            <path className="ra-ink" d="M0 0 l 3 -3" />
          </g>
        </g>
        {/* The ink pot, a ribbon. */}
        <path className="ra-ribbon" d="M150 37 L 150 132 L 154 126 L 158 132 L 158 36 Z" />
        <g transform="translate(206 112)">
          <path className="ra-pot" d="M-10 0 h 20 l -2 14 h -16 z" />
          <rect className="ra-pot-neck" x="-6" y="-5" width="12" height="5" rx="1.5" />
          <path className="ra-glint-ink" d="M-6 3 v 7" />
        </g>
      </Plate>
    </svg>
  )
}

export function LanternArt({ className, state = 'idle', small = false }: ArtProps & { small?: boolean }): React.JSX.Element {
  const id = useWatch()
  const lantern = (x: number, y: number, s: number, delay: string) => (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path className="ra-ink ra-fine" d="M0 -30 V -18" />
      <g className="ra-swing lp" style={{ animationDelay: delay }}>
        <circle className="ra-ink" cx="0" cy="-16" r="2.4" fill="none" />
        <path className="ra-lantern-cap" d="M-9 -8 Q 0 -16 9 -8 Z" />
        <rect className="ra-lantern-glass" x="-8" y="-8" width="16" height="22" rx="1.5" />
        <circle className="ra-flame-glow lp" cx="0" cy="3" r="13" fill={`url(#${id}-lg)`} style={{ animationDelay: delay }} />
        <path className="ra-flame lp" d="M0 -2 C 3 2 4 5 4 7 A 4 4 0 0 1 -4 7 C -4 5 -3 2 0 -2 Z" style={{ animationDelay: delay }} />
        <path className="ra-ink" d="M-9 -8 h 18 M -8 -8 v 22 M 8 -8 v 22 M -10 14 h 20 l -2 5 h -16 z" fill="none" />
        <path className="ra-ink ra-fine" d="M-3 -8 v 22 M 3 -8 v 22" />
      </g>
    </g>
  )
  const w = small ? 120 : 240
  const h = small ? 64 : 150
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn('ra la ra-lanterns', small && 'is-small', className)} data-state={state} aria-hidden data-room-art="lanterns">
      <defs>
        <radialGradient id={`${id}-lg`}>
          <stop offset="0" className="ra-lamp-0" />
          <stop offset="1" className="ra-lamp-1" />
        </radialGradient>
      </defs>
      {small ? (
        <>
          <path className="ra-ink ra-fine" d="M6 8 H 114" />
          {lantern(34, 38, 0.9, '0s')}
          {lantern(86, 38, 0.9, '-1.7s')}
          <g className="ra-motes">
            <circle className="ra-mote lp" cx="46" cy="40" r="1.6" />
            <circle className="ra-mote ra-mote-2 lp" cx="74" cy="40" r="1.3" />
          </g>
        </>
      ) : (
        <Plate id={id} w={w} h={h}>
          {STARS.slice(0, 6).map(([x, y, r], i) => (
            <circle key={i} className="ra-star lp" cx={x} cy={y} r={r} style={{ animationDelay: `${i * 0.9}s` }} />
          ))}
          <path className="ra-beamline" d="M12 34 Q 120 46 228 34" />
          {lantern(78, 82, 1.7, '0s')}
          {lantern(162, 82, 1.7, '-1.7s')}
          <g className="ra-motes">
            <circle className="ra-mote lp" cx="100" cy="84" r="2.4" />
            <circle className="ra-mote ra-mote-2 lp" cx="140" cy="84" r="2" />
            <circle className="ra-mote ra-mote-3 lp" cx="120" cy="78" r="1.6" />
          </g>
          <path className="ra-sea" d="M0 132 Q 60 126 120 130 T 240 128 V 150 H 0 Z" />
        </Plate>
      )}
    </svg>
  )
}

export function PagesArt({ className }: ArtProps): React.JSX.Element {
  const id = useWatch()
  const lines = (x: number, y: number, n: number, w: number) =>
    Array.from({ length: n }, (_, i) => <path key={i} className="ra-script" d={`M${x} ${y + i * 9} h ${i === n - 1 ? w * 0.55 : w - (i % 3) * 6}`} />)
  return (
    <svg viewBox="0 0 240 150" className={cn('ra la ra-pages', className)} aria-hidden data-room-art="pages">
      <Plate id={id} w={240} h={150} tone="desk">
        <ellipse className="ra-pool" cx="120" cy="84" rx="104" ry="52" />
        <g transform="translate(120 80)">
          <g transform="rotate(-9)">
            <rect className="ra-sheet ra-sheet-3" x="-44" y="-52" width="88" height="108" rx="3" />
          </g>
          <g transform="rotate(5)">
            <rect className="ra-sheet ra-sheet-2" x="-44" y="-52" width="88" height="108" rx="3" />
          </g>
          <g className="ra-breathe lp">
            <rect className="ra-sheet" x="-44" y="-54" width="88" height="108" rx="3" />
            <path className="ra-ink ra-fine" d="M-34 -40 h 40" />
            {lines(-34, -28, 9, 66)}
            <rect className="ra-mark-old" x="-36" y="-13" width="38" height="7" rx="2" />
            <rect className="ra-mark-new" x="-2" y="5" width="34" height="7" rx="2" />
            <path className="ra-ribbon" d="M26 -54 V -8 L 30 -14 L 34 -8 V -54 Z" />
          </g>
        </g>
        {/* A small clock: when each was kept. */}
        <g transform="translate(196 116)">
          <circle className="ra-clock" r="13" />
          <path className="ra-ink" d="M0 -8 V 0" />
          <path className="ra-ink ra-hand lp" d="M0 0 L 6 3" />
        </g>
      </Plate>
    </svg>
  )
}

export function EchoArt({ className }: ArtProps): React.JSX.Element {
  useWatch()
  return (
    <svg viewBox="0 0 64 64" className={cn('ra la ra-echo', className)} aria-hidden data-room-art="echo">
      <circle className="ra-ring lp" cx="32" cy="30" r="14" />
      <circle className="ra-ring ra-ring-2 lp" cx="32" cy="30" r="14" />
      <path className="ra-bell" d="M22 38 C 22 26 24 18 32 18 C 40 18 42 26 42 38 L 45 41 H 19 Z" />
      <path className="ra-ink" d="M32 14 v 4 M 29 45 a 3 3 0 0 0 6 0" fill="none" />
    </svg>
  )
}

export function LoomArt({ className }: ArtProps): React.JSX.Element {
  useWatch()
  return (
    <svg viewBox="0 0 96 64" className={cn('ra la ra-loom', className)} aria-hidden data-room-art="loom">
      <path className="ra-thread ra-t1 lp" d="M4 20 C 24 8 36 40 52 28 S 80 12 92 22" />
      <path className="ra-thread ra-t2 lp" d="M4 34 C 22 46 40 18 56 34 S 80 48 92 36" />
      <path className="ra-thread ra-t3 lp" d="M4 48 C 26 40 38 56 58 46 S 82 40 92 50" />
      <circle className="ra-knot" cx="52" cy="28" r="3" />
      <circle className="ra-knot ra-knot-open" cx="92" cy="36" r="3" />
    </svg>
  )
}

export function BriefingArt({ className }: ArtProps): React.JSX.Element {
  const id = useWatch()
  return (
    <svg viewBox="0 0 240 150" className={cn('ra la ra-briefing', className)} aria-hidden data-room-art="briefing">
      <defs>
        <linearGradient id={`${id}-cone`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="ra-lamp-0" />
          <stop offset="1" className="ra-lamp-1" />
        </linearGradient>
      </defs>
      <Plate id={id} w={240} h={150} tone="desk">
        {/* The lamp's light falls on the briefing. */}
        <path className="ra-cone lp" d="M108 34 L 52 128 L 188 128 L 132 34 Z" fill={`url(#${id}-cone)`} />
        <g transform="translate(120 28)">
          <path className="ra-lantern-cap" d="M-16 6 Q 0 -10 16 6 Z" />
          <path className="ra-ink" d="M0 -12 V -4 M -18 6 H 18" />
          <circle className="ra-flame-glow lp" cx="0" cy="9" r="10" fill={`url(#${id}-cone)`} />
        </g>
        {/* The folder, its sheets numbered. */}
        <path className="ra-book-shadow" d="M44 126 H 196 L 190 132 H 50 Z" />
        <path className="ra-folder" d="M46 70 H 108 L 114 64 H 194 V 126 H 46 Z" />
        <rect className="ra-sheet ra-sheet-2" x="60" y="62" width="58" height="56" rx="2" transform="rotate(-4 89 90)" />
        <rect className="ra-sheet" x="124" y="58" width="58" height="60" rx="2" transform="rotate(3 153 88)" />
        {[0, 1, 2, 3, 4].map((i) => (
          <path key={i} className="ra-script" d={`M${68} ${74 + i * 8} h ${i === 4 ? 22 : 40 - (i % 2) * 8}`} transform="rotate(-4 89 90)" />
        ))}
        {[0, 1, 2, 3, 4].map((i) => (
          <path key={i} className="ra-script" d={`M${132} ${72 + i * 8} h ${i === 4 ? 26 : 42 - (i % 3) * 6}`} transform="rotate(3 153 88)" />
        ))}
        <circle className="ra-num" cx="136" cy="64" r="4" transform="rotate(3 153 88)" />
      </Plate>
    </svg>
  )
}
