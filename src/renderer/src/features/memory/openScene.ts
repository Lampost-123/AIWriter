import type { ID } from '@shared/types'
import { toast } from '@/components/ui'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { useOutlineStore } from '@/features/binder/outlineStore'
import { requestReveal } from '@/features/editor/reveal'

/** The story a scene is in: the open story's outline first, then each story's in turn. */
async function storyOfScene(sceneId: ID): Promise<ID | null> {
  const open = useOutlineStore.getState().outline
  if (open?.scenes.some((s) => s.id === sceneId)) return open.story.id
  for (const story of useApp.getState().stories) {
    if (story.id === open?.story.id) continue
    const outline = await api.getOutline(story.id)
    if (outline.scenes.some((s) => s.id === sceneId)) return story.id
  }
  return null
}

/** Opens a scene from anywhere (the "What changed" list), in whichever story it is in. */
export async function openScene(sceneId: ID): Promise<void> {
  try {
    const storyId = await storyOfScene(sceneId)
    if (!storyId) {
      toast("That scene isn't in any story now. It may have been deleted.")
      return
    }
    useApp.getState().selectScene(sceneId, storyId)
  } catch (e) {
    toast((e as Error).message)
  }
}

/**
 * Opens a scene at the words a fact came from (Jump to source, World Memory Overhaul B2): the words are selected and
 * scrolled into view, looked for in their own paragraph first; words edited since show that paragraph instead.
 */
export function showWords(sceneId: ID, quote: string, paragraphId?: string | null): void {
  requestReveal(sceneId, quote, { paragraphId: paragraphId ?? null })
  void openScene(sceneId)
}
