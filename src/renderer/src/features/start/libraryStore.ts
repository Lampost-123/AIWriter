// What the start screen shows: every world with its stories, Recently deleted and where Adam left off
// (getLibrary), read each time the start screen shows and after anything on it changes. The last list stays on
// screen while it is read again, so nothing flickers.

import { create } from 'zustand'
import type { ID } from '@shared/types'
import type { LibraryOverview, LibraryStory, LibraryWorld } from '@shared/contracts/library'
import { api } from '@/lib/api'

interface LibraryState {
  overview: LibraryOverview | null
  /** Plain words when the library couldn't be read (with Try again). */
  error: string | null
  /** Worlds whose card is open to show its stories, kept while the app runs. */
  expanded: Record<ID, boolean>
}

export const useLibrary = create<LibraryState>(() => ({ overview: null, error: null, expanded: {} }))

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
