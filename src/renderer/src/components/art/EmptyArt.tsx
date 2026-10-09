// The empty pages' pictures (UI overhaul, "living art", after the Empty mockup board): one small drawing for each kind
// of empty page, each with one quiet movement. It plays a short entrance once (a quill dips, monograms drift together,
// lines draw in) and then, where nobody is writing, a slow loop (threads weave, a ring spreads from the tick, a lens
// sweeps). The Write room's own empty page ("scenes") only draws itself once and rests: no loop beside the writing.
// Drawn in the theme's colours (kind inks, accent, success), so they suit Light, Dark and Sepia; the New look only
// (components/ui/misc.tsx, EmptyState's `art`). Still while the window is hidden or left, and with less motion
// (living.css).
import { useId } from 'react'
import { cn } from '@/lib/cn'
import { watchWindowForArt } from './living'
import './living.css'
import './emptyArt.css'

export type EmptyArtName = 'codex' | 'characters' | 'threads' | 'clear' | 'search' | 'map' | 'scenes' | 'board'

/** Each picture's tint (the soft light behind it). */
const TINT: Record<EmptyArtName, string> = {
  codex: 'var(--k-lore-soft)',
  characters: 'var(--k-char-soft)',
  threads: 'var(--k-thread-soft)',
  clear: 'var(--success-soft)',
  search: 'var(--accent-soft)',
  map: 'var(--k-group-soft)',
  scenes: 'var(--accent-soft)',
  board: 'var(--k-thread-soft)'
}

export function EmptyArt({ name, className }: { name: EmptyArtName; className?: string }): React.JSX.Element {
  watchWindowForArt()
  const Scene = SCENES[name]
  // The Write room's page stays still: its picture plays once and rests, with no glow breathing behind it.
  const still = name === 'scenes'
  return (
    <div aria-hidden className={cn('ea la', className)} data-living-art={`empty-${name}`} data-empty-art={name}>
      <span className={cn('ea-glow', !still && 'lp')} style={{ background: `radial-gradient(closest-side, ${TINT[name]}, transparent)` }} />
      <svg className="ea-svg" width="160" height="120" viewBox="0 0 160 120">
        <Scene />
      </svg>
    </div>
  )
}

/** The codex: an open notebook; a quill dips once into the ink pot (a ripple), then comes to rest on the page. */
function Codex(): React.JSX.Element {
  return (
    <>
      <ellipse className="ea-shadow" cx="62" cy="103" rx="54" ry="5" />
      <ellipse className="ea-shadow" cx="134" cy="103" rx="15" ry="2.6" />
      <rect x="11" y="37" width="102" height="63" rx="6" fill="var(--k-lore)" />
      <path className="ea-page" d="M15 41 C30 37 46 37 62 42 L62 96 C46 91 30 91 15 94 Z" />
      <path className="ea-page" d="M62 42 C78 37 94 37 109 41 L109 94 C94 91 78 91 62 96 Z" />
      <path className="ea-rule" d="M62 42 L62 96" />
      <g className="ea-ink">
        <path d="M23 53 C34 51 44 51 54 53.5" />
        <path d="M23 61 C34 59 44 59 54 61.5" />
        <path d="M23 69 C32 67.4 38 67.4 44 68.6" />
      </g>
      <path className="ea-ink ea-faint" d="M70 53.5 C80 51 90 51 101 53" />
      <path d="M98 39.6 L104 39 L104 54 L101 51.2 L98 54 Z" fill="var(--k-event)" />
      <g transform="translate(86 70)">
        <g className="ea-quill">
          <path d="M0 0 L22 -36" fill="none" stroke="var(--muted)" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M4 -7 C8 -21 17 -33 28 -40 C27 -29 20 -16 8 -5 Z" fill="var(--k-lore-soft)" stroke="var(--k-lore)" strokeWidth="1.1" strokeLinejoin="round" />
          <path d="M10 -15 L17 -19 M13 -22 L21 -26 M17 -29 L24 -32" fill="none" stroke="var(--k-lore)" strokeWidth="0.9" strokeLinecap="round" opacity="0.55" />
          <path d="M0 0 L1.6 -4.6 L4 -3.2 Z" fill="var(--fg)" />
        </g>
      </g>
      <path className="ea-pot" d="M124 85 L144 85 L144 97 Q144 101 140 101 L128 101 Q124 101 124 97 Z" />
      <rect className="ea-pot" x="128.5" y="78.5" width="11" height="7" rx="1.6" />
      <ellipse cx="134" cy="79" rx="5.5" ry="1.3" fill="var(--ea-ink-dark)" />
      <rect x="127" y="88" width="2.6" height="9" rx="1.3" fill="var(--page)" opacity="0.25" />
      <ellipse className="ea-ripple" cx="134" cy="79" rx="5.5" ry="1.5" />
    </>
  )
}

