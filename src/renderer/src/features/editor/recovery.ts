import type { ID, RecoveryItem, Scene } from '@shared/types'

/**
 * Whether a recovery file holds writing that never reached the database:
 * it was written after the scene's last save and differs from what's saved.
 */
export function shouldRestore(item: Pick<RecoveryItem, 'savedAt' | 'text' | 'doc'>, scene: Pick<Scene, 'updatedAt' | 'text' | 'doc'>): boolean {
  if (!(item.savedAt > scene.updatedAt)) return false
  if (item.text !== scene.text) return true
  return JSON.stringify(item.doc ?? null) !== JSON.stringify(scene.doc ?? null)
}

/** Recovery items for the open world, newest first per scene. */
export function itemsForWorld(items: RecoveryItem[], worldId: ID): RecoveryItem[] {
  const latest = new Map<ID, RecoveryItem>()
  for (const it of items) {
    if (it.worldId !== worldId) continue
    const prev = latest.get(it.sceneId)
    if (!prev || it.savedAt > prev.savedAt) latest.set(it.sceneId, it)
  }
  return [...latest.values()]
}
