// The living picture on the New look's empty timeline (UI overhaul): a river under a sky, three days marked along its
// bank with little cards floating over them, the sun going over and the water moving. Drawn in the theme's colours. It
// stays still with less motion, and pauses while the window is hidden.
import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'

/** True while the window is hidden (minimised, another app full screen): living art stops then. */
export function useHidden(): boolean {
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden)
  useEffect(() => {
    const on = (): void => setHidden(document.hidden)
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return hidden
}

export function RiverArt({ className }: { className?: string }): React.JSX.Element {
  const hidden = useHidden()
  const days = [
    { x: 120, label: 'Day 1', d: 0 },
    { x: 300, label: 'Day 2', d: 1 },
    { x: 480, label: 'Day 5', d: 2 }
  ]
  return (
    <svg viewBox="0 0 600 300" className={cn('tl-art', className)} data-paused={hidden || undefined} aria-hidden>
      <defs>
        <linearGradient id="tl-art-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--accent-soft)" stopOpacity="0.9" />
          <stop offset="1" stopColor="var(--accent-soft)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="tl-art-water" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.05" />
          <stop offset="0.5" stopColor="var(--accent)" stopOpacity="0.22" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0.05" />
        </linearGradient>
        <clipPath id="tl-art-clip">
          <rect x="0" y="0" width="600" height="300" rx="18" />
        </clipPath>
      </defs>
      <g clipPath="url(#tl-art-clip)">
        <rect width="600" height="300" fill="url(#tl-art-sky)" />
        <g className="tl-art-sun">
          <circle cx="300" cy="64" r="30" className="tl-art-sunglow" />
          <circle cx="300" cy="64" r="15" className="tl-art-sunbody" />
        </g>
        {/* The river, its water moving. */}
        <path d="M-20 214 C 110 190, 190 238, 300 212 S 500 186, 620 210 L 620 250 C 500 228, 420 262, 300 250 S 100 232, -20 252 Z" fill="url(#tl-art-water)" />
        <path className="tl-art-ripple" d="M-20 226 C 110 204, 190 250, 300 226 S 500 200, 620 222" />
        <path className="tl-art-ripple is-2" d="M-20 240 C 110 220, 190 262, 300 240 S 500 214, 620 236" />
        {/* The time line along the bank, drawing itself. */}
        <path className="tl-art-axis" pathLength={1} d="M40 176 H 560" />
        {days.map((d) => (
          <g key={d.label} className="tl-art-day" style={{ animationDelay: `${600 + d.d * 260}ms` }}>
            <line x1={d.x} x2={d.x} y1={168} y2={184} className="tl-art-tick" />
            <circle cx={d.x} cy={176} r={4.5} className="tl-art-dot" />
            <text x={d.x} y={202} className="tl-art-label">
              {d.label}
            </text>
          </g>
        ))}
        {/* Little scene cards floating over their days. */}
        {days.map((d) => (
          <g key={`c${d.label}`} className="tl-art-card" style={{ animationDelay: `${d.d * -2.1}s` }}>
            <rect x={d.x - 46} y={92} width={92} height={58} rx={6} className="tl-art-cardbody" />
            <line x1={d.x - 34} x2={d.x + 22} y1={110} y2={110} className="tl-art-cardline is-title" />
            <line x1={d.x - 34} x2={d.x + 30} y1={124} y2={124} className="tl-art-cardline" />
            <line x1={d.x - 34} x2={d.x + 8} y1={136} y2={136} className="tl-art-cardline" />
            <circle cx={d.x + 30} cy={136} r={6} className={cn('tl-art-pov', `is-${d.d}`)} />
          </g>
        ))}
        {/* A lane, thick where its character is there. */}
        <path className="tl-art-lane" pathLength={1} d="M120 272 H 300" />
        <path className="tl-art-lane is-thin" pathLength={1} d="M300 272 H 480" />
        <circle cx="120" cy="272" r="6" className="tl-art-mark" />
        <circle cx="300" cy="272" r="5" className="tl-art-mark is-ring" />
        <circle cx="480" cy="272" r="6" className="tl-art-mark" />
      </g>
    </svg>
  )
}
