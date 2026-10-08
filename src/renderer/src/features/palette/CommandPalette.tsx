// Search and the command palette (Ctrl+K, ⌘K on a Mac). One box finds the world's actions and
// entries, then everything else: scenes, summaries, notes, chapters and stories, the style guide.
// With nothing typed it offers the places Adam was lately and the actions he is most likely to want.
//
// The list never jumps: what it shows (actions and results) is always for one query, swapped in
// whole when that query's results are back (a few milliseconds); the box itself never waits.

import * as D from '@radix-ui/react-dialog'
import {
  AlignLeft,
  ArrowRight,
  BookOpen,
  CalendarRange,
  Check,
  ChevronDown,
  Coffee,
  Feather,
  FilePlus2,
  FileText,
  Folder,
  FolderPlus,
  Globe2,
  HardDriveDownload,
  History,
  Keyboard,
  LayoutGrid,
  Monitor,
  Moon,
  Network,
  Palette,
  PanelLeft,
  PanelRight,
  PenLine,
  Plus,
  RotateCcw,
  Search as SearchIcon,
  Settings,
  Sparkles,
  Spool,
  Square,
  StickyNote,
  Sun,
  Trash2,
  WandSparkles,
  type IconType
} from '@/components/ui/icons'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SearchGroupId, SearchHit, SearchResults, TextPart } from '@shared/contracts/search'
import { Kbd, Spinner } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { flushAll } from '@/lib/flush'
import { OPEN_DIALOG, OPEN_MENU } from '@/lib/layers'
import { isShortcut, shortcutKeys } from '@/lib/shortcuts'
import { useApp } from '@/lib/store'
import { useOutlineStore } from '@/features/binder/outlineStore'
import { useDelayed } from '@/features/generate/parts'
import { KIND_ICONS, KIND_INK } from '@/features/world/kindIcons'
import { useNewLook } from '@/features/look/look'
import { openResult, runAction } from './actions'
import {
  entryAction,
  goesAway,
  hasWords,
  isOption,
  matchActions,
  paletteRows,
  stepIndex,
  suggestedActions,
  type ActionContext,
  type ActionDef,
  type ActionId,
  type Option,
  type Row
} from './paletteLogic'
import { giveFocusBack, openPalette, PALETTE_LAYER, usePalette } from './paletteStore'
import { followRecent, recentPlaces } from './recent'
import { useReading } from '@/features/readAloud/control'
import { canBuildMemory, useImport } from '@/features/importing/importStore'
import { useFocusMode } from '@/features/look/focusMode'

/** How many recent places show with nothing typed. */
const RECENT = 5
/** How far Page Up and Page Down move. */
const PAGE = 8
/** The keys that move through the list, and how far. */
const MOVES = new Map([
  ['ArrowDown', 1],
  ['ArrowUp', -1],
  ['PageDown', PAGE],
  ['PageUp', -PAGE]
])

const NONE: ReadonlySet<string> = new Set()

/** What the list shows: one query's actions and results, together. */
interface Shown {
  query: string
  results: SearchResults | null
  /** The groups opened up with "Show more" for these results. */
  expanded: ReadonlySet<string>
  failed: boolean
}

const EMPTY: Shown = { query: '', results: null, expanded: NONE, failed: false }
const TOP = { key: null, index: 0 }

/** The search groups opened up, as one comparable value (actions open up without a search). */
const searchedGroups = (expanded: ReadonlySet<string>): string =>
  [...expanded]
    .filter((g) => g !== 'actions')
    .sort()
    .join('|')

// ---------- Icons ----------

