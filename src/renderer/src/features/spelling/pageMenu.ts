// The page's side of AI Write's actions in the right-click menu (src/main/spelling/pageItems.ts). A right-click in a
// scene's words notes what can be offered there: the words selected (when the click is on them) or the place clicked.
// The action picked comes back (spelling:pageAction) and is carried out with the same tools as the bar over selected
// words: Ask about this and Edit this open the editor chat with the words quoted, the AI tools start a tracked change,
// and Listen from here starts reading aloud there.
import { TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import type { PageAction, PageMenu } from '@shared/contracts/spelling'
import { hasDialogue } from '@shared/contracts/edits'
import type { ID } from '@shared/types'
import { editorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'
import { askAbout, editAbout } from '@/features/ask/open'
import { pidsBetween } from '@/features/beats/sessionLogic'
import { startTool } from '@/features/edits/session'
import { listenFrom } from '@/features/readAloud/control'

/** The place noted at the last right-click in the page. */
interface Noted {
  token: number
  sceneId: ID
  view: EditorView
  /** The words selected (the click was on them), or the place clicked (from = to). */
  from: number
  to: number
  selection: boolean
}

let noted: Noted | null = null
let tokens = 0

/** Where a right-click at (x, y) is in the page: on the words selected, or at a place. */
export function placeOfClick(view: EditorView, x: number, y: number): { from: number; to: number; selection: boolean } {
  const { state } = view
  const sel = state.selection
  const hit = view.posAtCoords({ left: x, top: y })
  const onSelection = !sel.empty && (!hit || (hit.pos >= sel.from && hit.pos <= sel.to))
  if (onSelection && state.doc.textBetween(sel.from, sel.to, ' ', ' ').trim()) return { from: sel.from, to: sel.to, selection: true }
  const at = hit?.pos ?? sel.head
  return { from: at, to: at, selection: false }
}

/** Notes what the page offers at a right-click (for the menu main builds), or null where it offers nothing. */
export function notePageMenu(view: EditorView, sceneId: ID | null, x: number, y: number): PageMenu | null {
  if (!sceneId || !view.editable) {
    noted = null
    return null
  }
  const place = placeOfClick(view, x, y)
  noted = { token: ++tokens, sceneId, view, ...place }
  const text = place.selection ? view.state.doc.textBetween(place.from, place.to, '\n', ' ') : ''
  return {
    token: noted.token,
    selection: place.selection,
    dialogue: place.selection && hasDialogue(text),
    listen: !!useApp.getState().settings?.speech.readAloud
  }
}

/** The paragraph around a place: where its words start and end (null in an empty one). */
function paragraphAt(view: EditorView, pos: number): { from: number; to: number } | null {
  const $pos = view.state.doc.resolve(pos)
  if (!$pos.parent.isTextblock || !$pos.parent.textContent.trim()) return null
  return { from: $pos.start(), to: $pos.end() }
}

/** Carries out an action picked in the right-click menu, at the place noted for it. */
export function runPageAction(token: number, action: PageAction): void {
  const n = noted
  if (!n || n.token !== token) return
  noted = null
  const bridge = editorBridge()
  const editor = bridge?.editor
  const view = n.view
  if (!editor || view.isDestroyed || bridge.sceneId !== n.sceneId || editor.view !== view) return
  const doc = view.state.doc
  if (n.to > doc.content.size) return
  if (action.kind === 'listen') {
    listenFrom(editor, n.sceneId, n.from)
    return
  }
  if (action.kind === 'ask' || action.kind === 'edit') {
    const range = n.selection ? { from: n.from, to: n.to } : paragraphAt(view, n.from)
    const words = range ? doc.textBetween(range.from, range.to, '\n', ' ') : ''
    const pids = range ? pidsBetween(doc, range.from, range.to) : []
    if (action.kind === 'ask') askAbout(words, pids)
    else editAbout(words, pids)
    return
  }
  // The AI tools work on the words selected, as from the bar: they are selected again if the selection moved.
  const sel = view.state.selection
  if (sel.from !== n.from || sel.to !== n.to) view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, n.from, n.to)))
  view.focus()
  void startTool(action.tool, { direction: action.direction })
}
