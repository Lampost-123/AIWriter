// The New look's small hero picture for the start screen and the first-run setup: a lit window on a headland over
// still water, its light lying on the water below. Drawn in the theme's own colours (the window in the warm amber),
// so it suits Light, Dark and Sepia alike. It never moves.
import { cn } from '@/lib/cn'

export function LitWindow({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 640 150" preserveAspectRatio="xMidYMid slice" aria-hidden className={cn('block h-full w-full', className)}>
      <defs>
        <radialGradient id="lit-window-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="var(--ai)" stopOpacity="0.45" />
          <stop offset="1" stopColor="var(--ai)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="lit-window-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--surface-2)" stopOpacity="0" />
          <stop offset="1" stopColor="var(--surface-2)" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <rect width="640" height="150" fill="url(#lit-window-sky)" />
      {/* A star or two, and the far shore. */}
      <circle cx="96" cy="26" r="1.4" fill="var(--faint)" opacity="0.6" />
      <circle cx="530" cy="18" r="1.1" fill="var(--faint)" opacity="0.5" />
      <circle cx="580" cy="40" r="1.6" fill="var(--faint)" opacity="0.45" />
      <path d="M0 98 C 70 90 120 94 180 96 C 240 98 280 92 330 95 L 330 104 L 0 104 Z" fill="var(--line)" opacity="0.7" />
      {/* The headland, and the house on it with its lit window. */}
      <path d="M330 104 C 360 76 392 66 430 64 C 470 62 500 72 530 84 C 560 94 600 98 640 100 L 640 104 Z" fill="var(--surface-3)" />
      <path d="M440 64 L 440 46 L 455 34 L 470 46 L 470 64 Z" fill="var(--line-strong)" />
      <circle cx="455" cy="52" r="26" fill="url(#lit-window-glow)" />
      <rect x="451" y="48" width="8" height="9" rx="1" fill="var(--ai)" />
      {/* Still water, and the window's light lying on it. */}
      <g stroke="var(--line-strong)" strokeLinecap="round" opacity="0.7">
        <line x1="40" y1="114" x2="210" y2="114" strokeWidth="1.5" />
        <line x1="250" y1="122" x2="380" y2="122" strokeWidth="1.5" />
        <line x1="90" y1="131" x2="170" y2="131" strokeWidth="1.5" />
        <line x1="520" y1="118" x2="610" y2="118" strokeWidth="1.5" />
        <line x1="300" y1="140" x2="350" y2="140" strokeWidth="1.5" />
      </g>
      <g stroke="var(--ai)" strokeLinecap="round" opacity="0.55">
        <line x1="447" y1="112" x2="463" y2="112" strokeWidth="2" />
        <line x1="442" y1="120" x2="468" y2="120" strokeWidth="2" />
        <line x1="449" y1="128" x2="461" y2="128" strokeWidth="2" />
        <line x1="445" y1="137" x2="465" y2="137" strokeWidth="1.6" opacity="0.6" />
      </g>
    </svg>
  )
}
