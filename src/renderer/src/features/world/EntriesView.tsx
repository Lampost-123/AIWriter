import { ArrowLeft, Plus, Search, ShieldCheck, Sparkles, X } from '@/components/ui/icons'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { KIND_LABELS } from '@shared/fields'
import type { Entry, EntryKind, ID } from '@shared/types'
import type { BuilderKind } from '@shared/contracts/builder'
import { Button, EmptyState, IconButton, Input, Notice, Spinner, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useNewLook } from '@/features/look/look'
import { useApp } from '@/lib/store'
import { useCodex } from '@/features/codex/codexStore'
import { Portrait } from '@/features/views/Portrait'
import { EntryForm } from './EntryForm'
import { getDraft, withDrafts } from './entryDrafts'
import { createEntry } from './entryActions'
import { entryInitial, filterEntries, keepRowOrder, kindNoun, kindNounMany, placePath, withArticle } from './entryLogic'
import { KIND_ICONS, KIND_INK } from './kindIcons'
import { useKeepFocusInPlace } from './parts/useKeepFocusInPlace'
import { useSlow } from './parts/useSlow'

const TEACH: Record<EntryKind, { text: string; button: string }> = {
  character: {
    text: "Characters you add here are given to the AI whenever they're in a scene, so it keeps their looks, voice and history straight.",
    button: 'Create a character'
  },
  place: {
    text: 'Places you add here are given to the AI whenever a scene is set there, with the sights, sounds and smells that make them real.',
    button: 'Create a place'
  },
  group: {
    text: 'Groups are the families, guilds, factions and nations of your world. The AI is told their goals, ranks and rivals whenever they matter to a scene.',
    button: 'Create a group'
  },
  item: {
    text: 'Items are the objects that matter to the plot: a sword, a letter, a key. Note what they can and can’t do, and who holds them, so the AI keeps track.',
    button: 'Create an item'
  },
  lore: {
    text: 'Lore is how your world works: magic, history, customs and laws. Mark something as a hard rule and the AI is always told never to break it.',
    button: 'Create lore'
  },
  event: {
    text: 'Events are things that happened, on or off the page: when they happened, what came of them, and who was involved.',
    button: 'Create an event'
  },
  thread: {
    text: 'Plot threads are the promises you’ve made to the reader: mysteries, setups and conflicts still to be resolved. The AI is reminded of the ones still open.',
    button: 'Create a plot thread'
  },
  glossary: {
    text: 'The glossary keeps the words you invent spelled the same every time, with notes on how to say them.',
    button: 'Add a term'
  }
}

/** Kinds with a builder (milestone 3): Quick start makes one from a few lines of notes. */
const BUILDER_KINDS: EntryKind[] = ['character', 'place', 'group', 'item']
const hasBuilder = (kind: EntryKind): kind is BuilderKind => BUILDER_KINDS.includes(kind)

/** Opens the builder's Quick start for a new entry of this kind. */
const quickStart = (kind: BuilderKind): void =>
  useApp.getState().navigate({ kind: 'builder', entryKind: kind, entryId: null, start: { mode: 'quick' } })

/** Where the screen was opened from, when it offers the way back (a draft's "What the AI saw"). */
type From = { generationId: ID } | undefined

/** The world bible screen for one kind: a searchable list on the left, the selected entry's form on the right. */
export function EntriesView({ kind, entryId, from }: { kind: EntryKind; entryId: ID | null; from?: From }): React.JSX.Element {
  return <EntriesScreen key={kind} kind={kind} entryId={entryId} from={from} />
}

/** Keeps the same array while the parts that matter (by `key`) are unchanged, so memoised children skip work. */
function useStableList<T>(list: T[], key: (x: T) => string): T[] {
  const ref = useRef<{ key: string; list: T[] } | null>(null)
  const k = list.map(key).join('\u0000')
  if (!ref.current || ref.current.key !== k) ref.current = { key: k, list }
  return ref.current.list
}

