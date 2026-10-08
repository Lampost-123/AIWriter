// The pictures on the World room's cards (UI overhaul phase 4): drawn, not generated, in the kind's colour turned a little
// each entry's own way (galleryLogic.artHue), so the same entry always has the same picture. Two layers each: a far one
// (stars, swell, a ridge) and a near one (the kind's two-tone icon in its glow, or a headland with its lit window), which
// part a few pixels on hover (desk.css, the art parallax). An entry's own portrait always wins: then the picture is his.
// The Phosphor two-tone icons are the app's own (components/ui/icons); the landscapes follow the start screen's lit
// window (components/ui/LitWindow.tsx). The desk's motif library (one drawing chosen per entry) comes in phase 5.
import { useState } from 'react'
import type { EntryKind } from '@shared/types'
import { KIND_ICONS } from '@/features/world/kindIcons'
import { artHue, hashOf, variantOf } from './galleryLogic'

/** A few stars, steady per entry. */
function stars(id: string, w: number, h: number, n: number): { x: number; y: number; r: number; o: number }[] {
  const out: { x: number; y: number; r: number; o: number }[] = []
  let seed = hashOf(id)
  const next = (): number => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
    return seed / 4294967296
  }
  for (let i = 0; i < n; i++) out.push({ x: next() * w, y: next() * h * 0.62, r: 0.8 + next() * 0.8, o: 0.4 + next() * 0.45 })
  return out
}

/**
 * A character's cameo: a head-and-shoulders silhouette in light ink inside an oval ring, the hair one of three cuts
 * (steady per entry), so a row of characters isn't the same picture four times.
 */
const HAIR = [
  // Short, swept.
  'M35 37 C 34 24 42 17 51 17 C 61 17 67 24 66 35 C 63 29 57 26 50 27 C 43 27 38 31 35 37 Z',
  // Long, to the shoulders.
  'M34 40 C 32 24 41 16 50 16 C 60 16 69 24 66 42 C 67 52 70 58 72 64 C 66 62 64 56 63 50 L 63 36 C 58 31 43 31 38 37 L 38 50 C 37 56 34 62 28 64 C 30 58 33 52 34 40 Z',
  // A hood.
  'M30 46 C 29 26 39 13 50 13 C 62 13 72 26 70 46 C 69 54 72 60 76 66 L 64 62 C 64 54 64 44 63 38 C 58 30 42 30 37 38 C 36 44 36 54 36 62 L 24 66 C 28 60 31 54 30 46 Z'
]
function Cameo({ id, size }: { id: string; size: number }): React.JSX.Element {
  const hair = HAIR[variantOf(id, HAIR.length)]
  return (
    <svg className="g-art-icon" width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <ellipse cx={50} cy={50} rx={38} ry={45} fill="none" stroke="rgb(255 251 246 / 0.55)" strokeWidth={1.4} />
      <ellipse cx={50} cy={50} rx={34} ry={41} fill="none" stroke="rgb(255 251 246 / 0.25)" strokeWidth={1} />
      <ellipse cx={50} cy={38} rx={13.5} ry={15.5} fill="rgb(255 251 246 / 0.92)" />
      <path d="M44 50 L 44 60 L 56 60 L 56 50 Z" fill="rgb(255 251 246 / 0.92)" />
      <path d="M24 90 C 25 72 36 63 50 63 C 64 63 75 72 76 90 C 68 93 59 94 50 94 C 41 94 32 93 24 90 Z" fill="rgb(255 251 246 / 0.92)" />
      <path d={hair} fill="rgb(255 251 246 / 0.98)" />
    </svg>
  )
}

/** The picture an entry has, when it loads (else null: the drawing shows). */
function usePicture(image: string | null): [string | null, () => void] {
  const [failed, setFailed] = useState<string | null>(null)
  return [image && failed !== image ? image : null, () => setFailed(image)]
}

/**
 * A portrait card's picture (characters, and plain cards' tops): the entry's own portrait, or the kind's icon glowing on a
 * gradient under a few stars and a line of swell.
 */
export function PortraitArt({
  id,
  kind,
  image,
  featured = false
}: {
  id: string
  kind: EntryKind
  image: string | null
  featured?: boolean
}): React.JSX.Element {
  const [src, onError] = usePicture(image)
  const hue = artHue(kind, id)
  const Icon = KIND_ICONS[kind]
  if (src) {
    return (
      <span aria-hidden className="g-art g-art-photo">
        <img src={src} alt="" draggable={false} decoding="async" loading="lazy" onError={onError} className="g-art-motif" />
        <span className="g-art-shade" />
      </span>
    )
  }
  return (
    <span
      aria-hidden
      className="g-art"
      style={{
        background: `radial-gradient(80% 60% at 20% 4%, rgb(255 255 255 / 0.24), transparent 70%), linear-gradient(162deg, hsl(${hue} 46% 70%), hsl(${hue} 40% 47%) 56%, hsl(${hue} 46% 29%))`
      }}
    >
      <svg className="g-art-far" viewBox="0 0 220 180" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">
        {stars(id, 220, 180, 6).map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#f8f2ff" opacity={s.o} />
        ))}
        <path
          d="M-10 146q13-4 26 0t26 0t26 0t26 0t26 0t26 0t26 0t26 0t26 0"
          fill="none"
          stroke="#f3ecff"
          strokeWidth={1.2}
          strokeLinecap="round"
          opacity={0.32}
        />
        <path
          d="M-4 160q16-4 32 0t32 0t32 0t32 0t32 0t32 0t32 0t32 0"
          fill="none"
          stroke="#f3ecff"
          strokeWidth={1.2}
          strokeLinecap="round"
          opacity={0.2}
        />
      </svg>
      <span className="g-art-motif">
        <span className="g-art-glow" />
        {kind === 'character' ? <Cameo id={id} size={featured ? 112 : 96} /> : <Icon size={featured ? 64 : 54} className="g-art-icon" />}
      </span>
    </span>
  )
}

