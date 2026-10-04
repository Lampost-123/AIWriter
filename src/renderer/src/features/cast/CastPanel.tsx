// The Cast tab beside a scene: who is in it, for quick reference while writing. The point of view
// first, then the others the scene card says are present, where it happens, then (quieter) anyone
// else the text names; each with its one-liner, how it stands as of this scene and, for a character,
// how they speak. Clicking one shows it in this panel, and the scene stays as it is.
import { Users } from '@/components/ui/icons'
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
import { RecallSection } from './RecallSection'

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
        // The button under the words, so the words keep the panel's width.
        <Notice>
          Set the point of view and who is present on the scene card to list them first.
          <div className="mt-2">{toCard}</div>
        </Notice>
      ) : null}
      {groups.map((g) => (
        <CastSection key={g.key} group={g} />
      ))}
      <RecallSection sceneId={sceneId} />
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

/**
 * One of the cast; those only named in the text are quieter. Its name is the button that shows the
 * entry in this panel, stretched over the whole card so a click anywhere on it does; the one-liner,
 * state and voice notes stay ordinary text after it, so a screen reader reads them too.
 */
function CastCard({ entry, quiet }: { entry: NamedEntry; quiet: boolean }): React.JSX.Element {
  const peekEntry = useApp((s) => s.peekEntry)
  const name = displayName(entry)
  return (
    <div
      className={cn(
        'relative -mx-2 flex gap-3 rounded-lg px-2 py-2 transition-colors duration-150 hover:bg-surface-2',
        'has-[:focus-visible]:bg-surface-2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/40'
      )}
    >
      <Portrait entry={entry} size={quiet ? 28 : 36} className={quiet ? 'mt-px' : undefined} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <button
            type="button"
            onClick={() => peekEntry(entry.id)}
            className={cn(
              'min-w-0 truncate text-left font-semibold outline-none after:absolute after:inset-0 after:rounded-lg',
              quiet ? 'text-[13px] text-muted' : 'text-[13.5px] text-fg'
            )}
          >
            {name}
          </button>
          {entry.kind !== 'character' ? <span className="shrink-0 text-[11.5px] text-faint">{kindWord(entry.kind)}</span> : null}
        </div>
        {entry.summary ? (
          <p className={cn('mt-0.5 text-[12.5px] leading-[18px]', quiet ? 'line-clamp-1 text-faint' : 'line-clamp-2 text-muted')}>
            {entry.summary}
          </p>
        ) : null}
        <StateList entry={entry} quiet={quiet} className={quiet ? 'mt-1' : 'mt-1.5'} />
        <VoiceList voice={entry.voice} samples={quiet ? 0 : 2} className="mt-2" />
      </div>
    </div>
  )
}
