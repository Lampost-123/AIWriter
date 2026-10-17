import { memo, useId } from 'react'
import { genreLabel } from '@shared/genres'
import type { EffectiveStyle } from '@shared/style'
import type { StyleGuide } from '@shared/types'
import { Field, toast } from '@/components/ui'
import { cn } from '@/lib/cn'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { AiPhrasesSwitch } from './AiPhrasesSwitch'
import { GenreBlurbs, GenreTiles } from './GenreTiles'
import { IntensityControls } from './IntensityControls'
import { genreHint, intensityIntro, pickGenre, shownGenres, type FeelMode } from './feelLogic'
import { Group, short } from './StyleFields'
import { StylePresets } from './StylePresets'
import type { StylePreset } from '@shared/stylePresets'

/** What a preset changes in a style guide. */
const presetPatch = (p: StylePreset): Partial<StyleGuide> => ({
  pov: p.style.pov,
  tense: p.style.tense,
  proseStyle: p.style.proseStyle,
  genres: [...p.style.genres],
  genreNotes: p.style.genreNotes,
  intensity: { ...p.style.intensity }
})

const NOTES_PLACEHOLDER = 'Folk horror more than gothic. Magic is rare and frightening.'

/**
 * "Story feel", first on the Style guide's World and This story tabs: the genre (one, or two blended), Adam's
 * own take on it, how far romance, violence and language go, and the switch for common AI phrases. On a story,
 * anything it leaves unset shows the world's, faintly.
 */
export const StoryFeel = memo(function StoryFeel({
  value,
  onChange,
  below,
  mode
}: {
  value: StyleGuide
  onChange: (patch: Partial<StyleGuide>) => void
  /** The style the levels underneath give (for a story, the world's guide). */
  below: EffectiveStyle
  mode: FeelMode
}): React.JSX.Element {
  const ids = { genre: useId(), intensity: useId() }
  const shown = shownGenres(value.genres, below.genres, mode)
  const worldPicks = mode === 'story' && below.genres.length ? below.genres : null
  // The hint's room is the longest line it can show here, so picking never moves what is below.
  const hints = [genreHint({ ids: [], inherited: false }), ...(worldPicks ? [genreHint({ ids: worldPicks, inherited: true })] : [])]
  const hint = genreHint(shown)

  const notesFrom = mode === 'story' && !value.genreNotes.trim() && below.genreNotes ? `Uses the world's: ${short(below.genreNotes)}` : null

  return (
    <Group title="Story feel">
      <StylePresets
        value={value}
        onPick={(p) => {
          const before: Partial<StyleGuide> = {
            pov: value.pov,
            tense: value.tense,
            proseStyle: value.proseStyle,
            genres: [...value.genres],
            genreNotes: value.genreNotes,
            intensity: { ...value.intensity }
          }
          onChange(presetPatch(p))
          toast(`Set the style to “${p.label}”.`, { action: { label: 'Undo', run: () => onChange(before) } })
        }}
      />

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <span id={ids.genre} className="text-[12px] font-medium text-muted">
            Genre
          </span>
          {/* Kept in place (only hidden) so the row never changes height. */}
          <button
            type="button"
            onClick={() => onChange({ genres: [] })}
            tabIndex={worldPicks && value.genres.length ? 0 : -1}
            aria-hidden={!(worldPicks && value.genres.length)}
            className={cn(
              'text-[12px] text-accent transition-opacity duration-150 hover:underline',
              !(worldPicks && value.genres.length) && 'pointer-events-none invisible'
            )}
          >
            Use the world's{worldPicks ? ` (${genreLabel(worldPicks)})` : ''}
          </button>
        </div>
        <div className="-mt-1 grid text-[12px] leading-[17px] text-faint">
          {hints.map((h) => (
            <p key={h} className={cn('col-start-1 row-start-1', h !== hint && 'invisible', shown.inherited && 'italic')} aria-hidden={h !== hint}>
              {h}
            </p>
          ))}
        </div>
        <GenreTiles shown={shown} labelledBy={ids.genre} onPick={(id) => onChange({ genres: pickGenre(value.genres, id) })} />
        <GenreBlurbs shown={shown} />
      </div>

      <Field label="Your own take" hint="What the genre means for this book, in your words. It refines the picks above.">
        {(id) => (
          <AutoTextarea
            id={id}
            value={value.genreNotes}
            minRows={2}
            maxRows={10}
            placeholder={notesFrom ?? NOTES_PLACEHOLDER}
            onChange={(e) => onChange({ genreNotes: e.target.value })}
          />
        )}
      </Field>

      <div className="flex flex-col gap-2">
        <div>
          <span id={ids.intensity} className="text-[12px] font-medium text-muted">
            How far it goes
          </span>
          <p className="text-[12px] leading-[17px] text-faint">
            {intensityIntro(mode, below.intensity)}
          </p>
        </div>
        <div role="group" aria-labelledby={ids.intensity}>
          <IntensityControls value={value.intensity} below={below.intensity} mode={mode} onChange={(intensity) => onChange({ intensity })} />
        </div>
      </div>

      <div className="pt-1">
        <AiPhrasesSwitch />
      </div>
    </Group>
  )
})
