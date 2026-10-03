import { Check, PenLine, Sparkles } from '@/components/ui/icons'
import type { ID } from '@shared/types'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import type { SourceNote } from '../memoryLogic'
import type { ScenePlace } from '../useSceneLabels'

/** Opens a scene in the writing view. */
export const openScene = (sceneId: ID, storyId?: ID | null): void => useApp.getState().selectScene(sceneId, storyId ?? undefined)

/** A scene's place as a quiet link that opens it ("Book 1, Ch 12, Sc 3"). Nothing while it isn't known. */
export function PlaceLink({
  sceneId,
  place,
  label,
  storyId,
  className
}: {
  sceneId: ID
  place?: ScenePlace
  /** Overrides the place's label (a change's own "where"). */
  label?: string
  /** The scene's story, when known without the place. */
  storyId?: ID | null
  className?: string
}): React.JSX.Element | null {
  const text = label ?? place?.label
  if (!text) return null
  return (
    <button
      type="button"
      title="Open this scene"
      onClick={() => openScene(sceneId, storyId ?? place?.storyId)}
      className={cn(
        'rounded-sm font-medium text-muted underline-offset-2 transition-colors duration-150 hover:text-accent hover:underline',
        className
      )}
    >
      {text}
    </button>
  )
}

/**
 * A source note, or: its words are still loading (the line is kept free), it was read from the story
 * but has no words to show, or Adam has changed it since the page opened (the line stays, saying so).
 */
export type LineNote = SourceNote | { kind: 'loading' } | { kind: 'story' } | { kind: 'edited' }

/**
 * Where a fact came from, quietly, inline (it sits inside a field's hint): the words it was read from
 * and their scene, "Those words were removed", "Drafted by AI", or for Adam's own, "You wrote this"
 * when `showAdam`. Renders nothing when there is nothing to say.
 */
export function SourceLine({
  note,
  places,
  showAdam = false,
  className
}: {
  note: LineNote | null
  places: Map<ID, ScenePlace> | null
  showAdam?: boolean
  className?: string
}): React.JSX.Element | null {
  if (!note || (note.kind === 'adam' && !showAdam)) return null
  const base = cn('inline-flex min-h-[18px] min-w-0 max-w-full items-baseline gap-1.5 text-[12px] text-faint', className)
  if (note.kind === 'loading') return <span className={base} aria-hidden />
  if (note.kind === 'story') return <span className={base}>Read from your story</span>
  if (note.kind === 'adam') {
    return (
      <span className={base}>
        <PenLine size={11} className="shrink-0 self-center" aria-hidden />
        You wrote this
      </span>
    )
  }
  if (note.kind === 'edited') {
    return (
      <span className={base}>
        <Check size={11} className="shrink-0 self-center" aria-hidden />
        Changed by you
      </span>
    )
  }
  if (note.kind === 'ai') {
    return (
      <span className={base}>
        <Sparkles size={11} className="shrink-0 self-center text-ai" aria-hidden />
        Drafted by AI
      </span>
    )
  }
  if (note.kind === 'gone') {
    const place = note.sceneId ? places?.get(note.sceneId) : undefined
    return (
      <span className={base}>
        <span>Those words were removed{place ? ' from' : ''}</span>
        {place && note.sceneId ? <PlaceLink sceneId={note.sceneId} place={place} /> : null}
      </span>
    )
  }
  const place = places?.get(note.sceneId)
  return (
    <span className={base}>
      <span className="min-w-0 truncate font-serif italic text-muted" title={note.quote}>
        “{note.quote}”
      </span>
      {place ? (
        <>
          <span aria-hidden>·</span>
          <PlaceLink sceneId={note.sceneId} place={place} className="shrink-0" />
        </>
      ) : null}
      {note.changed ? <span className="shrink-0">(since edited)</span> : null}
      {note.more ? <span className="shrink-0">and {note.more} more</span> : null}
    </span>
  )
}
