// What the start screen shows: every world with its stories, Recently deleted and where Adam left off
// (getLibrary), read each time the start screen shows and after anything on it changes. The last list stays on
// screen while it is read again, so nothing flickers.

import { create } from 'zustand'
import type { ID } from '@shared/types'
import type { DeletedWorld, LibraryOverview, LibraryStory, LibraryWorld } from '@shared/contracts/library'
import { api } from '@/lib/api'

interface LibraryState {
  overview: LibraryOverview | null
  /** Plain words when the library couldn't be read (with Try again). */
  error: string | null
  /** Worlds whose card is open to show its stories, kept while the app runs. */
  expanded: Record<ID, boolean>
  /**
   * Something on the start screen is opening or closing a world underneath it (deleting a story in another world,
   * New story…, Continue): nothing else that opens or changes a world can start until it is done.
   */
  busy: boolean
}

export const useLibrary = create<LibraryState>(() => ({ overview: null, error: null, expanded: {}, busy: false }))

/**
 * Runs one thing that opens, closes or changes a world from the start screen, unless another is under way (then
 * it does nothing). The start screen's controls rest meanwhile.
 */
export async function exclusive(run: () => Promise<void>): Promise<void> {
  if (useLibrary.getState().busy) return
  useLibrary.setState({ busy: true })
  try {
    await run()
  } finally {
    useLibrary.setState({ busy: false })
  }
}

/** A world was just deleted: it leaves the list (and Continue) at once, and waits in Recently deleted. */
export function dropWorld(worldId: ID, gone: DeletedWorld): void {
  const o = useLibrary.getState().overview
  if (!o) return
  useLibrary.setState({
    overview: {
      ...o,
      worlds: o.worlds.filter((w) => w.id !== worldId),
      deleted: [gone, ...o.deleted.filter((d) => d.trashId !== gone.trashId)],
      last: o.last?.worldId === worldId ? null : o.last
    }
  })
}

let latest = 0

/** Reads the library again. */
export async function loadLibrary(): Promise<LibraryOverview | null> {
  const ticket = ++latest
  try {
    const overview = await api.getLibrary()
    if (ticket === latest) useLibrary.setState({ overview, error: null })
    return overview
  } catch (e) {
    if (ticket === latest) useLibrary.setState({ error: (e as Error).message || 'AI Write couldn’t read your library.' })
    return null
  }
}

/** Changes one world as shown (a rename), until the library is read again. */
export function patchWorld(worldId: ID, patch: Partial<LibraryWorld>): void {
  const o = useLibrary.getState().overview
  if (!o) return
  useLibrary.setState({ overview: { ...o, worlds: o.worlds.map((w) => (w.id === worldId ? { ...w, ...patch } : w)) } })
}

/** Changes one story as shown (a rename), until the library is read again. */
export function patchStory(worldId: ID, storyId: ID, patch: Partial<LibraryStory>): void {
  const o = useLibrary.getState().overview
  if (!o) return
  useLibrary.setState({
    overview: {
      ...o,
      worlds: o.worlds.map((w) => (w.id === worldId ? { ...w, stories: w.stories.map((s) => (s.id === storyId ? { ...s, ...patch } : s)) } : w))
    }
  })
}

export function setExpanded(worldId: ID, open: boolean): void {
  useLibrary.setState((s) => ({ expanded: { ...s.expanded, [worldId]: open } }))
}