/** Characters: three monograms drift together and float gently, with a dashed place for the next one. */
function Characters(): React.JSX.Element {
  const face = (cx: number, cy: number, r: number, letter: string, mix: number, size: number): React.JSX.Element => (
    <>
      <circle cx={cx} cy={cy} r={r} fill={`color-mix(in oklab, var(--k-char) ${mix}%, var(--page))`} stroke="var(--page)" strokeWidth="3" />
      <text x={cx} y={cy + size * 0.36} className="ea-mono" style={{ fontSize: size }}>
        {letter}
      </text>
    </>
  )
  return (
    <>
      <ellipse className="ea-shadow" cx="80" cy="100" rx="46" ry="5" />
      <g className="ea-drift-a">
        <g className="ea-float lp">{face(54, 62, 23, 'J', 12, 18)}</g>
      </g>
      <g className="ea-drift-c">
        <g className="ea-float ea-f3 lp">{face(106, 62, 23, 'R', 16, 18)}</g>
      </g>
      <g className="ea-drift-b">
        <g className="ea-float ea-f2 lp">{face(80, 52, 25, 'M', 24, 20)}</g>
      </g>
      <g className="ea-slot">
        <circle cx="131" cy="92" r="11" fill="var(--page)" stroke="var(--k-char)" strokeWidth="1.4" strokeDasharray="3 3" opacity="0.7" />
        <path d="M131 87.5 L131 96.5 M126.5 92 L135.5 92" fill="none" stroke="var(--k-char)" strokeWidth="1.6" strokeLinecap="round" opacity="0.8" />
      </g>
    </>
  )
}

const THREADS = [
  { d: 'M14 42 C44 42 56 84 84 82 S124 50 146 50', ink: 'var(--k-thread)', start: 42, end: [146, 50], cls: '' },
  { d: 'M14 64 C42 64 54 34 82 36 S122 80 146 80', ink: 'var(--k-event)', start: 64, end: [146, 80], cls: 'ea-fb' },
  { d: 'M14 86 C46 86 60 58 86 60 S124 36 146 34', ink: 'var(--k-group)', start: 86, end: [146, 34], cls: 'ea-fc' }
] as const

/** Plot threads: three coloured threads draw in, then weave slowly across each other. */
function Threads(): React.JSX.Element {
  return (
    <>
      {THREADS.map((t, i) => (
        <path key={`b${i}`} className="ea-thread ea-base" d={t.d} stroke={t.ink} pathLength={100} style={{ '--d': `${i * 120}ms` } as React.CSSProperties} />
      ))}
      {THREADS.map((t, i) => (
        <path key={`f${i}`} className={cn('ea-thread ea-flow lp', t.cls)} d={t.d} stroke={t.ink} pathLength={100} />
      ))}
      {THREADS.map((t, i) => (
        <g key={`e${i}`} className="ea-pop" style={{ '--d': `${200 + i * 90}ms` } as React.CSSProperties}>
          <circle cx="14" cy={t.start} r="4.5" fill={t.ink} stroke="var(--page)" strokeWidth="2" />
          <circle cx={t.end[0]} cy={t.end[1]} r="3" fill="var(--page)" stroke={t.ink} strokeWidth="2" />
        </g>
      ))}
    </>
  )
}

