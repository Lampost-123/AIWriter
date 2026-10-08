import { useEffect, useRef, useState } from 'react'
import { Toaster } from '@/components/ui'
import { api } from '@/lib/api'
import { installFlushOnClose } from '@/lib/flush'
import { useApp } from '@/lib/store'
import { cn } from '@/lib/cn'
import { useTheme } from '@/lib/theme'
import { ResizablePane, useFloatingPane } from '@/layout/ResizablePane'
import { binderFloats, chosenWidthFor, dragMax, fitPanels, pageMinFor } from '@/layout/fitPanels'
import { TopBar } from '@/layout/TopBar'
import { Inspector } from '@/layout/Inspector'
import { StartScreen } from '@/features/start/StartScreen'
import { Binder } from '@/features/binder/Binder'
import { SceneView } from '@/features/editor/SceneView'
import { EntriesView } from '@/features/world/EntriesView'
import { StyleView } from '@/features/style/StyleView'
import { SettingsView } from '@/features/settings/SettingsView'
import { WhatTheAISaw } from '@/features/generate/WhatTheAISaw'
import { WhatChanged } from '@/features/memory/WhatChanged'
import { installMemoryEvents } from '@/features/memory/events'
import { CodexView } from '@/features/codex/CodexView'
import { BuilderView } from '@/features/builder/BuilderView'
import { TimelineView } from '@/features/timeline/TimelineView'
import { RelationshipMap } from '@/features/map/RelationshipMap'
import { ThreadsBoard } from '@/features/threads/ThreadsBoard'
import { StorySettings } from '@/features/stories/StorySettings'
import { NewStoryDialog } from '@/features/stories/NewStoryDialog'
import { CommandPalette } from '@/features/palette/CommandPalette'
import { ShortcutsList } from '@/features/palette/ShortcutsList'
import { HistoryView } from '@/features/history/HistoryView'
import { VariantsView } from '@/features/variants/VariantsView'
import { OutlineHelper } from '@/features/outline/OutlineHelper'
import { ChapterPlanner } from '@/features/outline/ChapterPlanner'
import { WorldBuilderView } from '@/features/worldBuilder/WorldBuilderView'
import { ConsistencyView } from '@/features/consistency/ConsistencyView'
import { DictationLayer } from '@/features/dictation/DictationLayer'
import { AskPanel } from '@/features/ask/AskPanel'
import { closeAsk } from '@/features/ask/open'
import { ExportDialogs } from '@/features/transfer/ExportDialogs'
import { SpendWatch } from '@/features/usage/SpendWatch'
import { ImportView } from '@/features/importing/ImportView'
import { useAccent } from '@/features/look/accents'
import { useLookSetting, useNewLook } from '@/features/look/look'
import { AreaRail } from '@/layout/AreaRail'
import { AreaList } from '@/layout/AreaList'
import { LookNote } from '@/features/look/LookNote'
import { useFocusMode } from '@/features/look/focusMode'
import { FocusLayer } from '@/features/look/FocusLayer'
import { FindLayer } from '@/features/find/FindLayer'
import { FirstRun } from '@/features/setup/FirstRun'
import { SampleWorldBar } from '@/features/setup/SampleWorldBar'
import { useSetup } from '@/features/setup/setupStore'
// Story recipes
import { RecipesView } from '@/features/recipes/RecipesView'
import { RecipePlan } from '@/features/recipes/RecipePlan'
import { RecipeWatch } from '@/features/recipes/parts'
import { installSpelling } from '@/features/spelling/install'
import { installGoals } from '@/features/goals/goalStore'
import { installInputModality } from '@/features/look/motion'

