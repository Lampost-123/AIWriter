// The New look's small picture at the head of each Settings page (UI overhaul, "first run, Settings and moving work in
// and out"): a little drawing of what the page is about, in the theme's own colours, with one quiet movement each (a
// lamp breathing, sound rings going out, a page drifting up out of the basket, the lighthouse's beam). Slow (seconds
// long) and small, by transform or opacity only; still while the window is hidden or left, while Adam types, and with
// less motion (sectionArt.css, components/art/living.ts). Amber only where the AI is (the Models page's lamp).
import type { SettingsTab } from '@/lib/store'
import { cn } from '@/lib/cn'
import { watchWindowForArt } from '@/components/art/living'
import './sectionArt.css'

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

/** A sheet of paper with a few written lines (shared by several pictures). */
function Paper({ x, y, w, h, lines = 4, r = 3, tilt = 0 }: { x: number; y: number; w: number; h: number; lines?: number; r?: number; tilt?: number }): React.JSX.Element {
  return (
    <g transform={tilt ? `rotate(${tilt} ${x + w / 2} ${y + h / 2})` : undefined}>
      <rect x={x} y={y} width={w} height={h} rx={r} className="sa-paper" />
      {Array.from({ length: lines }, (_, i) => (
        <path key={i} d={`M${x + 7} ${y + 10 + i * 7}h${(w - 14) * (i === lines - 1 ? 0.6 : i % 2 ? 0.86 : 1)}`} className="sa-line" />
      ))}
    </g>
  )
}

function Models(): React.JSX.Element {
  return (
    <>
      {/* Two services on either side, a cable to the lamp: the AI's own amber, breathing. */}
      <path d="M26 66 C 40 66 44 54 58 54" className="sa-cable" />
      <path d="M106 66 C 92 66 88 54 74 54" className="sa-cable" />
      <rect x="12" y="58" width="18" height="16" rx="5" className="sa-tile sa-k1" />
      <rect x="102" y="58" width="18" height="16" rx="5" className="sa-tile sa-k2" />
      <circle cx="66" cy="44" r="26" className="sa-ai-glow sa-breathe lp" />
      <path d="M58 30h16l-2 -6h-12z" className="sa-ink-fill" />
      <rect x="56" y="30" width="20" height="30" rx="4" className="sa-glass" />
      <path d="M66 36c3.5 4 4 7.5 0 12c-4 -4.5 -3.5 -8 0 -12z" className="sa-ai-flame sa-flicker lp" />
      <path d="M54 60h24v5a3 3 0 0 1 -3 3h-18a3 3 0 0 1 -3 -3z" className="sa-ink-fill" />
      <path d="M66 18v6" {...S} className="sa-ink" />
    </>
  )
}

function Preferences(): React.JSX.Element {
  return (
    <>
      {/* An open notebook, and a quill that sways a little as if about to write. */}
      <path d="M18 30 C 34 24 52 26 64 32 L64 78 C 52 72 34 70 18 76 Z" className="sa-paper" />
      <path d="M110 30 C 94 24 76 26 64 32 L64 78 C 76 72 94 70 110 76 Z" className="sa-paper" />
      {[40, 48, 56, 64].map((y) => (
        <path key={y} d={`M26 ${y - 2} C 38 ${y - 6} 48 ${y - 5} 57 ${y - 2}`} className="sa-line" />
      ))}
      {[40, 48].map((y) => (
        <path key={y} d={`M71 ${y - 2} C 80 ${y - 5} 92 ${y - 6} 102 ${y - 2}`} className="sa-line" />
      ))}
      <g className="sa-sway lp">
        <path d="M96 62 C 104 44 112 30 122 16 C 118 34 108 50 98 62 Z" className="sa-tile sa-k3" />
        <path d="M96 62 L122 16" {...S} className="sa-ink" strokeWidth={1.2} />
      </g>
      <circle cx="94" cy="65" r="1.6" className="sa-ink-fill" />
    </>
  )
}

