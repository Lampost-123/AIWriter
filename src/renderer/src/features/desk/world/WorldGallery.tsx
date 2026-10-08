// The desk's World room (UI overhaul phase 4, D4.1): everything in the world as a gallery on its sheet, in place of the
// codex's grid of cards. Under the world's name, kind tabs (All, then each kind the world has, with how many it holds)
// with one underline that glides to the chosen tab (a clip-path, no layout); find, the order and the codex's other
// filters beside them. Each kind is a section of its own material (GalleryCard): portraits, landscapes, parchment,
// scrolls, index cards, plain paper. A new tab fades the cards out (140ms) and brings them back one after another, 30ms
// apart; from the keyboard and with less motion they are simply there. The filters, the order and where the gallery was
// scrolled are the codex's own (codexStore), kept while Adam goes back and forth.
import * as M from '@radix-ui/react-dropdown-menu'
import {
  Check,
  ChevronDown,
  LayoutGrid,
  ListOrdered,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  WandSparkles,
  X
} from '@/components/ui/icons'
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { KIND_LABELS } from '@shared/fields'
import type { CodexCard } from '@shared/contracts/entryViews'
import type { EntryKind, ID } from '@shared/types'
import { Button, EmptyState, Notice, toast } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { keyboardDriven, reducedMotion } from '@/features/look/motion'
import { firstInView, itemOf, putBack } from '@/features/codex/codexPlace'
import { useCodex } from '@/features/codex/codexStore'
import {
  GALLERY_KINDS,
  GALLERY_SORTS,
  NO_FILTERS,
  filtersOn,
  nothingMatches,
  roleChoices,
  shownCards,
  tagChoices,
  tidyFilters,
  type CodexFilters
} from '@/features/codex/codexLogic'
import { useEntryMotifs } from '@/features/world/art/artStore'
import { createEntry } from '@/features/world/entryActions'
import { KIND_ICONS, KIND_INK } from '@/features/world/kindIcons'
import { openWorldBuilder } from '@/features/worldBuilder/open'
import { useArrival } from '@/layout/desk/arrival'
import { GalleryCard, type OpenHow } from './GalleryCard'
import { gallerySections, galleryTabs, staggerDelay, tabClip, worldLine } from './galleryLogic'
import type { WorldData } from './worldData'

/** How long the cards take to fade out before a new tab's come in (the desk's exits). */
const LEAVE_MS = 140

const MENU = 'desk-menu z-50 min-w-[220px] rounded-[14px] p-1.5 font-sans data-[state=open]:animate-pop-in'
const ITEM =
  'desk-menu-item flex h-[34px] select-none items-center gap-2.5 rounded-[9px] px-2.5 text-[13px] text-fg outline-none data-[highlighted]:bg-surface-2 data-[disabled]:opacity-50'
const LABEL = 'px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint'

/** The world's tab for a view: All on Everything, a kind on its own page (and the dossier keeps whatever was showing). */
export function tabOfView(view: ReturnType<typeof useApp.getState>['view']): EntryKind | null | undefined {
  if (view.kind === 'codex') return null
  if (view.kind === 'entries' && !view.entryId) return view.entryKind
  return undefined
}

/** Shows a tab's page: Everything, or a kind's (the same gallery; the room's links light up to match). */
function showTab(kind: EntryKind | null): void {
  const { navigate } = useApp.getState()
  navigate(kind ? { kind: 'entries', entryKind: kind, entryId: null } : { kind: 'codex' })
}

/** A new entry of a kind, opened in its dossier with its name ready to type over. */
async function newEntry(kind: EntryKind, open: (id: ID, kind: EntryKind) => void): Promise<void> {
  try {
    const e = await createEntry(kind)
    open(e.id, e.kind)
  } catch (err) {
    toast(`Couldn’t create the ${KIND_LABELS[kind].one.toLowerCase()}. ${(err as Error).message}`, { tone: 'danger' })
  }
}

