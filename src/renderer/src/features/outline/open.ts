// Opening the outline helper for a story. Owned by the Outline part.
import type { ID } from '@shared/types'
import { useApp } from '@/lib/store'

export function openOutlineHelper(storyId: ID): void {
  useApp.getState().navigate({ kind: 'outline', storyId })
}
