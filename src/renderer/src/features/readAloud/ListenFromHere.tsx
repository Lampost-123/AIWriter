// "Listen from here" in the bar over selected words (features/editor/selection/SelectionLayer.tsx), when
// read aloud is on. Owned by the Read aloud part. Groundwork stand-in.
import type { Editor } from '@tiptap/core'
import type { ID } from '@shared/types'

export function ListenFromHere(_props: { editor: Editor; sceneId: ID; from: number; to: number }): React.JSX.Element | null {
  return null
}
