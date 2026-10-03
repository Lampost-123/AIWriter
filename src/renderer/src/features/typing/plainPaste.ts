// Paste as plain text (writing by hand): Ctrl+Shift+V, or Format › Paste as plain text. The words come in
// without the bold, italics, fonts or quoting of wherever they were copied from; they take on the style
// where they land, as typing there would. Each line becomes a paragraph, as an ordinary paste makes them.
import { Fragment, Slice, type Mark, type Schema } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'

/** Ctrl+Shift+V (⌘+Shift+V on a Mac). */
export const isPastePlainKey = (e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): boolean =>
  (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && (e.key.toLowerCase() === 'v' || e.code === 'KeyV')

/** Plain text as paragraphs, one per line (blank lines between them make no empty paragraphs), with `marks` on the words. */
export function plainTextSlice(schema: Schema, text: string, marks: readonly Mark[] = []): Slice {
  const para = schema.nodes.paragraph
  const lines = text.split(/(?:\r\n?|\n)+/)
  const blocks = lines.map((line) => para.create(null, line ? schema.text(line, marks) : null))
  return new Slice(Fragment.from(blocks), 1, 1)
}

/** The step that puts plain text in place of the selection (or at the caret), or null when there is nothing to paste. */
export function plainPaste(state: EditorState, text: string): Transaction | null {
  if (!text) return null
  const marks = state.storedMarks ?? state.selection.$from.marks()
  const slice = plainTextSlice(state.schema, text, marks)
  // Marked as a paste (an undo step of its own, like any paste), but not as one from elsewhere: nothing in the
  // words is turned into formatting (*stars* stay stars).
  return state.tr.replaceSelection(slice).scrollIntoView().setMeta('paste', true)
}
