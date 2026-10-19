// Keeps the interface and the memory in step: the memory's status for the top bar, a reload of
// whatever shows memory (entry lists, the scene card's summary, the Context tab) when it changes,
// and telling the memory when Adam leaves a scene, so it reads that scene's latest words then.
import type { ID } from '@shared/types'
import { api, onEvent } from '@/lib/api'
import { flushAll } from '@/lib/flush'
import { useApp } from '@/lib/store'
import { createChangeBatcher } from './changeBatch'
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
  // Changes that come close together are taken together (changeBatch.ts): each kind of view reads again once, and only
  // the kinds that changed, rather than every list and page once for every save.
  const batch = createChangeBatcher((r) => {
    const app = useApp.getState()
    // Open entry pages and lists show what the memory now holds.
    if (r.entries) app.bumpEntries()
    if (r.memory) app.bumpMemory()
    // A scene's "Memory not updated" mark may have come or gone.
    if (r.outline) app.bumpOutline()
    // Not about one scene (a story's placement changed, say): the stories themselves may have changed too. A World
    // build's saves while it runs come as '' (2026-10-17): entries only, so the stories aren't read again each time;
    // its last one, at the end, is null.
    if (r.stories) void app.refreshStories().catch(() => undefined)
  })
  const offChanged = onEvent('memory:changed', (change) => batch.push(change))

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
    batch.cancel()
    offState()
  }
}