const ACTION_ICONS: Partial<Record<ActionId, IconType>> = {
  generate: Sparkles,
  stop: Square,
  'mark-done': Check,
  'reopen-scene': RotateCcw,
  'new-scene': FilePlus2,
  'new-chapter': FolderPlus,
  'new-story': BookOpen,
  'delete-scene': Trash2,
  'go-write': PenLine,
  'go-codex': LayoutGrid,
  'go-timeline': CalendarRange,
  'go-map': Network,
  'go-threads': Spool,
  'go-style': Palette,
  'go-memory': History,
  'go-story': BookOpen,
  'quick-character': WandSparkles,
  'theme-light': Sun,
  'theme-dark': Moon,
  'theme-sepia': Coffee,
  'theme-system': Monitor,
  'toggle-binder': PanelLeft,
  'toggle-panel': PanelRight,
  'backup-now': HardDriveDownload,
  'new-world': Globe2,
  'switch-world': Globe2,
  'rename-world': PenLine,
  shortcuts: Keyboard
}

function actionIcon(a: ActionDef): IconType {
  const entry = entryAction(a.id)
  if (entry) return entry.verb === 'new' ? Plus : KIND_ICONS[entry.kind]
  if (a.id.startsWith('settings-')) return Settings
  return ACTION_ICONS[a.id] ?? ArrowRight
}

/** A result's icon: what it is, from the start of its key ('summary:…', 'chapter:…'), or its kind of entry. */
function hitIcon(hit: SearchHit): IconType {
  switch (hit.key.split(':')[0]) {
    case 'summary':
      return AlignLeft
    case 'note':
      return StickyNote
    case 'chapter':
      return Folder
    case 'story':
      return BookOpen
    case 'style':
      return Feather
  }
  return hit.open.kind === 'entry' ? KIND_ICONS[hit.open.entryKind] : FileText
}

// ---------- Parts ----------

/** Text with the matched words highlighted. */
function Marked({ parts }: { parts: TextPart[] }): React.JSX.Element {
  return (
    <>
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-[3px] bg-accent-soft px-px text-fg">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </>
  )
}

function Keys({ keys }: { keys: string[] }): React.JSX.Element {
  return (
    <span className="flex shrink-0 items-center gap-0.5" aria-hidden>
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
    </span>
  )
}

const domId = (prefix: string, key: string): string => `${prefix}-${key.replace(/[^\w-]/g, '_')}`

interface OptionRowProps {
  row: Option
  active: boolean
  onPoint: () => void
  onChoose: () => void
}