function Appearance(): React.JSX.Element {
  return (
    <>
      {/* A small desk lamp over a sheet, with the colours fanned out beside it. */}
      <g className="sa-lamp-light lp">
        <path d="M44 34 L22 74 L78 74 Z" className="sa-light" />
      </g>
      <Paper x={24} y={56} w={50} h={28} lines={2} />
      <path d="M40 30 L52 18 L60 26" {...S} className="sa-ink" />
      <path d="M36 34 a9 9 0 0 1 16 -8 z" className="sa-ink-fill" />
      <g transform="translate(96 60)">
        <rect x="-11" y="-30" width="22" height="34" rx="5" transform="rotate(-18)" className="sa-swatch" style={{ fill: 'var(--k-place)' }} />
        <rect x="-11" y="-30" width="22" height="34" rx="5" transform="rotate(0)" className="sa-swatch" style={{ fill: 'var(--k-char)' }} />
        <rect x="-11" y="-30" width="22" height="34" rx="5" transform="rotate(18)" className="sa-swatch" style={{ fill: 'var(--accent)' }} />
        <circle cx="0" cy="0" r="2.4" className="sa-paper" />
      </g>
    </>
  )
}

function Speech(): React.JSX.Element {
  return (
    <>
      {/* A horn sending sound rings out, and a microphone listening. */}
      <path d="M26 42h10l16 -12v36l-16 -12h-10z" className="sa-tile sa-k4" />
      <path d="M26 42h10l16 -12v36l-16 -12h-10z" {...S} className="sa-ink" />
      <path d="M60 38a14 14 0 0 1 0 20" {...S} className="sa-ring sa-r1 lp" />
      <path d="M66 32a22 22 0 0 1 0 32" {...S} className="sa-ring sa-r2 lp" />
      <path d="M72 26a30 30 0 0 1 0 44" {...S} className="sa-ring sa-r3 lp" />
      <rect x="96" y="30" width="14" height="26" rx="7" className="sa-tile sa-k5" />
      <rect x="96" y="30" width="14" height="26" rx="7" {...S} className="sa-ink" />
      <path d="M90 50a13 13 0 0 0 26 0M103 63v8M96 72h14" {...S} className="sa-ink" />
    </>
  )
}

function Editor(): React.JSX.Element {
  return (
    <>
      {/* A page being written, a pen nib moving along its last line. */}
      <Paper x={26} y={16} w={64} h={70} lines={6} r={4} />
      <path d="M33 66h22" className="sa-line sa-line-strong" />
      <g className="sa-nib lp">
        <path d="M70 66 L92 44 L100 52 L78 74 Z" className="sa-tile sa-k6" />
        <path d="M70 66 L92 44 L100 52 L78 74 Z M70 66 l-4 12 l12 -4" {...S} className="sa-ink" />
      </g>
      <path d="M100 28h12M106 22v12" {...S} className="sa-ink sa-faint" />
    </>
  )
}

function Backups(): React.JSX.Element {
  return (
    <>
      {/* Copies kept on a shelf, the newest tied with a ribbon, and the hands of time going round. */}
      <rect x="20" y="58" width="58" height="16" rx="3" className="sa-paper" />
      <rect x="24" y="44" width="54" height="16" rx="3" className="sa-paper" />
      <rect x="18" y="30" width="60" height="16" rx="3" className="sa-tile sa-k2" />
      <rect x="18" y="30" width="60" height="16" rx="3" {...S} className="sa-ink" />
      <path d="M58 30v24l4 -4 4 4v-24" className="sa-ribbon" />
      <path d="M14 76h96" {...S} className="sa-ink sa-faint" />
      <circle cx="98" cy="44" r="16" className="sa-paper" />
      <g className="sa-turn lp">
        <path d="M98 44v-9" {...S} className="sa-ink" />
      </g>
      <path d="M98 44l6 4" {...S} className="sa-ink" />
      <path d="M86 32a16 16 0 0 1 22 -2" {...S} className="sa-accent" />
      <path d="M108 30l1 -5" {...S} className="sa-accent" />
    </>
  )
}