export function App(): React.JSX.Element | null {
  const ready = useApp((s) => s.ready)
  const init = useApp((s) => s.init)
  const settings = useApp((s) => s.settings)
  const world = useApp((s) => s.world)
  const home = useApp((s) => s.home)
  const view = useApp((s) => s.view)
  // While a backup is being restored nothing can be clicked, focused or typed into (see BackupsSettings).
  const restoring = useApp((s) => s.restoring)
  // Milestone 6: the first-run setup shows in place of everything else while it is under way.
  const setupStep = useSetup((s) => s.step)
  const setupReady = useSetup((s) => s.ready)

  useTheme(settings?.theme)
  useAccent(settings ? settings.accent : undefined)
  useLookSetting(settings?.look)
  useEffect(() => {
    // Where the first run stands is known first (it may open the world a setup was making), so the start
    // screen never flashes before the setup (and never shows once the setup is done).
    void useSetup
      .getState()
      .load()
      .then(() => init({ startScreen: !useSetup.getState().step }))
    const offFlush = installFlushOnClose()
    const offMemory = installMemoryEvents()
    // Writing by hand: spell check in step with the world and story, and the words written each day.
    const offSpelling = installSpelling()
    const offGoals = installGoals()
    // The New look: whether Adam is on the keyboard or the pointer (what he does from the keyboard happens at once).
    const offModality = installInputModality()
    return () => {
      offFlush()
      offMemory()
      offSpelling()
      offGoals()
      offModality()
    }
  }, [init])

  // The window stays hidden until the first real frame (in the right theme) is painted, so
  // nothing flashes. requestAnimationFrame then setTimeout lands just after that paint.
  const loaded = ready && !!settings && setupReady
  useEffect(() => {
    if (!loaded) return
    requestAnimationFrame(() => setTimeout(() => void api.showWindow().catch(() => undefined), 0))
  }, [loaded])

  if (!loaded) return null

  // With no world open, Settings, the manuscript import and Story recipes still have their pages; anything else is the start screen.
  const noWorldPage = !world && (view.kind === 'settings' || view.kind === 'import' || view.kind === 'recipes')
  const showStart = !setupStep && (home || (!world && !noWorldPage))

  return (
    // The New look: a soft light falls on the window's frame from above (none in Classic).
    <div className="relative flex h-full flex-col look-new:[background-image:var(--glow)]" inert={restoring} aria-busy={restoring || undefined}>
      {setupStep ? (
        <FirstRun />
      ) : world ? (
        // The start screen shows over the workspace without unmounting it, so a draft keeps writing into its
        // scene and everything is where Adam left it when he goes back. Hidden with visibility, as the writing
        // view is under other pages, and inert, so the keyboard can't reach it.
        <div className={cn('isolate flex min-h-0 flex-1 flex-col', home && 'invisible')} inert={home}>
          <Workspace />
        </div>
      ) : noWorldPage && !home ? (
        <NoWorld />
      ) : null}
      {showStart ? <StartScreen /> : null}
      {/* The New look: the one-time note offering Classic, after updating. */}
      {setupStep ? null : <LookNote />}
      <Toaster />
      {/* Milestone 6: the monthly limit's toasts and its ask before an AI action. */}
      <SpendWatch />
      {/* Story recipes: a recipe that finishes says so wherever Adam is. */}
      <RecipeWatch />
    </div>
  )
}

function NoWorld(): React.JSX.Element {
  const view = useApp((s) => s.view)
  if (view.kind === 'settings') {
    return (
      <>
        <TopBar />
        <div className="min-h-0 flex-1">
          <SettingsView tab={view.tab} />
        </div>
      </>
    )
  }
  // Story recipes: the recipe library works with no world open too.
  if (view.kind === 'recipes') {
    return (
      <>
        <TopBar />
        <div className="min-h-0 flex-1">
          <RecipesView page={view.page} recipeId={view.recipeId} />
        </div>
      </>
    )
  }
  // Milestone 6: importing a manuscript from the start screen (the import makes a world named after the book).
  return (
    <>
      <TopBar />
      <div className="min-h-0 flex-1">
        <ImportView />
      </div>
    </>
  )
}

/**
 * The window's width, and whether it is being resized right now (the side panels then follow the
 * window edge straight away instead of easing after it).
 */
function useWindowWidth(): { width: number; resizing: boolean } {
  const [state, setState] = useState(() => ({ width: window.innerWidth, resizing: false }))
  useEffect(() => {
    let settle: ReturnType<typeof setTimeout> | undefined
    const onResize = (): void => {
      setState({ width: window.innerWidth, resizing: true })
      clearTimeout(settle)
      settle = setTimeout(() => setState({ width: window.innerWidth, resizing: false }), 250)
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      clearTimeout(settle)
    }
  }, [])
  return state
}

