// Typing dictated words into the scene (milestone 4): through TipTap's commands, at the cursor and in place
// of any selection, with the spaces they need (insertText.ts), as a step of their own so one Ctrl+Z takes
// out exactly them. They take the formatting at the cursor, as typing would.
import type { Editor } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { Selection, type Transaction } from '@tiptap/pm/state'
import { spaced } from './insertText'

/**
 * Adds typing `spoken` at the transaction's selection to it, with the cursor after the words, as an undo
 * step of its own. False when there was nothing to type.
 */
export function typeSpoken(tr: Transaction, spoken: string): boolean {
  const { from, to, $from, $to } = tr.selection
  // The characters either side, within the paragraph (a line break counts as a space).
  const before = tr.doc.textBetween(Math.max($from.start(), from - 2), from, '\n', '\n')
  const after = tr.doc.textBetween(to, Math.min($to.end(), to + 2), '\n', '\n')
  const s = spaced(before, after, spoken)
  if (!s.words) return false
  const trail = s.text.length - s.lead - s.words.length
  tr.insertText(s.text, from, to)
  // The cursor goes just after the words, inside their paragraph (in place of the whole scene, the end
  // of the words is the end of the scene, outside any paragraph).
  tr.setSelection(Selection.near(tr.doc.resolve(tr.mapping.map(to, 1) - trail), -1))
  closeHistory(tr)
  return true
}

/** Types `spoken` into the scene where its cursor is, scrolled into view. False when there was nothing to type. */
export function insertIntoScene(editor: Editor, spoken: string): boolean {
  const done = editor
    .chain()
    .command(({ tr }) => typeSpoken(tr, spoken) && !!tr.scrollIntoView())
    .run()
  // Typing straight after is a step of its own too.
  if (done) editor.view.dispatch(closeHistory(editor.state.tr))
  return done
}
