// What shows over the page for AI edits waiting on Adam (Accept and Reject by each one, Alternatives to
// pick from) and while one is being written. Rendered by SceneView in the page's scrolling area. Owned by
// the AI edits part. Groundwork stand-in.
import type { Editor } from '@tiptap/core'
import type { ID } from '@shared/types'

export function SuggestionLayer(_props: {
  editor: Editor
  sceneId: ID | null
  scrollerRef: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element | null {
  return null
}
