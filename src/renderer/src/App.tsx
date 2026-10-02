import { useEffect } from 'react'
import { Toaster } from '@/components/ui'
import { api } from '@/lib/api'
import { installFlushOnClose } from '@/lib/flush'
import { useApp } from '@/lib/store'
import { useTheme } from '@/lib/theme'
import { ResizablePane } from '@/layout/ResizablePane'
import { TopBar } from '@/layout/TopBar'
import { Inspector } from '@/layout/Inspector'
import { UpdateBanner } from '@/layout/UpdateBanner'
import { Welcome } from '@/features/welcome/Welcome'
import { Binder } from '@/features/binder/Binder'
import { SceneView } from '@/features/editor/SceneView'
import { EntriesView } from '@/features/world/EntriesView'
import { StyleView } from '@/features/style/StyleView'
import { SettingsView } from '@/features/settings/SettingsView'
import { WhatTheAISaw } from '@/features/generate/WhatTheAISaw'

export function App(): React.JSX.Element | null {
  const ready = useApp((s) => s.ready)
  const init = useApp((s) => s.init)
  const settings = useApp((s) => s.settings)
  const world = useApp((s) => s.world)

  useTheme(settings?.theme)
  useEffect(() => {
    void init()
    return installFlushOnClose()
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
    <div className="flex h-full flex-col">
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

function Workspace(): React.JSX.Element {
  const settings = useApp((s) => s.settings)!
  const update = useApp((s) => s.updateSettings)
  const view = useApp((s) => s.view)
  const sceneId = useApp((s) => s.sceneId)
  const { layout } = settings

  return (
    <>
      <TopBar />
      <UpdateBanner />
      <div className="flex min-h-0 flex-1">
        <ResizablePane
          side="left"
          label="Binder"
          width={layout.binderWidth}
          open={layout.binderOpen}
          min={220}
          max={440}
          onResize={(w) => void update({ layout: { binderWidth: w } })}
        >
          <Binder />
        </ResizablePane>
        <main className="min-w-0 flex-1 bg-bg">
          {view.kind === 'write' && <SceneView />}
          {view.kind === 'entries' && <EntriesView kind={view.entryKind} entryId={view.entryId} />}
          {view.kind === 'style' && <StyleView />}
          {view.kind === 'settings' && <SettingsView tab={view.tab} />}
          {view.kind === 'generation' && <WhatTheAISaw generationId={view.generationId} />}
        </main>
        {view.kind === 'write' && sceneId ? (
          <ResizablePane
            side="right"
            label="Scene panel"
            width={layout.inspectorWidth}
            open={layout.inspectorOpen}
            min={280}
            max={520}
            onResize={(w) => void update({ layout: { inspectorWidth: w } })}
          >
            <Inspector sceneId={sceneId} />
          </ResizablePane>
        ) : null}
      </div>
    </>
  )
}
