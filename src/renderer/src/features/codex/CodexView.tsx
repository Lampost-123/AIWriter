// The codex (milestone 3): a card for every entry, grouped by kind, with its portrait, one-liner,
// tags and where it last appears. Filter by kind, tag, story or role, sort by name, importance or
// last appearance; a card opens the entry's page, and the codex keeps its filters and scroll while
// Adam goes back and forth. Plot threads live on their own board, so they aren't here.

import { LayoutGrid, Plus, Search, ShieldCheck, Sparkles, WandSparkles, X } from 'lucide-react'
import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { KIND_LABELS } from '@shared/fields'
import type { CodexCard } from '@shared/contracts/entryViews'
import { Badge, Button, EmptyState, IconButton, Input, Notice, Select, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { Skeleton, useDelayed } from '@/features/generate/parts'
import { Portrait } from '@/features/views/Portrait'
import { createEntry } from '@/features/world/entryActions'
import { openWorldBuilder } from '@/features/worldBuilder/open'
import {
  CODEX_KINDS,
  NO_FILTERS,
  SORTS,
  appearsLine,
  displayName,
  filtersOn,
  groupCards,
  nothingMatches,
  roleChoices,
  shownCards,
  tagChoices,
  tidyFilters,
  type Choice,
  type CodexFilters,
  type CodexSort
} from './codexLogic'
import { openFromCodex, useCodex, type CodexAnchor } from './codexStore'

/** The codex's cards, reloaded whenever entries, the memory or the stories change. The last answer stays while the next loads. */
function useCodexCards(): { cards: CodexCard[] | null; error: string | null; retry: () => void } {
  const entriesRev = useApp((s) => s.entriesRev)
  const memoryRev = useApp((s) => s.memoryRev)
  const outlineRev = useApp((s) => s.outlineRev)
  const [state, setState] = useState<{ cards: CodexCard[] | null; error: string | null }>({ cards: null, error: null })
  const seq = useRef(0)
  const load = useCallback(() => {
    const ticket = ++seq.current
    api
      .listCodex()
      .then((cards) => ticket === seq.current && setState({ cards, error: null }))
      .catch((e: Error) => ticket === seq.current && setState((s) => ({ cards: s.cards, error: e.message || 'Something went wrong.' })))
  }, [])
  useEffect(() => load(), [load, entriesRev, memoryRev, outlineRev])
  return { ...state, retry: load }
}

const quickStart = (): void =>
  useApp.getState().navigate({ kind: 'builder', entryKind: 'character', entryId: null, start: { mode: 'quick' } })

// Cards are measured by the list item around each: its box is there even while the card inside
// hasn't been drawn, so measuring it never makes the browser draw a card out of view.
const itemOf = (el: HTMLElement, id: string): HTMLElement | null => el.querySelector<HTMLElement>(`[data-codex-item="${CSS.escape(id)}"]`)

/** The first card at least partly in view under the toolbar, and how far below the top of the view it starts. */
function firstInView(el: HTMLElement): CodexAnchor | null {
  const top = el.getBoundingClientRect().top
  const under = el.querySelector('[data-codex-toolbar]')?.getBoundingClientRect().bottom ?? top
  for (const item of el.querySelectorAll<HTMLElement>('[data-codex-item]')) {
    const r = item.getBoundingClientRect()
    if (r.bottom > under) return { id: item.dataset.codexItem!, top: r.top - top, opened: false }
  }
  return null
}

/** Cards on each side of the one put back that are drawn straight away: more than a tall window holds. */
const NEAR = 60

/**
 * Scrolls the codex so a card is `top` below the top of its view again. The cards around it are drawn
 * first, as they will be once they are in view: a card not drawn yet counts at a guessed height, which
 * would put the view out by the difference (most of all at the end of the list).
 */
function putBack(el: HTMLElement, item: HTMLElement, top: number): void {
  const items = [...el.querySelectorAll<HTMLElement>('[data-codex-item]')]
  const i = items.indexOf(item)
  for (const near of items.slice(Math.max(0, i - NEAR), i + NEAR + 1)) near.style.contentVisibility = 'visible'
  el.scrollTop = item.getBoundingClientRect().top - el.getBoundingClientRect().top - top
}

export function CodexView(): React.JSX.Element {
  const { cards, error, retry } = useCodexCards()
  const filters = useCodex((s) => s.filters)
  const sort = useCodex((s) => s.sort)
  const setFilters = useCodex((s) => s.setFilters)
  const setSort = useCodex((s) => s.setSort)
  const stories = useApp((s) => s.stories)
  const scroller = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const [creating, setCreating] = useState(false)

  const all = useMemo(() => (cards ?? []).filter((c) => CODEX_KINDS.includes(c.kind)), [cards])
  const tags = useMemo(() => tagChoices(all), [all])
  const roles = useMemo(() => roleChoices(all), [all])
  const storyChoices = useMemo(
    () =>
      [...stories]
        .sort((a, b) => a.position - b.position || a.createdOrder - b.createdOrder)
        .map((s) => ({ value: s.id, label: s.title.trim() || 'Untitled story' })),
    [stories]
  )
  const groups = useMemo(() => groupCards(shownCards(all, filters, sort)), [all, filters, sort])

  // A filter for a tag, role or story that is no longer there would hide everything for no reason Adam can see.
  useEffect(() => {
    if (!cards) return
    const tidy = tidyFilters(filters, { tags, roles, storyIds: stories.map((s) => s.id) })
    if (tidy !== filters) useCodex.setState({ filters: tidy })
  }, [cards, filters, tags, roles, stories])

  // Back from an entry's page: the codex is where Adam left it, with the card he opened (or the one at
  // the top) where it was. The card he opened gets the keyboard's place back when "Back to the codex"
  // took it away with it.
  const restored = useRef(false)
  useLayoutEffect(() => {
    const el = scroller.current
    if (restored.current || !cards || !el) return
    restored.current = true
    const { scroll, anchor } = useCodex.getState()
    const item = anchor ? itemOf(el, anchor.id) : null
    if (item && anchor) putBack(el, item, anchor.top)
    else el.scrollTop = scroll
    if (item && anchor?.opened && document.activeElement === document.body) {
      item.querySelector<HTMLElement>('[data-codex-card]')?.focus({ preventScroll: true })
    }
    useCodex.setState({ scroll: el.scrollTop, anchor: null })
  }, [cards])
  // Leaving the codex another way (from the binder, say): the card at the top of the view is its place,
  // unless the codex was at its very top.
  useLayoutEffect(() => {
    const el = scroller.current
    return () => {
      if (el && el.scrollTop > 0 && restored.current && !useCodex.getState().anchor) useCodex.setState({ anchor: firstInView(el) })
    }
  }, [])

  const open = useCallback((c: CodexCard) => {
    const el = scroller.current
    const item = el ? itemOf(el, c.id) : null
    const top = el && item ? item.getBoundingClientRect().top - el.getBoundingClientRect().top : null
    openFromCodex(c, { scroll: el?.scrollTop ?? 0, top })
  }, [])

  const createCharacter = async (): Promise<void> => {
    if (creating) return
    setCreating(true)
    try {
      const e = await createEntry('character')
      openFromCodex(e, { scroll: 0, top: null })
    } catch (err) {
      toast(`Couldn’t create the character. ${(err as Error).message}`, { tone: 'danger' })
      setCreating(false)
    }
  }

  // A clear button goes once it has done its job: the keyboard's place moves to the search box rather than the top of the window.
  const clear = useCallback(
    (patch: Partial<CodexFilters>) => {
      setFilters(patch)
      search.current?.focus()
    },
    [setFilters]
  )

  const slow = useDelayed(cards === null && !error, 250)
  const shown = groups.reduce((n, g) => n + g.cards.length, 0)

  let body: React.ReactNode
  if (cards === null && error) {
    body = (
      <div className="mx-auto max-w-md pt-16">
        <Notice
          tone="danger"
          action={
            <Button size="sm" onClick={retry}>
              Try again
            </Button>
          }
        >
          Couldn’t load the codex. {error}
        </Notice>
      </div>
    )
  } else if (cards === null) {
    // A first look in a big world can take a moment: nothing at first, then quiet placeholder cards.
    body = slow ? (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3 pt-16" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-xl" />
        ))}
      </div>
    ) : null
  } else if (!all.length) {
    body = (
      <EmptyState
        icon={<LayoutGrid size={20} />}
        title="Nothing in the codex yet"
        className="mt-[8vh] max-w-md"
        actions={
          <>
            <Button variant="primary" icon={<Plus size={15} />} loading={creating} onClick={() => void createCharacter()}>
              Create a character
            </Button>
            <Button icon={<Sparkles size={15} />} onClick={quickStart}>
              Quick start from a few notes
            </Button>
            <Button icon={<WandSparkles size={15} />} onClick={() => openWorldBuilder()}>
              Build from a summary
            </Button>
          </>
        }
      >
        The codex holds everything the AI should remember about your world: its characters, places, groups, items, lore, events and the
        words you invent. Whatever is here is given to the AI when a scene needs it, so names, looks and rules stay the same from one
        chapter to the next.
      </EmptyState>
    )
  } else {
    body = (
      <>
        <Toolbar tags={tags} roles={roles} stories={storyChoices} search={search} onClear={clear} />
        {shown ? (
          groups.map((g) => <Group key={g.kind} label={g.label} cards={g.cards} onOpen={open} />)
        ) : (
          <EmptyState
            icon={<Search size={20} />}
            title="Nothing matches"
            className="mt-4"
            actions={
              filtersOn({ ...filters, query: '' }) ? (
                <Button size="sm" onClick={() => clear(NO_FILTERS)}>
                  Clear filters
                </Button>
              ) : (
                <Button size="sm" onClick={() => clear({ query: '' })}>
                  Clear search
                </Button>
              )
            }
          >
            {nothingMatches(filters)}
          </EmptyState>
        )}
      </>
    )
  }

  return (
    <div
      ref={scroller}
      // The scrollbar's room is kept when nothing scrolls (a filter that leaves a few cards), so the toolbar never shifts.
      className="h-full overflow-y-auto [scrollbar-gutter:stable]"
      onScroll={(e) => {
        if (restored.current) useCodex.setState({ scroll: e.currentTarget.scrollTop })
      }}
    >
      <div className="mx-auto w-full max-w-[1120px] px-8 pb-20 pt-6">
        {/* Headed like the other world pages (the timeline, the map, the board): a title and what the page is for. */}
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div className="min-w-[220px] flex-1">
            <div className="flex items-baseline gap-2">
              <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-fg">Codex</h1>
              {all.length ? <span className="text-[13px] tabular-nums text-faint">{all.length}</span> : null}
            </div>
            <p className="mt-0.5 text-[13px] text-muted">Everything the AI remembers about your world.</p>
          </div>
          {all.length ? <SortSelect value={sort} onChange={setSort} /> : null}
        </div>
        {error && cards ? (
          <p className="mt-1 text-[12.5px] text-muted" role="status">
            Couldn’t refresh the codex. {error}{' '}
            <button type="button" className="font-medium text-accent underline-offset-2 hover:underline" onClick={retry}>
              Try again
            </button>
          </p>
        ) : null}
        {body}
      </div>
    </div>
  )
}