function Trash(): React.JSX.Element {
  return (
    <>
      {/* A basket of crumpled pages, one drifting back up out of it: brought back. */}
      <path d="M34 42h56l-6 38a4 4 0 0 1 -4 3h-36a4 4 0 0 1 -4 -3z" className="sa-tile sa-k5" />
      <path d="M34 42h56l-6 38a4 4 0 0 1 -4 3h-36a4 4 0 0 1 -4 -3z M48 50l2 26M62 50v26M76 50l-2 26" {...S} className="sa-ink" />
      <circle cx="48" cy="40" r="7" className="sa-paper" />
      <circle cx="70" cy="38" r="8" className="sa-paper" />
      <path d="M44 38l4 3l3 -4M66 36l5 4l3 -3" {...S} className="sa-line" />
      <g className="sa-float lp">
        <Paper x={78} y={10} w={24} h={30} lines={3} r={2} tilt={12} />
      </g>
      <path d="M92 44c4 -2 6 -6 6 -10" {...S} className="sa-accent sa-dash" />
    </>
  )
}

function Usage(): React.JSX.Element {
  return (
    <>
      {/* A ledger with a little bar chart, and two coins that catch the light. */}
      <rect x="18" y="18" width="66" height="64" rx="5" className="sa-paper" />
      <path d="M28 70h48" {...S} className="sa-ink sa-faint" />
      {[
        [32, 50],
        [42, 40],
        [52, 56],
        [62, 32],
        [72, 46]
      ].map(([x, y]) => (
        <rect key={x} x={x - 3} y={y} width="6" height={70 - y} rx="1.6" className="sa-bar" />
      ))}
      <path d="M28 28h22" className="sa-line" />
      <ellipse cx="100" cy="72" rx="15" ry="5" className="sa-coin-edge" />
      <ellipse cx="100" cy="66" rx="15" ry="5" className="sa-coin" />
      <ellipse cx="104" cy="58" rx="15" ry="5" className="sa-coin-edge" />
      <ellipse cx="104" cy="52" rx="15" ry="5" className="sa-coin" />
      <path d="M98 52h12" className="sa-glint lp" />
    </>
  )
}

function About(): React.JSX.Element {
  return (
    <>
      {/* The lighthouse on its headland, its beam turning: the start screen's harbour in small. */}
      <rect x="0" y="0" width="132" height="96" rx="12" className="sa-sky" />
      <g className="sa-beam lp">
        <path d="M84 32 L4 18 L4 44 Z" className="sa-beam-light" />
      </g>
      <path d="M0 74 C 30 70 60 72 132 66 L132 96 L0 96 Z" className="sa-sea" />
      <path d="M60 96 C 70 80 82 70 100 68 C 114 66 124 68 132 70 L132 96 Z" className="sa-land" />
      <path d="M79 70 L89 70 L87 36 L81 36 Z" className="sa-tower" />
      <path d="M80 56h8M80.6 46h6.8" stroke="var(--sx-band, #a54b44)" strokeWidth="3" />
      <rect x="80" y="27" width="8" height="9" rx="1.5" className="sa-lamp" />
      <path d="M78.5 28 L89.5 28 L84 22 Z" className="sa-roof" />
      <circle cx="20" cy="16" r="1" className="sa-star" />
      <circle cx="44" cy="10" r="0.9" className="sa-star" />
      <circle cx="112" cy="14" r="1.1" className="sa-star" />
    </>
  )
}

const PICTURES: Record<SettingsTab, () => React.JSX.Element> = {
  models: Models,
  preferences: Preferences,
  appearance: Appearance,
  speech: Speech,
  editor: Editor,
  backups: Backups,
  trash: Trash,
  usage: Usage,
  about: About
}

export function SectionArt({ tab, className }: { tab: SettingsTab; className?: string }): React.JSX.Element {
  watchWindowForArt()
  const Picture = PICTURES[tab]
  return (
    <svg aria-hidden viewBox="0 0 132 96" data-section-art={tab} className={cn('sa la', className)}>
      <Picture />
    </svg>
  )
}
