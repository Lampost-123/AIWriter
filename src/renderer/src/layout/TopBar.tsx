import * as M from '@radix-ui/react-dropdown-menu'
import {
  Check,
  ChevronDown,
  Globe2,
  House,
  CookingPot,
  LibraryBig,
  PanelLeft,
  PanelRight,
  PenLine,
  Plus,
  Search as SearchIcon,
  Settings as SettingsIcon
} from '@/components/ui/icons'
import { useEffect, useRef, useState, type RefObject } from 'react'
import type { WorldSummary } from '@shared/types'
import { IconButton, Kbd, toast } from '@/components/ui'
import { api, isMac } from '@/lib/api'
import { flushBeforeWorldChange } from '@/lib/flush'
import { shortcutKeys, withShortcut } from '@/lib/shortcuts'
import { useApp } from '@/lib/store'
import { cn } from '@/lib/cn'
import { NewWorldDialog } from '@/features/welcome/NewWorldDialog'
import { InlineTitle } from '@/features/binder/InlineTitle'
import { KeeperStatus } from '@/features/memory/KeeperStatus'
import { openScene } from '@/features/memory/openScene'
import { AskButton } from '@/features/ask/AskButton'
import { WorldFileItems } from '@/features/transfer/WorldFileItems'
import { FocusButton } from '@/features/look/FocusLayer'
import { WordCountButton } from '@/features/goals/WordCounts'
import { giveFocusBack, openPalette, usePalette } from '@/features/palette/paletteStore'
import { openSampleWorld, useSetup } from '@/features/setup/setupStore'
import { goToStartScreen } from '@/features/start/home'
import { toggleFloatingBinder, useFloatingBinder } from './ResizablePane'
import { saveNote } from './saveNote'
import { openRecipes } from '@/features/recipes/recipeStore'
import { UpdateBanner } from './UpdateBanner'
import { DrawnTick } from '@/components/ui/DrawnTick'
import { Trail } from './Trail'
import { useNewLook } from '@/features/look/look'
import { SampleWorldChip } from '@/features/setup/SampleWorldBar'

/** How the open scene is saving. Its slot stays when there is nothing to say, so the bar never moves. */
function SaveIndicator(): React.JSX.Element {
  const state = useApp((s) => s.saveState)
  const writing = useApp((s) => s.view.kind === 'write')
  const label = saveNote(state, writing)
  const isNew = useNewLook()
  // The New look: "Saved" is a small green tick that draws itself each time.
  const [saves, setSaves] = useState(0)
  useEffect(() => {
    if (state === 'saved') setSaves((n) => n + 1)
  }, [state])
  if (isNew && label === 'Saved') {
    return (
      <span aria-live="polite" className="flex min-w-[64px] shrink-0 items-center justify-end gap-1 whitespace-nowrap text-[12px] text-faint">
        <DrawnTick key={saves} size={14} draw className="text-success" />
        Saved
      </span>
    )
  }
  return (
    <span
      aria-live="polite"
      className={cn(
        'min-w-[110px] shrink-0 whitespace-nowrap text-right text-[12px] transition-opacity duration-300 look-new:min-w-[64px]',
        state === 'error' ? 'text-danger' : 'text-faint',
        !label && 'opacity-0'
      )}
    >
      {/* With nothing to say, a hidden "Saved" fades out, unread by screen readers. */}
      {label || <span aria-hidden>Saved</span>}
    </span>
  )
}

/** Renames the open world (only its name inside the world; the folder on disk keeps its name). */
async function renameWorld(name: string): Promise<void> {
  const clean = name.trim()
  if (!clean) return
  useApp.setState((s) => (s.world ? { world: { ...s.world, name: clean } } : {}))
  try {
    await api.updateWorld({ name: clean })
  } catch (e) {
    toast((e as Error).message, { tone: 'danger' })
  } finally {
    await useApp.getState().refreshWorld().catch(() => undefined)
  }
}

const menuItem = 'flex items-center gap-2 rounded-md px-2 py-1.5 text-[13.5px] outline-none data-[highlighted]:bg-surface-2'