/** Three headlands for places: a light on the point, roofs above a harbour, hills with a path. */
const LANDS = [
  // A headland with its light.
  {
    near: 'M0 78 C 40 70 70 64 104 62 C 140 60 168 66 196 74 C 230 84 262 88 300 86 L300 100 L0 100 Z',
    building: 'M178 66 L178 40 L184 34 L190 40 L190 70 Z',
    light: { x: 184, y: 44 }
  },
  // Roofs above a narrow harbour.
  {
    near: 'M0 74 L 26 74 L 26 62 L 40 54 L 54 62 L 54 72 L 70 72 L 70 58 L 86 48 L 102 58 L 102 74 L 300 78 L300 100 L0 100 Z',
    building: 'M116 76 L116 60 L128 52 L140 60 L140 77 Z',
    light: { x: 128, y: 64 }
  },
  // Hills, and a path out over the water.
  {
    near: 'M0 70 C 50 58 90 56 140 66 C 170 72 200 80 236 82 L 300 84 L300 100 L0 100 Z',
    building: 'M236 82 L 252 82 L 258 78 L 270 78 L 276 82 L 300 82 L 300 84 L 236 84 Z',
    light: { x: 92, y: 60 }
  }
]

/** A landscape card's picture (places): a sky in the place's colour, a far ridge, the near land, still water and a lit window. */
export function LandscapeArt({ id, image }: { id: string; image: string | null }): React.JSX.Element {
  const [src, onError] = usePicture(image)
  const hue = artHue('place', id)
  if (src) {
    return (
      <span aria-hidden className="g-art g-art-photo">
        <img src={src} alt="" draggable={false} decoding="async" loading="lazy" onError={onError} className="g-art-motif" />
        <span className="g-art-shade" />
      </span>
    )
  }
  const land = LANDS[variantOf(id, LANDS.length)]
  const g = `lg-${id.replace(/[^a-z0-9]/gi, '')}`
  return (
    <span
      aria-hidden
      className="g-art"
      style={{ background: `linear-gradient(180deg, hsl(${hue} 36% 74%), hsl(${hue} 34% 52%) 70%, hsl(${hue} 40% 36%))` }}
    >
      <svg className="g-art-far" viewBox="0 0 300 100" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">
        {stars(id, 300, 100, 5).map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y * 0.7} r={s.r * 0.8} fill="#f2fbf8" opacity={s.o * 0.9} />
        ))}
        <path d="M0 66 C 60 54 110 58 160 60 C 210 62 250 54 300 58 L300 100 L0 100 Z" fill={`hsl(${hue} 30% 40%)`} opacity={0.55} />
      </svg>
      <svg className="g-art-motif" viewBox="0 0 300 100" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">
        <defs>
          <radialGradient id={g} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#ffd796" stopOpacity="0.85" />
            <stop offset="1" stopColor="#ffd796" stopOpacity="0" />
          </radialGradient>
        </defs>
        <path d={land.near} fill={`hsl(${hue} 34% 22%)`} />
        <path d={land.building} fill={`hsl(${hue} 30% 16%)`} />
        <circle cx={land.light.x} cy={land.light.y} r={16} fill={`url(#${g})`} />
        <rect x={land.light.x - 2} y={land.light.y - 2.5} width={4} height={5} rx={1} fill="#ffcf7a" />
        <path d="M0 92 h300" stroke="#eaf7f3" strokeOpacity={0.22} strokeWidth={1} />
        <path
          d={`M${land.light.x - 10} 95 h20 M${land.light.x - 6} 98 h12`}
          stroke="#ffcf7a"
          strokeOpacity={0.45}
          strokeWidth={1.2}
          strokeLinecap="round"
        />
      </svg>
    </span>
  )
}

/** A kind's icon on a small round seal (a group's parchment, a plain card's corner). */
export function Seal({ kind, size = 34 }: { kind: EntryKind; size?: number }): React.JSX.Element {
  const Icon = KIND_ICONS[kind]
  return (
    <span aria-hidden className="g-seal" data-kind={kind} style={{ width: size, height: size }}>
      <Icon size={Math.round(size * 0.52)} />
    </span>
  )
}
