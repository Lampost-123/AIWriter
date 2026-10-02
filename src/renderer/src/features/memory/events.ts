// Keeps the interface and the memory in step: the memory's status for the top bar, a reload of
// whatever shows memory (entry lists, the scene card's summary, the Context tab) when it changes,
// and telling the memory when Adam leaves a scene, so it reads that scene's latest words then.
import type { ID } from '@shared/types'
import { api, onEvent } from '@/lib/api'
import { flushAll } from '@/lib/flush'
import { useApp } from '@/lib/store'

/** Installed once, beside the window's flush-on-close. Returns the uninstaller. */
export function installMemoryEvents(): () => void {
  const offStatus = onEvent('memory:status', (status) => {
    const app = useApp.getState()
    const before = app.memoryStatus
    app.setMemoryStatus(status)
    // A read finished or failed: the binder and the scene header show each scene's memory state.
    if (before && ((before.reading && before.reading.sceneId !== status.reading?.sceneId) || before.failed !== status.failed))
      app.bumpOutline()
  })
  const offChanged = onEvent('memory:changed', () => {
    const app = useApp.getState()
    app.bumpEntries()
    app.bumpMemory()
    // A scene's "Memory not updated" mark may have come or gone.
    app.bumpOutline()
  })

  // Each world has its own memory: ask what it is doing whenever a world opens.
  let worldId: ID | null = null
  const follow = (id: ID | null): void => {
    if (id === worldId) return
    worldId = id
    useApp.getState().setMemoryStatus(null)
    if (!id) return
    api
      .getMemoryStatus()
      .then((status) => {
        if (useApp.getState().world?.id === id) useApp.getState().setMemoryStatus(status)
      })
      // Not known: the top bar simply shows nothing until the memory next says what it is doing.
      .catch(() => undefined)
  }

  // The scene Adam is writing in. When he opens another scene or another page, the one he left is
  // read once its last words are saved. Not on a world switch (that world reads its scenes when it
  // next opens), and not while a draft is still being written into it (it is read once that ends).
  let writingIn: { sceneId: ID; worldId: ID } | null = null
  const leave = (left: { sceneId: ID; worldId: ID }): void => {
    const app = useApp.getState()
    if (app.world?.id !== left.worldId || app.activeGeneration?.sceneId === left.sceneId) return
    void flushAll()
      .then(() => (useApp.getState().world?.id === left.worldId ? api.sceneLeft(left.sceneId) : undefined))
      .catch(() => undefined)
  }

  const onState = (): void => {
    const s = useApp.getState()
    follow(s.world?.id ?? null)
    const here = s.view.kind === 'write' && s.sceneId && s.world ? { sceneId: s.sceneId, worldId: s.world.id } : null
    if (writingIn && (here?.sceneId !== writingIn.sceneId || here?.worldId !== writingIn.worldId)) leave(writingIn)
    writingIn = here
  }
  onState()
  const offState = useApp.subscribe(onState)

  return () => {
    offStatus()
    offChanged()
    offState()
  }
}
