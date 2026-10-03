// The binder's mark on what is being read aloud: a small speaker in place of the scene's status dot, and a fainter one
// on its chapter's row, from any page of the app (and as Keep reading moves on). Owned by the Read aloud part.
import { Volume2 } from '@/components/ui/icons'
import type { ID, SceneStatus } from '@shared/types'
import { cn } from '@/lib/cn'
import { useOutlineStore } from '@/features/binder/outlineStore'
import { StatusDot } from '@/features/binder/StatusDot'
import { useReading } from './control'
import { playingLabel, playingScene } from './playing'

/** "Playing aloud" (or "Reading aloud, paused") when this scene is being read; null otherwise. */
function useSceneLabel(sceneId: ID): string | null {
  const playing = useReading((s) => playingScene(s) === sceneId)
  const paused = useReading((s) => s.bar?.phase === 'paused')
  return playing ? playingLabel(paused) : null
}

/**
 * A scene's status dot; while the scene is read aloud, a small speaker over the same spot, so the title never moves.
 * The words a screen reader hears ("Playing aloud. Drafted: ") are in the row too.
 */
export function SceneStatusMark({ sceneId, status, statusLabel }: { sceneId: ID; status: SceneStatus; statusLabel: string }): React.JSX.Element {
  const label = useSceneLabel(sceneId)
  return (
    <>
      <span className="relative mr-2 flex h-[7px] w-[7px] shrink-0 look-new:h-[11px] look-new:w-[11px]">
        <StatusDot status={status} pulse className={cn(label && 'invisible')} />
        {label ? (
          <span
            data-playing
            title={label}
            className={cn('absolute -inset-[3.5px] flex items-center justify-center animate-fade-in', label === 'Playing aloud' ? 'text-accent' : 'text-muted')}
          >
            <Volume2 size={13} strokeWidth={2.25} aria-hidden />
          </span>
        ) : null}
      </span>
      <span className="sr-only">
        {label ? `${label}. ` : ''}
        {statusLabel}:{' '}
      </span>
    </>
  )
}

/** On a chapter's row, after its title: a faint speaker while one of its scenes is read aloud. */
export function ChapterPlayingMark({ chapterId }: { chapterId: ID }): React.JSX.Element | null {
  const sceneId = useReading(playingScene)
  const paused = useReading((s) => s.bar?.phase === 'paused')
  const here = useOutlineStore((s) => !!sceneId && !!s.outline?.scenes.some((x) => x.id === sceneId && x.chapterId === chapterId))
  if (!here) return null
  const label = playingLabel(paused)
  return (
    <span data-playing title={label} className="ml-1.5 flex shrink-0 text-accent/60 animate-fade-in">
      <Volume2 size={12} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  )
}
