import { api, onEvent } from './api'

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

export function installFlushOnClose(): () => void {
  return onEvent('app:flush', () => {
    void flushAll().finally(() => api.flushDone())
  })
}