function SortSelect({ value, onChange }: { value: CodexSort; onChange: (v: CodexSort) => void }): React.JSX.Element {
  const id = useId()
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-[12.5px] text-muted">
        Sort by
      </label>
      <div className="w-[160px]">
        <Select id={id} value={value} onChange={(v) => v && onChange(v as CodexSort)} options={SORTS} />
      </div>
    </div>
  )
}

/** One labelled filter: a quiet label and a small picker, "Any …" when unset. */
function FilterSelect({
  label,
  value,
  onChange,
  options,
  none,
  width = 150
}: {
  label: string
  value: string | null
  onChange: (v: string | null) => void
  options: Choice[]
  none: string
  width?: number
}): React.JSX.Element {
  const id = useId()
  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor={id} className="text-[12.5px] text-muted">
        {label}
      </label>
      <div style={{ width }}>
        <Select id={id} value={value} onChange={onChange} options={options} allowNone noneLabel={none} />
      </div>
    </div>
  )
}

const KIND_CHOICES: Choice[] = CODEX_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k].many }))

/** Search and filters. Stays at the top while the cards scroll under it. */
function Toolbar({
  tags,
  roles,
  stories,
  search,
  onClear
}: {
  tags: Choice[]
  roles: Choice[]
  stories: Choice[]
  search: React.RefObject<HTMLInputElement | null>
  /** Clears some of the search and filters, and puts the keyboard's place in the search box. */
  onClear: (patch: Partial<CodexFilters>) => void
}): React.JSX.Element {
  const filters = useCodex((s) => s.filters)
  const setFilters = useCodex((s) => s.setFilters)
  return (
    <div data-codex-toolbar className="sticky top-0 z-10 -mx-2 flex flex-wrap items-center gap-x-4 gap-y-2 bg-bg px-2 pb-3 pt-4">
      <div className="relative w-[220px]">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
        <Input
          ref={search}
          value={filters.query}
          onChange={(e) => setFilters({ query: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && filters.query) {
              e.preventDefault()
              setFilters({ query: '' })
            }
          }}
          placeholder="Search the codex"
          aria-label="Search the codex"
          className="pl-8 pr-7"
        />
        {filters.query ? (
          <IconButton
            label="Clear search"
            size="sm"
            className="absolute right-1 top-1/2 -translate-y-1/2"
            onClick={() => onClear({ query: '' })}
          >
            <X size={13} />
          </IconButton>
        ) : null}
      </div>
      <FilterSelect
        label="Kind"
        value={filters.kind}
        onChange={(kind) => setFilters({ kind: kind as typeof filters.kind })}
        options={KIND_CHOICES}
        none="All kinds"
        width={140}
      />
      {tags.length ? (
        <FilterSelect label="Tag" value={filters.tag} onChange={(tag) => setFilters({ tag })} options={tags} none="Any tag" />
      ) : null}
      {stories.length > 1 ? (
        <FilterSelect
          label="Story"
          value={filters.storyId}
          onChange={(storyId) => setFilters({ storyId })}
          options={stories}
          none="Every story"
          width={170}
        />
      ) : null}
      {roles.length ? (
        <FilterSelect
          label="Role"
          value={filters.role}
          onChange={(role) => setFilters({ role })}
          options={roles}
          none="Any role"
          width={140}
        />
      ) : null}
      {/* The search box clears itself; this is for the pickers (and clears the search with them, as under "Nothing matches"). */}
      {filtersOn({ ...filters, query: '' }) ? (
        <Button variant="ghost" size="sm" onClick={() => onClear(NO_FILTERS)}>
          Clear filters
        </Button>
      ) : null}
    </div>
  )
}

