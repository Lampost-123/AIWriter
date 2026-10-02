import { memo, useCallback, useMemo } from 'react'
import { FIELD_GROUPS } from '@shared/fields'
import type { Entry, ID } from '@shared/types'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { describeChange, splitChanges } from '../memoryLogic'
import { Section } from '../parts/Section'
import { useSceneLabels } from '../useSceneLabels'
import { AppearsSection } from './AppearsSection'
import { ChangesSection, type ChangeItem } from './ChangesSection'
import { HistorySection } from './HistorySection'
import { KnowledgeSection } from './KnowledgeSection'
import { RelationshipsSection, relationshipsTitle } from './RelationshipsSection'
import { useEntryData } from './useEntryData'

/** Labels for the fields a change can set, for "Hair: cropped short". */
function fieldLabels(kind: Entry['kind']): (key: string) => string {
  const labels = new Map<string, string>([
    ['description', 'Description'],
    ['summary', 'Short summary'],
    ['name', 'Name']
  ])
  for (const g of FIELD_GROUPS[kind] ?? []) for (const f of g.fields) labels.set(f.key, f.label)
  return (key) => labels.get(key) ?? key
}

/**
 * The memory parts of an entry page, as sections under its fields: relationships (or connections)
 * at the start, what a character knows at the start, how it changes over time, the scenes it
 * appears in, and earlier versions.
 * Each loads on its own and says so quietly when it can't, so the rest of the page always works.
 */
export const EntryMemorySections = memo(function EntryMemorySections({
  now,
  names,
  ready,
  others,
  open,
  onToggle,
  onOpen,
  beforeRestore
}: {
  /** The entry as it is on the page now. */
  now: Entry
  /** The names it goes by, as last saved (any string that changes when they do). */
  names: string
  /** False until where it first exists has loaded: that line at the top of the page is asked for first. */
  ready: boolean
  /** Every other entry in the world. */
  others: Entry[]
  open: Set<string>
  onToggle: (id: string) => void
  onOpen: (e: Pick<Entry, 'id' | 'kind'>) => void
  beforeRestore: () => Promise<void>
}): React.JSX.Element {
  const { id, kind } = now
  const name = now.name.trim() || 'Unnamed'
  const data = useEntryData(() => api.listChanges(id), `changes:${id}`)
  const places = useSceneLabels(!!data.data?.some((c) => c.links.length > 0 || c.anchor === 'scene'))
  // Where it appears changes with the memory (a scene read again, a change pinned to a scene), with the
  // scenes themselves (moved, deleted) and with the names it goes by: not with every save of its profile.
  const memoryRev = useApp((s) => s.memoryRev)
  const outlineRev = useApp((s) => s.outlineRev)
  const appears = useEntryData(() => api.listAppearances(id), `appears:${id}`, ready, `${memoryRev}|${outlineRev}|${names}`)

  const byId = useMemo(() => new Map(others.map((e) => [e.id, e])), [others])
  const nameOf = useCallback(
    (x: ID): string | null => (x === id ? name : byId.get(x)?.name.trim() || (byId.has(x) ? 'Unnamed' : null)),
    [byId, id, name]
  )
  const split = useMemo(() => (data.data ? splitChanges(data.data, id) : null), [data.data, id])
  const items = useMemo((): ChangeItem[] => {
    if (!split) return []
    const label = fieldLabels(kind)
    const out: ChangeItem[] = []
    for (const change of split.history) {
      const words = describeChange(change, id, nameOf, label)
      if (words) out.push({ change, words, mine: change.entryId === id })
    }
    return out
  }, [split, id, kind, nameOf])

  const self = useMemo(() => ({ id, kind, name: now.name }), [id, kind, now.name])
  const relationships = split?.relationships ?? []
  const relCount = relationships.filter((r) => byId.has(r.otherId)).length
  const placeName = useCallback((x: ID) => byId.get(x)?.name.trim() || 'a place that was deleted', [byId])

  return (
    <>
      <Section
        title={relationshipsTitle(kind)}
        meta={relCount || null}
        open={open.has('relationships')}
        onToggle={() => onToggle('relationships')}
      >
        <RelationshipsSection self={self} rows={relationships} data={data} entries={others} places={places} onOpen={onOpen} />
      </Section>
      {kind === 'character' ? (
        <Section title="Knows at the start" meta={split?.knows.length || null} open={open.has('knows')} onToggle={() => onToggle('knows')}>
          <KnowledgeSection self={self} rows={split?.knows ?? []} data={data} places={places} />
        </Section>
      ) : null}
      <Section title="Changes over time" meta={items.length || null} open={open.has('changes')} onToggle={() => onToggle('changes')}>
        <ChangesSection name={name} kind={kind} items={items} data={data} places={places} />
      </Section>
      <Section title="Appears in" meta={appears.data?.length || null} open={open.has('appears')} onToggle={() => onToggle('appears')}>
        <AppearsSection name={name} kind={kind} data={appears} />
      </Section>
      <Section title="Earlier versions" open={open.has('history')} onToggle={() => onToggle('history')}>
        <HistorySection now={now} placeName={placeName} beforeRestore={beforeRestore} />
      </Section>
    </>
  )
})
