// What the story board does to the story: a planned scene added at the end of a chapter, staying on the board.
import type { ID } from '@shared/types'
import { toast } from '@/components/ui'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { useBoardStore } from './boardStore'

/**
 * Adds a planned scene at the end of a chapter, staying on the board, and shows its card. A plain card: it never asks
 * the AI (no paid call on a plain click); the amber button and a card's Ideas do that.
 */
export async function addSceneTo(chapterId: ID, title?: string): Promise<ID | null> {
  try {
    const scene = await api.createScene(chapterId, title ? { title } : {})
    useApp.getState().bumpOutline()
    useBoardStore.setState({ fresh: scene.id })
    return scene.id
  } catch (e) {
    toast((e as Error).message, { tone: 'danger' })
    return null
  }
}
