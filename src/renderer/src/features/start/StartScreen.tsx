// The start screen (spec, "Visual design and UX › Start screen"): where Adam left off (Continue), every world
// with its stories, ways to start something new, and the worlds he deleted lately. It shows when AI Write opens
// (unless he chose "Where I left off" in Settings › Appearance), whenever no world is open, and from the Home
// button, the world menu and the palette. It lies over the workspace, which stays as it was underneath, so a
// draft keeps writing and Continue is instant. App.tsx decides when it shows (useApp.home).

import * as M from '@radix-ui/react-dropdown-menu'
import { ArrowRight, BookPlus, ChevronRight, CookingPot, LibraryBig, PenLine, Plus, Search, Settings as SettingsIcon, WandSparkles, type IconType } from '@/components/ui/icons'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { LastPlace, LibraryWorld } from '@shared/contracts/library'
import { Button, Card, Field, IconButton, Input, Kbd, Notice, toast } from '@/components/ui'
import { flushBeforeWorldChange } from '@/lib/flush'
import { isShortcut } from '@/lib/shortcuts'
import { useApp } from '@/lib/store'
import { cn } from '@/lib/cn'
import { Harbour } from '@/components/art/Harbour'
import { useNewLook } from '@/features/look/look'
import { useOutlineStore } from '@/features/binder/outlineStore'
import { createWorldAndBuild } from '@/features/worldBuilder/open'
import { openSampleWorld } from '@/features/setup/setupStore'
import { NewWorldDialog } from '@/features/welcome/NewWorldDialog'
import { WELCOME_ACTIONS, type WelcomeAction } from '@/features/welcome/welcomeActions'
import { DeleteWorldDialog, RecentlyDeletedWorlds } from './DeletedWorlds'
import { loadLibrary, useLibrary } from './libraryStore'
import { MissingLibrary } from './MissingLibrary'
import { DriftingTexture, InkMark, rise, useOpening } from './Opening'
import { continueWriting, newStoryIn } from './startActions'
import { continueText, filterWorlds, orderWorlds, SEARCH_FROM } from './startLogic'
import { WorldCard } from './WorldCard'
import { listenForRecipes, useRecipes } from '@/features/recipes/recipeStore'
import { recipeName } from '@/features/recipes/recipeLogic'

/** Whether a key or the pointer has been pressed since the window opened. */
let pressed = false
for (const kind of ['keydown', 'pointerdown'] as const) window.addEventListener(kind, () => (pressed = true), { capture: true, once: true })

/**
 * Puts the keyboard on an element of the start screen unless something on it has it already, now and once more on
 * the next frame: a menu that opened the start screen (the world menu, the palette) may still hold the keyboard as
 * it closes. Returns the clean-up. At launch, before anything has been pressed, it shows no focus ring (the browser
 * would draw one, as nothing says the pointer is in use); the first key shows it as usual. Later the browser decides,
 * as everywhere: a ring when the start screen was opened from the keyboard, none from a click.
 */
function takeKeyboard(el: () => HTMLElement | null): () => void {
  const take = (): void => {
    const target = el()
    const screen = target?.closest('.start-screen')
    const active = document.activeElement
    if (!target || (active && active !== screen && screen?.contains(active))) return
    // (focusVisible isn't in TypeScript's own list yet; Chromium has it.)
    target.focus({ preventScroll: true, ...(pressed ? {} : { focusVisible: false }) } as FocusOptions)
  }
  take()
  const frame = requestAnimationFrame(take)
  return () => cancelAnimationFrame(frame)
}

const sectionTitle = 'text-[11.5px] font-semibold uppercase tracking-wide text-faint'

/** Layers over the start screen where keys belong (dialogs, menus, the palette, toasts, lists to pick from). */
const LAYERS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper], [aria-live]'

