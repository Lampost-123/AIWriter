// Opening a scene's history (from the toolbar, the palette or a message). Owned by the History part.
import type { ID } from '@shared/types'
import { flushAll } from '@/lib/flush'
import { useApp } from '@/lib/store'

/** Saves the page, then shows the scene's history. */
export async function openHistory(sceneId: ID): Promise<void> {
  await flushAll()
  useApp.getState().navigate({ kind: 'history', sceneId })
}