export function WorldMenu({ trigger }: { trigger: RefObject<HTMLButtonElement | null> }): React.JSX.Element {
  const world = useApp((s) => s.world)
  const openWorld = useApp((s) => s.openWorld)
  const [worlds, setWorlds] = useState<WorldSummary[]>([])
  // Kept with the command palette's state, so the palette can open the menu, the New world dialog and the name box too.
  const menuOpen = usePalette((s) => s.worldMenu)
  const newOpen = usePalette((s) => s.newWorld)
  const renaming = usePalette((s) => s.renamingWorld)
  const setNewOpen = (o: boolean): void => usePalette.setState({ newWorld: o })
  // Set when the chosen item moves focus elsewhere (the name box, the New world dialog),
  // so the closing menu doesn't pull focus back to its button.
  const keepFocus = useRef(false)
  // Opened from the palette: closing it puts the caret back where Adam was, not on the menu's button.
  const fromPalette = useRef(false)
  // Set when Rename is chosen: the name box opens once the menu has closed, as an open menu keeps
  // the keyboard inside it and the box would lose it.
  const renameNext = useRef(false)
  // The first world other than this one, where the keyboard starts when the palette asks to switch.
  const otherWorld = useRef<HTMLDivElement>(null)
  const worldId = world?.id
  // Milestone 6: the sample world can be opened (or made again) from here, unless it is the one open.
  const sampleOpen = useSetup((s) => !!worldId && s.sampleWorldId === worldId)

  // The list of worlds is there before the menu first opens, so it opens whole (from the palette too),
  // and it is fetched again each time the menu opens.
  const load = (): (() => void) => {
    let live = true
    api
      .listWorlds()
      .then((w) => live && setWorlds(w))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }
  useEffect(load, [worldId])
  useEffect(() => {
    if (!menuOpen) return
    keepFocus.current = false
    renameNext.current = false
    fromPalette.current = menuOpen === 'palette'
    return load()
  }, [menuOpen])

  // "Switch to another world": once the menu is up, the keyboard is on the first other world.
  useEffect(() => {
    if (menuOpen !== 'palette') return
    const f = requestAnimationFrame(() => otherWorld.current?.focus())
    return () => cancelAnimationFrame(f)
  }, [menuOpen])

  const firstOther = worlds.find((w) => w.id !== worldId)?.id
  return (
    <>
      <M.Root open={!!menuOpen} onOpenChange={(o) => usePalette.setState({ worldMenu: o ? 'bar' : false })}>
        {/* While the world is renamed, its name box covers this; the button keeps its room, so nothing moves.
            A long name is cut shorter in a small window, so the bar fits at its narrowest, and shorter still
            while an update is offered there (the offer needs the room; see TopBar). 184px leaves room for the Home button. */}
        <M.Trigger
          ref={trigger}
          className={cn(
            'flex h-7 max-w-[184px] shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] font-semibold text-fg hover:bg-surface-2',
            'look-new:h-8 look-new:gap-2 look-new:rounded-[10px] look-new:pl-1',
            'min-[1100px]:max-w-[260px] max-xl:group-has-[[data-update-slot]>[role=status]:not([aria-hidden=true])]/bar:max-w-[120px]',
            // The desk: the world's name alone, in the serif, with its chevron (no glyph tile).
            'desk:max-w-[320px] desk:gap-1.5 desk:rounded-[9px] desk:pl-2 desk:pr-1.5 desk:hover:bg-[color-mix(in_oklab,var(--page)_55%,transparent)]',
            renaming && 'invisible'
          )}
        >
          <Globe2 size={14} className="shrink-0 text-muted look-new:hidden" />
          {/* The New look: the world's glyph, a small lit tile. */}
          <span
            aria-hidden
            className="hidden h-6 w-6 shrink-0 place-items-center rounded-[7px] bg-[linear-gradient(140deg,#4a6fa0,#2c4466)] text-[#f3d9a4] shadow-[inset_0_1px_0_rgb(255_255_255/0.25),var(--elev-1)] look-new:grid desk:hidden"
          >
            <Globe2 size={14} />
          </span>
          <span className="truncate look-new:font-heading look-new:text-[15px] look-new:tracking-[-0.01em] desk:font-semibold">{world?.name ?? 'No world open'}</span>
          <ChevronDown size={13} className="shrink-0 text-muted desk:text-faint" />
        </M.Trigger>
        <M.Portal>
          <M.Content
            align="start"
            sideOffset={4}
            onCloseAutoFocus={(e) => {
              if (keepFocus.current || fromPalette.current) e.preventDefault()
              // Rename was chosen: the name box opens now that the menu is closed (opened from the
              // palette, the caret goes back to the page once the name is in).
              if (renameNext.current) usePalette.setState({ renamingWorld: fromPalette.current ? 'palette' : 'bar' })
              else if (fromPalette.current && !keepFocus.current) giveFocusBack()
              keepFocus.current = false
              renameNext.current = false
            }}
            className="z-50 min-w-[240px] max-w-[360px] rounded-lg border border-line bg-surface p-1 shadow-pop data-[state=open]:animate-pop-in"
          >
            <M.Label className="px-2 pb-1 pt-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">Worlds</M.Label>
            {worlds.map((w) => (
              <M.Item
                key={w.id}
                ref={w.id === firstOther ? otherWorld : undefined}
                onSelect={() => {
                  if (w.id === world?.id) return
                  void flushBeforeWorldChange()
                    .then(() => openWorld(w.id))
                    .catch((e: Error) => toast(e.message, { tone: 'danger' }))
                }}
                className={menuItem}
              >
                <span className="w-4 shrink-0">{w.id === world?.id ? <Check size={14} className="text-accent" /> : null}</span>
                {/* The open world by its name now, so a rename shows here at once (the list was read before it). */}
                <span className="truncate">{w.id === world?.id ? world.name : w.name}</span>
              </M.Item>
            ))}
            <M.Separator className="my-1 h-px bg-line" />
            {/* The start screen: every world and story, and where Adam left off. */}
            <M.Item
              onSelect={() => {
                keepFocus.current = true
                goToStartScreen()
              }}
              className={menuItem}
            >
              <House size={14} className="text-muted" /> Go to the start screen
            </M.Item>
            {world ? (
              <M.Item
                onSelect={() => {
                  keepFocus.current = true
                  renameNext.current = true
                }}
                className={menuItem}
              >
                <PenLine size={14} className="text-muted" /> Rename this world
              </M.Item>
            ) : null}
            <M.Item
              onSelect={() => {
                keepFocus.current = true
                setNewOpen(true)
              }}
              className={menuItem}
            >
              <Plus size={14} className="text-muted" /> New world…
            </M.Item>
            {/* Milestone 6: Export world…, Make a copy, Import a world file… */}
            <M.Separator className="my-1 h-px bg-line" />
            <WorldFileItems itemClass={menuItem} hasWorld={!!world} />
            {sampleOpen ? null : (
              <M.Item onSelect={() => void openSampleWorld()} className={menuItem}>
                <LibraryBig size={14} className="text-muted" /> Explore the sample world
              </M.Item>
            )}
            {/* Story recipes */}
            <M.Item onSelect={openRecipes} className={menuItem}>
              <CookingPot size={14} className="text-muted" /> Story recipes
            </M.Item>
          </M.Content>
        </M.Portal>
      </M.Root>
      <NewWorldDialog open={newOpen} onOpenChange={setNewOpen} />
    </>
  )
}

