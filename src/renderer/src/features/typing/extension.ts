// Writing by hand in the page: smart punctuation as Adam types, and Ctrl+Shift+V pasting plain text.
// A TipTap extension, in the editor's list (features/editor/extensions.ts).
//
//  - Smart punctuation is one input rule (the swaps themselves are smartPunctuation.ts). TipTap puts what was
//    typed in first, then the swap as its own step, so Backspace (TipTap's undoInputRule) or Ctrl+Z straight
//    after puts the plain characters back. The next change after a swap starts a new undo step, so Ctrl+Z
//    after typing on takes back the typing first, then the swap. It reads the setting each time (no reload),
//    and never changes words where a draft is being written in, words held for a draft about to replace them,
//    or the words under an AI change waiting in the page.
//  - Ctrl+Shift+V: the browser's own "paste and match style" sends only the plain text; this takes that paste
//    and puts it in as plain paragraphs (plainPaste.ts), so nothing in it is turned into formatting either.
import { Extension, InputRule, type Editor } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { activeStream, holding } from '@/features/editor/streamDoc'
import { activeSuggestion } from '@/features/edits/suggestions'
import { useApp } from '@/lib/store'
import { smartChange } from './smartPunctuation'
import { isPastePlainKey, plainPaste } from './plainPaste'

/** Set on the step that swapped in smart punctuation. */
export const smartKey = new PluginKey<boolean>('aiwriteSmartPunctuation')

/** Smart punctuation is on (Settings › Editor; on until Adam turns it off). */
export const smartPunctuationOn = (): boolean => useApp.getState().settings?.editor?.smartPunctuation ?? true

/**
 * May smart punctuation change the words from `from` to `to`? Not where a draft is being written in (from where it
 * starts), not while the page is held for a draft about to replace it, and not in the words under an AI change.
 */
export function mayChange(state: EditorState, from: number, to: number): boolean {
  if (holding(state)) return false
  const stream = activeStream(state)
  if (stream && to > stream.from) return false
  const s = activeSuggestion(state)
  if (s && ((from < s.to && to > s.from) || (s.from < from && from < s.to))) return false
  return true
}

function smartPunctuationRule(editor: Editor): InputRule {
  return new InputRule({
    find: (text) => {
      if (!smartPunctuationOn()) return null
      // TipTap writes anything that isn't text (a line break) as '%leaf%': a new line, for what comes before.
      const change = smartChange(text.replace(/%leaf%/g, '\n'))
      if (!change || change.remove > text.length) return null
      return { index: text.length - change.remove, text: text.slice(-change.remove), data: { insert: change.insert } }
    },
    handler: ({ state, range, match }) => {
      const insert = (match.data as { insert?: string } | undefined)?.insert
      // The editor as it is (the rule's own state is a copy without the page's plugins).
      if (!insert || !mayChange(editor.state, range.from, range.to)) return null
      state.tr.insertText(insert, range.from, range.to).setMeta(smartKey, true)
    }
  })
}

const typingKey = new PluginKey<boolean>('aiwriteTyping')

export function typingPlugin(): Plugin<boolean> {
  /** Ctrl+Shift+V was just pressed: the paste it brings is plain. */
  let plainUntil = 0
  return new Plugin<boolean>({
    key: typingKey,
    // True straight after a smart punctuation swap.
    state: {
      init: () => false,
      apply: (tr, after) => (tr.getMeta(smartKey) ? true : tr.docChanged ? false : after)
    },
    // The first change after a swap starts its own undo step, so Ctrl+Z takes back the typing before the swap.
    filterTransaction: (tr, state) => {
      if (tr.docChanged && !tr.getMeta(smartKey) && tr.getMeta('addToHistory') !== false && typingKey.getState(state)) closeHistory(tr)
      return true
    },
    props: {
      handleKeyDown: (_view, event) => {
        if (isPastePlainKey(event)) plainUntil = Date.now() + 1000
        return false
      },
      handleDOMEvents: {
        paste: (view, event) => {
          if (Date.now() > plainUntil) return false
          plainUntil = 0
          event.preventDefault()
          const tr = plainPaste(view.state, event.clipboardData?.getData('text/plain') ?? '')
          if (tr) view.dispatch(tr)
          return true
        }
      }
    }
  })
}

export const HandTyping = Extension.create({
  name: 'aiwriteHandTyping',
  addInputRules() {
    return [smartPunctuationRule(this.editor)]
  },
  addProseMirrorPlugins: () => [typingPlugin()]
})
