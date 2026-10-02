// The places Adam visited lately (scenes and entries), for the palette's "Recent" list. Kept per
// world in this computer's browser storage, which is optional: without it the list is just empty.

import type { ID } from '@shared/types'
import type { SearchPlace } from '@shared/contracts/search'
import { useApp } from '@/lib/store'
import { remember } from './paletteLogic'

const KEY = 'aiwrite.palette.recent'

function readAll(): Record<ID, SearchPlace[]> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<ID, SearchPlace[]>) : {}
  } catch {
    return {}
  }
}

/** This world's recent places, newest first. */
export function recentPlaces(worldId: ID): SearchPlace[] {
  const list = readAll()[worldId]
  return Array.isArray(list) ? list.filter((p) => p && (p.kind === 'scene' || p.kind === 'entry') && typeof p.id === 'string') : []
}

function record(worldId: ID, place: SearchPlace): void {
  try {
    const all = readAll()
    all[worldId] = remember(recentPlaces(worldId), place)
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    // Not remembered this time.
  }
}

/** Remembers each scene and entry page Adam opens. Returns a function that stops it. */
export function followRecent(): () => void {
  let last: { sceneId: ID | null; entryId: ID | null } = { sceneId: null, entryId: null }
  return useApp.subscribe((s) => {
    const entryId = s.view.kind === 'entries' || s.view.kind === 'builder' ? s.view.entryId : null
    const worldId = s.world?.id
    if (worldId) {
      if (s.sceneId && s.sceneId !== last.sceneId) record(worldId, { kind: 'scene', id: s.sceneId })
      if (entryId && entryId !== last.entryId) record(worldId, { kind: 'entry', id: entryId })
    }
    last = { sceneId: s.sceneId, entryId }
  })
}
