// "Mark paid off" on an open plot thread's card (the desk's plot threads page): Adam picks the scene that pays it off,
// and that scene's card opens with the thread added under Pays off, through the card's own field and save (nothing else
// is new: it is what typing its name there does). The request waits here until the scene's card has loaded; Undo takes
// it off again, through the card on screen if it is still open, or through the same save otherwise.
import type { ID } from '@shared/types'
import { withListEdited } from '@shared/threadLinks'
import { emptySceneCard } from '@shared/defaults'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { openSceneTab } from '@/layout/areaLinks'

export interface PayOffRequest {
  sceneId: ID
  threadId: ID
  name: string
}

let pending: PayOffRequest | null = null

/** Opens the scene's card with the thread to be added under Pays off. */
export function markPaidOff(req: PayOffRequest, storyId: ID): void {
  pending = req
  const app = useApp.getState()
  app.selectScene(req.sceneId, storyId)
  openSceneTab('card')
}

/** The scene card takes the request meant for it (once). */
export function takePayOff(sceneId: ID): PayOffRequest | null {
  if (!pending || pending.sceneId !== sceneId) return null
  const req = pending
  pending = null
  return req
}

/** The scene cards on screen: how to take a thread off their Pays off. */
const panels = new Map<ID, (threadId: ID) => void>()

export function registerPayOffPanel(sceneId: ID, remove: (threadId: ID) => void): () => void {
  panels.set(sceneId, remove)
  return () => {
    if (panels.get(sceneId) === remove) panels.delete(sceneId)
  }
}

/** Undo: the thread comes off the scene's Pays off again. */
export async function undoPayOff(sceneId: ID, threadId: ID): Promise<void> {
  const panel = panels.get(sceneId)
  if (panel) return panel(threadId)
  const s = await api.getScene(sceneId)
  const card = { ...emptySceneCard(), ...s.card }
  const next = withListEdited(card, 'paysOff', card.paysOffIds.filter((id) => id !== threadId))
  await api.updateSceneCard(sceneId, { ...card, paysOffIds: next.paysOffIds, threadLinks: next.threadLinks })
  useApp.getState().bumpBriefing()
}
