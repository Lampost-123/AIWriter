import { BookMarked, MapPin, Plus, Search, ShieldCheck, Users, X } from 'lucide-react'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { KIND_LABELS } from '@shared/fields'
import type { Entry, EntryKind, ID } from '@shared/types'
import { Button, EmptyState, IconButton, Input, Notice, Spinner, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { EntryForm } from './EntryForm'
import { getDraft, withDrafts } from './entryDrafts'
import { createEntry } from './entryActions'
import { filterEntries, kindNoun, placePath } from './entryLogic'
import { useSlow } from './parts/useSlow'

const ICONS: Partial<Record<EntryKind, typeof Users>> = { character: Users, place: MapPin, lore: BookMarked }

const TEACH: Partial<Record<EntryKind, { text: string; button: string }>> = {
  character: {
    text: "Characters you add here are given to the AI whenever they're in a scene, so it keeps their looks, voice and history straight.",
    button: 'Create a character'
  },
  place: {
    text: 'Places you add here are given to the AI whenever a scene is set there, with the sights, sounds and smells that make them real.',
    button: 'Create a place'
  },
  lore: {
    text: 'Lore is how your world works: magic, history, customs and laws. Mark something as a hard rule and the AI is always told never to break it.',
    button: 'Create lore'
  }
}

/** The world bible screen for one kind: a searchable list on the left, the selected entry's form on the right. */
export function EntriesView({ kind, entryId }: { kind: EntryKind; entryId: ID | null }): React.JSX.Element {
  return <EntriesScreen key={kind} kind={kind} entryId={entryId} />
}

/** Keeps the same array while the parts that matter (by `key`) are unchanged, so memoised children skip work. */
function useStableList<T>(list: T[], key: (x: T) => string): T[] {
  const ref = useRef<{ key: string; list: T[] } | null>(null)
  const k = list.map(key).join('\u0000')
  if (!ref.current || ref.current.key !== k) ref.current = { key: k, list }
  return ref.current.list
}

function EntriesScreen({ kind, entryId }: { kind: EntryKind; entryId: ID | null }): React.JSX.Element {
  const entriesRev = useApp((s) => s.entriesRev)
  const navigate = useApp((s) => s.navigate)
  const labels = KIND_LABELS[kind]
  const noun = kindNoun(kind)
  const [all, setAll] = useState<Entry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  // Which change of the world bible the list reflects; while it lags, a just-restored entry may be missing.
  const [loadedRev, setLoadedRev] = useState(-1)
  const loadSeq = useRef(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const load = useCallback((rev: number) => {
    const seq = ++loadSeq.current
    api
      .listEntries()
      .then((list) => {
        if (seq !== loadSeq.current) return
        setAll((prev) => {
          const before = new Map((prev ?? []).map((e, i) => [e.id, { e, i }]))
          // Keep unchanged entries as the same objects, so only changed rows redraw.
          const next = withDrafts(list).map((e) => {
            const old = before.get(e.id)?.e
            return old && old.updatedAt === e.updatedAt && old !== getDraft(e.id) ? old : e
          })
          if (!prev) return next
          // Rows stay where they are while this screen is open, so renaming one doesn't make it jump.
          // New ones go at the end. The list is sorted by name again next time the screen opens.
          const pos = (e: Entry): number => before.get(e.id)?.i ?? Number.MAX_SAFE_INTEGER
          return next
            .map((e, j) => ({ e, j }))
            .sort((a, b) => pos(a.e) - pos(b.e) || a.j - b.j)
            .map((x) => x.e)
        })
        setError(null)
        setLoadedRev(rev)
      })
      .catch((e: Error) => {
        if (seq !== loadSeq.current) return
        setError(e.message)
        setLoadedRev(rev)
      })
  }, [])
  useEffect(() => load(entriesRev), [load, entriesRev])
  const retry = (): void => load(entriesRev)

  const list = useMemo(() => (all ?? []).filter((e) => e.kind === kind), [all, kind])
  const shown = useMemo(() => filterEntries(list, query), [list, query])
  const places = useStableList(
    useMemo(() => (all ?? []).filter((e) => e.kind === 'place'), [all]),
    (p) => `${p.id}\u0001${p.name}\u0001${p.parentId ?? ''}`
  )
  const selected = entryId ? (getDraft(entryId) ?? all?.find((e) => e.id === entryId) ?? null) : null
  const others = useMemo(() => (all ?? []).filter((e) => e.id !== entryId), [all, entryId])

  const select = useCallback((id: ID | null) => navigate({ kind: 'entries', entryKind: kind, entryId: id }), [navigate, kind])

  // Keep the selected row in view when it moves (renamed, or chosen with the arrow keys).
  useLayoutEffect(() => {
    if (!entryId) return
    listRef.current?.querySelector(`[data-entry="${CSS.escape(entryId)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [entryId, shown])

  const create = async (name?: string): Promise<void> => {
    if (creating) return
    setCreating(true)
    try {
      const e = await createEntry(kind, name)
      setAll((prev) => (prev ? [...prev, e] : [e]))
      if (!name) setQuery('')
      select(e.id)
    } catch (err) {
      toast(`Couldn't create the ${noun}. ${(err as Error).message}`, { tone: 'danger' })
    } finally {
      setCreating(false)
    }
  }

  const onLiveChange = useCallback((e: Entry) => setAll((prev) => prev?.map((x) => (x.id === e.id ? e : x)) ?? prev), [])
  const onOpen = useCallback((e: Pick<Entry, 'id' | 'kind'>) => navigate({ kind: 'entries', entryKind: e.kind, entryId: e.id }), [navigate])
  const onDeleted = useCallback(
    (e: Entry) => {
      const i = shown.findIndex((x) => x.id === e.id)
      const next = shown[i + 1] ?? shown[i - 1] ?? null
      setAll((prev) => prev?.filter((x) => x.id !== e.id) ?? prev)
      select(next?.id ?? null)
    },
    [shown, select]
  )

  const onSearchKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape' && query) {
      e.preventDefault()
      setQuery('')
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return
    if (!shown.length) {
      if (e.key === 'Enter' && query.trim()) void create(query)
      return
    }
    e.preventDefault()
    const i = shown.findIndex((x) => x.id === entryId)
    if (e.key === 'Enter') return select(shown[Math.max(0, i)].id)
    const j = e.key === 'ArrowDown' ? Math.min(shown.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1)
    select(shown[j].id)
  }

  const slow = useSlow(all === null && !error)
  const Icon = ICONS[kind] ?? Users
  const teach = TEACH[kind]

  if (all === null && !error) {
    // First load takes a few milliseconds: show nothing rather than a flash of an empty list.
    return slow ? (
      <div className="flex h-full items-center justify-center text-faint">
        <Spinner />
      </div>
    ) : (
      <div />
    )
  }

  if (error && all === null) {
    return (
      <div className="mx-auto max-w-md px-6 pt-16">
        <Notice
          tone="danger"
          action={
            <Button size="sm" onClick={retry}>
              Try again
            </Button>
          }
        >
          Couldn't load your {labels.many.toLowerCase()}. {error}
        </Notice>
      </div>
    )
  }

  // Nothing of this kind yet: one calm screen that explains what these are for.
  if (all !== null && list.length === 0) {
    return (
      <div className="flex h-full items-start justify-center overflow-auto pt-[12vh]">
        <EmptyState
          icon={<Icon size={20} />}
          title={`No ${labels.many.toLowerCase()} yet`}
          actions={
            <Button variant="primary" icon={<Plus size={15} />} loading={creating} onClick={() => void create()}>
              {teach?.button ?? `Create a ${noun}`}
            </Button>
          }
        >
          {teach?.text}
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-[34%] min-w-[220px] max-w-[320px] shrink-0 flex-col border-r border-line bg-surface">
        <div className="flex h-12 shrink-0 items-center gap-2 pl-4 pr-2">
          <h1 className="text-[15px] font-semibold text-fg">{labels.many}</h1>
          {all !== null ? <span className="text-[12px] tabular-nums text-faint">{list.length}</span> : null}
          <div className="flex-1" />
          <Button size="sm" variant="primary" icon={<Plus size={14} />} loading={creating} onClick={() => void create()}>
            New {kind === 'lore' ? 'lore' : noun}
          </Button>
        </div>
        <div className="px-3 pb-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
            <Input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKey}
              placeholder={`Search ${labels.many.toLowerCase()}`}
              aria-label={`Search ${labels.many.toLowerCase()}`}
              className="pl-8 pr-7"
            />
            {query ? (
              <IconButton
                label="Clear search"
                size="sm"
                className="absolute right-1 top-1/2 -translate-y-1/2"
                onClick={() => {
                  setQuery('')
                  searchRef.current?.focus()
                }}
              >
                <X size={13} />
              </IconButton>
            ) : null}
          </div>
        </div>
        <div ref={listRef} role="listbox" aria-label={labels.many} className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {shown.map((e) => (
            <EntryRow key={e.id} entry={e} active={e.id === entryId} places={kind === 'place' ? places : null} onSelect={select} />
          ))}
          {all !== null && query && !shown.length ? (
            <div className="px-2 py-6 text-center text-[13px] text-muted animate-fade-in">
              <p>No {labels.many.toLowerCase()} match "{query.trim()}".</p>
              <Button size="sm" className="mt-3 max-w-full" icon={<Plus size={14} />} loading={creating} onClick={() => void create(query)}>
                <span className="truncate">Create "{query.trim()}"</span>
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto">
        {selected ? (
          <EntryForm key={selected.id} initial={selected} others={others} places={places} onLiveChange={onLiveChange} onDeleted={onDeleted} onOpen={onOpen} />
        ) : all === null || (entryId && loadedRev !== entriesRev) ? null : entryId ? (
          <EmptyState icon={<Icon size={20} />} title={`This ${noun} can't be found`} className="mt-[10vh]">
            It may have been deleted. If you just deleted it, use Undo in the message at the bottom right.
          </EmptyState>
        ) : (
          <EmptyState icon={<Icon size={20} />} title={`Choose a ${noun}`} className="mt-[10vh]">
            Pick one from the list to see and edit it, or press New {kind === 'lore' ? 'lore' : noun} to add another.
          </EmptyState>
        )}
      </div>
    </div>
  )
}

const EntryRow = memo(function EntryRow({
  entry,
  active,
  places,
  onSelect
}: {
  entry: Entry
  active: boolean
  places: Entry[] | null
  onSelect: (id: ID) => void
}): React.JSX.Element {
  const name = entry.name.trim() || 'Unnamed'
  const initial = (Array.from(name)[0] ?? '?').toUpperCase()
  const inside = places && entry.parentId ? placePath(places, entry.parentId).join(' › ') : ''
  const sub = entry.summary.trim() || (inside ? `In ${inside}` : '')
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      data-entry={entry.id}
      onClick={() => onSelect(entry.id)}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors duration-100',
        active ? 'bg-accent-soft' : 'hover:bg-surface-2'
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold',
          active ? 'bg-accent text-accent-fg' : 'bg-surface-3 text-muted'
        )}
      >
        {entry.kind === 'lore' && entry.hardRule ? <ShieldCheck size={14} /> : initial}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-[13.5px] font-medium', active ? 'text-accent' : 'text-fg')}>{name}</span>
        <span className={cn('block truncate text-[12px]', sub ? 'text-muted' : 'italic text-faint')}>{sub || 'No summary yet'}</span>
      </span>
    </button>
  )
})
