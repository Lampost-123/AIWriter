import type { ID } from '@shared/types'

// The scene last open in each story, so switching back to a story reopens it.
// Kept in browser storage on this computer; optional.

const KEY = 'aiwrite.binder.lastScene'

function read(): Record<ID, ID> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<ID, ID>) : {}
  } catch {
    return {}
  }
}

export function lastSceneOf(storyId: ID): ID | null {
  const v = read()[storyId]
  return typeof v === 'string' ? v : null
}

export function rememberScene(storyId: ID, sceneId: ID): void {
  try {
    const all = read()
    if (all[storyId] === sceneId) return
    all[storyId] = sceneId
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    // Not remembered this time.
  }
}
