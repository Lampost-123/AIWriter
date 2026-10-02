// Opening a story's settings at one of its parts ("Choose cast" in a toast). On its own so the flows'
// quiet line (flows.ts) can open it too without importing storyActions, which imports the flows.
import { create } from 'zustand'
import type { ID } from '@shared/types'
import { useApp } from '@/lib/store'

/**
 * A section of a story's settings to open at ("Choose cast" in a toast): that story's page brings it
 * into view and takes it, whether it opens now or is already open.
 */
export const useSectionRequest = create<{ request: { storyId: ID; section: string } | null }>(() => ({ request: null }))

/** Opens a story's settings, at a section if given. */
export function openStorySettings(storyId: ID, section?: string): void {
  useSectionRequest.setState({ request: section ? { storyId, section } : null })
  useApp.getState().navigate({ kind: 'story', storyId })
}