/** The kinds to make, as a menu's rows (the New entry button's, and the ghost card's). */
function NewEntryItems({ onPick }: { onPick: (kind: EntryKind) => void }): React.JSX.Element {
  return (
    <>
      {GALLERY_KINDS.map((k) => {
        const Icon = KIND_ICONS[k]
        return (
          <M.Item key={k} className={ITEM} onSelect={() => onPick(k)}>
            <span aria-hidden className={cn('grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[6px]', KIND_INK[k].tile)}>
              <Icon size={14} />
            </span>
            {k === 'lore' ? 'Lore' : k === 'glossary' ? 'A term' : `A ${KIND_LABELS[k].one.toLowerCase()}`}
          </M.Item>
        )
      })}
      <M.Separator className="my-1 h-px bg-line" />
      <M.Item
        className={ITEM}
        onSelect={() => useApp.getState().navigate({ kind: 'builder', entryKind: 'character', entryId: null, start: { mode: 'quick' } })}
      >
        <Sparkles size={15} className="text-ai" aria-hidden />
        Quick start from a few notes
      </M.Item>
    </>
  )
}

export function WorldGallery({
  data,
  openId,
  onOpen,
  onCreated
}: {
  data: WorldData
  /** The entry whose dossier is open over the gallery (its card steps out), or null. */
  openId: ID | null
  onOpen: (card: CodexCard, el: HTMLElement, how: OpenHow) => void
  /** A new entry was made here: open it. */
  onCreated: (id: ID, kind: EntryKind) => void
}): React.JSX.Element {
  const { cards, byId, threads, error, retry } = data
  const filters = useCodex((s) => s.filters)
  const sort = useCodex((s) => s.sort)
  const setFilters = useCodex((s) => s.setFilters)
  const setSort = useCodex((s) => s.setSort)
  const world = useApp((s) => s.world)
  const stories = useApp((s) => s.stories)
  const storyTitle = useApp((s) => s.stories.find((x) => x.id === s.storyId)?.title.trim() ?? '')
  const scroller = useRef<HTMLDivElement>(null)
  const find = useRef<HTMLInputElement>(null)
  // Each entry's drawing (phase 5's library): Adam's choice, else the one its words call for.
  const motifs = useEntryMotifs()

  const all = useMemo(() => (cards ?? []).filter((c) => GALLERY_KINDS.includes(c.kind)), [cards])
  const tabs = useMemo(() => galleryTabs(all), [all])
  const tags = useMemo(() => tagChoices(all), [all])
  const roles = useMemo(() => roleChoices(all), [all])
  const storyChoices = useMemo(
    () =>
      [...stories]
        .sort((a, b) => a.position - b.position || a.createdOrder - b.createdOrder)
        .map((s) => ({ value: s.id, label: s.title.trim() || 'Untitled story' })),
    [stories]
  )

  // A filter for a tag, role or story that is no longer there would hide everything for no reason Adam can see.
  useEffect(() => {
    if (!cards) return
    const tidy = tidyFilters(filters, { tags, roles, storyIds: stories.map((s) => s.id) })
    if (tidy !== filters) useCodex.setState({ filters: tidy })
  }, [cards, filters, tags, roles, stories])

  // The tab: the view's (Everything, or a kind's page); the dossier keeps whatever was showing under it.
  const view = useApp((s) => s.view)
  const viewTab = tabOfView(view)
  // The stagger runs again for each new tab (gen flips the keyframes' name, which restarts them); the first time the room
  // shows this session the cards come in after its sheet.
  const arriving = useArrival('world-gallery')
  const [gen, setGen] = useState<'a' | 'b' | null>(() => (arriving ? 'a' : null))
  const [leaving, setLeaving] = useState(false)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(leaveTimer.current), [])
  useLayoutEffect(() => {
    if (viewTab === undefined || viewTab === useCodex.getState().filters.kind) return
    setFilters({ kind: viewTab })
    setGen((g) => (keyboardDriven() || reducedMotion() ? null : g === 'a' ? 'b' : 'a'))
  }, [viewTab, setFilters])
  // A tab clicked: the cards fade out, then the new tab's come in one after another. From the keyboard, at once.
  const pick = (kind: EntryKind | null): void => {
    if (kind === filters.kind && viewTab !== undefined) return
    clearTimeout(leaveTimer.current)
    if (keyboardDriven() || reducedMotion() || !cards) {
      setLeaving(false)
      showTab(kind)
      return
    }
    setLeaving(true)
    leaveTimer.current = setTimeout(() => {
      setLeaving(false)
      showTab(kind)
    }, LEAVE_MS)
  }

  const shown = useMemo(() => shownCards(all, filters, sort, GALLERY_KINDS), [all, filters, sort])
  const sections = useMemo(() => gallerySections(shown, sort), [shown, sort])
  const total = shown.length

  // Back in the room: the gallery is where Adam left it, with the card he opened (or the one at the top) where it was,
  // and that card has the keyboard's place back when it took it away with it.
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
      item.querySelector<HTMLElement>('[data-gallery-card]')?.focus({ preventScroll: true })
    }
    useCodex.setState({ scroll: el.scrollTop, anchor: null })
  }, [cards])
  useLayoutEffect(() => {
    const el = scroller.current
    return () => {
      if (el && el.scrollTop > 0 && restored.current && !useCodex.getState().anchor) useCodex.setState({ anchor: firstInView(el) })
    }
  }, [])

  const clear = useCallback(
    (patch: Partial<CodexFilters>) => {
      setFilters(patch)
      find.current?.focus()
    },
    [setFilters]
  )

  // The underline under the chosen tab: one bar the row's width, clipped to the tab (a clip-path transition, no layout).
  const row = useRef<HTMLDivElement>(null)
  const [line, setLine] = useState<{ clip: string; width: number; kind: string; ready: boolean } | null>(null)
  const chosen = filters.kind
  useLayoutEffect(() => {
    const el = row.current
    if (!el) return
    const measure = (): void => {
      const tab = el.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      if (!tab) return setLine(null)
      // The row's width is its tabs' (not its scroll width, which the bar itself would otherwise keep wide).
      const tabs = el.querySelectorAll<HTMLElement>('[role="tab"]')
      const last = tabs[tabs.length - 1]
      const width = last ? last.offsetLeft + last.offsetWidth : el.clientWidth
      setLine((prev) => ({
        clip: tabClip(width, { left: tab.offsetLeft, width: tab.offsetWidth }),
        width,
        kind: chosen ?? 'all',
        ready: !!prev
      }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [chosen, tabs])

  const onTabKey = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const i = Math.max(
      0,
      tabs.findIndex((t) => t.kind === chosen)
    )
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
    pick(tabs[j].kind)
    row.current?.querySelectorAll<HTMLElement>('[role="tab"]')[j]?.focus()
  }

  const name = world?.name.trim() || 'Your world'
  const sub = [
    stories.length === 1 && storyTitle ? `The world of ${storyTitle}` : stories.length > 1 ? `${stories.length} stories` : '',
    worldLine(tabs)
  ]
    .filter(Boolean)
    .join(' · ')
  const extra = filtersOn({ ...filters, query: '', kind: null })
  // The stagger's order: each section's heading with its first card, then its cards, across the sections.
  let order = 0

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
          Couldn’t load the world. {error}
        </Notice>
      </div>
    )
  } else if (cards === null) {
    body = null
  } else if (!all.length) {
    body = (
      <EmptyState
        art="codex"
        icon={<LayoutGrid size={20} />}
        title="Nothing in the world yet"
        className="mt-[6vh] max-w-md"
        actions={
          <>
            <Button variant="primary" icon={<Plus size={15} />} onClick={() => void newEntry('character', onCreated)}>
              Create a character
            </Button>
            <Button
              icon={<Sparkles size={15} />}
              onClick={() =>
                useApp.getState().navigate({ kind: 'builder', entryKind: 'character', entryId: null, start: { mode: 'quick' } })
              }
            >
              Quick start from a few notes
            </Button>
            <Button icon={<WandSparkles size={15} />} onClick={() => openWorldBuilder()}>
              Build from a summary
            </Button>
          </>
        }
      >
        The world holds everything the AI should remember: its characters, places, groups, items, lore, events, plot threads and the words
        you invent. Whatever is here is given to the AI when a scene needs it, so names, looks and rules stay the same from one chapter to
        the next.
      </EmptyState>
    )
  } else if (!total) {
    body = (
      <EmptyState
        // No characters yet (the Characters tab, nothing else asked): the monograms; else the search's lens.
        art={filters.kind === 'character' && !filtersOn({ ...filters, kind: null }) ? 'characters' : 'search'}
        icon={<Search size={20} />}
        title="Nothing matches"
        className="mt-4"
        actions={
          filtersOn({ ...filters, query: '', kind: null }) ? (
            <Button size="sm" onClick={() => clear({ ...NO_FILTERS, kind: filters.kind })}>
              Clear filters
            </Button>
          ) : (
            <Button size="sm" onClick={() => clear({ query: '' })}>
              Clear search
            </Button>
          )
        }
      >
        {nothingMatches(filters).replace('in the codex', 'in the world')}
      </EmptyState>
    )
  } else {
    body = (
      <div className="g-sections">
        {sections.map((s) => {
          const headAt = order
          const id = `g-sec-${s.kind}`
          return (
            <section key={s.kind} aria-labelledby={id} className="g-sec" data-kind={s.kind} data-shape={s.shape}>
              <h2 id={id} className="g-lbl g-in" style={gen ? ({ '--d': `${staggerDelay(headAt)}ms` } as React.CSSProperties) : undefined}>
                <span>{s.label}</span>
                <span className="g-n">{s.cards.length.toLocaleString('en-GB')}</span>
                <span aria-hidden className="g-rule" />
                <span className="g-hint">{s.hint}</span>
              </h2>
              <ul className="g-cards" data-shape={s.shape}>
                {s.cards.map((c) => {
                  const entry = byId.get(c.id) ?? null
                  const parent = entry?.parentId ? byId.get(entry.parentId) : null
                  const delay = gen ? staggerDelay(order++) : null
                  return (
                    <li
                      key={c.id}
                      data-codex-item={c.id}
                      className="g-item g-in"
                      data-shape={s.shape}
                      data-featured={s.featured === c.id || undefined}
                    >
                      <GalleryCard
                        card={c}
                        shape={s.shape}
                        entry={entry}
                        thread={threads.get(c.id) ?? null}
                        inside={parent?.name.trim() ?? ''}
                        featured={s.featured === c.id}
                        delay={delay}
                        opened={openId === c.id}
                        motif={motifs.get(c.id) ?? null}
                        onOpen={onOpen}
                      />
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
        {chosen === null && !filters.query.trim() && !extra ? (
          // An empty slot at the end of everything: a way to add to the world.
          <section className="g-sec g-sec-ghost" aria-label="Add to the world">
            <span aria-hidden className="g-lbl-pad" />
            <M.Root modal={false}>
              <M.Trigger className="g-ghost g-in" style={gen ? ({ '--d': `${staggerDelay(order)}ms` } as React.CSSProperties) : undefined}>
                <span aria-hidden className="g-ghost-ic">
                  <Plus size={18} />
                </span>
                <span className="g-ghost-t">Add to the world</span>
                <span className="g-ghost-d">A person, place, group, piece of lore or anything else</span>
              </M.Trigger>
              <M.Portal>
                <M.Content align="start" sideOffset={6} collisionPadding={8} className={MENU}>
                  <NewEntryItems onPick={(k) => void newEntry(k, onCreated)} />
                </M.Content>
              </M.Portal>
            </M.Root>
          </section>
        ) : null}
      </div>
    )
  }

  return (
    <div data-world-gallery className="desk-gallery flex h-full min-h-0 flex-col">
      <header className="g-head">
        <div className="min-w-0">
          <h1 className="g-title-world">{name}</h1>
          {sub ? (
            // Each part keeps its number with its word when the line wraps.
            <p className="g-sub">
              {sub.split(' · ').map((part, i) => (
                <Fragment key={i}>
                  {i ? ' · ' : ''}
                  <span className="whitespace-nowrap">{part}</span>
                </Fragment>
              ))}
            </p>
          ) : null}
        </div>
        <div className="g-tools">
          <div className="g-find">
            <Search size={15} aria-hidden className="g-find-ic" />
            <input
              ref={find}
              type="search"
              value={filters.query}
              aria-label="Find in the world"
              placeholder="Find in the world"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setFilters({ query: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && filters.query) {
                  e.preventDefault()
                  e.stopPropagation()
                  setFilters({ query: '' })
                }
              }}
            />
            {filters.query ? (
              <button type="button" aria-label="Clear search" className="g-find-clear" onClick={() => clear({ query: '' })}>
                <X size={13} />
              </button>
            ) : null}
          </div>
          <M.Root modal={false}>
            <M.Trigger className="g-new">
              <Plus size={15} aria-hidden />
              <span>New entry</span>
            </M.Trigger>
            <M.Portal>
              <M.Content align="end" sideOffset={6} collisionPadding={8} className={MENU}>
                <M.Label className={LABEL}>Add to the world</M.Label>
                <NewEntryItems onPick={(k) => void newEntry(k, onCreated)} />
              </M.Content>
            </M.Portal>
          </M.Root>
        </div>
      </header>

      {all.length ? (
        <div className="g-tabbar">
          <div ref={row} role="tablist" aria-label="Kinds of entry" className="g-tabs" onKeyDown={onTabKey}>
            {tabs.map((t) => {
              const on = t.kind === chosen
              const Icon = t.kind ? KIND_ICONS[t.kind] : LayoutGrid
              return (
                <button
                  key={t.kind ?? 'all'}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  aria-controls="world-gallery-cards"
                  tabIndex={on ? 0 : -1}
                  data-kind={t.kind ?? 'all'}
                  className={cn('g-tab', on && 'is-on')}
                  onClick={() => pick(t.kind)}
                >
                  <Icon size={15} selected={on} aria-hidden />
                  <span>{t.label}</span>
                  <span className="g-count">{t.count.toLocaleString('en-GB')}</span>
                </button>
              )
            })}
            {line ? (
              <span
                aria-hidden
                className="g-uline"
                data-kind={line.kind}
                data-ready={line.ready || undefined}
                style={{ clipPath: line.clip, width: line.width }}
              />
            ) : null}
          </div>
          <div className="g-order">
            {tags.length || roles.length || storyChoices.length > 1 ? (
              <M.Root modal={false}>
                <M.Trigger className={cn('g-quiet', extra && 'is-on')} aria-label={extra ? `Filters, ${extra} on` : 'Filters'}>
                  <SlidersHorizontal size={15} aria-hidden />
                  <span className="g-filter-k">{extra ? `Filters · ${extra}` : 'Filters'}</span>
                  <ChevronDown size={12} aria-hidden className="text-faint" />
                </M.Trigger>
                <M.Portal>
                  <M.Content
                    align="end"
                    sideOffset={6}
                    collisionPadding={8}
                    className={cn(MENU, 'max-h-[min(460px,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto')}
                  >
                    {tags.length ? (
                      <>
                        <M.Label className={LABEL}>Tag</M.Label>
                        <M.RadioGroup value={filters.tag ?? ''} onValueChange={(v) => setFilters({ tag: v || null })}>
                          {[{ value: '', label: 'Any tag' }, ...tags].map((c) => (
                            <M.RadioItem key={c.value || 'any'} value={c.value} className={ITEM}>
                              <span className="w-4">{(filters.tag ?? '') === c.value ? <Check size={14} /> : null}</span>
                              {c.label}
                            </M.RadioItem>
                          ))}
                        </M.RadioGroup>
                      </>
                    ) : null}
                    {roles.length ? (
                      <>
                        <M.Label className={LABEL}>Role</M.Label>
                        <M.RadioGroup value={filters.role ?? ''} onValueChange={(v) => setFilters({ role: v || null })}>
                          {[{ value: '', label: 'Any role' }, ...roles].map((c) => (
                            <M.RadioItem key={c.value || 'any'} value={c.value} className={ITEM}>
                              <span className="w-4">{(filters.role ?? '') === c.value ? <Check size={14} /> : null}</span>
                              {c.label}
                            </M.RadioItem>
                          ))}
                        </M.RadioGroup>
                      </>
                    ) : null}
                    {storyChoices.length > 1 ? (
                      <>
                        <M.Label className={LABEL}>Story</M.Label>
                        <M.RadioGroup value={filters.storyId ?? ''} onValueChange={(v) => setFilters({ storyId: v || null })}>
                          {[{ value: '', label: 'Every story' }, ...storyChoices].map((c) => (
                            <M.RadioItem key={c.value || 'any'} value={c.value} className={ITEM}>
                              <span className="w-4">{(filters.storyId ?? '') === c.value ? <Check size={14} /> : null}</span>
                              {c.label}
                            </M.RadioItem>
                          ))}
                        </M.RadioGroup>
                      </>
                    ) : null}
                    {extra ? (
                      <>
                        <M.Separator className="my-1 h-px bg-line" />
                        <M.Item className={ITEM} onSelect={() => setFilters({ tag: null, role: null, storyId: null })}>
                          <X size={14} className="text-muted" aria-hidden />
                          Clear filters
                        </M.Item>
                      </>
                    ) : null}
                  </M.Content>
                </M.Portal>
              </M.Root>
            ) : null}
            <M.Root modal={false}>
              <M.Trigger className="g-quiet" aria-label={`Order: ${GALLERY_SORTS.find((s) => s.value === sort)?.label ?? ''}`}>
                <ListOrdered size={15} aria-hidden />
                <span>
                  <span className="g-order-k">Order: </span>
                  <b>{(GALLERY_SORTS.find((s) => s.value === sort)?.label ?? '').toLowerCase()}</b>
                </span>
                <ChevronDown size={12} aria-hidden className="text-faint" />
              </M.Trigger>
              <M.Portal>
                <M.Content align="end" sideOffset={6} collisionPadding={8} className={MENU}>
                  <M.Label className={LABEL}>Order</M.Label>
                  <M.RadioGroup value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
                    {GALLERY_SORTS.map((s) => (
                      <M.RadioItem key={s.value} value={s.value} className={ITEM}>
                        <span className="w-4">{sort === s.value ? <Check size={14} /> : null}</span>
                        {s.label}
                      </M.RadioItem>
                    ))}
                  </M.RadioGroup>
                </M.Content>
              </M.Portal>
            </M.Root>
          </div>
        </div>
      ) : null}

      <div
        ref={scroller}
        id="world-gallery-cards"
        role={all.length ? 'tabpanel' : undefined}
        aria-label={all.length ? (chosen ? KIND_LABELS[chosen].many : 'Everything in the world') : undefined}
        className="g-pane min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]"
        onScroll={(e) => {
          if (restored.current) useCodex.setState({ scroll: e.currentTarget.scrollTop })
        }}
      >
        {error && cards ? (
          <p className="g-error" role="status">
            Couldn’t refresh the world. {error}{' '}
            <button type="button" className="font-medium text-accent underline-offset-2 hover:underline" onClick={retry}>
              Try again
            </button>
          </p>
        ) : null}
        <div className="g-gal" data-gen={gen ?? undefined} data-leaving={leaving || undefined} data-arrive={arriving || undefined}>
          {body}
        </div>
      </div>
    </div>
  )
}
