import { useEffect, useState } from 'react'
import { Toaster } from '@/components/ui'
import { api } from '@/lib/api'
import { installFlushOnClose } from '@/lib/flush'
import { useApp } from '@/lib/store'
import { cn } from '@/lib/cn'
import { useTheme } from '@/lib/theme'
import { ResizablePane } from '@/layout/ResizablePane'
import { dragMax, fitPanels } from '@/layout/fitPanels'
import { TopBar } from '@/layout/TopBar'
import { Inspector } from '@/layout/Inspector'
import { Welcome } from '@/features/welcome/Welcome'
import { Binder } from '@/features/binder/Binder'
import { SceneView } from '@/features/editor/SceneView'
import { EntriesView } from '@/features/world/EntriesView'
import { StyleView } from '@/features/style/StyleView'
import { SettingsView } from '@/features/settings/SettingsView'
import { WhatTheAISaw } from '@/features/generate/WhatTheAISaw'
import { WhatChanged } from '@/features/memory/WhatChanged'
import { installMemoryEvents } from '@/features/memory/events'

export function App(): React.JSX.Element | null {
  const ready = useApp((s) => s.ready)
  const init = useApp((s) => s.init)
  const settings = useApp((s) => s.settings)
  const world = useApp((s) => s.world)
  // While a backup is being restored nothing can be clicked, focused or typed into (see BackupsSettings).
  const restoring = useApp((s) => s.restoring)

  useTheme(settings?.theme)
  useEffect(() => {
    void init()
    const offFlush = installFlushOnClose()
    const offMemory = installMemoryEvents()
    return () => {
      offFlush()
      offMemory()
    }
  }, [init])

  // The window stays hidden until the first real frame (in the right theme) is painted, so
  // nothing flashes. requestAnimationFrame then setTimeout lands just after that paint.
  const loaded = ready && !!settings
  useEffect(() => {
    if (!loaded) return
    requestAnimationFrame(() => setTimeout(() => void api.showWindow().catch(() => undefined), 0))
  }, [loaded])

  if (!loaded) return null

  return (
    <div className="flex h-full flex-col" inert={restoring} aria-busy={restoring || undefined}>
      {world ? <Workspace /> : <NoWorld />}
      <Toaster />
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
  return <Welcome />
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
const SCENE_PANEL = { min: 280, max: 520, floor: 260 }

function Workspace(): React.JSX.Element {
  const settings = useApp((s) => s.settings)!
  const update = useApp((s) => s.updateSettings)
  const view = useApp((s) => s.view)
  const sceneId = useApp((s) => s.sceneId)
  const { layout } = settings
  const writing = view.kind === 'write'
  const scenePanel = writing && !!sceneId
  // In a small window the open panels give up some width, so the page keeps room to write in.
  // Adam's chosen widths are kept and come back when the window is wider.
  const win = useWindowWidth()
  const fit = fitPanels(
    win.width,
    { open: layout.binderOpen, width: layout.binderWidth, floor: BINDER.floor },
    { open: scenePanel && layout.inspectorOpen, width: layout.inspectorWidth, floor: SCENE_PANEL.floor }
  )

  return (
    <>
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <ResizablePane
          side="left"
          label="Binder"
          width={layout.binderOpen ? fit.left : layout.binderWidth}
          open={layout.binderOpen}
          min={BINDER.min}
          max={dragMax(win.width, fit.right, BINDER.min, BINDER.max)}
          instant={win.resizing}
          onResize={(w) => void update({ layout: { binderWidth: w } })}
        >
          <Binder />
        </ResizablePane>
        <main className="relative min-w-0 flex-1 bg-bg">
          {/* The writing view stays in place under the other pages, so a draft keeps writing into the scene
              while Adam looks at something else, and the page and caret are where he left them. Hidden with
              visibility (not display), which keeps its scroll position. */}
          <div className={cn('h-full', !writing && 'invisible pointer-events-none')} inert={!writing}>
            <SceneView />
          </div>
          {!writing ? (
            <div className="absolute inset-0 bg-bg">
              {view.kind === 'entries' && <EntriesView kind={view.entryKind} entryId={view.entryId} from={view.from} />}
              {view.kind === 'style' && <StyleView />}
              {view.kind === 'settings' && <SettingsView tab={view.tab} />}
              {view.kind === 'generation' && <WhatTheAISaw generationId={view.generationId} />}
              {view.kind === 'memory' && <WhatChanged sceneId={view.sceneId} />}
            </div>
          ) : null}
        </main>
        {scenePanel && sceneId ? (
          <ResizablePane
            side="right"
            label="Scene panel"
            width={layout.inspectorOpen ? fit.right : layout.inspectorWidth}
            open={layout.inspectorOpen}
            min={SCENE_PANEL.min}
            max={dragMax(win.width, fit.left, SCENE_PANEL.min, SCENE_PANEL.max)}
            instant={win.resizing}
            onResize={(w) => void update({ layout: { inspectorWidth: w } })}
          >
            <Inspector sceneId={sceneId} />
          </ResizablePane>
        ) : null}
      </div>
    </>
  )
}