/** All clear: a checked page with a tick that draws itself; a soft ring spreads from it every few seconds. */
function Clear(): React.JSX.Element {
  return (
    <>
      <ellipse className="ea-shadow" cx="80" cy="110" rx="44" ry="4.5" />
      <rect className="ea-sheet" x="36" y="14" width="78" height="90" rx="8" />
      <g className="ea-lines">
        <rect x="48" y="28" width="40" height="4" rx="2" className="ea-l-strong" />
        <rect x="48" y="40" width="54" height="3" rx="1.5" />
        <rect x="48" y="48" width="50" height="3" rx="1.5" />
        <rect x="48" y="56" width="54" height="3" rx="1.5" />
        <rect x="48" y="64" width="34" height="3" rx="1.5" />
        <rect x="48" y="76" width="28" height="3" rx="1.5" />
      </g>
      <circle className="ea-pulse lp" cx="110" cy="80" r="20" />
      <circle cx="110" cy="80" r="24" fill="var(--success-soft)" />
      <circle cx="110" cy="80" r="19" fill="var(--success)" />
      <path className="ea-tick" pathLength={1} d="M101 80.5 L107 86.5 L119 73.5" />
    </>
  )
}

/** Nothing found: a magnifier sweeps a soft beam of light back and forth over a page. */
function Search(): React.JSX.Element {
  const id = `ea${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  return (
    <>
      <defs>
        <clipPath id={`${id}-page`}>
          <rect x="34" y="14" width="80" height="92" rx="8" />
        </clipPath>
        <radialGradient id={`${id}-spot`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="var(--page)" stopOpacity="0.95" />
          <stop offset="0.5" stopColor="var(--accent-soft)" stopOpacity="0.8" />
          <stop offset="1" stopColor="var(--accent-soft)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse className="ea-shadow" cx="76" cy="110" rx="42" ry="4.5" />
      <rect className="ea-sheet" x="34" y="14" width="80" height="92" rx="8" />
      <g className="ea-lines ea-lines-faint">
        <rect x="46" y="28" width="32" height="4" rx="2" />
        <rect x="46" y="40" width="56" height="3" rx="1.5" />
        <rect x="46" y="48" width="48" height="3" rx="1.5" />
        <rect x="46" y="56" width="54" height="3" rx="1.5" />
        <rect x="46" y="64" width="30" height="3" rx="1.5" />
      </g>
      <g clipPath={`url(#${id}-page)`}>
        <g className="ea-sweep lp">
          <ellipse cx="70" cy="60" rx="28" ry="22" fill={`url(#${id}-spot)`} />
        </g>
      </g>
      <g className="ea-sweep lp">
        <g transform="translate(70 60)">
          <circle cx="0" cy="0" r="14" fill="var(--accent-soft)" opacity="0.6" />
          <circle cx="0" cy="0" r="14" fill="none" stroke="var(--accent)" strokeWidth="3" />
          <path d="M-7 -6 A9 9 0 0 1 2 -10" fill="none" stroke="var(--page)" strokeWidth="2" strokeLinecap="round" opacity="0.9" />
          <path d="M10.5 10.5 L21 21" fill="none" stroke="var(--muted)" strokeWidth="5" strokeLinecap="round" />
        </g>
      </g>
    </>
  )
}

const DOTS = [
  { x: 80, y: 60, kind: 'char', core: true },
  { x: 36, y: 40, kind: 'char' },
  { x: 72, y: 22, kind: 'place' },
  { x: 118, y: 42, kind: 'group' },
  { x: 128, y: 84, kind: 'char' },
  { x: 84, y: 94, kind: 'place' },
  { x: 42, y: 82, kind: 'event' }
] as const
const LINKS = [
  [0, 1],
  [0, 2],
  [0, 3],
  [3, 4],
  [0, 5],
  [5, 6]
] as const

