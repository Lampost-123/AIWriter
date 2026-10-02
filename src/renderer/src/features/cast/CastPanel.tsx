// The Cast tab beside a scene: who is in it, for quick reference while writing. The point of view
// first, then the others the scene card says are present, where it happens, then (quieter) anyone
// else the text names; each with its one-liner, how it stands as of this scene and, for a character,
// how they speak. Clicking one shows it in this panel, and the scene stays as it is.
import { Users } from 'lucide-react'
import { useMemo } from 'react'
import type { ID } from '@shared/types'
import type { NamedEntry } from '@shared/contracts/manuscript'
import { Button, EmptyState, Notice } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { Portrait } from '@/features/views/Portrait'
import { useNamesStore, useSceneNames } from '@/features/editor/names/sceneNames'
import { displayName, kindWord } from '@/features/peek/entryView'
import { ListLoading, StateList, VoiceList } from '@/features/peek/parts'
import { cardHasNoCast, castGroups, type CastGroup } from './castLogic'

const NO_IDS: ID[] = []

export function CastPanel({ sceneId }: { sceneId: ID }): React.JSX.Element {
  const { data, error, retry } = useSceneNames(sceneId)
  const named = useNamesStore((s) => (s.named.sceneId === sceneId ? s.named.ids : NO_IDS))
  const groups = useMemo(() => (data ? castGroups(data, named) : []), [data, named])
  const setTab = useApp((s) => s.setInspectorTab)

  if (!data) {
    if (error) {
      return (
        <div className="p-4">
          <Notice
            tone="danger"
            action={
              <Button size="sm" onClick={retry}>
                Try again
              </Button>
            }
          >
            Couldn’t read who is in this scene. {error}
          </Notice>
        </div>
      )
    }
    return <ListLoading />
  }

  const toCard = (
    <Button size="sm" onClick={() => setTab('card')}>
      Open the scene card
    </Button>
  )

  if (!groups.length) {
    return (
      <EmptyState icon={<Users size={20} />} title="No one in this scene yet" actions={toCard}>
        The cast comes from the scene card: its point of view, the characters present and where it happens. Anyone the text names
        shows here too.
      </EmptyState>
    )
  }

  return (
    <div className="flex flex-col gap-5 px-4 pb-6 pt-4">
      {cardHasNoCast(data.cast) ? (
        <Notice action={toCard}>Choose the point of view and who is present on the scene card to list them first.</Notice>
      ) : null}
      {groups.map((g) => (
        <CastSection key={g.key} group={g} />
      ))}
    </div>
  )
}

function CastSection({ group }: { group: CastGroup }): React.JSX.Element {
  const quiet = group.key === 'named'
  return (
    <section aria-label={group.title}>
      <h3 className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">{group.title}</h3>
      <ul className={cn('flex flex-col', quiet ? 'gap-0.5' : 'gap-1')}>
        {group.entries.map((e) => (
          <li key={e.id}>
            <CastCard entry={e} quiet={quiet} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/** One of the cast. The whole card is a button that shows the entry in this panel; those only named in the text are quieter. */
function CastCard({ entry, quiet }: { entry: NamedEntry; quiet: boolean }): React.JSX.Element {
  const peekEntry = useApp((s) => s.peekEntry)
  const name = displayName(entry)
  return (
    <button
      type="button"
      aria-label={name}
      onClick={() => peekEntry(entry.id)}
      className="-mx-2 flex w-[calc(100%+1rem)] gap-3 rounded-lg px-2 py-2 text-left transition-colors duration-150 hover:bg-surface-2"
    >
      <Portrait entry={entry} size={quiet ? 28 : 36} className={quiet ? 'mt-px' : undefined} />
      <span className="block min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={cn('truncate font-semibold', quiet ? 'text-[13px] text-muted' : 'text-[13.5px] text-fg')}>{name}</span>
          {entry.kind !== 'character' ? <span className="shrink-0 text-[11.5px] text-faint">{kindWord(entry.kind)}</span> : null}
        </span>
        {entry.summary ? (
          <span className={cn('mt-0.5 block text-[12.5px] leading-[18px]', quiet ? 'line-clamp-1 text-faint' : 'line-clamp-2 text-muted')}>
            {entry.summary}
          </span>
        ) : null}
        <StateList entry={entry} quiet={quiet} className={quiet ? 'mt-1' : 'mt-1.5'} />
        <VoiceList voice={entry.voice} samples={quiet ? 0 : 2} className="mt-2" />
      </span>
    </button>
  )
}
