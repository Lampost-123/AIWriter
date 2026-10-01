// Document-level helpers for the manuscript editor, written against plain
// ProseMirror state so they can be tested without a browser:
//  - loading a stored scene into a document, and turning a document into plain text
//  - streaming a draft into the end of the scene without touching Adam's cursor
//  - turning a finished stream into ONE undo step
//
// How the single undo step works: streamed chunks are applied with
// addToHistory: false, so typing during a stream keeps its own undo steps and the
// draft never mixes into them. A plugin remembers where the draft begins (a block
// boundary, mapped through every later change). When the stream ends, the draft's
// region is swapped back to how it was before the stream (not recorded), then the
// whole draft is put back as one recorded step. The document ends up identical,
// and one Ctrl+Z removes the whole draft.

import { Fragment, type Node as PMNode, type Schema } from '@tiptap/pm/model'
import { EditorState, Plugin, PluginKey, Selection, TextSelection, type Transaction } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import { isSceneBreakLine, splitParagraphs, type StreamOp } from './streamText'

// ---------- Loading and plain text ----------

/** Builds a document from text: one paragraph per line or blank-line block; "***" lines become scene breaks. */
export function docFromText(schema: Schema, text: string): PMNode {
  const para = schema.nodes.paragraph
  const hr = schema.nodes.horizontalRule
  const blocks = splitParagraphs(text).map((p) => (hr && isSceneBreakLine(p) ? hr.create() : para.create(null, p ? schema.text(p) : null)))
  return schema.topNodeType.create(null, blocks.length ? blocks : [para.create()])
}

/** The stored scene as a document: the saved JSON, else its text, else an empty page. */
export function docFromStored(schema: Schema, doc: unknown, text: string): PMNode {
  if (doc && typeof doc === 'object') {
    try {
      const node = schema.nodeFromJSON(doc)
      node.check()
      if (node.childCount > 0) return node
    } catch {
      // Fall through to the plain text, which is always saved alongside.
    }
  }
  return docFromText(schema, text ?? '')
}

/** Plain text of a scene: paragraphs separated by blank lines, scene breaks as "* * *". */
export function sceneText(doc: PMNode): string {
  const blocks: string[] = []
  const visit = (node: PMNode): void => {
    if (node.type.name === 'horizontalRule') {
      blocks.push('* * *')
      return
    }
    if (node.isTextblock) {
      let t = ''
      node.forEach((child) => {
        if (child.isText) t += child.text ?? ''
        else if (child.type.name === 'hardBreak') t += '\n'
      })
      if (t.trim()) blocks.push(t)
      return
    }
    node.forEach(visit)
  }
  doc.forEach(visit)
  return blocks.join('\n\n')
}

export const isEmptyParagraph = (node: PMNode | null | undefined): boolean =>
  !!node && node.type.name === 'paragraph' && node.content.size === 0

/** True when the page has nothing on it. */
export const isDocEmpty = (doc: PMNode): boolean => doc.childCount === 0 || (doc.childCount === 1 && isEmptyParagraph(doc.firstChild))

// ---------- Streaming ----------

export interface StreamInfo {
  generationId: string
  /** Block boundary where the draft begins. Mapped through every change while streaming. */
  from: number
  /** The draft's region started as one empty paragraph that the draft writes into. */
  placeholder: boolean
  /** Some text has arrived. */
  wrote: boolean
}

type StreamMeta = { type: 'start'; info: StreamInfo } | { type: 'wrote' } | { type: 'end' }

export const streamKey = new PluginKey<StreamInfo | null>('aiwriteStream')

export const streamPlugin = new Plugin<StreamInfo | null>({
  key: streamKey,
  state: {
    init: () => null,
    apply(tr, value) {
      const meta = tr.getMeta(streamKey) as StreamMeta | undefined
      if (meta?.type === 'start') return meta.info
      if (meta?.type === 'end' || !value) return null
      let next = value
      if (tr.docChanged) next = { ...next, from: Math.max(0, tr.mapping.map(next.from, -1)) }
      if (meta?.type === 'wrote' && !next.wrote) next = { ...next, wrote: true }
      return next
    }
  }
})

export const activeStream = (state: EditorState): StreamInfo | null => streamKey.getState(state) ?? null

/** Starts a stream at the end of the scene. Writes into a trailing empty paragraph, else after the last block. */
export function startStream(state: EditorState, generationId: string): Transaction {
  const doc = state.doc
  const last = doc.lastChild
  const placeholder = isEmptyParagraph(last)
  const from = placeholder && last ? doc.content.size - last.nodeSize : doc.content.size
  const meta: StreamMeta = { type: 'start', info: { generationId, from, placeholder, wrote: false } }
  return state.tr.setMeta(streamKey, meta).setMeta('addToHistory', false)
}

