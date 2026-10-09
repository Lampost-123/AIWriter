// The AI planning pages' drawings (UI overhaul, "the AI planning pages"): one for each page's header band, drawn by hand
// in SVG in the theme's own inks (the paper, the kind inks, the threads' strings; amber only for the lamp, the AI's
// light). Each has one or two slow, quiet movements (planning.css): the outline helper's lamp-lit desk with index cards
// drifting in its light, the world builder's map unrolling with a lantern travelling its road, the plot threads weaving
// with a glint running along them, the recipe book with its ribbon swaying and steam rising, the chapter's notebook with
// a quill writing its line. And the lamp the AI thinks by (LampMotif), with its flame and its sparks. They hold still
// while the window is away or Adam types (art.ts), and show a resting frame with less motion.
import { useEffect, useId } from 'react'
import { cn } from '@/lib/cn'
import { watchPlanArt } from './art'

export type PlanArtName = 'outline' | 'world' | 'threads' | 'recipes' | 'chapter'

/** Ids safe inside url(#…). */
const useSvgId = (): string => useId().replace(/[^a-zA-Z0-9_-]/g, '')

export function PlanArt({ name, className }: { name: PlanArtName; className?: string }): React.JSX.Element {
  useEffect(() => watchPlanArt(), [])
  const id = useSvgId()
  const Art = ART[name]
  return (
    <svg className={cn('plan-art', className)} viewBox="0 0 280 140" fill="none" aria-hidden data-plan-art={name} preserveAspectRatio="xMidYMid meet">
      <Art id={id} />
    </svg>
  )
}

/** An index card lying in the light: paper, its ruled lines and red margin rule, a title line (amber: the AI's). */
function Card({ x, y, w = 58, h = 38, ai = false, cls }: { x: number; y: number; w?: number; h?: number; ai?: boolean; cls?: string }): React.JSX.Element {
  return (
    <g className={cls}>
      <rect x={x + 1.5} y={y + 2.5} width={w} height={h} rx={3} className="pa-shadow" />
      <rect x={x} y={y} width={w} height={h} rx={3} className="pa-paper" />
      {[15, 23, 31].map((dy) => (
        <line key={dy} x1={x + 3} x2={x + w - 3} y1={y + dy} y2={y + dy} className="pa-rule" />
      ))}
      <line x1={x + 10} x2={x + 10} y1={y + 2} y2={y + h - 2} className="pa-margin" />
      <line x1={x + 14} x2={x + 14 + w * 0.46} y1={y + 8} y2={y + 8} className={ai ? 'pa-ai-ink pa-write' : 'pa-ink'} pathLength={1} />
      <line x1={x + 14} x2={x + w - 10} y1={y + 19} y2={y + 19} className="pa-ink-soft" />
      <line x1={x + 14} x2={x + w - 18} y1={y + 27} y2={y + 27} className="pa-ink-soft" />
    </g>
  )
}

