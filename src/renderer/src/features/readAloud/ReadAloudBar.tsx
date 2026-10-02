// The slim bar above the page while reading: who is speaking and how ("Mara · quiet and wary"), Pause,
// Stop and Close. Rendered by SceneView between the scene header and the page. Owned by the Read aloud
// part. Groundwork stand-in.
import type { Editor } from '@tiptap/core'
import type { ID } from '@shared/types'

export function ReadAloudBar(_props: {
  editor: Editor
  sceneId: ID | null
  scrollerRef: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element | null {
  return null
}
