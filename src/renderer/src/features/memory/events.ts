// Keeps the interface in step with the memory keeper: its status for the top bar, and a reload
// of whatever shows memory (entry lists, the scene card's summary, the Context tab) when it changes.
import { api, onEvent } from '@/lib/api'
import { useApp } from '@/lib/store'

/** Installed once, beside the window's flush-on-close. Returns the uninstaller. */
export function installMemoryEvents(): () => void {
  const offStatus = onEvent('memory:status', (status) => useApp.getState().setMemoryStatus(status))
  const offChanged = onEvent('memory:changed', () => {
    const app = useApp.getState()
    app.bumpEntries()
    app.bumpMemory()
  })

  // Each world has its own memory keeper: ask what it is doing whenever a world opens.
  let worldId: string | null = null
  const follow = (id: string | null): void => {
    if (id === worldId) return
    worldId = id
    useApp.getState().setMemoryStatus(null)
    if (!id) return
    api
      .getMemoryStatus()
      .then((status) => {
        if (useApp.getState().world?.id === id) useApp.getState().setMemoryStatus(status)
      })
      // Not known: the top bar simply shows nothing until the keeper next says what it is doing.
      .catch(() => undefined)
  }
  follow(useApp.getState().world?.id ?? null)
  const offWorld = useApp.subscribe((s) => follow(s.world?.id ?? null))

  return () => {
    offStatus()
    offChanged()
    offWorld()
  }
}
