// The New look's mark for an AI service (Settings › Models, the first run's Connect step): a small tile with a plain
// shape of its own, never the company's logo. OpenRouter is a road that branches (one key, many models); a program on
// this computer is a little screen; any other service gets one of a few simple figures and a kind ink, picked from its
// name so it always looks the same. Classic keeps its key and server icons (ModelsSettings.tsx).
import { isLocalUrl } from '@shared/urls'
import { cn } from '@/lib/cn'

type Shape = 'branch' | 'screen' | 'circle' | 'diamond' | 'triangle' | 'hex' | 'waves' | 'stack'

/** The tile's ink and its soft ground, from the kind colours (styles.css; contrast-tested). */
const INKS = [
  ['var(--k-group)', 'var(--k-group-soft)'],
  ['var(--k-place)', 'var(--k-place-soft)'],
  ['var(--k-char)', 'var(--k-char-soft)'],
  ['var(--k-lore)', 'var(--k-lore-soft)'],
  ['var(--k-event)', 'var(--k-event-soft)'],
  ['var(--k-thread)', 'var(--k-thread-soft)']
] as const

const FIGURES: Shape[] = ['circle', 'diamond', 'triangle', 'hex', 'waves', 'stack']

const hash = (s: string): number => [...s.toLowerCase()].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)

/** Which shape and ink a service gets. */
export function markOf(o: { kind?: 'openrouter' | 'custom'; name: string; baseUrl?: string }): { shape: Shape; ink: string; soft: string } {
  if (o.kind === 'openrouter') return { shape: 'branch', ink: 'var(--accent)', soft: 'var(--accent-soft)' }
  const url = (o.baseUrl ?? '').trim()
  if (url && isLocalUrl(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `http://${url}`)) return { shape: 'screen', ink: 'var(--k-gloss)', soft: 'var(--k-gloss-soft)' }
  const h = hash(o.name || url || 'service')
  const [ink, soft] = INKS[h % INKS.length]
  return { shape: FIGURES[(h >> 3) % FIGURES.length], ink, soft }
}

function Figure({ shape }: { shape: Shape }): React.JSX.Element {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (shape) {
    case 'branch':
      return (
        <g {...common}>
          <path d="M4 12h5" />
          <path d="M9 12c3 0 4-5 8-5" />
          <path d="M9 12h8" />
          <path d="M9 12c3 0 4 5 8 5" />
          <circle cx="4" cy="12" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="18.5" cy="7" r="1.5" />
          <circle cx="18.5" cy="12" r="1.5" />
          <circle cx="18.5" cy="17" r="1.5" />
        </g>
      )
    case 'screen':
      return (
        <g {...common}>
          <rect x="4" y="5" width="16" height="11" rx="2" />
          <path d="M9 19.5h6M12 16v3.5" />
          <path d="M7.5 9.5h5M7.5 12h7" opacity="0.7" />
        </g>
      )
    case 'circle':
      return (
        <g {...common}>
          <circle cx="12" cy="12" r="7" />
          <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
        </g>
      )
    case 'diamond':
      return (
        <g {...common}>
          <path d="M12 4l8 8-8 8-8-8z" />
          <path d="M12 8.5l3.5 3.5-3.5 3.5-3.5-3.5z" fill="currentColor" stroke="none" opacity="0.55" />
        </g>
      )
    case 'triangle':
      return (
        <g {...common}>
          <path d="M12 4.5l8 14H4z" />
          <path d="M12 11l3 5.2H9z" fill="currentColor" stroke="none" opacity="0.55" />
        </g>
      )
    case 'hex':
      return (
        <g {...common}>
          <path d="M12 3.8l7 4.1v8.2l-7 4.1-7-4.1V7.9z" />
          <path d="M12 8v8M8.5 10l7 4M15.5 10l-7 4" opacity="0.7" />
        </g>
      )
    case 'waves':
      return (
        <g {...common}>
          <path d="M4 9c2-2 4-2 6 0s4 2 6 0 3-1.5 4-1" />
          <path d="M4 13c2-2 4-2 6 0s4 2 6 0 3-1.5 4-1" />
          <path d="M4 17c2-2 4-2 6 0s4 2 6 0 3-1.5 4-1" opacity="0.6" />
        </g>
      )
    default:
      return (
        <g {...common}>
          <path d="M12 4.5l8 3.8-8 3.8-8-3.8z" />
          <path d="M4 12l8 3.8 8-3.8" />
          <path d="M4 15.7l8 3.8 8-3.8" opacity="0.6" />
        </g>
      )
  }
}

/** The mark itself: a rounded tile in the service's soft ink with its figure. */
export function ProviderMark({
  kind,
  name,
  baseUrl,
  size = 36,
  className
}: {
  kind?: 'openrouter' | 'custom'
  name: string
  baseUrl?: string
  size?: number
  className?: string
}): React.JSX.Element {
  const m = markOf({ kind, name, baseUrl })
  return (
    <span
      aria-hidden
      data-provider-mark={m.shape}
      className={cn('grid shrink-0 place-items-center rounded-[10px] shadow-[inset_0_0_0_1px_color-mix(in_oklab,currentColor_16%,transparent)]', className)}
      style={{ width: size, height: size, color: m.ink, background: m.soft }}
    >
      <svg viewBox="0 0 24 24" width={Math.round(size * 0.6)} height={Math.round(size * 0.6)}>
        <Figure shape={m.shape} />
      </svg>
    </span>
  )
}