/**
 * The world's name box, over the world's name and the search box beside it, so nothing in the bar
 * moves while Adam types (the old width of the name would be too small for a new one). Once the name
 * is in, the keyboard goes back where it was: the world's button, or (renamed from the palette) the
 * page. Not if Adam has clicked somewhere else meanwhile.
 */
export function RenameWorld({ trigger }: { trigger: RefObject<HTMLButtonElement | null> }): React.JSX.Element | null {
  const world = useApp((s) => s.world)
  const renaming = usePalette((s) => s.renamingWorld)
  if (!renaming || !world) return null
  const done = (): void => {
    usePalette.setState({ renamingWorld: false })
    requestAnimationFrame(() => {
      if (document.activeElement && document.activeElement !== document.body) return
      if (renaming === 'palette') giveFocusBack()
      else trigger.current?.focus()
    })
  }
  return (
    <div className="absolute inset-y-0 left-0 right-0 z-10 flex items-center gap-1.5 bg-surface px-2 look-new:bg-bg">
      <Globe2 size={14} className="shrink-0 text-muted" />
      <InlineTitle
        label="World name"
        value={world.name}
        className="h-6 text-[13px] font-semibold"
        onCommit={(n) => renameWorld(n)}
        onDone={done}
      />
    </div>
  )
}

