// Writing by hand: spelling and synonyms in the page. Two things happen here:
//  - Spell check on or off (Settings › Editor) goes straight to the page's own spellcheck attribute, so the
//    underlines go at once (Chromium's checker is also switched in the main process).
//  - A right-click in the page notes the word under the pointer (or the one word selected) for the main
//    process, which builds the menu; a synonym picked there comes back (spelling:replaceWord) and is put in
//    place of that word as one step Ctrl+Z takes back, with the word's capitals.
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import type { EditorView } from '@tiptap/pm/view'
import type { ID } from '@shared/types'
import { isOneWord, wordAt } from '@shared/spelling'
import { toast } from '@/components/ui'
import { api } from '@/lib/api'
import { editorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'

/** The word noted at the last right-click in the page, and where it is. */
interface Noted {
  token: number
  word: string
  sceneId: ID
  from: number
  to: number
  view: EditorView
}

let noted: Noted | null = null
let tokens = 0

/** Whether spell check is on (Settings › Editor). */
const spellCheckOn = (): boolean => useApp.getState().settings?.editor?.spellCheck !== false

/** Sets the page's spellcheck attribute to match the setting. */
export function applySpellCheck(view: EditorView): void {
  const want = spellCheckOn() ? 'true' : 'false'
  if (view.dom.getAttribute('spellcheck') !== want) view.dom.setAttribute('spellcheck', want)
}

/** The word at a point in the page (or the one word selected, when the click is on it); null when there is none. */
export function wordUnder(view: EditorView, x: number, y: number): { word: string; from: number; to: number } | null {
  const { state } = view
  const sel = state.selection
  const hit = view.posAtCoords({ left: x, top: y })
  if (!sel.empty && (!hit || (hit.pos >= sel.from && hit.pos <= sel.to))) {
    const text = state.doc.textBetween(sel.from, sel.to, ' ', ' ')
    const trimmed = text.trim()
    if (isOneWord(trimmed)) {
      const lead = text.length - text.trimStart().length
      const from = sel.from + lead
      return { word: trimmed, from, to: from + trimmed.length }
    }
  }
  if (!hit) return null
  const $pos = state.doc.resolve(hit.pos)
  const block = $pos.parent
  if (!block.isTextblock) return null
  // Inline nodes other than text (a line break) are one character, as a space.
  const text = block.textBetween(0, block.content.size, undefined, ' ')
  const w = wordAt(text, $pos.parentOffset)
  if (!w) return null
  const start = $pos.start()
  return { word: w.word, from: start + w.from, to: start + w.to }
}

/** Tells the main process which word the right-click is on (null for none), just before its menu is built. */
function noteRightClick(view: EditorView, e: MouseEvent): void {
  const sceneId = editorBridge()?.sceneId ?? null
  const found = sceneId && view.editable ? wordUnder(view, e.clientX, e.clientY) : null
  if (!found || !sceneId) {
    noted = null
    void api.noteContextWord(null).catch(() => undefined)
    return
  }
  noted = { token: ++tokens, word: found.word, sceneId, from: found.from, to: found.to, view }
  void api.noteContextWord({ token: noted.token, word: found.word, sceneId }).catch(() => undefined)
}

/** Puts a synonym picked in the right-click menu in place of the word it was for. */
export function replaceNoted(token: number, replacement: string): void {
  const n = noted
  if (!n || n.token !== token) return
  noted = null
  const view = n.view
  const bridge = editorBridge()
  if (view.isDestroyed || bridge?.sceneId !== n.sceneId || bridge.editor?.view !== view) return
  if (bridge.busy()) {
    toast('A draft is being written into this scene. Wait for it to finish (or stop it), then try again.')
    return
  }
  const { state } = view
  if (n.to > state.doc.content.size || state.doc.textBetween(n.from, n.to, ' ', ' ') !== n.word) {
    toast('That word has changed since, so it was left as it is.')
    return
  }
  // A step of its own: Ctrl+Z puts the word back, and typing straight after is another step.
  view.dispatch(closeHistory(state.tr.insertText(replacement, n.from, n.to)).scrollIntoView())
  view.dispatch(closeHistory(view.state.tr))
  view.focus()
}

const spellingKey = new PluginKey('aiwriteSpelling')

/** The page's side of spelling and synonyms (see the top of this file). */
export const PageSpelling = Extension.create({
  name: 'aiwriteSpelling',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: spellingKey,
        view: (view) => {
          applySpellCheck(view)
          // The switch in Settings › Editor turns the underlines off (or on) at once.
          const off = useApp.subscribe((s, prev) => {
            if (s.settings?.editor?.spellCheck !== prev.settings?.editor?.spellCheck) applySpellCheck(view)
          })
          return {
            update: (v) => applySpellCheck(v),
            destroy: off
          }
        },
        props: {
          handleDOMEvents: {
            contextmenu: (view, e) => {
              noteRightClick(view, e)
              return false
            }
          }
        }
      })
    ]
  }
})

