// The caret where the page has it. Keys that move the caret (the arrows, Home, End) are carried out by the browser, and
// ProseMirror hears of the new place only at the browser's next "selectionchange". On a busy computer that comes late:
// the browser handles key presses before such notices, so after a quick run of arrow presses ProseMirror can be many
// keys behind. Anything that then puts ProseMirror's caret back on the page (a timer's transaction for the live checks'
// underlines, beat marks or the reading's highlight; the editor taking the keyboard; a change to the text) puts it where
// it was keys ago: the run of presses, or a selection made with Shift, comes out short. readAloud.spec's "Listen from
// here" saw it on CI ("again." and then "late again." read instead of "Mara counted…": the selection was "gain", "la").
//
// So this plugin tells ProseMirror where the caret went as each moving key is let go (and before the next key is
// handled), and a transaction that comes in between keeps the page's caret too.
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

const pageCaretKey = new PluginKey('aiwritePageCaret')

/** The keys the browser moves the caret with (with or without Shift, Ctrl or Alt). */
const MOVE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])
/** Keys held with the moving keys (Shift+Right selects): pressing them changes nothing about where the caret is. */
const HELD_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock'])

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

/** Tells ProseMirror where the page's caret is now, when it is somewhere else in the text than ProseMirror thinks. */
function catchUp(view: EditorView): void {
  const page = pageSelection(view)
  const now = view.state.selection
  if (!page || !(now instanceof TextSelection) || (now.anchor === page.anchor && now.head === page.head)) return
  const size = view.state.doc.content.size
  if (page.anchor < 0 || page.head < 0 || page.anchor > size || page.head > size) return
  const { doc } = view.state
  view.dispatch(view.state.tr.setSelection(TextSelection.between(doc.resolve(page.anchor), doc.resolve(page.head))).setMeta('addToHistory', false))
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
          handleKeyDown: (v, e) => {
            // The key before moved the caret: ProseMirror hears where to before this key is handled.
            if (moved) catchUp(v)
            if (MOVE_KEYS.has(e.key)) moved = true
            else if (!HELD_KEYS.has(e.key)) moved = false
            return false
          },
          handleDOMEvents: {
            // A moving key let go: the browser has moved the caret by now.
            keyup: (v) => {
              if (moved) catchUp(v)
              return false
            },
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
