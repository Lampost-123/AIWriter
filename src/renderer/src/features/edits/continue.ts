// Continue: the AI writes on from the cursor (from the palette, and from the AI tools over selected words,
// which carry on after them), or from the end of the scene (the desk's AI dock, and Ctrl+Shift+Enter there). About a
// paragraph or two, following the scene card's beats, as a tracked change Adam accepts or rejects (session.ts). Owned
// by the AI edits part.
import { editorBridge } from '@/lib/editorBridge'
import { startTool } from './session'
import { endOfWords } from './text'

/** Writes on from the cursor, or after the selected words. */
export function continueFromCursor(): void {
  void startTool('continue')
}

/**
 * The desk's Continue: the AI writes on from the end of the scene, wherever the cursor is, with `direction` (the steer
 * box) as what should happen next. The tracked change, Accept (Tab), Reject (Esc), the check and repair after Accept
 * and the record are Continue's own, as from the cursor; the page follows the change into view as its words arrive.
 * False when there is nothing to carry on from (the dock then offers to draft the scene instead).
 */
export function continueAtEnd(direction = ''): boolean {
  const editor = editorBridge()?.editor
  if (!editor || editor.isDestroyed) return false
  const at = endOfWords(editor.state.doc)
  if (at === null) return false
  void startTool('continue', { direction, at })
  return true
}
