import {
  BookOpen,
  Coffee,
  Compass,
  Feather,
  Flame,
  Ghost,
  Heart,
  Landmark,
  Laugh,
  Moon,
  Rocket,
  Search,
  Sparkles,
  Swords,
  Timer,
  WandSparkles,
  type IconType
} from '@/components/ui/icons'
import type { CSSProperties } from 'react'
import { GENRES, genresOf } from '@shared/genres'
import { cn } from '@/lib/cn'
import { genreRole, type GenresShown } from './feelLogic'

/** The presets' icon names (src/shared/genres.ts) and their icons. */
const ICONS: Record<string, IconType> = {
  WandSparkles,
  Moon,
  Swords,
  Rocket,
  Ghost,
  Timer,
  Search,
  Heart,
  Sparkles,
  Flame,
  Feather,
  Landmark,
  Compass,
  Laugh,
  Coffee
}

const hue = (h: number): CSSProperties => ({ '--hue': h }) as CSSProperties

/**
 * The genre presets as coloured tiles. Each takes its colour from the preset's hue, as light or dark as the
 * theme says (styles.css, "genre-tiles"). The picks carry a Main or Blend mark; on a story using the world's
 * picks, those tiles show a dashed edge instead and none is pressed.
 */
export function GenreTiles({ shown, onPick, labelledBy }: { shown: GenresShown; onPick: (id: string) => void; labelledBy: string }): React.JSX.Element {
  return (
    <div role="group" aria-labelledby={labelledBy} className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2">
      {GENRES.map((g) => {
        const Icon = ICONS[g.icon] ?? BookOpen
        const role = genreRole(shown.ids, g.id)
        const own = !!role && !shown.inherited
        return (
          <button
            key={g.id}
            type="button"
            aria-pressed={own}
            data-inherited={role && shown.inherited ? '' : undefined}
            title={g.blurb}
            onClick={() => onPick(g.id)}
            style={hue(g.hue)}
            className="genre-tile relative flex h-[72px] flex-col items-start justify-between rounded-xl px-3 pb-2.5 pt-3 text-left"
          >
            <Icon size={19} strokeWidth={1.75} className="genre-ink" aria-hidden />
            <span className="max-w-full truncate text-[13px] font-medium leading-tight text-fg">{g.label}</span>
            {role ? (
              <span
                className={cn(
                  'absolute right-2 top-2 rounded-full px-1.5 py-px text-[10.5px] font-semibold leading-[1.45] animate-fade-in',
                  own ? 'genre-badge' : 'genre-ink border border-current bg-transparent'
                )}
              >
                {own ? (role === 'main' ? 'Main' : 'Blend') : "World's"}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

/**
 * The picked genres' one-line descriptions, in a space that always has room for two lines, so picking never
 * moves what is below. Faint while they are the world's.
 */
export function GenreBlurbs({ shown }: { shown: GenresShown }): React.JSX.Element {
  const picks = genresOf(shown.ids)
  return (
    <div className={cn('flex min-h-[40px] flex-col justify-start gap-0.5 text-[12.5px] leading-[18px]', shown.inherited && 'opacity-75')}>
      {picks.length ? (
        picks.map((g, i) => (
          <p key={g.id} className="truncate" style={hue(g.hue)} title={g.blurb}>
            <span className="genre-ink font-medium">{g.label}</span>
            {picks.length > 1 ? <span className="text-faint">{i === 0 ? ' leads' : ' blends in'}</span> : null}
            <span className="text-muted"> · {g.blurb}</span>
          </p>
        ))
      ) : (
        <p className="truncate text-faint">Nothing picked: the AI goes by your prose style and notes alone.</p>
      )}
    </div>
  )
}