function OptionRow({ row, active, onPoint, onChoose }: OptionRowProps): React.JSX.Element {
  const isNew = useNewLook()
  const base = cn('flex cursor-default select-none gap-3 rounded-lg px-3', active && 'bg-surface-2')
  const props = {
    id: domId('palette-option', row.key),
    role: 'option' as const,
    'aria-selected': active,
    // Moving the pointer onto a row makes it the one Enter opens. Only moving counts (not a row
    // scrolling under a still pointer), so the keyboard's choice isn't taken away.
    onMouseMove: active ? undefined : onPoint,
    // Clicking leaves the caret in the box.
    onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
    onClick: onChoose
  }

  if (row.type === 'action') {
    const Icon = actionIcon(row.action)
    return (
      <div {...props} className={cn(base, 'h-9 items-center')}>
        <Icon size={15} className={cn('shrink-0', active ? 'text-fg' : 'text-muted')} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[13.5px] text-fg">{row.action.label}</span>
        {row.action.shortcut ? <Keys keys={shortcutKeys(row.action.shortcut)} /> : null}
      </div>
    )
  }

  if (row.type === 'more') {
    const all = `${row.total.toLocaleString('en-GB')} in all`
    return (
      <div {...props} aria-label={`${row.label}, ${all}`} className={cn(base, 'h-8 items-center text-[12.5px] text-muted')}>
        <ChevronDown size={14} className="shrink-0" aria-hidden />
        <span className="flex-1">{row.label}</span>
        <span className="tabular-nums text-faint">{all}</span>
      </div>
    )
  }

  const { hit } = row
  const Icon = hitIcon(hit)
  // The New look: a world entry's icon sits on a tile in its kind's ink.
  const kind = isNew && hit.open.kind === 'entry' ? hit.open.entryKind : null
  return (
    <div {...props} className={cn(base, 'items-start py-2')}>
      {kind ? (
        <span className={cn('grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[6px]', KIND_INK[kind].tile)} aria-hidden>
          <Icon size={14} />
        </span>
      ) : (
        <Icon size={15} className={cn('mt-[3px] shrink-0', active ? 'text-fg' : 'text-muted')} aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 truncate text-[13.5px] font-medium text-fg">
            <Marked parts={hit.title} />
          </span>
          {hit.detail ? <span className="ml-auto max-w-[55%] shrink-0 truncate pl-2 text-[12px] text-faint">{hit.detail}</span> : null}
        </div>
        {hit.snippet.length ? (
          <p
            className={cn(
              'mt-0.5 line-clamp-2 text-muted',
              hit.prose ? 'font-serif text-[13px] leading-[1.5]' : 'text-[12.5px] leading-[1.45]'
            )}
          >
            <Marked parts={hit.snippet} />
          </p>
        ) : null}
      </div>
    </div>
  )
}

type Heading = Extract<Row, { type: 'heading' }>

/** The rows under their headings, for the list's groups. */
function sections(rows: Row[]): { heading: Heading | null; rows: Row[] }[] {
  const out: { heading: Heading | null; rows: Row[] }[] = []
  for (const r of rows) {
    if (r.type === 'heading') out.push({ heading: r, rows: [] })
    else if (out.length) out[out.length - 1].rows.push(r)
    else out.push({ heading: null, rows: [r] })
  }
  return out
}

// ---------- The palette ----------

/** Where Adam is, for the actions that make sense now. */
function useActionContext(): ActionContext {
  const view = useApp((s) => s.view.kind)
  const storyId = useApp((s) => s.storyId)
  const sceneId = useApp((s) => s.sceneId)
  const drafting = useApp((s) => s.activeGeneration !== null)
  const theme = useApp((s) => s.settings?.theme ?? 'system')
  const sceneDone = useOutlineStore((s) => !!sceneId && s.outline?.scenes.find((x) => x.id === sceneId)?.status === 'done')
  const readAloud = useApp((s) => !!s.settings?.speech.readAloud)
  const reading = useReading((s) => s.reading)
  const speakers = useApp((s) => !!s.settings?.speech.showSpeakers)
  const spellCheck = useApp((s) => s.settings?.editor.spellCheck !== false)
  const unreadStory = useImport((s) => canBuildMemory(s.catchUp, storyId))
  const focus = useFocusMode((s) => s.on)
  const soundEffects = useApp((s) => !!s.settings?.speech.readAloud && !!s.settings?.speech.soundEffects)
  return useMemo(
    () => ({ view, storyId, sceneId, sceneDone, drafting, theme, readAloud, reading, speakers, unreadStory, focus, spellCheck, soundEffects }),
    [view, storyId, sceneId, sceneDone, drafting, theme, readAloud, reading, speakers, unreadStory, focus, spellCheck, soundEffects]
  )
}

/** Ctrl+K (⌘K) from anywhere, even the page: caught on the way down, before the editor sees it. */
function useOpenShortcut(input: React.RefObject<HTMLInputElement | null>): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!isShortcut(e, 'search')) return
      e.preventDefault()
      e.stopPropagation()
      if (usePalette.getState().open) {
        // Pressed again: the box's text is selected, ready to type over.
        input.current?.select()
        return
      }
      // Not over another dialog or an open menu (Esc closes that first), nor while a backup is being restored.
      const covered = document.querySelector(`${OPEN_DIALOG}:not([${PALETTE_LAYER}]), ${OPEN_MENU}`)
      if (useApp.getState().restoring || covered) return
      openPalette()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [input])
}