/** The relationship map: a constellation of dots in the kinds' inks; the lines between them draw in one by one. */
function MapArt(): React.JSX.Element {
  return (
    <>
      {LINKS.map(([a, b], i) => (
        <path
          key={i}
          className="ea-link"
          pathLength={1}
          d={`M${DOTS[a].x} ${DOTS[a].y} L${DOTS[b].x} ${DOTS[b].y}`}
          style={{ '--d': `${700 + i * 150}ms` } as React.CSSProperties}
        />
      ))}
      {DOTS.map((p, i) => (
        <g key={i} className="ea-pop" style={{ '--d': `${100 + i * 80}ms` } as React.CSSProperties}>
          {'core' in p ? (
            <circle className="ea-halo lp" cx={p.x} cy={p.y} r="13" fill={`var(--k-${p.kind}-soft)`} />
          ) : (
            <circle cx={p.x} cy={p.y} r="8" fill={`var(--k-${p.kind}-soft)`} />
          )}
          <circle cx={p.x} cy={p.y} r={'core' in p ? 6 : 4.2} fill={`var(--k-${p.kind})`} stroke="var(--page)" strokeWidth="2" />
        </g>
      ))}
    </>
  )
}

/** The first scene: a blank page, and a pen that writes its first line once, then rests. (No loop: the Write room.) */
function Scenes(): React.JSX.Element {
  return (
    <>
      <ellipse className="ea-shadow" cx="78" cy="110" rx="44" ry="4.5" />
      <rect className="ea-sheet" x="38" y="12" width="76" height="94" rx="6" />
      <g className="ea-lines ea-lines-faint">
        <rect x="50" y="26" width="30" height="4" rx="2" />
      </g>
      <path className="ea-write" pathLength={1} d="M50 44 C56 41 60 47 66 44 S76 41 82 44 S92 47 98 43" />
      <path className="ea-write ea-write-2" pathLength={1} d="M50 54 C55 51 60 57 66 54 S74 51 78 54" />
      <g className="ea-pen">
        <g transform="translate(78 54)">
          <path d="M0 0 L3.2 -7.4 L24 -34 L28.6 -30.4 L7.8 -3.8 Z" fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M0 0 L3.2 -7.4 L7.8 -3.8 Z" fill="var(--fg)" />
          <path d="M20.4 -29.4 L25.2 -25.6" fill="none" stroke="var(--accent)" strokeWidth="1.2" />
        </g>
      </g>
    </>
  )
}

/** The plan board, empty: two index cards fall into place, pinned, and a thread draws itself between them. */
function Board(): React.JSX.Element {
  const card = (x: number, y: number, r: number, cls: string, d: string): React.JSX.Element => (
    <g className={cls} style={{ '--d': d } as React.CSSProperties}>
      <g transform={`rotate(${r} ${x + 28} ${y})`}>
        <rect x={x} y={y} width="56" height="40" rx="3" fill="var(--page)" stroke="var(--line-strong)" strokeWidth="1" />
        <path d={`M${x} ${y + 9}h56`} stroke="var(--danger)" strokeWidth="0.8" opacity="0.4" />
        <path d={`M${x + 7} ${y + 18}h34M${x + 7} ${y + 25}h40M${x + 7} ${y + 32}h24`} stroke="var(--line-strong)" strokeWidth="1.6" strokeLinecap="round" />
      </g>
    </g>
  )
  return (
    <>
      <ellipse className="ea-shadow" cx="80" cy="106" rx="56" ry="4.5" />
      {card(14, 30, -4, 'ea-drop', '80ms')}
      {card(90, 46, 3, 'ea-drop', '200ms')}
      <path className="ea-string" pathLength={1} d="M42 31 C60 22 92 66 118 47" />
      <g className="ea-pop" style={{ '--d': '420ms' } as React.CSSProperties}>
        <circle className="ea-pin-glow lp" cx="42" cy="31" r="7" />
        <circle cx="42" cy="31" r="3.4" fill="var(--k-event)" stroke="var(--page)" strokeWidth="1.4" />
      </g>
      <g className="ea-pop" style={{ '--d': '520ms' } as React.CSSProperties}>
        <circle cx="118" cy="47" r="3.4" fill="var(--k-event)" stroke="var(--page)" strokeWidth="1.4" />
      </g>
    </>
  )
}

const SCENES: Record<EmptyArtName, () => React.JSX.Element> = {
  codex: Codex,
  characters: Characters,
  threads: Threads,
  clear: Clear,
  search: Search,
  map: MapArt,
  scenes: Scenes,
  board: Board
}