/**
 * While the start screen shows, keys never reach the workspace underneath (Ctrl+Z in the hidden page, Generate, Esc
 * stopping a draft, F11...), even when nothing on the start screen has the keyboard (a dialog or a row it was in has
 * just gone, an Undo was clicked). Caught on the way down: a key aimed outside the start screen and its layers stops
 * there and the start screen takes the keyboard. Ctrl+K (the palette) and Ctrl+, (Settings) still work. And when
 * the keyboard falls to the page itself, the start screen takes it back.
 */
function useKeysStayHere(root: React.RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const take = (): void => root.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target instanceof Element ? e.target : null
      if (target && (root.current?.contains(target) || target.closest(LAYERS))) return
      if (isShortcut(e, 'search') || isShortcut(e, 'settings')) return
      e.stopImmediatePropagation()
      take()
    }
    let pending = 0
    const onFocusOut = (): void => {
      cancelAnimationFrame(pending)
      pending = requestAnimationFrame(() => {
        const active = document.activeElement
        if (!active || active === document.body) take()
      })
    }
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('focusout', onFocusOut)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('focusout', onFocusOut)
      cancelAnimationFrame(pending)
    }
  }, [root])
}

export function StartScreen(): React.JSX.Element {
  const { phase, paused } = useOpening()
  // Coming back later in a run, the screen simply fades in (the opening plays once).
  const [later] = useState(phase === 'done')
  const overview = useLibrary((s) => s.overview)
  const error = useLibrary((s) => s.error)
  const world = useApp((s) => s.world)
  const navigate = useApp((s) => s.navigate)
  const root = useRef<HTMLDivElement>(null)
  const [deleting, setDeleting] = useState<LibraryWorld | null>(null)
  const [newWorldOpen, setNewWorldOpen] = useState(false)
  const busy = useLibrary((s) => s.busy)
  const isNew = useNewLook()
  useKeysStayHere(root)

  // Read afresh each time it shows; the last list stays meanwhile. The keyboard starts on Continue (see
  // ContinueCard) or, with nothing else holding it, here, so keys never reach the workspace underneath.
  useEffect(() => {
    void loadLibrary()
    return takeKeyboard(() => root.current)
  }, [])

  const place = useContinuePlace()
  // With a world open, Continue (and what's around it) shows at once; with none, the screen waits for the library
  // rather than showing one thing and then another.
  const ready = !!overview || !!world || !!error
  const reachable = overview?.reachable ?? true
  const worlds = overview?.worlds ?? null
  const empty = !!worlds && worlds.length === 0

  return (
    <div
      ref={root}
      tabIndex={-1}
      data-opening={phase}
      data-paused={paused || undefined}
      aria-busy={busy || undefined}
      // Keys pressed here stay here: the workspace underneath (a draft's shortcuts, focus mode) never sees them.
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === ',') {
          e.preventDefault()
          navigate({ kind: 'settings', tab: 'models' })
        }
        e.stopPropagation()
      }}
      className={cn('start-screen absolute inset-0 z-10 bg-bg outline-none', later && 'animate-fade-in', busy && 'cursor-progress')}
    >
      <DriftingTexture />
      <div className="absolute inset-0 overflow-y-auto [scrollbar-gutter:stable_both-edges]">
        <div className="relative mx-auto w-full max-w-[800px] px-8 pb-20 pt-[9vh]">
          {/* The New look: the harbour at dusk above it all, its lighthouse beam sweeping slowly (components/art/Harbour). */}
          {isNew ? <Harbour className="start-rise -mx-2 mb-6 h-[clamp(150px,23vh,208px)] rounded-card" style={rise(0)} /> : null}
          <header className="mb-8 flex items-center gap-3.5">
            <InkMark />
            <div className="min-w-0 flex-1">
              <h1 className="font-serif text-[26px] font-semibold leading-tight text-fg">AI Write</h1>
              <p className="text-[13px] text-muted">Long stories that stay consistent.</p>
            </div>
            <IconButton label="Settings" title="Settings" onClick={() => navigate({ kind: 'settings', tab: 'models' })}>
              <SettingsIcon size={17} />
            </IconButton>
          </header>

          {!reachable ? (
            <div className="start-rise" style={rise(0)}>
              <MissingLibrary path={overview?.libraryPath ?? ''} />
            </div>
          ) : !ready ? (
            // A moment while the library is read: nothing yet, rather than a flash.
            <div aria-hidden className="h-[320px]" />
          ) : (
            <>
              {place ? <ContinueCard place={place} /> : null}
              {empty ? (
                <CreateWorldCard />
              ) : (
                <StartNew worlds={worlds} order={place ? 1 : 0} onNewWorld={() => setNewWorldOpen(true)} />
              )}
              {error ? (
                <div className="mt-8">
                  <Notice
                    tone="danger"
                    action={
                      <Button size="sm" onClick={() => void loadLibrary()}>
                        Try again
                      </Button>
                    }
                  >
                    {error}
                  </Notice>
                </div>
              ) : null}
              {worlds && worlds.length ? <WorldList worlds={worlds} openId={world?.id ?? null} onDelete={setDeleting} /> : null}
              {overview ? <RecentlyDeletedWorlds deleted={overview.deleted} style={rise(Math.min(8, (worlds?.length ?? 0) + 3))} /> : null}
            </>
          )}
        </div>
      </div>
      <DeleteWorldDialog world={deleting} onClose={() => setDeleting(null)} />
      <NewWorldDialog open={newWorldOpen} onOpenChange={setNewWorldOpen} />
    </div>
  )
}

