import { Check, Sparkles } from 'lucide-react'
import type { Entry, ID } from '@shared/types'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { MADE_YOURS, existsLine, madeByNote } from '../memoryLogic'
import { useSceneLabels } from '../useSceneLabels'
import { PlaceLink } from './SourceLine'
import { useEntryData } from './useEntryData'

/**
 * Where the entry first exists, as one quiet line beside its kind: "In the world from the start",
 * "First appears in Book 1, Ch 3, Sc 2". Shows nothing until it is known (or if it can't be loaded).
 */
export function ExistsLine({ entryId, className }: { entryId: ID; className?: string }): React.JSX.Element | null {
  const points = useEntryData(() => api.listExistsPoints(entryId), entryId)
  const places = useSceneLabels(points.data?.some((p) => p.kind === 'scene') ?? false)
  const stories = useApp((s) => s.stories)
  if (!points.data) return null
  const text = existsLine(points.data, {
    story: (id) => {
      const s = stories.find((x) => x.id === id)
      return s ? s.title.trim() || 'Untitled story' : undefined
    },
    scene: (id) => places?.get(id)?.label
  })
  if (!text) return null
  return (
    <span className={cn('flex min-w-0 animate-fade-in items-center gap-1.5 text-[12px] text-faint', className)} title={text}>
      {/* Beside the kind on a wide page; on a narrow one it has its own line, without the dot. */}
      <span aria-hidden className="@max-[34rem]:hidden">
        ·
      </span>
      <span className="min-w-0 truncate">{text}</span>
    </span>
  )
}

/**
 * The quiet note on an entry AI Write made itself: "Added by AI Write from Book 1, Ch 2, Sc 1. Edit
 * anything and it's yours." Once Adam edits it, it says so. Its line is kept for as long as the page
 * is open, so the form never jumps; `shown` decides (when the page opens) whether it has one at all.
 */
export function MadeByNote({
  entry,
  shown
}: {
  entry: Pick<Entry, 'origin' | 'byHand' | 'originSceneId'>
  shown: boolean
}): React.JSX.Element | null {
  const places = useSceneLabels(shown && !!entry.originSceneId)
  if (!shown) return null
  const place = entry.originSceneId ? places?.get(entry.originSceneId) : undefined
  // Wait for the scene's place before saying anything, so the sentence doesn't change as it loads.
  const waiting = !!entry.originSceneId && places === null
  // What it says until Adam edits; it says MADE_YOURS from then on.
  const made = madeByNote({ origin: entry.origin, byHand: false }, place?.label ?? null)
  const yours = !madeByNote(entry, null)
  // Both sentences sit in the same place, the one not showing kept invisible, so the note is as tall
  // as the taller of the two from the start and the page doesn't move up when Adam's first edit
  // shortens it (on a narrow page the first takes two lines).
  const layer = 'col-start-1 row-start-1 flex min-w-0 items-start gap-1.5 leading-[18px] transition-opacity duration-200'
  return (
    <div className="grid min-h-6 items-center text-[12.5px] text-muted" role="note">
      {waiting ? null : (
        <>
          <span className={cn(layer, 'animate-fade-in', yours && 'opacity-0')} aria-hidden={yours} inert={yours}>
            <Sparkles size={12} className="mt-[3px] shrink-0 text-ai" aria-hidden />
            <span className="min-w-0">
              {place && entry.origin === 'text' && entry.originSceneId ? (
                <>
                  Added by AI Write from <PlaceLink sceneId={entry.originSceneId} place={place} />. Edit anything and it's yours.
                </>
              ) : (
                made
              )}
            </span>
          </span>
          <span className={cn(layer, 'text-faint', !yours && 'opacity-0')} aria-hidden={!yours}>
            <Check size={12} className="mt-[3px] shrink-0" aria-hidden />
            <span className="min-w-0">{MADE_YOURS}</span>
          </span>
        </>
      )}
    </div>
  )
}
