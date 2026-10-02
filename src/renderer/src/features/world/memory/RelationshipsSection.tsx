import { Trash2 } from 'lucide-react'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { KIND_LABELS } from '@shared/fields'
import type { ChangeView, Entry, EntryKind, ID } from '@shared/types'
import { Field, IconButton, Input, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { announceDelete } from '@/lib/undoDelete'
import { createEntry } from '../entryActions'
import { filterEntries, kindNoun, normalizeName } from '../entryLogic'
import { KIND_ICONS } from '../kindIcons'
import {
  createKindsFor,
  mergeRelationEdit,
  relationEditOf,
  relationPlaceholder,
  saveRelationOverNewer,
  sourceNote,
  type RelationEdit,
  type RelationshipChange,
  type RelationView
} from '../memoryLogic'
import { AutoTextarea } from '../parts/AutoTextarea'
import { Combobox, type ComboOption } from '../parts/Combobox'
import { useAutosave } from '../parts/useAutosave'
import type { ScenePlace } from '../useSceneLabels'
import { QuietError } from './QuietError'
import { SourceLine } from './SourceLine'
import type { EntryData } from './useEntryData'

type Self = Pick<Entry, 'id' | 'kind' | 'name'>

/** At most this many entries are offered at once; typing narrows the rest down. */
const MAX_SHOWN = 50
const nameOf = (e: Pick<Entry, 'name'> | undefined): string => e?.name.trim() || 'Unnamed'

/** "Relationships" for people and groups; "Connections" for everything else. */
export const relationshipsTitle = (kind: EntryKind): string => (kind === 'character' || kind === 'group' ? 'Relationships' : 'Connections')

/**
 * How the entry stands with other entries at the start of the story (baseline relationships):
 * a character's family, rivals and groups, an item's holder, an event's people. A relationship
 * written on the other entry shows here too, read from this entry's side. Later changes are
 * listed under "Changes over time".
 */
export function RelationshipsSection({
  self,
  rows,
  data,
  entries,
  places,
  onOpen
}: {
  self: Self
  rows: RelationView[]
  data: EntryData<ChangeView[]>
  /** Every other entry in the world. */
  entries: Entry[]
  places: Map<ID, ScenePlace> | null
  onOpen: (e: Pick<Entry, 'id' | 'kind'>) => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<ID | null>(null)
  // Entries made from the picker a moment ago, until the world's list has them.
  const [made, setMade] = useState<Map<ID, Entry>>(() => new Map())
  const byId = useMemo(() => {
    const m = new Map(made)
    for (const e of entries) m.set(e.id, e)
    return m
  }, [entries, made])

  const shown = rows.filter((r) => byId.has(r.otherId))
  const title = relationshipsTitle(self.kind)
  const selfName = nameOf(self)

  const { options, more } = useMemo(() => {
    const taken = new Set(rows.map((r) => r.otherId))
    const all = filterEntries(
      entries.filter((e) => e.id !== self.id && !taken.has(e.id)),
      query
    )
    const list: ComboOption[] = all.slice(0, MAX_SHOWN).map((e) => {
      const Icon = KIND_ICONS[e.kind]
      return {
        key: e.id,
        label: nameOf(e),
        sub: [KIND_LABELS[e.kind].one, e.summary.trim()].filter(Boolean).join(' · '),
        icon: <Icon size={13} />
      }
    })
    const name = query.trim()
    const n = normalizeName(name)
    const exists = name && entries.some((e) => normalizeName(e.name) === n || e.aliases.some((a) => normalizeName(a) === n))
    if (name && !exists) {
      for (const k of createKindsFor(self.kind))
        list.push({ key: `new:${k}`, label: `Add "${name}" as a new ${kindNoun(k)}`, create: true })
    }
    return { options: list, more: Math.max(0, all.length - MAX_SHOWN) }
  }, [entries, rows, self.id, self.kind, query])

  const pick = async (o: ComboOption): Promise<void> => {
    setAddError(null)
    let other: Entry | undefined
    if (o.create) {
      const kind = o.key.slice(4) as EntryKind
      try {
        other = await createEntry(kind, query, { fresh: false })
        const e = other
        setMade((m) => new Map(m).set(e.id, e))
      } catch (err) {
        setAddError(`Couldn't add ${query.trim()}. ${(err as Error).message}`)
        throw err
      }
    } else {
      other = byId.get(o.key)
    }
    if (!other) return
    try {
      const c = await api.createChange({
        entryId: self.id,
        anchor: 'baseline',
        kind: 'relationship',
        payload: { otherId: other.id, type: '', feels: '', otherFeels: '' }
      })
      data.update((list) => [...list, c])
      setFocusId(c.id)
    } catch (err) {
      setAddError(
        `Couldn't add the ${title === 'Relationships' ? 'relationship' : 'connection'} with ${nameOf(other)}. ${(err as Error).message}`
      )
      throw err
    }
  }

  const { update } = data
  const removed = useCallback((v: RelationView): void => update((list) => list.filter((c) => c.id !== v.change.id)), [update])
  const focused = useCallback(() => setFocusId(null), [])

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12.5px] leading-relaxed text-muted">
        How things stand at the start of the story. Later changes are listed under Changes over time.
      </p>
      {data.error && !data.data ? (
        <QuietError what={title.toLowerCase()} message={data.error} onRetry={data.reload} />
      ) : (
        <>
          {shown.map((v) => (
            <RelationshipRow
              key={v.change.id}
              view={v}
              self={self}
              other={byId.get(v.otherId)!}
              places={places}
              focus={focusId === v.change.id}
              onFocused={focused}
              onRemoved={removed}
              onOpen={onOpen}
            />
          ))}
          {data.data ? (
            <div>
              <Field label={`Add ${title === 'Relationships' ? 'a relationship' : 'a connection'} for ${selfName}`}>
                {(id) => (
                  <Combobox
                    id={id}
                    listLabel="Entries"
                    query={query}
                    onQuery={(q) => {
                      setQuery(q)
                      setAddError(null)
                    }}
                    options={options}
                    more={more}
                    onPick={pick}
                    refocus={false}
                    placeholder="Type a name…"
                  />
                )}
              </Field>
              {addError ? (
                <p role="alert" className="mt-1.5 text-[12px] text-danger">
                  {addError}
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

type Edit = RelationEdit

const sameEdit = (a: Edit, b: Edit): boolean => a.type === b.type && a.selfFeels === b.selfFeels && a.otherFeels === b.otherFeels

/** One relationship, edited in place and saved as Adam types. */
const RelationshipRow = memo(function RelationshipRow({
  view,
  self,
  other,
  places,
  focus,
  onFocused,
  onRemoved,
  onOpen
}: {
  view: RelationView
  self: Self
  other: Entry
  places: Map<ID, ScenePlace> | null
  focus: boolean
  onFocused: () => void
  onRemoved: (v: RelationView) => void
  onOpen: (e: Pick<Entry, 'id' | 'kind'>) => void
}): React.JSX.Element {
  const [edit, setEdit] = useState<Edit>(() => relationEditOf(view, view.change))
  const viewRef = useRef(view)
  viewRef.current = view
  // The newest saved state this row knows of, the relationship as it was then (what Adam's typing
  // started from), and whether he has typed since it was saved.
  const known = useRef(view.change.updatedAt)
  const base = useRef<Edit>(relationEditOf(view, view.change))
  const pending = useRef<Edit | null>(null)
  const editRef = useRef(edit)
  editRef.current = edit
  const typeRef = useRef<HTMLInputElement>(null)

  const selfName = nameOf(self)
  const otherName = nameOf(other)
  const scheduleRef = useRef<(e: Edit) => void>(() => {})
  const autosave = useAutosave<Edit>(
    async (e) => {
      // The memory may have changed the relationship since (how the other one feels, say): only the boxes
      // Adam changed are written over it.
      const { saved, now } = await saveRelationOverNewer(viewRef.current, e, base.current, {
        get: async (c) =>
          (await api.listChanges(c.entryId)).find((x): x is RelationshipChange => x.id === c.id && x.kind === 'relationship') ?? null,
        put: (id, input) => api.updateChange(id, input)
      })
      base.current = now
      if (saved.updatedAt > known.current) known.current = saved.updatedAt
      if (pending.current === e) pending.current = null
      // What the memory changed shows, in every box Adam hasn't typed in since this save began.
      const shown = mergeRelationEdit(e, editRef.current, now)
      if (sameEdit(shown, editRef.current)) return
      editRef.current = shown
      setEdit(shown)
      if (pending.current) {
        pending.current = shown
        scheduleRef.current(shown)
      }
    },
    { what: `the relationship with ${otherName}` }
  )
  scheduleRef.current = autosave.schedule

  // A newer copy loaded from elsewhere (the memory keeper, another page) shows when nothing is waiting to be saved.
  useEffect(() => {
    if (pending.current || view.change.updatedAt <= known.current) return
    known.current = view.change.updatedAt
    base.current = relationEditOf(view, view.change)
    setEdit(base.current)
  }, [view])

  // Just added from the picker: straight into its type, ready to type "sister" or "rival".
  useLayoutEffect(() => {
    if (!focus) return
    typeRef.current?.focus()
    onFocused()
  }, [focus, onFocused])

  const change = (patch: Partial<Edit>): void => {
    const next = { ...editRef.current, ...patch }
    editRef.current = next
    pending.current = next
    setEdit(next)
    autosave.schedule(next)
  }

  const removing = useRef(false)
  const remove = async (): Promise<void> => {
    if (removing.current) return
    removing.current = true
    await autosave.flush()
    autosave.cancel()
    const id = view.change.id
    try {
      await api.deleteChange(id)
    } catch (err) {
      removing.current = false
      toast(`Couldn't remove the relationship with ${otherName}. ${(err as Error).message}`, { tone: 'danger' })
      return
    }
    onRemoved(view)
    announceDelete({
      message: `Removed the relationship between ${selfName} and ${otherName}.`,
      noun: ['relationship', 'relationships'],
      undo: () =>
        api
          .restoreChange(id)
          .then(() => useApp.getState().bumpEntries())
          .catch((err: Error) => void toast(`Couldn't bring back the relationship with ${otherName}. ${err.message}`, { tone: 'danger' }))
    })
  }

  const from = view.mine ? selfName : otherName
  const to = view.mine ? otherName : selfName
  const Icon = KIND_ICONS[other.kind]
  const note = view.change.origin === 'adam' ? null : sourceNote(view.change.origin, view.change.links)

  return (
    <div className="rounded-lg border border-line bg-surface px-3 pb-3 pt-2" onBlur={() => void autosave.flush()}>
      <div className="flex h-8 items-center gap-2.5">
        <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-3 text-muted">
          <Icon size={12} />
        </span>
        <button
          type="button"
          onClick={() => onOpen(other)}
          title={`Open ${otherName}`}
          className="min-w-0 truncate rounded-sm text-[13.5px] font-medium text-fg underline-offset-2 hover:text-accent hover:underline"
        >
          {otherName}
        </button>
        <span className="shrink-0 text-[12px] text-faint">{KIND_LABELS[other.kind].one}</span>
        <div className="flex-1" />
        <IconButton label={`Remove the relationship with ${otherName}`} size="sm" onClick={() => void remove()}>
          <Trash2 size={13} />
        </IconButton>
      </div>
      <div className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-3 @lg:grid-cols-2">
        <Field label={`How ${from} is linked to ${to}`} className="@lg:col-span-2">
          {(id) => (
            <Input
              ref={typeRef}
              id={id}
              value={edit.type}
              placeholder={relationPlaceholder(view.mine ? self.kind : other.kind, view.mine ? other.kind : self.kind)}
              onChange={(e) => change({ type: e.target.value })}
            />
          )}
        </Field>
        {self.kind === 'character' ? (
          // Full width when it's the only one (a character and a group, say), rather than half a row with a gap beside it.
          <Field label={`How ${selfName} feels about ${otherName}`} className={other.kind === 'character' ? undefined : '@lg:col-span-2'}>
            {(id) => (
              <AutoTextarea
                id={id}
                value={edit.selfFeels}
                minRows={1}
                maxRows={8}
                onChange={(e) => change({ selfFeels: e.target.value })}
              />
            )}
          </Field>
        ) : null}
        {other.kind === 'character' ? (
          <Field label={`How ${otherName} feels about ${selfName}`} className={self.kind === 'character' ? undefined : '@lg:col-span-2'}>
            {(id) => (
              <AutoTextarea
                id={id}
                value={edit.otherFeels}
                minRows={1}
                maxRows={8}
                onChange={(e) => change({ otherFeels: e.target.value })}
              />
            )}
          </Field>
        ) : null}
      </div>
      {note ? (
        <p className="mt-2">
          <SourceLine note={note} places={places} />
        </p>
      ) : null}
      {autosave.status === 'error' ? (
        <p role="status" className="mt-2 text-[12px] text-danger" title={autosave.error ?? undefined}>
          Not saved yet. It will try again when you click away.
        </p>
      ) : null}
    </div>
  )
})