/**
 * Where Continue goes. With a world open, that is where Adam left off: its place from the store, always current
 * (a library read earlier may name another world, or a scene he has since left), with the library's time and
 * scene title when it is about the same world. With none open, where the library says.
 */
function useContinuePlace(): LastPlace | null {
  const last = useLibrary((s) => s.overview?.last)
  const world = useApp((s) => s.world)
  const storyId = useApp((s) => s.storyId)
  const sceneId = useApp((s) => s.sceneId)
  const storyTitle = useApp((s) => s.stories.find((x) => x.id === s.storyId)?.title ?? '')
  const sceneTitle = useOutlineStore((s) => s.outline?.scenes.find((x) => x.id === sceneId)?.title ?? '')
  if (!world) return last ?? null
  const same = last?.worldId === world.id ? last : null
  return {
    worldId: world.id,
    worldName: world.name,
    storyId,
    storyTitle,
    sceneId,
    sceneTitle: sceneTitle || (same && same.sceneId === sceneId ? same.sceneTitle : ''),
    at: same?.at ?? ''
  }
}

/** Continue: one click (or Enter, as it has the keyboard first) goes straight back where Adam left off. */
function ContinueCard({ place }: { place: LastPlace }): React.JSX.Element {
  const button = useRef<HTMLButtonElement>(null)
  const [busy, setBusy] = useState(false)
  // Something else on the start screen is opening a world: Continue waits for it.
  const othersBusy = useLibrary((s) => s.busy)
  const { title, where } = continueText(place)

  // The keyboard starts here, so Enter continues.
  useEffect(() => takeKeyboard(() => button.current), [])

  return (
    <button
      ref={button}
      type="button"
      aria-label={`Continue: ${title}${where ? `, ${where}` : ''}`}
      disabled={busy}
      aria-disabled={othersBusy || undefined}
      onClick={() => {
        if (othersBusy) return
        setBusy(true)
        void continueWriting(place).finally(() => setBusy(false))
      }}
      style={rise(0)}
      className={cn(
        'start-rise group flex w-full items-center gap-4 rounded-xl border border-line bg-surface px-5 py-4 text-left shadow-soft outline-none',
        'transition-[border-color,background-color] duration-150 hover:border-line-strong hover:bg-page focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30'
      )}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
        <PenLine size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block h-[18px] text-[11.5px] font-semibold uppercase leading-[18px] tracking-wide text-accent">Continue where you left off</span>
        <span className="block h-[26px] truncate font-serif text-[18px] font-semibold leading-[26px] text-fg">{title}</span>
        <span className="block h-[18px] truncate text-[12.5px] leading-[18px] text-muted">{where}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-faint opacity-0 transition-opacity duration-150 group-focus-visible:opacity-100" aria-hidden>
        <Kbd>Enter</Kbd>
      </span>
      <ArrowRight size={18} className="shrink-0 text-muted transition-colors duration-150 group-hover:text-accent group-focus-visible:text-accent" />
    </button>
  )
}