const BINDER = { min: 220, max: 440, floor: 200 }
/** The New look's area rail, always beside the side list (layout/AreaRail.tsx). */
const RAIL = 64
const SCENE_PANEL = { min: 280, max: 520, floor: 260 }
/** The top bar's binder button (in a small window it shows the binder over the page instead). */
const BINDER_BUTTON = 'Show or hide the binder'

function Workspace(): React.JSX.Element {
  const settings = useApp((s) => s.settings)!
  const update = useApp((s) => s.updateSettings)
  const view = useApp((s) => s.view)
  const sceneId = useApp((s) => s.sceneId)
  const askOpen = useApp((s) => s.askOpen)
  const peeking = useApp((s) => s.peekEntryId !== null)
  // Focus mode (milestone 6): the panels slide away (their saved layout untouched), and the scene panel shows
  // over the page's right edge only for Ask the world or a name shown beside the page.
  const focus = useFocusMode((s) => s.on)
  const focusMoving = useFocusMode((s) => s.moving)
  const focusPanel = focus && (askOpen || peeking)
  // The New look: the area rail, then the area's list where Classic has the binder (and no sample bar: a chip in the top bar).
  const isNew = useNewLook()
  const overPage = focus && (!focusMoving || focusPanel)
  const { layout } = settings
  const writing = view.kind === 'write'
  // Ask the world (milestone 4) shows in this panel too, even with no scene open.
  const scenePanel = writing && (!!sceneId || askOpen)
  // In a small window the open panels give up some width, so the page keeps room to write in.
  // Adam's chosen widths are kept and come back when the window is wider.
  const shown = useWindowWidth()
  // The panels share what the rail leaves.
  const win = isNew ? { ...shown, width: shown.width - RAIL } : shown
  // The scene panel comes and goes with the writing page (it isn't there on other pages). When it
  // does, the binder takes its new width at once too, rather than easing while the page swaps.
  const hadScenePanel = useRef(scenePanel)
  const pageSwap = hadScenePanel.current !== scenePanel
  useEffect(() => {
    hadScenePanel.current = scenePanel
  }, [scenePanel])
  // The page keeps room for about 55 characters a line at Adam's text size. When even both panels at
  // their narrowest can't leave that, the binder floats over the page, shown from the binder button;
  // the saved layout is untouched, so the binder is back beside the page in a wider window.
  const pageMin = pageMinFor(settings.editor.fontSize, settings.editor.pageWidth)
  const right = { open: !focus && scenePanel && layout.inspectorOpen, width: layout.inspectorWidth, floor: SCENE_PANEL.floor }
  const floats = binderFloats(win.width, BINDER.floor, right, pageMin)
  const floating = useFloatingPane(floats)
  // The New look: Settings has a list of its own beside the rail, so the area's list steps aside there.
  const listAside = isNew && view.kind === 'settings'
  const left = { open: !focus && !listAside && layout.binderOpen && !floats, width: layout.binderWidth, floor: BINDER.floor }
  const fit = fitPanels(win.width, left, right, pageMin)
  // A panel squeezed narrower than its own minimum is dragged from where it shows, and the width
  // saved is the one that shows where Adam lets go, so nothing jumps on release.
  const binderMin = left.open ? Math.min(BINDER.min, fit.left) : BINDER.min
  const sceneMin = right.open ? Math.min(SCENE_PANEL.min, fit.right) : SCENE_PANEL.min

  return (
    <>
      <TopBar />
      {isNew ? null : (
        <div data-focus-chrome>
          <SampleWorldBar />
        </div>
      )}
      <div className="relative flex min-h-0 flex-1">
        {isNew ? (
          <div className="contents" inert={focus}>
            <AreaRail />
          </div>
        ) : null}
        <div data-focus-chrome className="contents" inert={focus}>
          <ResizablePane
            side="left"
            label="Binder"
            width={left.open ? fit.left : layout.binderWidth}
            open={focus || listAside ? false : floats ? floating.open : layout.binderOpen}
            floating={floats ? { onClose: floating.close, toggle: BINDER_BUTTON } : null}
            min={binderMin}
            max={dragMax(win.width, fit.right, binderMin, BINDER.max, pageMin)}
            instant={!focusMoving && (win.resizing || pageSwap)}
            onResize={(w) => void update({ layout: { binderWidth: chosenWidthFor(w, win.width, 'left', left, right, BINDER.max, pageMin) } })}
          >
            {isNew ? <AreaList /> : <Binder />}
          </ResizablePane>
        </div>
        {/* data-page: in the New look, a new page crossfades in here (features/look/viewTransition.ts); coming back
            to the writing page is instant. */}
        <main data-page className="relative min-w-0 flex-1 bg-bg">
          {/* The writing view stays in place under the other pages, so a draft keeps writing into the scene
              while Adam looks at something else, and the page and caret are where he left them. Hidden with
              visibility (not display), which keeps its scroll position. */}
          <div className={cn('h-full', !writing && 'invisible pointer-events-none')} inert={!writing}>
            <SceneView />
          </div>
          {!writing ? (
            <div key={view.kind} className="absolute inset-0 bg-bg">
              {view.kind === 'entries' && <EntriesView kind={view.entryKind} entryId={view.entryId} from={view.from} />}
              {view.kind === 'style' && <StyleView />}
              {view.kind === 'settings' && <SettingsView tab={view.tab} />}
              {view.kind === 'generation' && <WhatTheAISaw generationId={view.generationId} />}
              {view.kind === 'memory' && <WhatChanged sceneId={view.sceneId} />}
              {view.kind === 'codex' && <CodexView />}
              {view.kind === 'builder' && <BuilderView kind={view.entryKind} entryId={view.entryId} start={view.start} />}
              {view.kind === 'timeline' && <TimelineView />}
              {view.kind === 'map' && <RelationshipMap />}
              {view.kind === 'threads' && <ThreadsBoard />}
              {view.kind === 'story' && <StorySettings key={view.storyId} storyId={view.storyId} />}
              {view.kind === 'history' && <HistoryView key={view.sceneId} sceneId={view.sceneId} snapshotId={view.snapshotId} />}
              {view.kind === 'variants' && <VariantsView key={view.sceneId} sceneId={view.sceneId} />}
              {view.kind === 'outline' &&
                (view.chapterId ? (
                  <ChapterPlanner key={view.chapterId} storyId={view.storyId} chapterId={view.chapterId} />
                ) : (
                  <OutlineHelper key={view.storyId} storyId={view.storyId} />
                ))}
              {view.kind === 'worldBuilder' && <WorldBuilderView />}
              {view.kind === 'consistency' && <ConsistencyView key={view.storyId} storyId={view.storyId} />}
              {view.kind === 'import' && <ImportView />}
              {view.kind === 'recipes' && <RecipesView page={view.page} recipeId={view.recipeId} />}
              {view.kind === 'recipePlan' && <RecipePlan key={view.storyId} storyId={view.storyId} recipeId={view.recipeId} />}
            </div>
          ) : null}
        </main>
        {scenePanel ? (
          // In focus mode the panel lies over the page's right edge (once it has slid shut beside the page), so the
          // page doesn't move when it opens.
          <div className={overPage ? cn('absolute inset-y-0 right-0 z-30 flex', focusPanel && 'shadow-pop') : 'contents'} inert={focus && !focusPanel}>
            <ResizablePane
              side="right"
              label={sceneId ? 'Scene panel' : 'Ask the world'}
              width={focus ? Math.min(layout.inspectorWidth, SCENE_PANEL.max) : layout.inspectorOpen ? fit.right : layout.inspectorWidth}
              open={focus ? focusPanel : layout.inspectorOpen}
              min={sceneMin}
              max={dragMax(win.width, fit.left, sceneMin, SCENE_PANEL.max, pageMin)}
              instant={!focusMoving && win.resizing}
              onResize={(w) =>
                void update({ layout: { inspectorWidth: chosenWidthFor(w, win.width, 'right', right, left, SCENE_PANEL.max, pageMin) } })
              }
            >
              {sceneId ? <Inspector sceneId={sceneId} /> : <AskPanel sceneId={null} onClose={closeAsk} />}
            </ResizablePane>
          </div>
        ) : null}
      </div>
      <CommandPalette />
      <ShortcutsList />
      <NewStoryDialog />
      <DictationLayer />
      <ExportDialogs />
      <FocusLayer />
      <FindLayer />
    </>
  )
}
