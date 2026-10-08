import { Fragment, memo, useCallback, useMemo, type ReactNode } from 'react'
import { FIELD_GROUPS } from '@shared/fields'
import type { Entry, ID } from '@shared/types'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { describeChange, splitChanges } from '../memoryLogic'
import { Section, sectionMeta } from '../parts/Section'
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

/** The memory's sections, by id (also the id kept for whether each is open). */
export type MemorySectionId = 'relationships' | 'knows' | 'changes' | 'appears' | 'history'
const MEMORY_SECTIONS: MemorySectionId[] = ['relationships', 'knows', 'changes', 'appears', 'history']

/** How a section is drawn around its contents: the entry page's collapsible Section by default. */
export type MemorySectionWrap = (part: { id: MemorySectionId; title: string; meta: ReactNode; children: ReactNode }) => ReactNode

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
  beforeRestore,
  only,
  order,
  wrap
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
  /** Only these sections; every one when not given. */
  only?: MemorySectionId[]
  /** The order they come in (the usual one when not given). */
  order?: MemorySectionId[]
  /** Draws each section (the desk's dossier has its own); the entry page's collapsible Section when not given. */
  wrap?: MemorySectionWrap
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
  // On an entry AI Write made, what Adam added to it says "You wrote this", as his fields there do.
  const adamsEntry = now.origin === 'adam'
  const relationships = split?.relationships ?? []
  const relCount = relationships.filter((r) => byId.has(r.otherId)).length
  const placeName = useCallback((x: ID) => byId.get(x)?.name.trim() || 'a place that was deleted', [byId])

  const shows = (part: MemorySectionId): boolean => !only || only.includes(part)
  const draw: MemorySectionWrap =
    wrap ??
    (({ id: part, title, meta, children }) => (
      <Section title={title} meta={meta} open={open.has(part)} onToggle={() => onToggle(part)}>
        {children}
      </Section>
    ))
  const parts: Record<MemorySectionId, ReactNode> = {
    relationships: shows('relationships')
      ? draw({
          id: 'relationships',
          title: relationshipsTitle(kind),
          meta: sectionMeta(relCount, 'relationship', 'relationships'),
          children: (
            <RelationshipsSection self={self} adamsEntry={adamsEntry} rows={relationships} data={data} entries={others} places={places} onOpen={onOpen} />
          )
        })
      : null,
    knows:
      kind === 'character' && shows('knows')
        ? draw({
            id: 'knows',
            title: 'Knows at the start',
            meta: sectionMeta(split?.knows.length ?? 0, 'fact', 'facts'),
            children: <KnowledgeSection self={self} adamsEntry={adamsEntry} rows={split?.knows ?? []} data={data} places={places} />
          })
        : null,
    changes: shows('changes')
      ? draw({
          id: 'changes',
          title: 'Changes over time',
          meta: sectionMeta(items.length, 'change', 'changes'),
          children: <ChangesSection name={name} kind={kind} items={items} data={data} places={places} />
        })
      : null,
    appears: shows('appears')
      ? draw({ id: 'appears', title: 'Appears in', meta: sectionMeta(appears.data?.length ?? 0, 'scene', 'scenes'), children: <AppearsSection name={name} kind={kind} data={appears} /> })
      : null,
    history: shows('history')
      ? draw({ id: 'history', title: 'Earlier versions', meta: null, children: <HistorySection now={now} placeName={placeName} beforeRestore={beforeRestore} /> })
      : null
  }
  return (
    <>
      {(order ?? MEMORY_SECTIONS).map((part) => (parts[part] ? <Fragment key={part}>{parts[part]}</Fragment> : null))}
    </>
  )
})
