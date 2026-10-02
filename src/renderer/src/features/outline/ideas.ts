// Asking for next scene ideas from the palette ("Ideas for this scene"). Owned by the Outline part.
import type { ID } from '@shared/types'
import { useApp } from '@/lib/store'
import { revealIdeas } from './ideasStore'

/** Opens the scene's card beside the page and asks for three directions for the scene (or shows the ones already there). */
export function showSceneIdeas(sceneId: ID): void {
  const app = useApp.getState()
  if (app.sceneId !== sceneId) app.selectScene(sceneId)
  if (app.askOpen) app.setAskOpen(false)
  if (app.peekEntryId) app.peekEntry(null)
  app.setInspectorTab('card')
  const layout = useApp.getState().settings?.layout
  if (layout && !layout.inspectorOpen) void app.updateSettings({ layout: { inspectorOpen: true } })
  revealIdeas(sceneId)
}
