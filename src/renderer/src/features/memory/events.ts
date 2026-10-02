// Keeps the interface and the memory in step: the memory's status for the top bar, a reload of
// whatever shows memory (entry lists, the scene card's summary, the Context tab) when it changes,
// and telling the memory when Adam leaves a scene, so it reads that scene's latest words then.
import type { ID } from '@shared/types'
import { api, onEvent } from '@/lib/api'
import { flushAll } from '@/lib/flush'
import { useApp } from '@/lib/store'
import { createLeaveTracker } from './leaving'

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
  const offChanged = onEvent('memory:changed', (change) => {
    const app = useApp.getState()
    // Every time, so open entry pages and lists show what the memory now holds.
    app.bumpEntries()
    app.bumpMemory()
    // A scene's "Memory not updated" mark may have come or gone.
    app.bumpOutline()
    // Not about one scene (a story's placement changed, say): the stories themselves may have changed too.
    if (change.sceneId === null) void app.refreshStories().catch(() => undefined)
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

  // The scene Adam left (for another scene or page) is read once its last words are saved.
  const track = createLeaveTracker()
  const onState = (): void => {
    const s = useApp.getState()
    follow(s.world?.id ?? null)
    const here = s.view.kind === 'write' && s.sceneId && s.world ? { sceneId: s.sceneId, worldId: s.world.id } : null
    for (const left of track({ here, worldId: s.world?.id ?? null, drafting: s.activeGeneration?.sceneId ?? null })) {
      void flushAll()
        .then(() => (useApp.getState().world?.id === left.worldId ? api.sceneLeft(left.sceneId) : undefined))
        .catch(() => undefined)
    }
  }
  onState()
  const offState = useApp.subscribe(onState)

  return () => {
    offStatus()
    offChanged()
    offState()
  }
}
