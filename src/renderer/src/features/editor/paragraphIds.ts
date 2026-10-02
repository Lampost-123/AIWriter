// Stable paragraph ids. Every paragraph in a scene carries a short id (`pid`, `data-pid` in HTML)
// that stays with it while Adam edits, so the memory can link a fact to the exact words it came
// from (spec: "Every paragraph in the editor has a stable id"). The ids are saved with the scene's
// document and come back when it is opened again.
//
// - A new paragraph gets a fresh id.
// - Splitting a paragraph keeps the id on the first half and gives the second half a new one; when
//   the first half is empty (Enter at the very start), the words keep their id instead.
// - Pasted paragraphs get fresh ids (a paragraph moved by dragging keeps its own).
// - No two paragraphs ever share an id.

import { Extension } from '@tiptap/core'
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model'
import { EditorState, Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'

/** The node types that carry an id. Headings are off in the scene editor, but get ids if they are ever turned on. */
export const PID_TYPES = ['paragraph', 'heading']

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const ID_LENGTH = 8

/** A short random id that isn't in `taken`. */
export function newParagraphId(taken: Set<string>): string {
  const bytes = new Uint8Array(ID_LENGTH)
  for (;;) {
    globalThis.crypto.getRandomValues(bytes)
    let id = ''
    for (const b of bytes) id += ALPHABET[b % ALPHABET.length]
    if (!taken.has(id)) return id
  }
}

const hasPid = (node: PMNode): boolean => PID_TYPES.includes(node.type.name)

/** Every paragraph that carries an id, with its position, in document order. */
function paragraphs(doc: PMNode): { pos: number; node: PMNode }[] {
  const list: { pos: number; node: PMNode }[] = []
  doc.descendants((node, pos) => {
    if (hasPid(node)) {
      list.push({ pos, node })
      return false
    }
    return !node.isTextblock
  })
  return list
}

/**
 * Gives every paragraph without an id, or sharing one with another paragraph, a fresh id. Of the
 * paragraphs sharing an id, the first with words in it keeps it (else the first). Returns null when
 * every id is already fine.
 */
export function fixParagraphIds(tr: Transaction): Transaction | null {
  const list = paragraphs(tr.doc)
  const keeper = new Map<string, number>()
  list.forEach(({ node }, i) => {
    const pid = node.attrs.pid as string | null
    if (!pid) return
    const k = keeper.get(pid)
    if (k === undefined || (list[k].node.content.size === 0 && node.content.size > 0)) keeper.set(pid, i)
  })
  const taken = new Set(keeper.keys())
  let changed = false
  list.forEach(({ pos, node }, i) => {
    const pid = node.attrs.pid as string | null
    if (pid && keeper.get(pid) === i) return
    const id = newParagraphId(taken)
    taken.add(id)
    tr.setNodeAttribute(pos, 'pid', id)
    changed = true
  })
  return changed ? tr : null
}

/** A stored document with every paragraph given an id. `filled` is true when any id was added or changed. */
export function withParagraphIds(doc: PMNode): { doc: PMNode; filled: boolean } {
  const tr = fixParagraphIds(EditorState.create({ doc }).tr)
  return tr ? { doc: tr.doc, filled: true } : { doc, filled: false }
}

/** The same content without paragraph ids, for pasting (so a copy never takes the original's id). */
export function withoutParagraphIds(fragment: Fragment): Fragment {
  const nodes: PMNode[] = []
  fragment.forEach((node) => {
    if (hasPid(node)) nodes.push(node.attrs.pid ? node.type.create({ ...node.attrs, pid: null }, node.content, node.marks) : node)
    else if (node.isLeaf || node.isTextblock) nodes.push(node)
    else nodes.push(node.copy(withoutParagraphIds(node.content)))
  })
  return Fragment.fromArray(nodes)
}

export const paragraphIdsKey = new PluginKey('paragraphIds')

export const paragraphIdsPlugin = new Plugin({
  key: paragraphIdsKey,
  // After any change to the document, new and duplicated paragraphs get their own ids. The fix
  // joins the change's own undo step, so Ctrl+Z never leaves a paragraph without an id.
  appendTransaction: (trs, _old, state) => (trs.some((t) => t.docChanged) ? fixParagraphIds(state.tr) : null),
  props: {
    transformPasted: (slice, view) =>
      // Dragging a paragraph within the page moves it: it keeps its id (the original goes in the same step).
      view.dragging?.move ? slice : new Slice(withoutParagraphIds(slice.content), slice.openStart, slice.openEnd)
  }
})

/** The TipTap extension: the `pid` attribute on paragraphs (`data-pid` in HTML) and the plugin above. */
export const ParagraphIds = Extension.create({
  name: 'paragraphIds',
  addGlobalAttributes: () => [
    {
      types: PID_TYPES,
      attributes: {
        pid: {
          default: null,
          // A split's new half never takes the id; it gets its own.
          keepOnSplit: false,
          parseHTML: (el: HTMLElement) => el.getAttribute('data-pid'),
          renderHTML: (attrs: Record<string, unknown>) => (attrs.pid ? { 'data-pid': attrs.pid } : {})
        }
      }
    }
  ],
  addProseMirrorPlugins: () => [paragraphIdsPlugin]
})
