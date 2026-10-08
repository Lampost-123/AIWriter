// The caret where the page has it. Keys that move the caret (the arrows, Home, End) are carried out by the browser, and
// ProseMirror hears of the new place only at the browser's next "selectionchange", a moment later. A transaction sent in
// that moment from a timer (the live checks' underlines, beat marks, the find marks, the reading's highlight: anything
// that only changes what the page shows) redraws the page with the caret where ProseMirror last knew it, so a key or two
// pressed quickly is lost and the caret jumps back. On a busy computer, typing then moving along a line with the arrows
// could leave the caret, or a selection made with Shift, a few letters short (readAloud.spec's "Listen from here" saw it
// on CI). This plugin adds the page's own caret to such a transaction, so it is kept: only after a key that moves the
// caret and before ProseMirror has read where it went (at other times ProseMirror's caret is the newer one, for example
// a scene just opened with the caret put back where it was).
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

const pageCaretKey = new PluginKey('aiwritePageCaret')

/** The keys the browser moves the caret with (with or without Shift, Ctrl or Alt). */
const MOVE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])

/**
 * Where the caret should be after `trs`, when they only changed what the page shows (no new text, no caret of their
 * own) and the page's caret (`anchor`, `head`, as document positions) is somewhere else in the text. Null otherwise.
 */
export function caretToKeep(
  trs: readonly Transaction[],
  state: EditorState,
  page: { anchor: number; head: number } | null
): { anchor: number; head: number } | null {
  if (!page || trs.some((tr) => tr.docChanged || tr.selectionSet)) return null
  const size = state.doc.content.size
  if (page.anchor < 0 || page.head < 0 || page.anchor > size || page.head > size) return null
  // Only a caret or a run of selected words: a selected picture or the whole page (Ctrl+A) is left to ProseMirror.
  if (!(state.selection instanceof TextSelection)) return null
  if (state.selection.anchor === page.anchor && state.selection.head === page.head) return null
  return page
}

/** The page's caret as document positions, when it is in this editor and the editor has the keyboard. */
function pageSelection(view: EditorView): { anchor: number; head: number } | null {
  if (view.isDestroyed || !view.hasFocus()) return null
  const sel = view.dom.ownerDocument.getSelection()
  if (!sel || !sel.anchorNode || !sel.focusNode) return null
  if (!view.dom.contains(sel.anchorNode) || !view.dom.contains(sel.focusNode)) return null
  try {
    return { anchor: view.posAtDOM(sel.anchorNode, sel.anchorOffset, 1), head: view.posAtDOM(sel.focusNode, sel.focusOffset, 1) }
  } catch {
    return null
  }
}

export const PageCaret = Extension.create({
  name: 'aiwritePageCaret',
  addProseMirrorPlugins() {
    let view: EditorView | null = null
    // A key moved the caret in the page, and ProseMirror hasn't yet read where to.
    let moved = false
    return [
      new Plugin({
        key: pageCaretKey,
        view: (v) => {
          view = v
          return { destroy: () => void (view = null) }
        },
        props: {
          handleKeyDown: (_v, e) => {
            if (MOVE_KEYS.has(e.key)) moved = true
            return false
          },
          handleDOMEvents: {
            mousedown: () => {
              moved = false
              return false
            }
          }
        },
        appendTransaction: (trs, _old, state) => {
          // ProseMirror read the caret (or the text changed): its caret is the page's again.
          if (trs.some((tr) => tr.selectionSet || tr.docChanged)) moved = false
          if (!moved) return null
          const keep = view ? caretToKeep(trs, state, pageSelection(view)) : null
          if (!keep) return null
          const { doc } = state
          return state.tr.setSelection(TextSelection.between(doc.resolve(keep.anchor), doc.resolve(keep.head))).setMeta('addToHistory', false)
        }
      })
    ]
  }
})
