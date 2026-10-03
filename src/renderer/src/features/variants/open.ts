// Opening Variants for a scene (from the toolbar or the palette). Owned by the Variants part.
import type { ID } from '@shared/types'
import { useApp } from '@/lib/store'

export function openVariants(sceneId: ID): void {
  useApp.getState().navigate({ kind: 'variants', sceneId })
}
