// Next scene ideas: on an empty scene card, three possible directions from the outline, open plot threads
// and the story so far; one click fills the card with the one Adam picks. Shown at the top of the scene
// card (features/inspector/SceneCardPanel.tsx). Owned by the Outline part. Groundwork stand-in.
import type { ID, SceneCard } from '@shared/types'

export function SceneIdeas(_props: { sceneId: ID; card: SceneCard; onUse: (patch: Partial<SceneCard>) => void }): React.JSX.Element | null {
  return null
}
