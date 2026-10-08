import { Sparkles, X } from '@/components/ui/icons'
import { memo } from 'react'
import type { ChangeView, EntryKind, ID } from '@shared/types'
import { IconButton, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { announceDelete } from '@/lib/undoDelete'
import { changeWhere, shortQuote, sourceNote, type ChangeWords } from '../memoryLogic'
import type { ScenePlace } from '../useSceneLabels'
import { QuietError } from './QuietError'
import { EditedSince, PlaceLink } from './SourceLine'
import { showWords } from '@/features/memory/openScene'
import type { EntryData } from './useEntryData'

export interface ChangeItem {
  change: ChangeView
  words: ChangeWords
  /** True when the change belongs to this entry (false: another entry's, pointing here). */
  mine: boolean
}

/** "they are" for people and groups, "it is" for everything else. */
const howTheyAre = (kind: EntryKind): string => (kind === 'character' || kind === 'group' ? 'how they are' : 'how it is')

/**
 * How the entry changes as the story goes on: each change with where it happens (a link to the
 * scene), what changed in plain words, and where it came from (the words in the scene, "Drafted by
 * AI" or "Added by you"). Read-only; each can be removed, with Undo.
 */
export function ChangesSection({
  name,
  kind,
  items,
  data,
  places
}: {
  name: string
  kind: EntryKind
  items: ChangeItem[]
  data: EntryData<ChangeView[]>
  places: Map<ID, ScenePlace> | null
}): React.JSX.Element {
  if (data.error && !data.data) return <QuietError what="how it has changed" message={data.error} onRetry={data.reload} />
  if (!data.data) return <div className="h-5" aria-hidden />
  if (!items.length) {
    return (
      <p className="text-[13px] leading-relaxed text-muted">
        As the story goes on, what happens to {name.trim() || 'it'} is listed here, so the AI always knows {howTheyAre(kind)} at each point.
      </p>
    )
  }
  const removed = (id: ID): void => data.update((list) => list.filter((c) => c.id !== id))
  return (
    <ol className="flex flex-col">
      {items.map((it) => (
        <ChangeRow key={it.change.id} item={it} places={places} onRemoved={removed} />
      ))}
    </ol>
  )
}

const ChangeRow = memo(function ChangeRow({
  item,
  places,
  onRemoved
}: {
  item: ChangeItem
  places: Map<ID, ScenePlace> | null
  onRemoved: (id: ID) => void
}): React.JSX.Element {
  const { change: c, words } = item
  const where = changeWhere(c)
  const note = sourceNote(c.origin, c.links)
  // Another entry's fresh description sets this relationship: removing it would remove all of that, so it isn't offered here.
  const removable = !(c.kind === 'full' && !item.mine)

  const remove = async (): Promise<void> => {
    try {
      await api.deleteChange(c.id)
    } catch (err) {
      toast(`Couldn't remove ${shortQuote(words.text)}. ${(err as Error).message}`, { tone: 'danger' })
      return
    }
    onRemoved(c.id)
    announceDelete({
      message: `Removed ${shortQuote(words.text)}.`,
      noun: ['change', 'changes'],
      undo: () =>
        api
          .restoreChange(c.id)
          .then(() => useApp.getState().bumpEntries())
          .catch((err: Error) => void toast(`Couldn't bring back ${shortQuote(words.text)}. ${err.message}`, { tone: 'danger' }))
    })
  }

  return (
    <li className="group border-t border-line py-2.5 first:border-t-0 first:pt-0.5">
      <div className="flex h-6 items-center gap-1.5 text-[12px] text-faint">
        {c.anchor === 'scene' && c.sceneId ? (
          <PlaceLink
            sceneId={c.sceneId}
            place={places?.get(c.sceneId)}
            storyId={c.storyId}
            label={where}
            words={note?.kind === 'words' && note.sceneId === c.sceneId ? { quote: note.quote, paragraphId: note.paragraphId } : null}
            className="text-[12px]"
          />
        ) : (
          <span className="font-medium text-muted">{where}</span>
        )}
        {note?.kind === 'ai' ? (
          <>
            <span aria-hidden>·</span>
            <Sparkles size={11} className="text-ai" aria-hidden />
            <span>Drafted by AI</span>
          </>
        ) : note?.kind === 'adam' ? (
          <>
            <span aria-hidden>·</span>
            <span>Added by you</span>
          </>
        ) : null}
        <div className="flex-1" />
        {removable ? (
          <IconButton
            label={`Remove ${shortQuote(words.text)}`}
            size="sm"
            className="opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
            onClick={() => void remove()}
          >
            <X size={13} />
          </IconButton>
        ) : null}
      </div>
      <p className="text-[13.5px] leading-snug text-fg">{words.text}</p>
      {words.detail ? <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{words.detail}</p> : null}
      {note?.kind === 'words' ? (
        <blockquote className="mt-1.5 border-l-2 border-line-strong pl-3 font-serif text-[13.5px] italic leading-relaxed text-muted">
          <button
            type="button"
            title="Show these words in the scene"
            onClick={() => showWords(note.sceneId, note.quote, note.paragraphId)}
            className="rounded-sm text-left italic underline-offset-2 transition-colors duration-150 hover:text-accent hover:underline"
          >
            “{note.quote}”
          </button>
          {note.changed ? (
            <EditedSince sceneId={note.sceneId} words={{ quote: note.quote, paragraphId: note.paragraphId }} className="ml-1.5 text-[12px] text-faint" />
          ) : null}
          {note.more ? <span className="ml-1.5 font-sans text-[12px] not-italic text-faint">and {note.more} more</span> : null}
        </blockquote>
      ) : note?.kind === 'gone' ? (
        <p className="mt-1 text-[12px] text-faint">Those words were removed.</p>
      ) : null}
    </li>
  )
})
