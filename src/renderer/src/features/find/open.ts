// Opening find and replace (Writing by hand): Ctrl+F finds in the open scene, Ctrl+Shift+F across the story.
// The command palette runs these too.
import { toast } from '@/components/ui'
import { editorBridge } from '@/lib/editorBridge'
import { shortcutText } from '@/lib/shortcuts'
import { useApp } from '@/lib/store'
import { useFind } from './findStore'

/** Words selected in the page that make a good thing to find: one short piece on one line. */
function selectedWords(): string | null {
  const editor = editorBridge()?.editor
  // Only while the keyboard is in the page: Ctrl+F again from the find box keeps what is typed there.
  if (!editor || !editor.view.hasFocus()) return null
  const { from, to, empty } = editor.state.selection
  if (empty) return null
  const text = editor.state.doc.textBetween(from, to, '\n', '\n')
  return text.trim() && !text.includes('\n') && text.length <= 120 ? text : null
}

/** Shows the find bar over the open scene, with the words selected in the page (if any) to find. */
export function openFindInScene(): void {
  const app = useApp.getState()
  if (!app.sceneId) {
    toast(`Open a scene first to find words in it. ${shortcutText('findInStory')} finds them in the whole story.`)
    return
  }
  if (app.view.kind !== 'write') app.navigate({ kind: 'write' })
  const words = selectedWords()
  const s = useFind.getState()
  s.set({ sceneOpen: true, storyOpen: false, focusTick: s.focusTick + 1, ...(words ? { query: words } : {}) })
}

/** Shows find and replace across the open story. */
export function openFindInStory(): void {
  const app = useApp.getState()
  if (!app.storyId) {
    toast('Open a story first to find words in it.')
    return
  }
  const words = selectedWords()
  const s = useFind.getState()
  s.set({ storyOpen: true, focusTick: s.focusTick + 1, ...(words ? { query: words } : {}) })
}

/** Closes the bar over the open scene. */
export function closeFindInScene(): void {
  useFind.getState().set({ sceneOpen: false })
}