function EntriesScreen({ kind, entryId, from }: { kind: EntryKind; entryId: ID | null; from: From }): React.JSX.Element {
  const entriesRev = useApp((s) => s.entriesRev)
  const navigate = useApp((s) => s.navigate)
  // Opened from the codex: the page offers the way back to it, as Adam left it.
  const fromCodex = useCodex((s) => s.backTo === kind)
  const labels = KIND_LABELS[kind]
  const noun = kindNoun(kind)
  const [all, setAll] = useState<Entry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  // Which change of the world bible the list reflects; while it lags, a just-restored entry may be missing.
  const [loadedRev, setLoadedRev] = useState(-1)
  const loadSeq = useRef(0)
  // Where deleted rows stood, so Undo puts them back in the same place rather than at the end.
  const removedAt = useRef(new Map<ID, number>())
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
          // The list is sorted by name again next time the screen opens.
          return keepRowOrder(prev, next, removedAt.current)
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

  // Moving around this screen keeps the way back to "What the AI saw".
  const select = useCallback((id: ID | null) => navigate({ kind: 'entries', entryKind: kind, entryId: id, from }), [navigate, kind, from])

  // Keep the selected row in view when another one is chosen (arrow keys, New, Undo) or the
  // search moves it. Not on every save or keystroke, so a list Adam has scrolled stays put.
  const selectedIndex = entryId ? shown.findIndex((e) => e.id === entryId) : -1
  useLayoutEffect(() => {
    if (!entryId || selectedIndex < 0) return
    listRef.current?.querySelector(`[data-entry="${CSS.escape(entryId)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [entryId, selectedIndex])

  // Another entry's page opens at its top, not partway down where the last one was left.
  const pageRef = useRef<HTMLDivElement>(null)
  const pageContentRef = useRef<HTMLDivElement>(null)
  // The memory can add to a page while Adam types on it: the field he's in stays where it is.
  useKeepFocusInPlace(pageRef, pageContentRef, list.length > 0)
  useLayoutEffect(() => {
    if (pageRef.current) pageRef.current.scrollTop = 0
  }, [entryId])

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
  const onOpen = useCallback(
    (e: Pick<Entry, 'id' | 'kind'>) => navigate({ kind: 'entries', entryKind: e.kind, entryId: e.id, from }),
    [navigate, from]
  )
  const onDeleted = useCallback(
    (e: Entry) => {
      const i = shown.findIndex((x) => x.id === e.id)
      const next = shown[i + 1] ?? shown[i - 1] ?? null
      setAll((prev) => {
        if (!prev) return prev
        const at = prev.findIndex((x) => x.id === e.id)
        if (at >= 0) removedAt.current.set(e.id, at)
        return prev.filter((x) => x.id !== e.id)
      })
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
  const Icon = KIND_ICONS[kind]
  const teach = TEACH[kind]
  const many = kindNounMany(kind)

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
          title={`No ${many} yet`}
          actions={
            <>
              <Button variant="primary" icon={<Plus size={15} />} loading={creating} onClick={() => void create()}>
                {teach.button}
              </Button>
              {hasBuilder(kind) ? (
                <Button icon={<Sparkles size={15} />} onClick={() => quickStart(kind)}>
                  Quick start from a few notes
                </Button>
              ) : null}
            </>
          }
        >
          {teach.text}
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="@container flex w-[34%] min-w-[220px] max-w-[320px] shrink-0 flex-col border-r border-line bg-surface">
        <div className="flex h-12 shrink-0 items-center gap-2 pl-4 pr-2">
          <h1 className="min-w-0 truncate text-[15px] font-semibold text-fg">{labels.many}</h1>
          {all !== null ? <span className="text-[12px] tabular-nums text-faint">{list.length}</span> : null}
          <div className="flex-1" />
          {hasBuilder(kind) ? (
            <IconButton size="sm" label={`Quick start ${withArticle(noun)} from a few notes`} onClick={() => quickStart(kind)}>
              <Sparkles size={14} />
            </IconButton>
          ) : null}
          {/* In a narrow list the button just says "New", and in the narrowest it is the plus alone, so it
              never spills over the form and the heading keeps its room. */}
          <Button
            size="sm"
            variant="primary"
            icon={<Plus size={14} />}
            loading={creating}
            aria-label={`New ${kind === 'lore' ? 'lore' : noun}`}
            title={`New ${kind === 'lore' ? 'lore' : noun}`}
            className="@max-[250px]:w-7 @max-[250px]:px-0"
            onClick={() => void create()}
          >
            <span className="hidden @[250px]:inline @[272px]:hidden">New</span>
            <span className="hidden @[272px]:inline">New {kind === 'lore' ? 'lore' : noun}</span>
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
              <p>
                No {many} match "{query.trim()}".
              </p>
              <Button size="sm" className="mt-3 max-w-full" icon={<Plus size={14} />} loading={creating} onClick={() => void create(query)}>
                <span className="truncate">Create "{query.trim()}"</span>
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <div ref={pageRef} className="min-w-0 flex-1 overflow-y-auto">
        <div ref={pageContentRef}>
          {from ? (
            <div className="mx-auto w-full max-w-[700px] px-8 pt-4">
              <Button
                variant="ghost"
                size="sm"
                icon={<ArrowLeft size={14} />}
                className="-ml-2.5"
                onClick={() => navigate({ kind: 'generation', generationId: from.generationId })}
              >
                Back to What the AI saw
              </Button>
            </div>
          ) : fromCodex ? (
            <div className="mx-auto w-full max-w-[700px] px-8 pt-4">
              <Button
                variant="ghost"
                size="sm"
                icon={<ArrowLeft size={14} />}
                className="-ml-2.5"
                onClick={() => navigate({ kind: 'codex' })}
              >
                Back to the codex
              </Button>
            </div>
          ) : null}
          {selected ? (
            <EntryForm
              key={selected.id}
              initial={selected}
              others={others}
              places={places}
              onLiveChange={onLiveChange}
              onDeleted={onDeleted}
              onOpen={onOpen}
            />
          ) : all === null || (entryId && loadedRev !== entriesRev) ? null : entryId ? (
            <EmptyState icon={<Icon size={20} />} title={`This ${noun} can't be found`} className="mt-[10vh]">
              It may have been deleted. Anything deleted can be brought back from Settings › Recently deleted for 30 days.
            </EmptyState>
          ) : (
            <EmptyState icon={<Icon size={20} />} title={`Choose ${withArticle(noun)}`} className="mt-[10vh]">
              Pick one from the list to see and edit it, or press New {kind === 'lore' ? 'lore' : noun} to add another.
            </EmptyState>
          )}
        </div>
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
  const initial = entryInitial(name)
  const isNew = useNewLook()
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
      {entry.image ? (
        <Portrait entry={entry} size={28} className={cn(active && 'ring-2 ring-accent')} />
      ) : (
        <span
          aria-hidden
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold',
            // The New look: the letter in its kind's ink and tint, in the serif, ringed when chosen.
            isNew
              ? cn(KIND_INK[entry.kind].tile, 'font-heading text-[13px]', active && 'ring-2 ring-accent')
              : active
                ? 'bg-accent text-accent-fg'
                : 'bg-surface-3 text-muted'
          )}
        >
          {entry.kind === 'lore' && entry.hardRule ? <ShieldCheck size={14} /> : initial}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-[13.5px] font-medium', active ? 'text-accent' : 'text-fg')}>{name}</span>
        <span className={cn('block truncate text-[12px]', sub ? 'text-muted' : 'italic text-faint')}>{sub || 'No summary yet'}</span>
      </span>
    </button>
  )
})
