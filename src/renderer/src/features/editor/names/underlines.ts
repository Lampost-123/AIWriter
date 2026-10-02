// The faint underline under the names of known entries in the page, and Ctrl+click (Cmd+click on a
// Mac) on one to show that entry beside the page.
//
// Underlines are decorations: they never change the document, so drawing them never autosaves or
// wakes the memory keeper. TipTap rebuilds them only in the blocks a change touched (a keystroke, a
// streamed chunk), and all at once when a scene opens or the list of names changes. The editor's
// extensions are made once and the scene controller swaps scenes by building a new state from the same
// plugins, so the index and the click action are read from this module, never captured when made.

import { Decoration, Extension } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import type { ID } from '@shared/types'
import { isMac } from '@/lib/api'
import { EMPTY_INDEX, findNames, type NameIndex } from './nameMatch'

export const NAMES_EXTENSION = 'aiwriteNames'
/** The class on an underlined name. */
export const NAME_CLASS = 'aw-name'
/** The attribute that holds an underlined name's entry id (not `data-entry`, which entry lists use for their rows). */
export const NAME_ATTR = 'data-name-of'

let index: NameIndex = EMPTY_INDEX
let onOpen: ((entryId: ID) => void) | null = null

export const nameIndex = (): NameIndex => index

/** Uses a new list of names. Returns true when it differs from the one in use (the page then underlines again). */
export function setNameIndex(next: NameIndex): boolean {
  if (next.key === index.key) return false
  index = next
  return true
}

/** What Ctrl+click on a name does (shows the entry beside the page). */
export function setNameOpener(fn: ((entryId: ID) => void) | null): void {
  onOpen = fn
}

/** True when the platform's shortcut key (Ctrl, or Cmd on a Mac) is held. */
export const modHeld = (e: MouseEvent | KeyboardEvent, mac: boolean): boolean => (mac ? e.metaKey : e.ctrlKey) && !e.altKey

/** The entry of the underlined name an event happened on, if any. */
export function nameAt(target: EventTarget | null): ID | null {
  const el = target instanceof Element ? target.closest(`.${NAME_CLASS}`) : null
  return el?.getAttribute(NAME_ATTR) ?? null
}

/** The underlines for the text blocks between two positions (block boundaries). */
function underline(state: EditorState, view: EditorView | null, from: number, to: number): Decoration[] {
  if (!index.size) return []
  const out: Decoration[] = []
  // While an input method is composing a word, the word at the caret is left alone: redrawing it
  // under the composition would break it.
  const composingAt = view?.composing ? state.selection.head : -1
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true
    // A hard break reads as one character, so offsets in the text are offsets in the block.
    const text = node.textBetween(0, node.content.size, undefined, '\n')
    for (const m of findNames(text, index)) {
      const a = pos + 1 + m.start
      const b = pos + 1 + m.end
      if (composingAt >= a && composingAt <= b) continue
      out.push(Decoration.Inline(a, b, { class: NAME_CLASS, [NAME_ATTR]: m.entryId }))
    }
    return false
  })
  return out
}

const clickKey = new PluginKey('aiwriteNameClick')

/**
 * Ctrl+click on a name opens the entry beside the page and leaves the caret where it was (the press
 * never reaches the editor). A plain click only places the caret: writing comes first.
 */
const clickPlugin = new Plugin({
  key: clickKey,
  props: {
    handleDOMEvents: {
      mousedown: (_view, event) => {
        if (event.button !== 0 || !modHeld(event, isMac())) return false
        const id = nameAt(event.target)
        if (!id || !onOpen) return false
        event.preventDefault()
        onOpen(id)
        return true
      }
    }
  }
})

export const NameUnderlines = Extension.create({
  name: NAMES_EXTENSION,
  addDecorations: () => ({
    update: 'changedRanges',
    create: ({ state, view }) => underline(state, view, 0, state.doc.content.size),
    createInRange: ({ state, view, from, to }) => underline(state, view, from, to)
  }),
  addProseMirrorPlugins: () => [clickPlugin]
})
