// The Relationships step: who the character knows, picked from the world's existing characters, and
// what they are to each other. Each one is a starting-point relationship (how things stand when the
// story begins), saved as Adam types, the same as on the entry page; the rules for saving over newer
// words the memory may have written meanwhile are memoryLogic's.
import { Trash2, UserRound } from '@/components/ui/icons'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { KIND_LABELS } from '@shared/fields'
import type { ChangeView, Entry, ID } from '@shared/types'
import { Field, IconButton, Input, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { announceDelete } from '@/lib/undoDelete'
import { filterEntries } from '@/features/world/entryLogic'
import { KIND_ICONS } from '@/features/world/kindIcons'
import {
  mergeRelationEdit,
  relationEditOf,
  relationPlaceholder,
  saveRelationOverNewer,
  sourceNote,
  type RelationEdit,
  type RelationshipChange,
  type RelationView
} from '@/features/world/memoryLogic'
import { QuietError } from '@/features/world/memory/QuietError'
import { SourceLine } from '@/features/world/memory/SourceLine'
import type { EntryData } from '@/features/world/memory/useEntryData'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { Combobox, type ComboOption } from '@/features/world/parts/Combobox'
import { useAutosave } from '@/features/world/parts/useAutosave'
import type { ScenePlace } from '@/features/world/useSceneLabels'

type Self = Pick<Entry, 'id' | 'kind' | 'name'>

/** At most this many characters are offered at once; typing narrows the rest down. */
const MAX_SHOWN = 50
const nameOf = (e: Pick<Entry, 'name'> | undefined): string => e?.name.trim() || 'Unnamed'

export function Relationships({
  self,
  rows,
  data,
  entries,
  places
}: {
  self: Self
  /** Every starting-point relationship the character has, whoever it is with. */
  rows: RelationView[]
  data: EntryData<ChangeView[]>
  /** Every entry in the world, or null while loading. */
  entries: Entry[] | null
  places: Map<ID, ScenePlace> | null
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<ID | null>(null)
  const byId = useMemo(() => new Map((entries ?? []).map((e) => [e.id, e])), [entries])
  const shown = rows.filter((r) => byId.has(r.otherId))
  const selfName = nameOf(self)

  // Only characters who are already in the world: this step doesn't make new ones.
  const others = useMemo(() => (entries ?? []).filter((e) => e.kind === 'character' && e.id !== self.id), [entries, self.id])
  const { options, more } = useMemo(() => {
    const taken = new Set(rows.map((r) => r.otherId))
    const all = filterEntries(
      others.filter((e) => !taken.has(e.id)),
      query
    )
    const list: ComboOption[] = all.slice(0, MAX_SHOWN).map((e) => ({
      key: e.id,
      label: nameOf(e),
      sub: e.summary.trim() || undefined,
      icon: <UserRound size={13} />
    }))
    return { options: list, more: Math.max(0, all.length - MAX_SHOWN) }
  }, [others, rows, query])

  const pick = async (o: ComboOption): Promise<void> => {
    setAddError(null)
    const other = byId.get(o.key)
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
      setAddError(`Couldn’t add ${nameOf(other)}. ${(err as Error).message}`)
      throw err
    }
  }

  const { update } = data
  const removed = useCallback((v: RelationView): void => update((list) => list.filter((c) => c.id !== v.change.id)), [update])
  const focused = useCallback(() => setFocusId(null), [])
  const open = useCallback(
    (e: Pick<Entry, 'id' | 'kind'>) => useApp.getState().navigate({ kind: 'entries', entryKind: e.kind, entryId: e.id }),
    []
  )

  if (data.error && !data.data) return <QuietError what="relationships" message={data.error} onRetry={data.reload} />
  // Loading takes a few milliseconds: nothing rather than a flash of an empty step.
  if (!data.data || !entries) return <div className="min-h-[60px]" />

  const nobody = query.trim() && !options.length
  return (
    <div className="flex flex-col gap-3">
      {shown.map((v) => (
        <RelationRow
          key={v.change.id}
          view={v}
          self={self}
          other={byId.get(v.otherId)!}
          places={places}
          focus={focusId === v.change.id}
          onFocused={focused}
          onRemoved={removed}
          onOpen={open}
        />
      ))}
      {others.length ? (
        <div>
          <Field label={`Add someone ${selfName} knows`}>
            {(id) => (
              <Combobox
                id={id}
                listLabel="Characters"
                query={query}
                onQuery={(q) => {
                  setQuery(q)
                  setAddError(null)
                }}
                options={options}
                more={more}
                onPick={pick}
                refocus={false}
                placeholder="Type the name of one of your characters…"
              />
            )}
          </Field>
          {/* Its line is kept, so nothing moves when it says that nobody is called that. */}
          <p
            role={addError ? 'alert' : undefined}
            className={cn('mt-1.5 min-h-[18px] text-[12px]', addError ? 'text-danger' : 'text-faint')}
          >
            {addError ?? (nobody ? `None of your characters is called “${query.trim()}”. Add them first, then pick them here.` : null)}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-line-strong px-4 py-6 text-center">
          <p className="text-[13px] text-muted">
            {shown.length ? 'There is nobody else to add yet.' : 'Your world has no other characters yet.'} Once it has, pick
            them here and say what they are to each other.
          </p>
        </div>
      )}
    </div>
  )
}

type Edit = RelationEdit

const sameEdit = (a: Edit, b: Edit): boolean => a.type === b.type && a.selfFeels === b.selfFeels && a.otherFeels === b.otherFeels

/** One relationship, edited in place and saved as Adam types, as on the entry page. */
const RelationRow = memo(function RelationRow({
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
  // started from), and what he has typed since that isn't saved yet.
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
      // The memory may have changed the relationship since: only the boxes Adam changed are written over it.
      const { saved, now } = await saveRelationOverNewer(viewRef.current, e, base.current, {
        get: async (c) =>
          (await api.listChanges(c.entryId)).find((x): x is RelationshipChange => x.id === c.id && x.kind === 'relationship') ?? null,
        put: (id, input) => api.updateChange(id, input)
      })
      base.current = now
      if (saved.updatedAt > known.current) known.current = saved.updatedAt
      if (pending.current === e) pending.current = null
      const merged = mergeRelationEdit(e, editRef.current, now)
      if (sameEdit(merged, editRef.current)) return
      editRef.current = merged
      setEdit(merged)
      if (pending.current) {
        pending.current = merged
        scheduleRef.current(merged)
      }
    },
    { what: `the relationship with ${otherName}` }
  )
  scheduleRef.current = autosave.schedule

  // A newer copy loaded from elsewhere (the memory keeper, the entry page) shows when nothing is waiting to be saved.
  useEffect(() => {
    if (pending.current || view.change.updatedAt <= known.current) return
    known.current = view.change.updatedAt
    base.current = relationEditOf(view, view.change)
    setEdit(base.current)
  }, [view])

  // Just picked: straight into what they are to each other, ready to type "sister" or "rival".
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
      toast(`Couldn’t remove the relationship with ${otherName}. ${(err as Error).message}`, { tone: 'danger' })
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
          .catch((err: Error) => void toast(`Couldn’t bring back the relationship with ${otherName}. ${err.message}`, { tone: 'danger' }))
    })
  }

  const from = view.mine ? selfName : otherName
  const to = view.mine ? otherName : selfName
  const Icon = KIND_ICONS[other.kind]
  const note = view.change.origin === 'adam' ? null : sourceNote(view.change.origin, view.change.links)
  const both = other.kind === 'character'

  return (
    <div className="@container rounded-lg border border-line bg-surface px-3 pb-3 pt-2" onBlur={() => void autosave.flush()}>
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
        {both ? null : <span className="shrink-0 text-[12px] text-faint">{KIND_LABELS[other.kind].one}</span>}
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
        <Field label={`How ${selfName} feels about ${otherName}`} className={both ? undefined : '@lg:col-span-2'}>
          {(id) => (
            <AutoTextarea id={id} value={edit.selfFeels} minRows={1} maxRows={8} onChange={(e) => change({ selfFeels: e.target.value })} />
          )}
        </Field>
        {both ? (
          <Field label={`How ${otherName} feels about ${selfName}`}>
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
