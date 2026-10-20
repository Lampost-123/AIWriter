// The memory's changes, taken together (overhaul Phase 6). The main process says 'memory:changed' after each save the
// memory keeper, an undo or Adam makes, often many in a row (a scene read, a World build, voices given out), and every
// list, page and panel showing memory read it all again each time: a storm of reloads, each a database query. Now the
// changes that come within CHANGE_WINDOW_MS of the first are gathered, and once that time is up each kind of view
// reloads once, and only the kinds that changed. Pure but for the timer, so it is unit-tested.
import type { AppEvents } from '@shared/api'

export type MemoryChange = AppEvents['memory:changed']

/** How long changes are gathered after the first, before the views reload. */
export const CHANGE_WINDOW_MS = 400

/** What a batch of changes asks to read again. */
export interface Reloads {
  /** What the memory holds (the Context tab, What changed, timelines, boards). Every change. */
  memory: boolean
  /** The entries themselves (lists, entry pages, names): when a change names entries, or wasn't about any one thing. */
  entries: boolean
  /**
   * The outline (the binder, each scene's memory mark): unless every change was a World build's save while it runs
   * (sceneId ''), which only adds entries; its last save, at the end, is null.
   */
  outline: boolean
  /** The stories: when a change wasn't about one scene (a story's placement changed, say). */
  stories: boolean
}

/** What the changes ask to read again. */
export function reloadsFor(changes: readonly MemoryChange[]): Reloads {
  return {
    memory: changes.length > 0,
    entries: changes.some((c) => c.entryIds.length > 0 || c.sceneId === null),
    outline: changes.some((c) => c.sceneId !== ''),
    stories: changes.some((c) => c.sceneId === null)
  }
}

export interface ChangeBatcher {
  /** One change: the views reload once the window from the first change in the batch is up. */
  push(change: MemoryChange): void
  /** Reloads now for the changes gathered so far, if any. */
  flush(): void
  /** Forgets the changes gathered so far (the window is going). */
  cancel(): void
}

/**
 * Gathers changes and calls `reload` once per window (trailing: CHANGE_WINDOW_MS after the first change of a batch,
 * never pushed back by later ones, so a long run of changes still shows as it goes).
 */
export function createChangeBatcher(reload: (r: Reloads, changes: MemoryChange[]) => void, wait = CHANGE_WINDOW_MS): ChangeBatcher {
  let pending: MemoryChange[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
    if (!pending.length) return
    const changes = pending
    pending = []
    reload(reloadsFor(changes), changes)
  }
  return {
    push(change) {
      pending.push(change)
      timer ??= setTimeout(flush, wait)
    },
    flush,
    cancel() {
      if (timer) clearTimeout(timer)
      timer = null
      pending = []
    }
  }
}
