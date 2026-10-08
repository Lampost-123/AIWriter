// A story's book cover, made for it rather than chosen (the desk's story home; UI overhaul, D5.1 and D5.4): a dusk sky in
// the story's own colour (its genre's hue, or one of its own), the sea below with the light on it, a glow, the story's
// drawing from the drawing library standing in that glow, and the title set on the cover in the serif. The book has
// depth: its pages along the edge, the spine's shading, a sheen. Hovered, it lifts. Drawn in SVG and CSS, so it is crisp
// at any size and costs nothing to make.
import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * The cover's colours for a hue (0–360, OKLCH like the genre tiles'): a deep sky in the hue that warms through rose to
 * a peach horizon, whatever the hue, and the sea under it in the hue again.
 */
export function coverColours(hue: number): { sky: [string, string, string, string]; sea: [string, string] } {
  const h = ((Math.round(hue) % 360) + 360) % 360
  return {
    sky: [`oklch(0.22 0.06 ${h})`, `oklch(0.34 0.08 ${h})`, `oklch(0.5 0.07 ${(h + 50) % 360})`, 'oklch(0.83 0.09 62)'],
    sea: [`oklch(0.42 0.05 ${h})`, `oklch(0.19 0.05 ${h})`]
  }
}

/** Splits a title over two lines at the space nearest its middle ("The Keeper’s" / "Light"), when it is long. */
export function titleLines(title: string): string[] {
  const t = title.trim() || 'Untitled'
  if (t.length <= 12 || !t.includes(' ')) return [t]
  const mid = t.length / 2
  let best = -1
  for (let i = t.indexOf(' '); i >= 0; i = t.indexOf(' ', i + 1)) if (best < 0 || Math.abs(i - mid) < Math.abs(best - mid)) best = i
  return [t.slice(0, best), t.slice(best + 1)]
}

export function BookCover({
  title,
  kicker,
  foot,
  hue,
  art,
  width = 220,
  className,
  style
}: {
  title: string
  /** Over the title: "Book One". */
  kicker: string
  /** At the foot of the cover: "A Gullhaven story". */
  foot: string
  hue: number
  /** The drawing standing in the glow (components/art/Motif), drawn in the cover's light ink. */
  art?: ReactNode
  /** The book's width in pixels (its height follows, 300 to 220). */
  width?: number
  className?: string
  style?: CSSProperties
}): React.JSX.Element {
  const c = coverColours(hue)
  const lines = titleLines(title)
  const id = `cv-${Math.round(hue)}`
  const long = Math.max(...lines.map((l) => l.length))
  const titleSize = long > 18 ? 18 : long > 13 ? 21 : 25
  return (
    <span className={cn('book-cover', className)} style={{ ...style, '--book-w': `${width}px` } as CSSProperties} data-book-cover>
      <span className="bk-shadow" aria-hidden />
      <span className="bk-body" aria-hidden>
        <span className="bk-deep" />
        <span className="bk-pages" />
        <span className="bk-cover">
          <svg className="cv-art" viewBox="0 0 212 300" preserveAspectRatio="xMidYMid slice" aria-hidden>
            <defs>
              <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={c.sky[0]} />
                <stop offset="0.4" stopColor={c.sky[1]} />
                <stop offset="0.66" stopColor={c.sky[2]} />
                <stop offset="1" stopColor={c.sky[3]} />
              </linearGradient>
              <linearGradient id={`${id}-sea`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={c.sea[0]} />
                <stop offset="1" stopColor={c.sea[1]} />
              </linearGradient>
              <radialGradient id={`${id}-glow`} cx="0.5" cy="0.5" r="0.5">
                <stop offset="0" stopColor="#fff4d2" stopOpacity="0.9" />
                <stop offset="0.3" stopColor="#ffd78e" stopOpacity="0.5" />
                <stop offset="0.7" stopColor="#f4a458" stopOpacity="0.12" />
                <stop offset="1" stopColor="#f4a458" stopOpacity="0" />
              </radialGradient>
              <radialGradient id={`${id}-vig`} cx="0.5" cy="0.45" r="0.8">
                <stop offset="0.55" stopColor="#0e0c1e" stopOpacity="0" />
                <stop offset="1" stopColor="#0e0c1e" stopOpacity="0.38" />
              </radialGradient>
            </defs>
            <rect width="212" height="212" fill={`url(#${id}-sky)`} />
            {/* A few stars, always in the same places. */}
            {[
              [26, 18, 0.9],
              [188, 22, 1.1],
              [158, 58, 0.7],
              [40, 96, 0.8],
              [178, 120, 1],
              [70, 128, 0.6],
              [120, 84, 0.6]
            ].map(([x, y, r], i) => (
              <circle key={i} cx={x} cy={y} r={r} fill="#fff3da" opacity={0.55 + (i % 3) * 0.12} />
            ))}
            {/* Low cloud catching the last light. */}
            <path d="M6 182 C40 177 84 177 126 181 C94 186 44 187 6 182 Z" fill="#f6be93" opacity="0.28" />
            <path d="M98 166 C124 162 156 162 190 166 C162 170 124 171 98 166 Z" fill="#d9928c" opacity="0.2" />
            {/* The sea, the horizon's light on it, and slow swells. */}
            <rect y="210" width="212" height="90" fill={`url(#${id}-sea)`} />
            <rect y="209.4" width="212" height="1.2" fill="#ffd9a2" opacity="0.5" />
            <path className="cv-wave" d="M-20 236q12-2.4 24 0t24 0t24 0t24 0t24 0t24 0t24 0t24 0t24 0t24 0t24 0" />
            <path className="cv-wave" d="M-20 262q16-3 32 0t32 0t32 0t32 0t32 0t32 0t32 0t32 0" />
            <rect x="80" y="216" width="52" height="1.6" rx="0.8" fill="#ffdda8" opacity="0.7" />
            <rect x="70" y="228" width="72" height="1.8" rx="0.9" fill="#ffd49a" opacity="0.42" />
            <rect x="86" y="246" width="40" height="2" rx="1" fill="#f9c88e" opacity="0.3" />
            {/* The glow the drawing stands in. */}
            <circle className="cv-glow" cx="106" cy="172" r="58" fill={`url(#${id}-glow)`} />
            <rect width="212" height="300" fill={`url(#${id}-vig)`} />
          </svg>
          {art ? <span className="cv-motif">{art}</span> : null}
          <span className="cv-spine" />
          <span className="cv-sheen" />
          <span className="cv-frame" />
          <span className="cv-text">
            <span className="cv-kicker">{kicker}</span>
            <svg className="cv-orn" width="40" height="6" viewBox="0 0 40 6" aria-hidden>
              <path d="M2 3h13M25 3h13" fill="none" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
              <path d="M20 0.6l2.4 2.4-2.4 2.4-2.4-2.4z" fill="currentColor" />
            </svg>
            <span className="cv-title" style={{ fontSize: titleSize, lineHeight: `${titleSize + 3}px` }}>
              {lines.map((l, i) => (
                <span key={i}>{l}</span>
              ))}
            </span>
          </span>
          <span className="cv-foot">{foot}</span>
        </span>
      </span>
    </span>
  )
}
