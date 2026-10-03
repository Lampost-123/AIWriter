// Find in the open scene (Writing by hand, Ctrl+F): the matches marked in the page. A TipTap extension, in the
// editor's list (features/editor/extensions.ts). Owned by the Find part.
//
// - The marks are decorations in this plugin's state: they never change the document, so showing them never
//   autosaves or wakes the memory keeper. Every match is marked; the current one more strongly.
// - What is being found lives in this module (setFindInputs), never in the extension, because the scene
//   controller swaps scenes by building a new state from the same plugins: a newly opened scene is marked
//   straight away.
// - Every change to the page finds the matches again (a scene is small, and this takes well under a
//   millisecond a thousand words), keeping the current match where it was.

import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { findInBlocks, hasQuery, OBJECT_CHAR, BREAK_CHAR, type FoundMatch, type MatchOptions, type TextBlock } from '@shared/findReplace'

export const FIND_EXTENSION = 'aiwriteFind'
/** The class on every match in the page; the current one has FIND_CURRENT_CLASS too. */
export const FIND_CLASS = 'aw-find'
export const FIND_CURRENT_CLASS = 'aw-find-current'

export interface FindInputs {
  active: boolean
  query: string
  opts: MatchOptions
}

let inputs: FindInputs = { active: false, query: '', opts: {} }

export const findInputs = (): FindInputs => inputs

export interface FindState {
  matches: FoundMatch[]
  /** The current match's index, or -1 when there are none. */
  current: number
  deco: DecorationSet
}

type Meta = { type: 'refresh'; anchor?: number } | { type: 'current'; index: number } | { type: 'anchor'; pos: number }

export const findKey = new PluginKey<FindState>(FIND_EXTENSION)

const EMPTY: FindState = { matches: [], current: -1, deco: DecorationSet.empty }

/** Every paragraph of the page as find reads it (the same as blocksOfDoc reads a stored scene). */
export function blocksOfPage(doc: PMNode): TextBlock[] {
  const out: TextBlock[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    let text = ''
    node.forEach((child) => {
      if (child.isText) text += child.text ?? ''
      else if (child.type.name === 'hardBreak') text += BREAK_CHAR
      else text += OBJECT_CHAR.repeat(child.nodeSize)
    })
    out.push({ pos: pos + 1, text })
    return false
  })
  return out
}

/** The matches in a page for what is being found now (none while find is closed). */
export function pageMatches(doc: PMNode): FoundMatch[] {
  if (!inputs.active || !hasQuery(inputs.query)) return []
  return findInBlocks(blocksOfPage(doc), inputs.query, inputs.opts)
}

function decorate(doc: PMNode, matches: FoundMatch[], current: number): DecorationSet {
  if (!matches.length) return DecorationSet.empty
  return DecorationSet.create(
    doc,
    matches.map((m, i) =>
      Decoration.inline(m.from, m.to, { class: i === current ? `${FIND_CLASS} ${FIND_CURRENT_CLASS}` : FIND_CLASS, 'data-find': String(i) })
    )
  )
}

/** The first match at or after `pos` (the first of all when none is), or -1. */
const firstFrom = (matches: FoundMatch[], pos: number): number => {
  if (!matches.length) return -1
  const i = matches.findIndex((m) => m.from >= pos)
  return i >= 0 ? i : 0
}

function build(doc: PMNode, anchor: number): FindState {
  const matches = pageMatches(doc)
  const current = firstFrom(matches, anchor)
  return { matches, current, deco: decorate(doc, matches, current) }
}

function apply(tr: Transaction, prev: FindState, state: EditorState): FindState {
  const meta = tr.getMeta(findKey) as Meta | undefined
  if (meta?.type === 'refresh') return build(tr.doc, meta.anchor ?? prev.matches[prev.current]?.from ?? state.selection.from)
  if (meta?.type === 'current') {
    const current = prev.matches.length ? ((meta.index % prev.matches.length) + prev.matches.length) % prev.matches.length : -1
    return current === prev.current ? prev : { ...prev, current, deco: decorate(tr.doc, prev.matches, current) }
  }
  if (!tr.docChanged) return prev
  if (!inputs.active) return prev.matches.length ? EMPTY : prev
  // After a replace, the next match after the new words; else the current match where the change moved it.
  const anchor = meta?.type === 'anchor' ? meta.pos : prev.current >= 0 ? tr.mapping.map(prev.matches[prev.current].from, -1) : tr.selection.from
  return build(tr.doc, anchor)
}

export const findPlugin = new Plugin<FindState>({
  key: findKey,
  state: {
    init: (_config, state) => (inputs.active ? build(state.doc, state.selection.from) : EMPTY),
    apply: (tr, prev, _old, state) => apply(tr, prev, state)
  },
  props: {
    decorations: (state) => findKey.getState(state)?.deco ?? DecorationSet.empty
  }
})

export const findStateOf = (state: EditorState): FindState => findKey.getState(state) ?? EMPTY

/** Sets what is being found; the page (if given) marks it straight away, the current match the first at or after `anchor`. */
export function setFindInputs(next: FindInputs, view?: { state: EditorState; dispatch: (tr: Transaction) => void } | null, anchor?: number): void {
  inputs = next
  if (view) view.dispatch(view.state.tr.setMeta(findKey, { type: 'refresh', anchor } satisfies Meta).setMeta('addToHistory', false))
}

/** Makes match `index` the current one (wrapping round). */
export const setCurrentTr = (state: EditorState, index: number): Transaction =>
  state.tr.setMeta(findKey, { type: 'current', index } satisfies Meta).setMeta('addToHistory', false)

/** Marks a transaction that replaces words so the match after them becomes the current one. */
export const anchorAfter = (tr: Transaction, pos: number): Transaction => tr.setMeta(findKey, { type: 'anchor', pos } satisfies Meta)

/** The extension in the editor's list. */
export const FindHighlights = Extension.create({
  name: FIND_EXTENSION,
  addProseMirrorPlugins: () => [findPlugin]
})