/** One way to start something new, as a tile: its icon, its words, and a few words under them. */
function Tile({
  icon: Icon,
  label,
  hint,
  onClick,
  busy,
  disabled,
  ...rest
}: {
  icon: IconType
  label: string
  hint: string
  onClick?: () => void
  busy?: boolean
  disabled?: boolean
} & React.ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element {
  const hintId = useId()
  return (
    <button
      type="button"
      aria-label={label}
      aria-describedby={hintId}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={onClick}
      {...rest}
      className={cn(
        'flex min-w-0 items-start gap-3 rounded-lg border border-line bg-surface px-3.5 py-3 text-left outline-none',
        'transition-[border-color,background-color] duration-150 hover:border-line-strong hover:bg-page focus-visible:ring-2 focus-visible:ring-accent/40',
        'disabled:pointer-events-none disabled:opacity-60 data-[state=open]:border-line-strong data-[state=open]:bg-page'
      )}
    >
      <span className="mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted">
        <Icon size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium leading-[20px] text-fg">{label}</span>
        <span id={hintId} className="line-clamp-2 block text-[12px] leading-[17px] text-muted">
          {hint}
        </span>
      </span>
    </button>
  )
}

/** The other ways to start (the sample world, and WELCOME_ACTIONS: importing a manuscript or a world file). */
function OtherWays({ busy, setBusy }: { busy: string | null; setBusy: (id: string | null) => void }): React.JSX.Element {
  const worldBusy = useLibrary((s) => s.busy)
  const run = async (a: WelcomeAction): Promise<void> => {
    setBusy(a.id)
    try {
      await a.run()
    } catch (e) {
      toast((e as Error).message, { tone: 'danger' })
    } finally {
      setBusy(null)
    }
  }
  return (
    <>
      <Tile
        icon={LibraryBig}
        label="Explore the sample world"
        hint="A short finished story with its characters, places and memory filled in"
        busy={busy === 'sample'}
        disabled={!!busy || worldBusy}
        onClick={() => {
          setBusy('sample')
          void openSampleWorld().finally(() => setBusy(null))
        }}
      />
      {WELCOME_ACTIONS.map((a) => (
        <Tile key={a.id} icon={a.icon} label={a.label} hint={a.hint ?? ''} busy={busy === a.id} disabled={!!busy || worldBusy} onClick={() => void run(a)} />
      ))}
    </>
  )
}

/** Start something new: a world, a story in one of the worlds, the sample world, or an import. */
function StartNew({ worlds, order, onNewWorld }: { worlds: LibraryWorld[] | null; order: number; onNewWorld: () => void }): React.JSX.Element {
  const [busy, setBusy] = useState<string | null>(null)
  // Something else on the start screen is opening or closing a world: these wait for it.
  const worldBusy = useLibrary((s) => s.busy)
  const openId = useApp((s) => s.world?.id ?? null)
  const choices = useMemo(() => orderWorlds(worlds ?? [], openId), [worlds, openId])
  return (
    <section aria-labelledby="start-new" className="start-rise mt-8" style={rise(order)}>
      <h2 id="start-new" className={cn(sectionTitle, 'mb-2')}>
        Start something new
      </h2>
      <div className="grid grid-cols-3 gap-2">
        <Tile icon={Plus} label="New world" hint="Characters, places and lore for a new set of stories" disabled={!!busy || worldBusy} onClick={onNewWorld} />
        <M.Root modal={false}>
          <M.Trigger asChild disabled={!!busy || worldBusy || !choices.length}>
            <Tile icon={BookPlus} label="New story…" hint="A new book, prequel or side story in one of your worlds" />
          </M.Trigger>
          <M.Portal>
            <M.Content
              align="start"
              sideOffset={4}
              className="z-50 max-h-[min(360px,var(--radix-dropdown-menu-content-available-height))] min-w-[240px] max-w-[360px] overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-pop data-[state=open]:animate-pop-in"
            >
              <M.Label className="px-2 pb-1 pt-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">In which world?</M.Label>
              {choices.map((w) => (
                <M.Item
                  key={w.id}
                  onSelect={() => void newStoryIn(w.id)}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13.5px] text-fg outline-none data-[highlighted]:bg-surface-2"
                >
                  <span className="truncate">{w.name}</span>
                </M.Item>
              ))}
            </M.Content>
          </M.Portal>
        </M.Root>
        <RecipeTile worlds={choices} disabled={!!busy || worldBusy} />
        <OtherWays busy={busy} setBusy={setBusy} />
      </div>
    </section>
  )
}

