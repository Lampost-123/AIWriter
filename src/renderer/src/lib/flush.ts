import { api, onEvent } from './api'
import { editorBridge } from './editorBridge'
import { useApp } from './store'

// Anything holding unsaved work registers a flusher. Flushers run before the
// window closes and before switching worlds, so a keystroke is never lost.

const flushers = new Set<() => Promise<void> | void>()

export function registerFlusher(fn: () => Promise<void> | void): () => void {
  flushers.add(fn)
  return () => flushers.delete(fn)
}

export async function flushAll(): Promise<void> {
  await Promise.allSettled([...flushers].map((fn) => fn()))
}

// After a backup is restored, the world's file has been swapped underneath the open
// views. Anything still holding changes from before must drop them rather than save
// them into the restored world. Discarders run just before those views reload.

const discarders = new Set<() => void>()

export function registerDiscarder(fn: () => void): () => void {
  discarders.add(fn)
  return () => discarders.delete(fn)
}

export function discardAll(): void {
  for (const fn of [...discarders]) {
    try {
      fn()
    } catch {
      /* one view failing to let go must not stop the others */
    }
  }
}

/**
 * Before the open world changes: stops a draft that is still being written, so its last
 * words are in the page (and saved) before the world closes, then saves everything.
 */
export async function flushBeforeWorldChange(): Promise<void> {
  const g = useApp.getState().activeGeneration
  if (g) {
    await editorBridge()
      ?.stopDraft('world')
      .catch(() => undefined)
    // Main finishes the record (and sends its last words) before this returns.
    await api.stopGeneration(g.id).catch(() => undefined)
  }
  await flushAll()
}

/** The window is closing: a draft still being written stops first, so its last words are saved too. */
async function stopDraftForClose(): Promise<void> {
  const g = useApp.getState().activeGeneration
  if (!g) return
  // Main sends the last words before this returns. Capped, so closing never waits on it for long.
  await Promise.race([api.stopGeneration(g.id).catch(() => undefined), new Promise((r) => setTimeout(r, 1000))])
}

export function installFlushOnClose(): () => void {
  const off = onEvent('app:flush', () => {
    void stopDraftForClose()
      .then(flushAll)
      .finally(() => api.flushDone())
  })
  // If the page is ever reloaded (only possible while developing), save what we can first.
  const onPageHide = (): void => void flushAll()
  window.addEventListener('pagehide', onPageHide)
  return () => {
    off()
    window.removeEventListener('pagehide', onPageHide)
  }
}