/**
 * The way into search and the command palette: looks like a search field, opens the palette (as
 * Ctrl+K does). Pressing it leaves the caret where it was, so closing the palette goes back there.
 * A fixed width (narrower in a small window), so nothing else in the bar moves. Only when the bar is
 * short of room (the update offer in a small window) does it give up width: first its keys go, then
 * its word, down to the magnifier.
 */
function SearchBox(): React.JSX.Element {
  const label = withShortcut('Search', 'search')
  return (
    <button
      type="button"
      aria-label={label}
      aria-keyshortcuts={isMac() ? 'Meta+K' : 'Control+K'}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={openPalette}
      className={cn(
        '@container ml-1 flex h-7 w-[180px] min-w-[36px] shrink items-center gap-2 rounded-md border border-line bg-page px-2.5 text-[12.5px] text-faint',
        // The New look: a soft pill.
        'look-new:h-8 look-new:w-[150px] look-new:rounded-full look-new:border-transparent look-new:bg-surface look-new:shadow-[inset_0_0_0_1px_var(--line)] look-new:hover:border-transparent look-new:min-[1100px]:w-[190px]',
        'transition-colors duration-150 hover:border-line-strong hover:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        'min-[1100px]:w-[220px]'
      )}
    >
      <SearchIcon size={14} className="shrink-0" aria-hidden />
      <span className="flex-1 truncate text-left @max-[64px]:hidden">Search</span>
      <span className="flex shrink-0 items-center gap-0.5 @max-[122px]:hidden" aria-hidden>
        {shortcutKeys('search').map((k) => (
          <Kbd key={k}>{k}</Kbd>
        ))}
      </span>
    </button>
  )
}

/** Ctrl+, (Cmd+, on a Mac) opens Settings, from anywhere (both top bars install it). */
export function useSettingsKey(): void {
  const navigate = useApp((s) => s.navigate)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key === ',') {
        e.preventDefault()
        navigate({ kind: 'settings', tab: 'models' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])
}