/** The outline helper: a desk lamp's light over the desk, three index cards drifting in it. */
function OutlineArt({ id }: { id: string }): React.JSX.Element {
  return (
    <>
      <defs>
        <radialGradient id={`${id}-pool`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="var(--lamp-2, #de9640)" stopOpacity="0.5" />
          <stop offset="1" stopColor="var(--lamp-2, #de9640)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-cone`} x1="0.2" y1="0" x2="0.5" y2="1">
          <stop offset="0" stopColor="var(--lamp-2, #de9640)" stopOpacity="0.42" />
          <stop offset="1" stopColor="var(--lamp-2, #de9640)" stopOpacity="0" />
        </linearGradient>
        <filter id={`${id}-blur`} x="-1" y="-1" width="3" height="3">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>
      <ellipse className="pa-breathe" cx="168" cy="124" rx="112" ry="15" fill={`url(#${id}-pool)`} />
      <path className="pa-breathe" d="M104 82 L132 66 L252 124 L92 124 Z" fill={`url(#${id}-cone)`} />
      <line x1="10" x2="270" y1="124.5" y2="124.5" className="pa-edge" />
      {/* The lamp: its base, two arms and the shade, lit at the mouth. */}
      <path d="M20 124 C 20 118 26 116 36 116 L 48 116 C 58 116 62 118 62 124 Z" className="pa-metal" />
      <path d="M41 117 L 54 76 L 101 52" className="pa-arm" />
      <circle cx="54" cy="76" r="3.2" className="pa-metal" />
      <circle cx="101" cy="52" r="2.6" className="pa-metal" />
      <path d="M98 53 L 109 45 L 133 66 L 104 82 Z" className="pa-metal" />
      <path d="M104 82 L 133 66" className="pa-mouth" />
      <circle cx="119" cy="75" r="8" className="pa-bulb-glow" filter={`url(#${id}-blur)`} />
      <circle cx="119" cy="75" r="3.4" className="pa-bulb" />
      {/* Motes in the light. */}
      <circle cx="150" cy="104" r="1.2" className="pa-mote" />
      <circle cx="176" cy="112" r="1" className="pa-mote pa-d2" />
      <circle cx="206" cy="108" r="1.3" className="pa-mote pa-d3" />
      <Card x={168} y={86} w={64} h={36} cls="pa-lie" />
      <g className="pa-drift">
        <g transform="rotate(-8 170 62)">
          <Card x={140} y={46} />
        </g>
      </g>
      <g className="pa-drift pa-d2">
        <g transform="rotate(6 222 46)">
          <Card x={196} y={26} ai />
        </g>
      </g>
    </>
  )
}

/** The world builder: a map unrolling across the desk, its coast, hills and woods, a lit lighthouse and a road with a lantern on it. */
function WorldArt({ id }: { id: string }): React.JSX.Element {
  return (
    <>
      <defs>
        <clipPath id={`${id}-reveal`}>
          <rect x="34" y="16" width="214" height="110" className="pa-unroll" />
        </clipPath>
        <linearGradient id={`${id}-roll`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--roll-a, #c9b28a)" />
          <stop offset="0.45" stopColor="var(--roll-b, #f6ebd3)" />
          <stop offset="1" stopColor="var(--roll-d, #bfa67c)" />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="var(--lamp-2, #de9640)" stopOpacity="0.8" />
          <stop offset="1" stopColor="var(--lamp-2, #de9640)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="142" cy="128" rx="118" ry="7" className="pa-floor" />
      <g clipPath={`url(#${id}-reveal)`}>
        <rect x="40" y="22" width="204" height="100" rx="2" className="pa-parch" />
        {/* The sea's hatching, the coast, hills, a wood and a town. */}
        {[34, 44, 54, 64, 74].map((y, i) => (
          <path key={y} d={`M${150 + i * 6} ${y} q 6 -3 12 0 t 12 0`} className="pa-sea" />
        ))}
        <path d="M118 24 C 128 40 122 52 134 62 C 146 72 140 86 152 96 C 160 104 158 114 166 122" className="pa-coast" />
        <path d="M58 58 l 9 -12 l 9 12 M70 60 l 8 -10 l 8 10 M84 58 l 6 -8 l 6 8" className="pa-hills" />
        {[62, 72, 82].map((x, i) => (
          <path key={x} d={`M${x} ${96 + (i % 2) * 4} l 4 -9 l 4 9 Z`} className="pa-tree" />
        ))}
        <rect x="96" y="80" width="5" height="5" className="pa-town" />
        <rect x="103" y="77" width="4" height="8" className="pa-town" />
        <path d="M100 86 C 112 98 126 92 132 82 C 138 72 146 68 150 64" className="pa-road" />
        <path d="M100 86 C 112 98 126 92 132 82 C 138 72 146 68 150 64" className="pa-road-run" pathLength={100} />
        {/* The lighthouse on its headland, lit. */}
        <path d="M150 64 L 152 50 L 156 50 L 158 64 Z" className="pa-tower" />
        <circle cx="154" cy="48" r="7" fill={`url(#${id}-glow)`} className="pa-blink" />
        <circle cx="154" cy="48" r="1.8" className="pa-bulb" />
        {/* A compass rose in the corner. */}
        <g transform="translate(214 98)">
          <circle r="11" className="pa-rose" />
          <g className="pa-needle">
            <path d="M0 -9 L 2.4 0 L 0 9 L -2.4 0 Z" className="pa-needle-shape" />
            <path d="M0 -9 L 2.4 0 L -2.4 0 Z" className="pa-needle-n" />
          </g>
        </g>
      </g>
      {/* The two rolls of the map. */}
      <rect x="32" y="18" width="10" height="108" rx="5" fill={`url(#${id}-roll)`} className="pa-roll" />
      <g className="pa-roll-r">
        <rect x="242" y="18" width="10" height="108" rx="5" fill={`url(#${id}-roll)`} className="pa-roll" />
      </g>
    </>
  )
}

/** The plot threads: three strings weaving through a loom's warp, a glint running along each; one ends in a knot, one runs on. */
function ThreadsArt({ id }: { id: string }): React.JSX.Element {
  const weft = [
    { d: 'M40 48 C 70 36, 90 60, 120 48 S 170 36, 200 48 S 236 58, 252 46', ink: 1 },
    { d: 'M40 72 C 70 84, 90 60, 120 72 S 170 84, 196 72', ink: 2 },
    { d: 'M40 96 C 70 84, 90 108, 120 96 S 170 84, 200 96 S 232 106, 246 98', ink: 3 }
  ]
  return (
    <>
      <defs>
        <radialGradient id={`${id}-open`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.7" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>
      {[70, 110, 150, 190, 230].map((x) => (
        <line key={x} x1={x} x2={x} y1="22" y2="122" className="pa-warp" />
      ))}
      {/* The spool they come from. */}
      <g className="pa-spool">
        <circle cx="26" cy="72" r="16" className="pa-spool-rim" />
        <circle cx="26" cy="72" r="11" className="pa-spool-wound" />
        <circle cx="26" cy="72" r="3" className="pa-spool-hub" />
        <path d="M26 61 L 26 66" className="pa-spool-notch" />
      </g>
      {weft.map((w, i) => (
        <g key={i} style={{ color: `var(--thread-${w.ink}, currentColor)` }}>
          <path d={w.d} className="pa-weft" />
          <path d={w.d} className={cn('pa-glint', i === 1 && 'pa-d2', i === 2 && 'pa-d3')} pathLength={100} />
        </g>
      ))}
      {/* Over-and-under: the warp crosses back over the strings here and there. */}
      {[
        [70, 42],
        [150, 78],
        [110, 100],
        [190, 46],
        [230, 92]
      ].map(([x, y]) => (
        <line key={`${x}-${y}`} x1={x} x2={x} y1={y - 5} y2={y + 5} className="pa-warp-over" />
      ))}
      {/* The second string paid off: a knot. The first and third run on, their ends glowing. */}
      <g style={{ color: 'var(--thread-2, currentColor)' }}>
        <circle cx="198" cy="72" r="3.4" className="pa-knot" />
        <path d="M196 75 q -3 5 -8 6" className="pa-weft" />
      </g>
      <g style={{ color: 'var(--thread-1, currentColor)' }}>
        <circle cx="252" cy="46" r="9" fill={`url(#${id}-open)`} className="pa-breathe" />
        <circle cx="252" cy="46" r="2" fill="currentColor" />
      </g>
    </>
  )
}

/** Story recipes: an open recipe book, its ribbon swaying, steam rising from the dish on its page. */
function RecipesArt(): React.JSX.Element {
  return (
    <>
      <ellipse cx="140" cy="126" rx="112" ry="7" className="pa-floor" />
      {/* The pages' edges under the open pages. */}
      <path d="M40 112 C 84 104 118 106 140 118 C 162 106 196 104 240 112 L 240 116 C 196 108 162 110 140 122 C 118 110 84 108 40 116 Z" className="pa-edges" />
      <path d="M140 30 C 116 22 82 22 44 30 L 44 110 C 82 102 116 102 140 112 Z" className="pa-paper" />
      <path d="M140 30 C 164 22 198 22 236 30 L 236 110 C 198 102 164 102 140 112 Z" className="pa-paper" />
      <path d="M140 30 L 140 112" className="pa-gutter" />
      {/* The left page: the recipe's heading and its steps. */}
      <path d="M58 40 L 104 37" className="pa-ink pa-heavy" />
      {[52, 62, 72, 82, 92].map((y, i) => (
        <g key={y}>
          <circle cx="60" cy={y - 1 - i * 0.4} r="1.6" className="pa-step" />
          <path d={`M66 ${y - i * 0.4} L ${118 - (i % 2) * 14} ${y - 2 - i * 0.4}`} className="pa-ink-soft" />
        </g>
      ))}
      {/* The right page: a dish, steaming. */}
      <path d="M164 80 C 166 92 178 98 190 98 C 202 98 214 92 216 80 Z" className="pa-dish" />
      <path d="M160 80 L 220 80" className="pa-dish-rim" />
      <path className="pa-steam" d="M180 72 C 176 66 184 62 180 56 C 176 50 184 46 180 40" />
      <path className="pa-steam pa-d2" d="M192 72 C 188 66 196 62 192 56 C 188 50 196 46 192 40" />
      <path className="pa-steam pa-d3" d="M204 72 C 200 66 208 62 204 56 C 200 50 208 46 204 40" />
      <path d="M170 104 L 222 101" className="pa-ink-soft" />
      {/* The ribbon from the head of the spine. */}
      <g className="pa-ribbon">
        <path d="M137 28 L 143 28 L 143 128 L 140 124 L 137 128 Z" className="pa-ribbon-shape" />
      </g>
    </>
  )
}

/** Planning a chapter: an open notebook, a quill writing its next line; the chapter's scene cards beside it. */
function ChapterArt(): React.JSX.Element {
  return (
    <>
      <ellipse cx="140" cy="128" rx="114" ry="7" className="pa-floor" />
      <g transform="rotate(-3 120 74)">
        <rect x="58" y="22" width="132" height="102" rx="3" className="pa-paper" />
        {[38, 50, 62, 74, 86, 98, 110].map((y) => (
          <line key={y} x1="60" x2="188" y1={y} y2={y} className="pa-rule" />
        ))}
        <line x1="76" x2="76" y1="24" y2="122" className="pa-margin" />
        <text x="84" y="34" className="pa-numeral">
          II
        </text>
        <path d="M84 48 C 100 46 116 49 134 47 C 146 46 158 48 168 47" className="pa-ink-soft" />
        <path d="M84 60 C 98 58 112 61 128 59 C 140 58 152 60 160 59" className="pa-ink-soft" />
        <path d="M84 72 C 98 70 114 73 130 71 C 144 70 158 72 172 71" className="pa-ai-ink pa-write-line" pathLength={100} />
        <g transform="translate(84 72)">
          <g className="pa-quill">
            <path d="M0 0 C 6 -10 18 -26 34 -36 C 30 -24 20 -12 4 -2 Z" className="pa-feather" />
            <path d="M0 0 L 30 -32" className="pa-quill-shaft" />
          </g>
        </g>
      </g>
      <g transform="rotate(4 230 60)">
        <Card x={204} y={36} w={50} h={32} ai />
      </g>
      <g className="pa-drift pa-d2">
        <g transform="rotate(-5 228 98)">
          <Card x={202} y={80} w={50} h={32} />
        </g>
      </g>
    </>
  )
}

const ART: Record<PlanArtName, (p: { id: string }) => React.JSX.Element> = {
  outline: OutlineArt,
  world: WorldArt,
  threads: ThreadsArt,
  recipes: RecipesArt,
  chapter: ChapterArt
}

/**
 * The lamp the AI thinks by: a small hanging lantern, its flame flickering, a warm glow breathing behind it and sparks
 * of ideas rising. In place of a spinner wherever the AI is at work on a plan.
 */
export function LampMotif({ size = 30, className }: { size?: number; className?: string }): React.JSX.Element {
  useEffect(() => watchPlanArt(), [])
  const id = useSvgId()
  return (
    <svg className={cn('plan-lamp', className)} width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden data-plan-lamp>
      <defs>
        <radialGradient id={`${id}-g`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="var(--lamp-2, #de9640)" stopOpacity="0.75" />
          <stop offset="1" stopColor="var(--lamp-2, #de9640)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="19" r="13" fill={`url(#${id}-g)`} className="pl-glow" />
      <path d="M16 2.5 L 16 6" className="pl-wire" />
      <path d="M12.5 7.5 C 12.5 5.8 19.5 5.8 19.5 7.5" className="pl-frame" />
      <path d="M10.5 9 L 21.5 9 L 20.5 26 L 11.5 26 Z" className="pl-glass" />
      <path d="M10.5 9 L 21.5 9 M11.5 26 L 20.5 26 M16 9 L 16 12" className="pl-frame" />
      <path d="M16 13.5 C 18.6 16.4 18.8 19.6 16 22.6 C 13.2 19.6 13.4 16.4 16 13.5 Z" className="pl-flame" />
      <path d="M16 17.4 C 17 18.6 17 19.8 16 21 C 15 19.8 15 18.6 16 17.4 Z" className="pl-core" />
      <path d="M9.5 27.5 L 22.5 27.5" className="pl-frame" />
      <circle cx="8" cy="12" r="0.9" className="pl-spark" />
      <circle cx="24.5" cy="10" r="0.8" className="pl-spark pl-d2" />
      <circle cx="23" cy="17" r="0.7" className="pl-spark pl-d3" />
    </svg>
  )
}
