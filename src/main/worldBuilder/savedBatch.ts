// What a build saved, told to the window in batches (2026-10-17): a build saves an entry every moment or two, and each
// "memory:changed" made the window read the codex, the timeline and the stories again. During a build the entries saved
// are told at most once every half second; the end of the build tells the rest at once. No Electron imports.

import type { ID } from '@shared/types'

/** The longest the window waits to hear what a build saved. */
export const SAVED_EVERY_MS = 500

export interface SavedBatch {
  /** Entries saved: told within SAVED_EVERY_MS, together with any saved meanwhile. */
  add(entryIds: ID[]): void
  /** The build ended: what is waiting is told now (an empty list when nothing is). */
  flush(): ID[]
  /** The world closed: nothing more is told. */
  drop(): void
}

export function savedBatch(
  send: (entryIds: ID[]) => void,
  o: { every?: number; now?: () => number; setTimer?: typeof setTimeout; clearTimer?: typeof clearTimeout } = {}
): SavedBatch {
  const every = o.every ?? SAVED_EVERY_MS
  const clock = o.now ?? Date.now
  const setTimer = o.setTimer ?? setTimeout
  const clearTimer = o.clearTimer ?? clearTimeout
  let waiting = new Set<ID>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let last = -Infinity
  const fire = (): void => {
    timer = null
    last = clock()
    const ids = [...waiting]
    waiting = new Set()
    send(ids)
  }
  return {
    add(entryIds) {
      for (const id of entryIds) waiting.add(id)
      if (timer) return
      timer = setTimer(fire, Math.max(0, last + every - clock()))
    },
    flush() {
      if (timer) clearTimer(timer)
      timer = null
      const ids = [...waiting]
      waiting = new Set()
      return ids
    },
    drop() {
      if (timer) clearTimer(timer)
      timer = null
      waiting = new Set()
    }
  }
}
