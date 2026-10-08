// The scene card in the desk's margin (UI overhaul, phase 3): pinned beside the page's title, as a ruled index card with
// the scene's place, point of view and beats (written ✓, the next one marked). Edit opens the whole card in the scene
// drawer; an empty card offers Ideas for this scene and Interview me, as the palette does.
import type { ID } from '@shared/types'
import { useApp } from '@/lib/store'
import { SceneCardSummary } from '@/features/inspector/SceneCardSummary'
import { showSceneIdeas, showSceneInterview } from '@/features/outline/ideas'
import { useDeskCard, useSceneCard } from '../../sceneCard'

/** Opens the scene drawer on the card. */
export function openCardInDrawer(): void {
  const app = useApp.getState()
  if (app.askOpen) app.setAskOpen(false)
  if (app.peekEntryId) app.peekEntry(null)
  app.setInspectorTab('card')
  if (!app.settings?.layout.inspectorOpen) void app.updateSettings({ layout: { inspectorOpen: true } })
}

export function SceneCardSlip({ sceneId }: { sceneId: ID }): React.JSX.Element | null {
  const card = useSceneCard(sceneId)
  const beatsDone = useDeskCard((s) => s.beatsDone)
  if (!card) return null
  return (
    <SceneCardSummary
      sceneId={sceneId}
      empty={card.empty}
      place={card.place?.name ?? null}
      pov={card.pov?.name ?? null}
      beats={card.beats}
      beatsDone={beatsDone}
      onEdit={openCardInDrawer}
      onIdeas={() => showSceneIdeas(sceneId)}
      onInterview={() => showSceneInterview(sceneId)}
    />
  )
}