export function CommandPalette(): React.JSX.Element {
  const open = usePalette((s) => s.open)
  const worldId = useApp((s) => s.world?.id ?? null)
  const storyId = useApp((s) => s.storyId)
  const ctx = useActionContext()

  const [text, setText] = useState('')
  // The groups Adam asked to see more of, for what is in the box now.
  const [want, setWant] = useState<ReadonlySet<string>>(NONE)
  const wantRef = useRef(want)
  wantRef.current = want
  const [shown, setShown] = useState<Shown>(EMPTY)
  const shownRef = useRef(shown)
  shownRef.current = shown
  const [recent, setRecent] = useState<SearchHit[] | null>(null)
  // The highlighted row: by key, and by position for when that row goes (the next one takes its place).
  const [active, setActive] = useState<{ key: string | null; index: number }>(TOP)
  const tickets = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // What was chosen: run once the palette has closed and focus is back where it belongs.
  const pending = useRef<{ run: () => Promise<void>; away: boolean } | null>(null)
  // Words typed a moment ago are saved first, so search finds them too.
  const saved = useRef<Promise<void>>(Promise.resolve())
  // Keys pressed while the list is still the one for what was in the box before (its search is a few
  // milliseconds away, or longer while a world's words are first read): they wait for the new list.
  const early = useRef<{ moves: number[]; enter: boolean }>({ moves: [], enter: false })

  useOpenShortcut(inputRef)
  useEffect(() => followRecent(), [])

  // Builds the search a moment after the world opens, so the first search is instant too. Whatever
  // was open over the last world (the palette, the shortcuts list) is closed.
  useEffect(() => {
    usePalette.setState({ open: false, shortcuts: false })
    if (!worldId) return
    const t = setTimeout(() => void api.prepareSearch().catch(() => undefined), 1500)
    return () => clearTimeout(t)
  }, [worldId])

  // Closed, it forgets the last search: each time it opens, the box is empty. Open, it saves what
  // is waiting to be saved and fetches the recent places (other than where Adam is now).
  useEffect(() => {
    if (!open) {
      tickets.current++
      early.current = { moves: [], enter: false }
      setText('')
      setWant(NONE)
      setShown(EMPTY)
      setActive(TOP)
      setRecent(null)
      return
    }
    saved.current = flushAll()
    const a = useApp.getState()
    const here = new Set([a.sceneId, a.view.kind === 'entries' ? a.view.entryId : null])
    const places = worldId ? recentPlaces(worldId).filter((p) => !here.has(p.id)) : []
    if (!places.length) {
      setRecent([])
      return
    }
    let live = true
    api.searchPlaces(places).then(
      (hits) => live && setRecent(hits.slice(0, RECENT)),
      () => live && setRecent([])
    )
    return () => {
      live = false
    }
  }, [open, worldId])

  // Searches as Adam types. Only the latest answer is shown; until it comes, the last one stays.
  const searchExpand = searchedGroups(want)
  useEffect(() => {
    if (!open) return
    const ticket = ++tickets.current
    if (!hasWords(text)) {
      setShown({ ...EMPTY, query: text })
      setActive(TOP)
      return
    }
    const expand = (searchExpand ? searchExpand.split('|') : []) as SearchGroupId[]
    const show = (results: SearchResults | null): void => {
      if (ticket !== tickets.current) return
      // A new query starts at the top; more of the same query keeps the highlighted row.
      if (shownRef.current.query !== text) setActive(TOP)
      setShown({ query: text, results, expanded: wantRef.current, failed: !results })
    }
    saved.current.then(() => api.search(text, { expand, storyId: storyId ?? undefined })).then(show, () => show(null))
  }, [open, text, searchExpand, storyId])

  const actions = useMemo(() => matchActions(shown.query, ctx), [shown.query, ctx])
  const suggested = useMemo(() => suggestedActions(ctx), [ctx])
  const rows = useMemo(
    () => paletteRows({ query: shown.query, actions, results: shown.results, recent: recent ?? [], suggested, expanded: shown.expanded }),
    [shown, actions, recent, suggested]
  )
  const options = useMemo(() => rows.filter(isOption), [rows])
  const optionIndex = useMemo(() => new Map(options.map((o, i) => [o.key, i])), [options])
  // With nothing typed, the list waits a moment for the recent places, so they don't push the suggestions down.
  const ready = hasWords(shown.query) || recent !== null
  const found = active.key === null ? -1 : (optionIndex.get(active.key) ?? -1)
  const activeIndex = options.length ? (found >= 0 ? found : Math.min(active.index, options.length - 1)) : -1
  const activeOption = activeIndex >= 0 ? options[activeIndex] : null

  const waiting = open && (!ready || (hasWords(text) && (text !== shown.query || searchExpand !== searchedGroups(shown.expanded))))
  const slow = useDelayed(waiting, 250)

  // The highlighted row stays in view (the first one with its heading).
  useLayoutEffect(() => {
    if (!activeOption) return
    if (activeIndex === 0) listRef.current?.scrollTo({ top: 0 })
    else document.getElementById(domId('palette-option', activeOption.key))?.scrollIntoView({ block: 'nearest' })
  }, [activeOption, activeIndex])

  const point = (o: Option, i: number): void => setActive({ key: o.key, index: i })

  const move = (by: number): void => {
    const next = stepIndex(activeIndex, by, options.length)
    if (next >= 0) point(options[next], next)
  }

  const runPending = (): void => {
    const p = pending.current
    pending.current = null
    if (p) void p.run()
  }

  const choose = (o: Option): void => {
    if (o.type === 'more') {
      const next = new Set(want).add(o.group)
      setWant(next)
      wantRef.current = next
      // More actions need no search: they show at once, in place of the "Show more" row.
      if (o.group === 'actions') setShown((s) => ({ ...s, expanded: new Set(s.expanded).add('actions') }))
      return
    }
    pending.current =
      o.type === 'action'
        ? { run: () => runAction(o.action.id), away: goesAway(o.action, ctx) }
        : { run: () => openResult(o.hit.open), away: true }
    usePalette.setState({ open: false })
    // Runs even if the closing focus step never comes (it always should).
    setTimeout(runPending, 100)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    // The box's own keys (moving through the list and opening a row), not the app's shortcuts.
    let by = 0
    switch (e.key) {
      case 'Tab':
        // The box is the one place to type in; Tab doesn't wander off into the list.
        e.preventDefault()
        return
      case 'Enter':
        if (e.nativeEvent.isComposing) return
        break
      default:
        by = MOVES.get(e.key) ?? 0
        if (!by) return
    }
    e.preventDefault()
    // The keys always act on the list for what is in the box: until its results are in, they wait.
    if (e.currentTarget.value !== shown.query) {
      if (by) early.current.moves.push(by)
      else early.current.enter = true
    } else if (!ready) {
      // Nothing is listed yet to move through or open.
    } else if (by) move(by)
    else if (activeOption) choose(activeOption)
  }

  // The list for what is in the box is in: keys pressed while it was coming act on it now, as if
  // pressed just after it (a new list starts at its first row).
  useEffect(() => {
    const keys = early.current
    if (shown.query !== text || (!keys.enter && !keys.moves.length)) return
    early.current = { moves: [], enter: false }
    if (!ready) return
    let i = options.length ? 0 : -1
    for (const by of keys.moves) i = stepIndex(i, by, options.length)
    if (i < 0) return
    point(options[i], i)
    if (keys.enter) choose(options[i])
  }, [shown])

  const renderRow = (r: Row): React.ReactNode => {
    if (r.type === 'heading') return null
    if (r.type === 'note') {
      return (
        <p key={r.key} className="px-3 py-1.5 text-[12px] text-faint">
          {r.text}
        </p>
      )
    }
    const i = optionIndex.get(r.key) ?? -1
    return <OptionRow key={r.key} row={r} active={i === activeIndex} onPoint={() => point(r, i)} onChoose={() => choose(r)} />
  }

  const nothing = ready && hasWords(shown.query) && !shown.failed && rows.length === 0

  return (
    <D.Root open={open} onOpenChange={(o) => usePalette.setState({ open: o })}>
      <D.Portal>
        {/* The New look: the palette is a raised pane with a hint of blur behind it (only it: small, so it costs little).
            It appears and goes at once, dim and all: it is opened from the keyboard all day. */}
        <D.Overlay className="fixed inset-0 z-40 bg-overlay data-[state=open]:animate-fade-in look-new:data-[state=open]:animate-none" />
        <D.Content
          {...{ [PALETTE_LAYER]: '' }}
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            inputRef.current?.focus()
          }}
          onCloseAutoFocus={(e) => {
            // Focus goes back where Adam was (usually the page), and only then does the chosen action
            // run, so an action that moves focus itself (a new scene puts the caret in it) has the last word.
            e.preventDefault()
            if (!pending.current?.away) giveFocusBack()
            runPending()
          }}
          // Keys pressed here stay here: the app's shortcuts underneath (Ctrl+G, Ctrl+Enter...) wait until it closes.
          onKeyDown={(e) => e.stopPropagation()}
          className="fixed left-1/2 top-[12vh] z-50 flex w-[640px] max-w-[calc(100vw-32px)] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-pop focus:outline-none data-[state=open]:animate-pop-in look-new:rounded-2xl look-new:border-transparent look-new:bg-raise/90 look-new:backdrop-blur-md look-new:shadow-[var(--elev-3),0_0_0_1px_var(--line)] look-new:data-[state=open]:animate-none"
        >
          <D.Title className="sr-only">Search</D.Title>
          <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
            <SearchIcon size={16} className="shrink-0 text-muted" aria-hidden />
            <input
              ref={inputRef}
              role="combobox"
              aria-label="Search, or find an action"
              aria-expanded
              aria-controls="palette-list"
              aria-autocomplete="list"
              aria-activedescendant={activeOption ? domId('palette-option', activeOption.key) : undefined}
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                setWant(NONE)
                wantRef.current = NONE
                // Keys still waiting were meant for the words before these.
                early.current = { moves: [], enter: false }
              }}
              onKeyDown={onKeyDown}
              placeholder="Search your story and world, or type an action…"
              spellCheck={false}
              autoComplete="off"
              className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-faint"
            />
            <span className="flex w-4 shrink-0 justify-center text-faint">{slow ? <Spinner size={14} /> : null}</span>
          </div>

          {/* A fixed height, so the palette doesn't grow and shrink as the results change. */}
          <div
            ref={listRef}
            id="palette-list"
            role="listbox"
            aria-label="Results"
            className="h-[min(440px,58vh)] overflow-y-auto overscroll-contain p-1.5"
          >
            {ready
              ? sections(rows).map((s, i) =>
                  s.heading ? (
                    <div key={s.heading.key} role="group" aria-labelledby={domId('palette', s.heading.key)} className="pb-1">
                      <div
                        id={domId('palette', s.heading.key)}
                        className="px-3 pb-1 pt-2.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint"
                      >
                        {s.heading.label}
                      </div>
                      {s.rows.map(renderRow)}
                    </div>
                  ) : (
                    <div key={i}>{s.rows.map(renderRow)}</div>
                  )
                )
              : null}
            {nothing ? (
              <div className="flex h-full flex-col items-center justify-center px-8 text-center">
                <p className="text-[14px] font-medium text-fg">Nothing matches “{shown.query.trim()}”</p>
                <p className="mt-1 text-[13px] text-muted">Check the spelling, or try fewer words.</p>
              </div>
            ) : null}
            {shown.failed && hasWords(shown.query) ? (
              <p className="px-3 py-3 text-[13px] text-muted">Search isn’t working right now. Close this and try again in a moment.</p>
            ) : null}
          </div>

          <div className="flex h-9 shrink-0 items-center gap-4 border-t border-line px-4 text-[12px] text-faint" aria-hidden>
            <span className="flex items-center gap-1.5">
              <Keys keys={['↑', '↓']} /> to move
            </span>
            <span className="flex items-center gap-1.5">
              <Keys keys={['Enter']} /> to open
            </span>
            <span className="flex items-center gap-1.5">
              <Keys keys={['Esc']} /> to close
            </span>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
