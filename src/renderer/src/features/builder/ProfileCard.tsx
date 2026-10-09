// The entry as its card will look in the world (the World room's portrait card, drawn the builder's own way so it reads
// the same in every layout): its picture (Adam's portrait, else its drawing glowing on its kind's colour under a few
// stars), its role, its name, its one-liner and how much of it is filled in. Beside the steps it fills in as Adam
// types; on Review it is the finished character, large, before he saves.
import { useState } from 'react'
import type { BuilderKind } from '@shared/contracts/builder'
import { KIND_LABELS } from '@shared/fields'
import { cn } from '@/lib/cn'
import { Motif } from '@/components/art/Motif'
import { artHue, hashOf } from '@/features/desk/world/galleryLogic'

/** A few stars over the picture, steady per entry. */
function stars(id: string, n: number): { x: number; y: number; r: number; o: number }[] {
  const out: { x: number; y: number; r: number; o: number }[] = []
  let seed = hashOf(id)
  const next = (): number => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
    return seed / 4294967296
  }
  for (let i = 0; i < n; i++) out.push({ x: next() * 100, y: next() * 55, r: 0.5 + next() * 0.6, o: 0.35 + next() * 0.5 })
  return out
}

export function ProfileCard({
  kind,
  id,
  name,
  summary,
  role,
  image,
  motif,
  counts,
  large = false,
  className
}: {
  kind: BuilderKind
  /** The entry's id once it has one (its colour and stars follow it), else '' for one not made yet. */
  id: string
  name: string
  summary: string
  role: string
  image: string | null
  motif: string
  counts: { filled: number; total: number }
  large?: boolean
  className?: string
}): React.JSX.Element {
  const [failed, setFailed] = useState<string | null>(null)
  const src = image && failed !== image ? image : null
  const hue = artHue(kind, id || `new-${kind}`)
  const pct = counts.total ? Math.round((counts.filled / counts.total) * 100) : 0
  const noun = KIND_LABELS[kind].one.toLowerCase()
  return (
    <div
      className={cn('bld-pc', large && 'is-large', className)}
      data-kind={kind}
      style={{ '--pc-hue': hue } as React.CSSProperties}
      aria-label={`${name || `New ${noun}`}, as their card will show in the world`}
      role="img"
    >
      <div className="bld-pc-art">
        {src ? (
          <img src={src} alt="" draggable={false} onError={() => setFailed(src)} className="bld-pc-photo" />
        ) : (
          <>
            <svg className="bld-pc-stars" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
              {stars(id || kind, 9).map((s, i) => (
                <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="rgb(255 251 246)" opacity={s.o} />
              ))}
            </svg>
            <span className="bld-pc-glow" aria-hidden />
            <span className="bld-pc-motif" aria-hidden>
              <Motif key={motif} id={motif} size={large ? 112 : 84} />
            </span>
            <svg className="bld-pc-swell" viewBox="0 0 200 24" preserveAspectRatio="none" aria-hidden>
              <path d="M0 16 C 30 8 60 22 100 14 S 170 8 200 15 L 200 24 L 0 24 Z" fill="rgb(255 251 246 / 0.10)" />
              <path d="M0 20 C 40 14 80 24 120 18 S 180 15 200 19" fill="none" stroke="rgb(255 251 246 / 0.32)" strokeWidth="0.8" />
            </svg>
          </>
        )}
        {role ? <span className="bld-pc-role">{role}</span> : null}
      </div>
      <div className="bld-pc-body">
        <span className={cn('bld-pc-name', !name && 'is-empty')}>{name || `New ${noun}`}</span>
        <span className={cn('bld-pc-sum', !summary && 'is-empty')}>{summary || 'No summary yet'}</span>
        <span className="bld-pc-foot">
          <span className="bld-pc-meter" aria-hidden>
            <span style={{ transform: `scaleX(${pct / 100})` }} />
          </span>
          <span className="tabular-nums">
            {counts.filled} of {counts.total} filled
          </span>
        </span>
      </div>
    </div>
  )
}