const Group = memo(function Group({
  label,
  cards,
  onOpen
}: {
  label: string
  cards: CodexCard[]
  onOpen: (c: CodexCard) => void
}): React.JSX.Element {
  const id = useId()
  return (
    <section aria-labelledby={id} className="mt-4">
      <h2 id={id} className="mb-2.5 flex items-baseline gap-2 text-[12px] font-semibold uppercase tracking-wide text-faint">
        {label}
        <span className="font-normal tabular-nums">{cards.length}</span>
      </h2>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3">
        {cards.map((c) => (
          // Cards out of view skip layout and paint, so a codex of hundreds of entries opens quickly.
          <li key={c.id} data-codex-item={c.id} className="[contain-intrinsic-size:auto_104px] [content-visibility:auto]">
            <Card card={c} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </section>
  )
})

const MAX_TAGS = 3

const Card = memo(function Card({ card, onOpen }: { card: CodexCard; onOpen: (c: CodexCard) => void }): React.JSX.Element {
  const ids = { rule: useId(), role: useId(), about: useId() }
  const name = displayName(card)
  const role = card.kind === 'character' && card.role ? card.role[0].toLocaleUpperCase() + card.role.slice(1) : ''
  const hardRule = card.kind === 'lore' && card.hardRule
  const more = card.tags.length - MAX_TAGS
  return (
    // Named by the entry's name; the hard-rule mark, role, one-liner, tags and where it appears describe it.
    <button
      type="button"
      data-codex-card={card.id}
      aria-label={name}
      aria-describedby={[hardRule && ids.rule, role && ids.role, ids.about].filter(Boolean).join(' ')}
      onClick={() => onOpen(card)}
      // The focus ring is drawn inside the card: the list item around it clips anything outside.
      className="flex h-full min-h-[104px] w-full items-start gap-3 rounded-xl border border-line bg-surface p-3 text-left transition-[border-color,background-color] duration-150 hover:border-line-strong hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
    >
      <Portrait entry={card} size={48} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={cn('truncate text-[14px] font-semibold', card.name.trim() ? 'text-fg' : 'italic text-muted')}>{name}</span>
          {hardRule ? (
            <span id={ids.rule} className="flex shrink-0 text-accent" title="Hard rule">
              <ShieldCheck size={13} aria-hidden />
              <span className="sr-only">Hard rule</span>
            </span>
          ) : null}
          {role ? (
            <span id={ids.role} className="ml-auto shrink-0 pl-1 text-[11.5px] text-faint">
              {role}
            </span>
          ) : null}
        </span>
        <span id={ids.about} className="block">
          <span className={cn('mt-0.5 line-clamp-2 text-[12.5px] leading-snug', card.summary.trim() ? 'text-muted' : 'italic text-faint')}>
            {card.summary.trim() || 'No summary yet'}
          </span>
          {card.tags.length ? (
            <span className="mt-1.5 flex flex-wrap gap-1">
              {card.tags.slice(0, MAX_TAGS).map((t) => (
                <Badge key={t} className="max-w-[140px] truncate">
                  {t}
                </Badge>
              ))}
              {more > 0 ? <span className="self-center text-[11.5px] text-faint">+{more}</span> : null}
            </span>
          ) : null}
          <span className="mt-1.5 line-clamp-2 text-[11.5px] text-faint">{appearsLine(card)}</span>
        </span>
      </span>
    </button>
  )
})
