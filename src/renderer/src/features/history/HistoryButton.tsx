// The History button in the scene toolbar: opens the scene's history (its earlier versions, compared side
// by side with the scene now, restored in one click). Owned by the History part.
import { History } from '@/components/ui/icons'
import type { ID } from '@shared/types'
import { ToolButton } from '@/features/editor/ToolButton'
import { openHistory } from './open'

export function HistoryButton({ sceneId }: { sceneId: ID }): React.JSX.Element {
  return (
    // In a narrow header it is its icon alone (ToolButton), so it stays in the toolbar at every window size.
    <ToolButton
      icon={<History size={15} />}
      label="History"
      // Its full name for screen readers, so it is never taken for a place's or a character's History field.
      aria-label="History of this scene"
      title="History: earlier versions of this scene, to compare with it and restore"
      onClick={() => void openHistory(sceneId)}
    />
  )
}