const menuItem = 'flex items-center gap-2 rounded-md px-2 py-1.5 text-[13.5px] text-fg outline-none data-[highlighted]:bg-surface-2 data-[state=open]:bg-surface-2'
const menuBox =
  'z-50 max-h-[min(360px,var(--radix-dropdown-menu-content-available-height))] min-w-[240px] max-w-[360px] overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-pop data-[state=open]:animate-pop-in'

/**
 * Story recipes: "New story from a recipe…" picks the recipe, then the world; the New story dialog then opens in
 * that world with the recipe already chosen (as a recipe's own "Start a story from it" does). Only once there is a
 * finished recipe and a world to put the story in.
 */
function RecipeTile({ worlds, disabled }: { worlds: LibraryWorld[]; disabled: boolean }): React.JSX.Element | null {
  const list = useRecipes((s) => s.list)
  useEffect(() => listenForRecipes(), [])
  const ready = (list ?? []).filter((r) => r.status === 'ready')
  if (!ready.length || !worlds.length) return null
  const start = (recipeId: string, worldId: string): void => {
    useRecipes.setState({ forStory: recipeId })
    void newStoryIn(worldId)
  }
  return (
    <M.Root modal={false}>
      <M.Trigger asChild disabled={disabled}>
        <Tile icon={CookingPot} label="New story from a recipe…" hint="The shape and style of a story you admire, told your way" />
      </M.Trigger>
      <M.Portal>
        <M.Content align="start" sideOffset={4} className={menuBox}>
          <M.Label className="px-2 pb-1 pt-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">Which recipe?</M.Label>
          {ready.map((r) =>
            worlds.length === 1 ? (
              <M.Item key={r.id} onSelect={() => start(r.id, worlds[0].id)} className={menuItem}>
                <span className="truncate">{recipeName(r)}</span>
              </M.Item>
            ) : (
              <M.Sub key={r.id}>
                <M.SubTrigger className={menuItem}>
                  <span className="flex-1 truncate">{recipeName(r)}</span>
                  <ChevronRight size={14} className="shrink-0 text-muted" />
                </M.SubTrigger>
                <M.Portal>
                  <M.SubContent sideOffset={4} className={menuBox}>
                    <M.Label className="px-2 pb-1 pt-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">In which world?</M.Label>
                    {worlds.map((w) => (
                      <M.Item key={w.id} onSelect={() => start(r.id, w.id)} className={menuItem}>
                        <span className="truncate">{w.name}</span>
                      </M.Item>
                    ))}
                  </M.SubContent>
                </M.Portal>
              </M.Sub>
            )
          )}
        </M.Content>
      </M.Portal>
    </M.Root>
  )
}

