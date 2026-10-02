// A scene's names (see getSceneNames in src/shared/contracts/manuscript.ts), shared by the page's
// underlines and hover cards, the Cast tab and the entry beside the page: one call per scene, made
// again when entries, the memory or the scene card change. The last answer stays on screen while a
// newer one loads, and the last few scenes are kept, so switching back to one shows it at once.
import { useCallback, useEffect } from 'react'
import { create } from 'zustand'
import type { ID } from '@shared/types'
import type { SceneNames } from '@shared/contracts/manuscript'
import { api } from '@/lib/api'
import { registerDiscarder } from '@/lib/flush'
import { useApp } from '@/lib/store'

interface Loaded {
  data: SceneNames | null
  /** The revision it was loaded at (see revision()). */
  rev: string | null
  error: string | null
}

interface NamesState {
  scenes: Record<ID, Loaded>
  /** The entries named in the open scene's text, as the page has it now (kept up to date by the page). */
  named: { sceneId: ID | null; ids: ID[] }
}

export const useNamesStore = create<NamesState>(() => ({ scenes: {}, named: { sceneId: null, ids: [] } }))

/** How many scenes' names are kept. */
const KEEP = 8

/** What a scene's names depend on: the world, its entries, the memory and the scene card. */
const revision = (s: ReturnType<typeof useApp.getState>): string => `${s.world?.id ?? ''}:${s.entriesRev}:${s.memoryRev}:${s.briefingRev}`

/** The revision each scene was last asked for: only the newest answer is kept. */
const asked = new Map<ID, string>()

// After a backup is restored the names are from the world before it.
registerDiscarder(() => {
  asked.clear()
  useNamesStore.setState({ scenes: {}, named: { sceneId: null, ids: [] } })
})

function put(sceneId: ID, loaded: Loaded): void {
  const scenes = { ...useNamesStore.getState().scenes }
  delete scenes[sceneId]
  scenes[sceneId] = loaded
  // Oldest first, so the scenes not looked at for longest go.
  const ids = Object.keys(scenes)
  for (const id of ids.slice(0, Math.max(0, ids.length - KEEP))) delete scenes[id]
  useNamesStore.setState({ scenes })
}

/** Loads a scene's names now. */
export async function loadSceneNames(sceneId: ID): Promise<void> {
  const rev = revision(useApp.getState())
  if (asked.get(sceneId) === rev) return
  asked.set(sceneId, rev)
  try {
    const data = await api.getSceneNames(sceneId)
    if (asked.get(sceneId) === rev) put(sceneId, { data, rev, error: null })
  } catch (e) {
    if (asked.get(sceneId) !== rev) return
    // Asked again next time; the last names stay meanwhile.
    asked.delete(sceneId)
    const prev = useNamesStore.getState().scenes[sceneId]
    put(sceneId, { data: prev?.data ?? null, rev: prev?.rev ?? null, error: (e as Error).message })
  }
}

/** The names of one scene from the cache (null until loaded), without asking for them. */
export const cachedNames = (sceneId: ID | null): SceneNames | null =>
  sceneId ? (useNamesStore.getState().scenes[sceneId]?.data ?? null) : null

export interface SceneNamesResult {
  data: SceneNames | null
  /** The data is for the world as it is now (false while a newer answer loads). */
  fresh: boolean
  error: string | null
  retry: () => void
}

/**
 * A scene's names, loaded when first asked for and again when what they depend on changes (`active`
 * false holds that off, while the writing page is hidden). The last answer stays while a newer loads.
 */
export function useSceneNames(sceneId: ID | null, active = true): SceneNamesResult {
  const rev = useApp(revision)
  const loaded = useNamesStore((s) => (sceneId ? s.scenes[sceneId] : undefined))
  useEffect(() => {
    if (!sceneId || !active) return
    const cur = useNamesStore.getState().scenes[sceneId]
    if (cur?.rev === rev && !cur.error) return
    // The first time straight away; after a change, a moment later, so a burst of changes asks once.
    const t = setTimeout(() => void loadSceneNames(sceneId), cur?.data ? 120 : 0)
    return () => clearTimeout(t)
  }, [sceneId, rev, active])
  const retry = useCallback(() => {
    if (!sceneId) return
    asked.delete(sceneId)
    void loadSceneNames(sceneId)
  }, [sceneId])
  return { data: loaded?.data ?? null, fresh: !!loaded?.data && loaded.rev === rev, error: loaded?.error ?? null, retry }
}

/** Sets the entries named in the open scene's text (the page calls this as the text changes). */
export function setNamedInScene(sceneId: ID | null, ids: ID[]): void {
  const cur = useNamesStore.getState().named
  if (cur.sceneId === sceneId && cur.ids.length === ids.length && cur.ids.every((id, i) => id === ids[i])) return
  useNamesStore.setState({ named: { sceneId, ids } })
}
