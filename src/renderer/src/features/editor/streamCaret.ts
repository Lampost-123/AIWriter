// The New look: while a draft streams into the scene, an amber caret stands where its words are arriving (the same caret
// an AI change shows, features/edits/suggestions.css), so the eye has somewhere to rest and a pause in the stream doesn't
// look like the end. The words themselves never move. Nothing in Classic; still (no blink) with less motion.
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { activeStream } from './streamDoc'

const caretKey = new PluginKey('aiwriteStreamCaret')

/** The caret, made once by ProseMirror when the widget is first drawn (its key keeps it while the paragraph grows). */
const makeCaret = (): HTMLElement => {
  const caret = document.createElement('span')
  caret.className = 'aw-stream-caret'
  caret.setAttribute('aria-hidden', 'true')
  return caret
}

export const StreamCaret = Extension.create({
  name: 'aiwriteStreamCaret',
  addProseMirrorPlugins: () => [
    new Plugin({
      key: caretKey,
      props: {
        decorations(state) {
          if (document.documentElement.dataset.look !== 'new') return null
          const info = activeStream(state)
          // Only once words are arriving (a draft replacing the scene's text shows none while it waits for its first).
          if (!info || !info.wrote) return null
          const last = state.doc.lastChild
          if (!last || !last.isTextblock) return null
          // The end of the last paragraph: where a draft's words land (streamDoc.ts writes at the end of the scene).
          const end = state.doc.content.size - 1
          return DecorationSet.create(state.doc, [Decoration.widget(end, makeCaret, { side: 1, key: 'aw-stream-caret', ignoreSelection: true })])
        }
      }
    })
  ]
})