/** With no worlds at all: make the first one (by name, or from a summary), or start another way. */
function CreateWorldCard(): React.JSX.Element {
  const createWorld = useApp((s) => s.createWorld)
  const [name, setName] = useState('')
  // Which way the world is being made: 'build' opens the World builder in it once it is made.
  const [making, setMaking] = useState<false | 'create' | 'build'>(false)
  const [busy, setBusy] = useState<string | null>(null)

  const create = async (build = false): Promise<void> => {
    if (!name.trim() || making) return
    setMaking(build ? 'build' : 'create')
    try {
      await flushBeforeWorldChange()
      await (build ? createWorldAndBuild(name) : createWorld(name))
    } catch (e) {
      toast((e as Error).message, { tone: 'danger' })
      setMaking(false)
    }
  }

  return (
    <>
      <Card className="start-rise p-5">
        <h2 className="text-[15px] font-semibold text-fg">Create a world</h2>
        <p className="mb-4 mt-1 text-[13px] leading-relaxed text-muted">
          A world holds the characters, places and lore shared by every story set in it. You can add books, chapters and scenes once it's made.
        </p>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
        >
          <Field label="World name">
            {(id) => <Input id={id} autoFocus value={name} placeholder="For example, The Northern Reaches" onChange={(e) => setName(e.target.value)} />}
          </Field>
          <div className="flex gap-2">
            <Button variant="primary" size="lg" type="submit" className="flex-1" loading={making === 'create'} disabled={!name.trim() || !!making}>
              Create world
            </Button>
            <Button
              size="lg"
              type="button"
              className="flex-1"
              icon={<WandSparkles size={15} />}
              loading={making === 'build'}
              disabled={!name.trim() || !!making}
              title="Create the world, then lay it out from a summary you type or paste"
              onClick={() => void create(true)}
            >
              Build from a summary
            </Button>
          </div>
        </form>
      </Card>
      <section aria-labelledby="start-other" className="start-rise mt-8" style={rise(1)}>
        <h2 id="start-other" className={cn(sectionTitle, 'mb-2')}>
          Or start another way
        </h2>
        <div className="grid grid-cols-3 gap-2">
          <OtherWays busy={busy} setBusy={setBusy} />
        </div>
      </section>
    </>
  )
}

/** Every world, newest opened first (the open one at the top), with a search box once there are more than a handful. */
function WorldList({ worlds, openId, onDelete }: { worlds: LibraryWorld[]; openId: string | null; onDelete: (w: LibraryWorld) => void }): React.JSX.Element {
  const [query, setQuery] = useState('')
  const ordered = useMemo(() => orderWorlds(worlds, openId), [worlds, openId])
  const searching = worlds.length > SEARCH_FROM
  const shown = useMemo(() => filterWorlds(ordered, searching ? query : ''), [ordered, query, searching])
  return (
    <section aria-labelledby="start-worlds" className="mt-10">
      <div className="start-rise mb-2 flex h-8 items-center justify-between gap-4" style={rise(2)}>
        <h2 id="start-worlds" className={sectionTitle}>
          Your worlds
        </h2>
        {searching ? (
          <div className="relative w-[260px]">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
            <Input
              type="search"
              aria-label="Find a world or story"
              placeholder="Find a world or story"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && query) {
                  e.preventDefault()
                  setQuery('')
                }
              }}
              className="pl-8"
            />
          </div>
        ) : null}
      </div>
      {shown.length ? (
        <ul aria-label="Your worlds" className="flex flex-col gap-2">
          {shown.map((s, i) => (
            <WorldCard
              key={s.world.id}
              world={s.world}
              stories={s.stories}
              byStory={s.byStory}
              isOpen={s.world.id === openId}
              onDelete={onDelete}
              style={rise(Math.min(3 + i, 8))}
            />
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">
          No worlds or stories match “{query.trim()}”.
        </p>
      )}
    </section>
  )
}