export function TopBar(): React.JSX.Element {
  const settings = useApp((s) => s.settings)
  const update = useApp((s) => s.updateSettings)
  const view = useApp((s) => s.view)
  const navigate = useApp((s) => s.navigate)
  const sceneId = useApp((s) => s.sceneId)
  const askOpen = useApp((s) => s.askOpen)
  // The scene a draft is being written into: shown when it isn't the page on screen.
  const draftScene = useApp((s) => s.activeGeneration?.sceneId ?? null)
  const draftElsewhere = !!draftScene && (view.kind !== 'write' || draftScene !== sceneId)
  const hasWorld = useApp((s) => s.world !== null)
  const isNew = useNewLook()
  const worldButton = useRef<HTMLButtonElement>(null)
  const layout = settings?.layout
  const floatingBinder = useFloatingBinder()
  // The scene panel belongs to an open scene in the writing view (Ask the world shows there even without
  // one); elsewhere the button rests.
  const panelAvailable = view.kind === 'write' && (!!sceneId || askOpen)

  useSettingsKey()

  return (
    // Focus mode (milestone 6) fades the bar away (data-focus-chrome, styles.css).
    <header
      data-focus-chrome
      className="group/bar flex h-11 shrink-0 items-center gap-1 border-b border-line bg-surface px-2 look-new:h-12 look-new:gap-1.5 look-new:border-transparent look-new:bg-transparent look-new:px-3"
    >
      {/* The start screen: every world and story, where Adam left off, and starting something new. */}
      <IconButton label="Start screen" title="Start screen: all your worlds and stories" onClick={goToStartScreen}>
        <House size={16} />
      </IconButton>
      <IconButton
        label="Show or hide the binder"
        active={floatingBinder.floating ? floatingBinder.open : layout?.binderOpen}
        onClick={() => {
          // In a small window the binder floats over the page: this shows or hides it and leaves the saved layout alone.
          if (floatingBinder.floating) toggleFloatingBinder()
          else if (layout) void update({ layout: { binderOpen: !layout.binderOpen } })
        }}
      >
        <PanelLeft size={16} />
      </IconButton>
      {/* The world's name and the search box: renaming the world happens over both, so nothing in the bar moves. */}
      <div className="relative flex min-w-0 items-center gap-1">
        <WorldMenu trigger={worldButton} />
        {/* Search needs an open world (with none, the bar is only the way to Settings). The New look has it on the
            right, and the trail of where Adam is beside the world's name. */}
        {hasWorld && !isNew ? <SearchBox /> : null}
        {hasWorld && isNew ? <Trail /> : null}
        <RenameWorld trigger={worldButton} />
      </div>
      {/* The free middle of the bar: a downloaded update is offered here, so nothing below moves for it.
          While the offer shows, it keeps room for the offer's buttons (UpdateBanner's own, at its widths),
          which a small window finds by narrowing the search box and the world's name. */}
      <div
        data-update-slot
        className={cn(
          'flex min-w-0 flex-1 justify-center px-3',
          'has-[>[role=status]:not([aria-hidden=true])]:min-w-[250px] lg:has-[>[role=status]:not([aria-hidden=true])]:min-w-[345px]'
        )}
      >
        <UpdateBanner />
      </div>
      {/* The New look: the sample world says so here, as a chip (Classic has a bar under the top bar). */}
      {isNew ? <SampleWorldChip /> : null}
      {/* The memory keeper's quiet status: a slot that is always there, empty while all is well. */}
      {hasWorld ? <KeeperStatus /> : null}
      {hasWorld && isNew ? <SearchBox /> : null}
      {/* The bar fits the smallest window with the longest world name, so what follows never wraps. */}
      {view.kind === 'write' ? (
        // Writing by hand: click for the selection's, chapter's and story's counts and today's writing.
        <WordCountButton />
      ) : null}
      {draftElsewhere && draftScene ? (
        // A draft keeps writing into its scene while another page or scene is open; this goes back to it.
        <button
          type="button"
          onClick={() => (draftScene === sceneId ? navigate({ kind: 'write' }) : void openScene(draftScene))}
          title="A draft is being written into a scene. Click to go back to it."
          className="mr-2 flex h-7 shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2 text-[12.5px] font-medium text-ai transition-colors duration-150 hover:bg-surface-2 animate-fade-in"
        >
          <span className="h-2 w-2 rounded-full bg-ai animate-pulse" aria-hidden />
          Writing…
        </button>
      ) : null}
      <SaveIndicator />
      {/* The New look has Ask the world and Settings on the area rail. */}
      {hasWorld && !isNew ? <AskButton /> : null}
      {/* In the smallest windows the bar has no room for it (F11 and the palette still reach focus mode). */}
      {hasWorld ? (
        <span className="hidden min-[1000px]:flex">
          <FocusButton />
        </span>
      ) : null}
      {isNew && hasWorld ? null : (
        <IconButton
          label="Settings"
          title={withShortcut('Settings', 'settings')}
          active={view.kind === 'settings'}
          onClick={() => navigate(view.kind === 'settings' ? { kind: 'write' } : { kind: 'settings', tab: 'models' })}
        >
          <SettingsIcon size={16} />
        </IconButton>
      )}
      <IconButton
        label="Show or hide the scene panel"
        active={panelAvailable && layout?.inspectorOpen}
        disabled={!panelAvailable}
        onClick={() => layout && void update({ layout: { inspectorOpen: !layout.inspectorOpen } })}
      >
        <PanelRight size={16} />
      </IconButton>
    </header>
  )
}
