// The New look's picture beside the first-run setup: a lighthouse on a headland, its beam across a quiet sky, the sea
// below and a small boat. Drawn in the theme's own colours, so it suits Light, Dark and Sepia. It stays still.
import { cn } from '@/lib/cn'

export function Lighthouse({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 600 720" preserveAspectRatio="xMidYMid slice" aria-hidden className={cn('block h-full w-full', className)}>
      <defs>
        <linearGradient id="lh-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--accent-soft)" />
          <stop offset="1" stopColor="var(--surface)" />
        </linearGradient>
        <linearGradient id="lh-beam-r" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--ai)" stopOpacity="0.45" />
          <stop offset="1" stopColor="var(--ai)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="lh-beam-l" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="var(--ai)" stopOpacity="0.3" />
          <stop offset="1" stopColor="var(--ai)" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="lh-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="var(--ai)" stopOpacity="0.55" />
          <stop offset="1" stopColor="var(--ai)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="600" height="720" fill="url(#lh-sky)" />
      {/* The beam, both ways across the sky. */}
      <polygon points="322,300 600,150 600,300" fill="url(#lh-beam-r)" />
      <polygon points="278,300 0,330 0,430" fill="url(#lh-beam-l)" />
      {/* The headland. */}
      <path d="M0 470 C 120 430 220 420 300 420 C 420 420 520 450 600 470 L 600 720 L 0 720 Z" fill="var(--surface-2)" />
      {/* The lighthouse: its tower, two bands, the lamp room and its roof. */}
      <polygon points="282,420 318,420 312,312 288,312" fill="var(--page)" stroke="var(--line-strong)" strokeWidth="2" strokeLinejoin="round" />
      <rect x="290" y="345" width="20" height="5" rx="1" fill="var(--k-event)" opacity="0.6" />
      <rect x="289" y="380" width="22" height="5" rx="1" fill="var(--k-event)" opacity="0.6" />
      <circle cx="300" cy="298" r="40" fill="url(#lh-glow)" />
      <rect x="286" y="286" width="28" height="26" rx="4" fill="var(--ai-soft)" stroke="var(--line-strong)" strokeWidth="2" />
      <circle cx="300" cy="299" r="6" fill="var(--ai)" />
      <polygon points="281,287 300,270 319,287" fill="var(--k-item)" />
      {/* The sea, in two bands, and a small boat. */}
      <path d="M0 560 C 120 545 260 552 360 556 C 460 560 540 548 600 552 L 600 720 L 0 720 Z" fill="var(--accent)" opacity="0.18" />
      <path d="M0 610 C 140 598 260 604 380 602 C 480 600 550 596 600 600 L 600 720 L 0 720 Z" fill="var(--accent)" opacity="0.28" />
      <g fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" opacity="0.7">
        <path d="M440 548 L 470 548 L 464 560 L 446 560 Z" />
        <path d="M455 548 L 455 520 L 470 540 Z" />
      </g>
    </svg>
  )
}