/** Keeps Adam's cursor where it was: text inserted at the cursor goes after it, not before. */
function keepSelection(state: EditorState, tr: Transaction): void {
  const sel = state.selection
  if (sel instanceof TextSelection) {
    const anchor = tr.mapping.map(sel.anchor, -1)
    const head = tr.mapping.map(sel.head, -1)
    tr.setSelection(TextSelection.between(tr.doc.resolve(anchor), tr.doc.resolve(head)))
  }
}

/** Start of the last block, if it's a paragraph inside the draft's region. */
function streamParagraphStart(tr: Transaction, from: number): number | null {
  const last = tr.doc.lastChild
  if (!last || last.type.name !== 'paragraph') return null
  const start = tr.doc.content.size - last.nodeSize
  return start >= from ? start : null
}

/** Turns a finished "***" paragraph at the end of the draft into a scene break. */
function convertSceneBreak(tr: Transaction, from: number): void {
  const hr = tr.doc.type.schema.nodes.horizontalRule
  const start = streamParagraphStart(tr, from)
  if (!hr || start == null) return
  const last = tr.doc.lastChild!
  if (last.content.size > 0 && isSceneBreakLine(last.textContent)) tr.replaceWith(start, tr.doc.content.size, hr.create())
}

/** Appends streamed operations at the end of the scene. Returns null if no stream is active. */
export function appendStream(state: EditorState, ops: StreamOp[]): Transaction | null {
  const info = activeStream(state)
  if (!info || ops.length === 0) return null
  const schema = state.schema
  const para = schema.nodes.paragraph
  const tr = state.tr
  let wrote = false
  for (const op of ops) {
    if (op.kind === 'paragraph') {
      convertSceneBreak(tr, info.from)
      tr.insert(tr.doc.content.size, para.create())
      continue
    }
    if (!op.text) continue
    const start = streamParagraphStart(tr, info.from)
    if (start == null) tr.insert(tr.doc.content.size, para.create(null, schema.text(op.text)))
    else tr.insert(tr.doc.content.size - 1, schema.text(op.text))
    wrote = true
  }
  if (!tr.docChanged) return null
  keepSelection(state, tr)
  tr.setMeta('addToHistory', false)
  if (wrote) tr.setMeta(streamKey, { type: 'wrote' } satisfies StreamMeta)
  return tr
}

/** The last step of a stream that changes the text: a final "***" line becomes a scene break. */
export function finishStreamText(state: EditorState): Transaction | null {
  const info = activeStream(state)
  if (!info) return null
  const tr = state.tr
  convertSceneBreak(tr, info.from)
  if (!tr.docChanged) return null
  keepSelection(state, tr)
  return tr.setMeta('addToHistory', false)
}

/**
 * Ends the stream and records the whole draft as one undo step. The returned
 * state has the same document as `state`; apply it with view.updateState.
 */
export function commitStream(state: EditorState): EditorState {
  const info = activeStream(state)
  if (!info) return state
  const end: StreamMeta = { type: 'end' }
  const size = state.doc.content.size
  const from = info.from
  const usable = info.wrote && from >= 0 && from < size && state.doc.resolve(from).depth === 0
  if (!usable) return state.apply(closeHistory(state.tr.setMeta(streamKey, end).setMeta('addToHistory', false)))
  try {
    const draft = state.doc.slice(from, size).content
    const before = info.placeholder ? Fragment.from(state.schema.nodes.paragraph.create()) : Fragment.empty
    // 1. Put the region back as it was before the stream, without recording it.
    const tr1 = state.tr.replaceWith(from, size, before).setMeta('addToHistory', false).setMeta(streamKey, end)
    const s1 = state.apply(tr1)
    // 2. Put the whole draft back as one recorded step of its own.
    const tr2 = closeHistory(s1.tr.replaceWith(from, from + before.size, draft))
    if (!tr2.doc.eq(state.doc)) throw new Error('draft did not round-trip')
    tr2.setSelection(Selection.fromJSON(tr2.doc, state.selection.toJSON()))
    const s2 = s1.apply(tr2)
    // 3. Close the group so the next thing Adam types is a separate undo step.
    return s2.apply(closeHistory(s2.tr))
  } catch {
    return state.apply(closeHistory(state.tr.setMeta(streamKey, end).setMeta('addToHistory', false)))
  }
}
