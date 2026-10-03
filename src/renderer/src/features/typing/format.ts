// The Format menu's actions (writing by hand), as plain functions so the scene's toolbar, the selection bar and
// the command palette all do the same thing. Each works on the open scene's page and leaves the caret in it;
// with no scene open, or while the page is held for a draft about to replace it, it does nothing and says false.
import type { Editor } from '@tiptap/core'
import { toast } from '@/components/ui'
import { editorBridge } from '@/lib/editorBridge'
import { shortcutText } from '@/lib/shortcuts'
import { useApp } from '@/lib/store'
import { holding } from '@/features/editor/streamDoc'
import { plainPaste } from './plainPaste'

export type FormatMark = 'bold' | 'italic' | 'blockquote'

/** The page, when it can be changed by hand now. */
function page(): Editor | null {
  const ed = editorBridge()?.editor
  if (!ed || ed.isDestroyed || useApp.getState().view.kind !== 'write' || holding(ed.state)) return null
  return ed
}

/** True when the words selected (or the caret) are bold, italic, or in a block quote. */
export function isFormatActive(mark: FormatMark): boolean {
  const ed = editorBridge()?.editor
  return !!ed && !ed.isDestroyed && ed.isActive(mark)
}

/** Bold on or off for the selected words (or for what is typed next). Ctrl+B. */
export const toggleBold = (): boolean => !!page()?.chain().focus().toggleBold().run()

/** Italic on or off. Ctrl+I. */
export const toggleItalic = (): boolean => !!page()?.chain().focus().toggleItalic().run()

/** The paragraph (or the selected ones) as a block quote, or back to ordinary paragraphs. */
export const toggleBlockQuote = (): boolean => !!page()?.chain().focus().toggleBlockquote().run()

/** A scene break (* * *) at the caret: a paragraph is split there if the caret is inside one. */
export const insertSceneBreak = (): boolean => !!page()?.chain().focus().setHorizontalRule().run()

/**
 * Pastes what was copied as plain text at the caret: no bold, italics or other formatting from where it came from,
 * each line its own paragraph. Ctrl+Shift+V does the same in the page.
 */
export async function pasteAsPlainText(): Promise<boolean> {
  const ed = page()
  if (!ed) return false
  let text: string
  try {
    text = await navigator.clipboard.readText()
  } catch {
    ed.commands.focus()
    toast(`The copied words couldn’t be read. Click in the page and press ${shortcutText('pastePlain')} instead.`)
    return false
  }
  if (ed.isDestroyed || page() !== ed) return false
  ed.commands.focus()
  if (!text) {
    toast('There’s nothing copied to paste.')
    return false
  }
  const tr = plainPaste(ed.state, text)
  if (!tr) return false
  ed.view.dispatch(tr)
  return true
}
