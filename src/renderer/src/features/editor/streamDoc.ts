// Document-level helpers for the manuscript editor, written against plain
// ProseMirror state so they can be tested without a browser:
//  - loading a stored scene into a document, and turning a document into plain text
//  - streaming a draft into the end of the scene without touching Adam's cursor,
//    below a scene break when the scene already has text
//  - or, when Adam chose to replace the scene's text, streaming it in place of that text
//  - turning the model's *asterisks* into italics (and **pairs** into bold) as they arrive
//  - turning a finished stream into ONE undo step
//
// How the single undo step works: streamed chunks are applied with
// addToHistory: false, so typing during a stream keeps its own undo steps and the
// draft never mixes into them. A plugin remembers where the draft begins (a block
// boundary, mapped through every later change). When the stream ends, the draft's
// region is swapped back to how it was before the stream (not recorded), then the
// whole draft is put back as one recorded step. The document ends up identical,
// and one Ctrl+Z removes the whole draft.
//
// Replacing works the same way, with the whole scene as the draft's region. The old
// text stays until the draft's first words arrive; then, in the same step as those
// words, it goes. The editor as it was just before that step is kept, so when the
// stream ends the whole draft is recorded on top of it as one step: one Ctrl+Z puts
// the old text back exactly (paragraph ids and all), and the undo steps Adam had
// before still work after it.
//
// While it waits for those first words, the old text is held: dimmed, and nothing
// typed, pasted or undone can change it (it is about to go, and anything put into it
// would go with it). Once the draft is writing, Ctrl+Z undoes Adam's own edits made
// since as usual; past them it takes the draft back out (the editor stops the draft
// and puts the old text back), and never reaches part-way into steps from before the
// draft, which aren't on the page any more.

import { Fragment, type Node as PMNode, type Schema } from '@tiptap/pm/model'
import { EditorState, Plugin, PluginKey, Selection, TextSelection, type Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { closeHistory, undoDepth } from '@tiptap/pm/history'
import { hasEmphasis, isPreambleLine, isSceneBreakLine, parseEmphasis, splitParagraphs, type StreamOp } from './streamText'

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

/** A paragraph with no words in it: empty, or only spaces. */
const isBlankParagraph = (node: PMNode): boolean => node.type.name === 'paragraph' && node.textContent.trim() === ''

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
  /** A scene break was put in to separate the draft from what the scene already had. */
  breakAdded?: boolean
  /** The draft takes the place of the scene's text (once its first words arrive). */
  replace?: boolean
  /**
   * Replacing: the editor just before the first words took the old text's place, or null while
   * the old text is still there. The whole scene is the draft's region once it is set.
   */
  before?: EditorState | null
  /** Replacing: Adam has changed the page himself since the draft's first words arrived. */
  typed?: boolean
}

type StreamMeta =
  | { type: 'start'; info: StreamInfo }
  | { type: 'wrote' }
  | { type: 'replaced'; before: EditorState }
  | { type: 'restored' }
  | { type: 'undo-asked' }
  | { type: 'end' }

export const streamKey = new PluginKey<StreamInfo | null>('aiwriteStream')

/** True when a change comes from Adam (typing, pasting, undoing), not from the draft being written. */
function byAdam(tr: Transaction): boolean {
  const root = (tr.getMeta('appendedTransaction') as Transaction | undefined) ?? tr
  return !root.getMeta(streamKey) && root.getMeta('addToHistory') !== false
}

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
      if (meta?.type === 'replaced') next = { ...next, from: 0, placeholder: true, before: meta.before }
      if (meta?.type === 'restored') next = { ...next, from: 0, wrote: false }
      if ((meta?.type === 'wrote' || meta?.type === 'replaced') && !next.wrote) next = { ...next, wrote: true }
      if (next.before && !next.typed && tr.docChanged && !meta && byAdam(tr)) next = { ...next, typed: true }
      return next
    }
  },
  // The old text waiting to be replaced is held as it is: nothing but the draft's first words changes it.
  filterTransaction: (tr, state) => !(tr.docChanged && !tr.getMeta(streamKey) && holding(state)),
  props: {
    editable: (state) => !holding(state),
    attributes: (state): Record<string, string> => (holding(state) ? { class: 'replace-waiting' } : {}),
    handleKeyDown: (view, event) => guardUndo(view, undoKeyOf(event)),
    handleDOMEvents: {
      beforeinput: (view, event) => {
        // Held text takes nothing, including an undo the browser sends it from elsewhere.
        const held = holding(view.state)
        const action = event.inputType === 'historyUndo' ? 'undo' : event.inputType === 'historyRedo' ? 'redo' : null
        if (!held && !guardUndo(view, action)) return false
        event.preventDefault()
        return true
      }
    }
  }
})

export const activeStream = (state: EditorState): StreamInfo | null => streamKey.getState(state) ?? null

/** Replacing, and the draft's first words haven't arrived yet: the old text is still there, untouched. */
const waitingToReplace = (info: StreamInfo): boolean => !!info.replace && !info.before

/** True while a draft that replaces the scene's text waits for its first words: the old text is held as it is. */
export function holding(state: EditorState): boolean {
  const info = activeStream(state)
  return !!info && waitingToReplace(info)
}

/** True when this step is the one in which a draft's first words took the place of the scene's text. */
export const replacedIn = (tr: Transaction): boolean => (tr.getMeta(streamKey) as StreamMeta | undefined)?.type === 'replaced'

/** True when Adam asked to undo a draft that is still replacing the scene's text (the editor stops it and puts the old text back). */
export const undoAsked = (tr: Transaction): boolean => (tr.getMeta(streamKey) as StreamMeta | undefined)?.type === 'undo-asked'

/**
 * What undo (Ctrl+Z) or redo should do while a draft replaces the scene's text. Adam's own edits
 * since its first words undo and redo as usual. Past them, undo takes the draft back out
 * ('undo-replace'). Steps from before the draft aren't on the page any more, so they are never
 * undone or redone part-way while it writes ('blocked'); they come back once it ends.
 */
export function undoVerdict(state: EditorState, action: 'undo' | 'redo'): 'normal' | 'blocked' | 'undo-replace' {
  const info = activeStream(state)
  if (!info?.replace) return 'normal'
  if (!info.before) return 'blocked'
  if (action === 'undo') return undoDepth(state) > undoDepth(info.before) ? 'normal' : 'undo-replace'
  return info.typed ? 'normal' : 'blocked'
}

const isMac = typeof navigator !== 'undefined' && /Mac|iP(hone|[oa]d)/.test(navigator.platform ?? '')

/** The editor's undo and redo keys (as its keymap binds them), or null for any other key. */
function undoKeyOf(e: KeyboardEvent): 'undo' | 'redo' | null {
  const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
  if (!mod || e.altKey) return null
  const key = e.key.toLowerCase()
  if (key === 'z' || key === 'я') return e.shiftKey ? 'redo' : 'undo'
  return key === 'y' && !e.shiftKey ? 'redo' : null
}

/** Applies undoVerdict to an undo or redo: true when it was dealt with here (the editor's own undo doesn't run). */
function guardUndo(view: EditorView, action: 'undo' | 'redo' | null): boolean {
  if (!action) return false
  const verdict = undoVerdict(view.state, action)
  if (verdict === 'normal') return false
  if (verdict === 'undo-replace') {
    view.dispatch(view.state.tr.setMeta(streamKey, { type: 'undo-asked' } satisfies StreamMeta).setMeta('addToHistory', false))
  }
  return true
}

/** The last block with words in it (skipping empty or blank paragraphs at the end). */
function lastFilledBlock(doc: PMNode): PMNode | null {
  for (let i = doc.childCount - 1; i >= 0; i--) {
    const n = doc.child(i)
    if (!isBlankParagraph(n)) return n
  }
  return null
}

/**
 * Starts a stream at the end of the scene. Writes into a trailing empty paragraph, else
 * after the last block. When the scene already has text, the draft begins below a scene
 * break, so Adam can see where his text ends and the new draft starts (one Ctrl+Z removes
 * the break with the draft). With `noBreak` (Beat by beat's later beats) it carries straight on.
 *
 * With `replace`, the draft takes the place of the scene's text instead: nothing changes
 * until its first words arrive, so a draft that brings nothing never touches the old text.
 * Until then the old text is held (see `holding`). Starting again while held (once the draft
 * has its id) keeps holding it.
 */
export function startStream(state: EditorState, generationId: string, opts: { replace?: boolean; noBreak?: boolean } = {}): Transaction {
  if (opts.replace) {
    // Nothing changes yet: the old text stays on the page until the draft's first words arrive.
    // Adam's typing before this is an undo step of its own, never joined to anything after.
    const info: StreamInfo = { generationId, from: 0, placeholder: false, wrote: false, replace: true, before: null }
    return closeHistory(state.tr).setMeta(streamKey, { type: 'start', info } satisfies StreamMeta).setMeta('addToHistory', false)
  }
  const doc = state.doc
  const last = doc.lastChild
  const placeholder = isEmptyParagraph(last)
  const from = placeholder && last ? doc.content.size - last.nodeSize : doc.content.size
  const tr = state.tr
  const hr = state.schema.nodes.horizontalRule
  const filled = lastFilledBlock(doc)
  const breakAdded = !opts.noBreak && !!hr && !!filled && filled.type !== hr
  if (breakAdded) {
    // Before the trailing empty paragraph the draft writes into (or at the very end).
    // Nothing before `from` moves, and a cursor in that paragraph stays in it.
    tr.insert(from, hr.create())
    keepSelection(state, tr)
  }
  const meta: StreamMeta = { type: 'start', info: { generationId, from, placeholder, wrote: false, breakAdded } }
  return tr.setMeta(streamKey, meta).setMeta('addToHistory', false)
}

/** Lets go of the held text when the draft that was to replace it never started. Null when nothing is held. */
export function releaseHold(state: EditorState): Transaction | null {
  if (!holding(state)) return null
  return state.tr.setMeta(streamKey, { type: 'end' } satisfies StreamMeta).setMeta('addToHistory', false)
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

/**
 * Turns complete pairs of the model's emphasis markers in the draft's last paragraph into
 * italics and bold ("*He knows,*" becomes italic "He knows,"). Only plain runs are read,
 * so text already formatted stays as it is; a marker still waiting for its pair stays visible.
 */
function formatLastParagraph(tr: Transaction, from: number): void {
  const start = streamParagraphStart(tr, from)
  if (start == null) return
  const para = tr.doc.lastChild!
  const schema = tr.doc.type.schema
  const italic = schema.marks.italic
  const bold = schema.marks.bold
  if (!italic || !bold) return
  const runs: { pos: number; text: string }[] = []
  para.forEach((child, offset) => {
    if (child.isText && child.marks.length === 0 && child.text && hasEmphasis(child.text)) runs.push({ pos: start + 1 + offset, text: child.text })
  })
  // From the end, so earlier positions stay valid.
  for (const r of runs.reverse()) {
    const nodes = parseEmphasis(r.text).map((p) => schema.text(p.text, [...(p.bold ? [bold.create()] : []), ...(p.italic ? [italic.create()] : [])]))
    tr.replaceWith(r.pos, r.pos + r.text.length, nodes)
  }
}

/**
 * Empties the draft's first paragraph when it is a heading or a lead-in ("Here's the scene:")
 * rather than the scene itself, so the scene starts with its first real line. Returns true
 * when it did.
 */
function dropPreamble(tr: Transaction, info: StreamInfo): boolean {
  const start = streamParagraphStart(tr, info.from)
  if (start == null) return false
  // The draft's first paragraph: right at its start, or just after the scene break put in for it.
  const first = info.breakAdded && tr.doc.nodeAt(info.from)?.type.name === 'horizontalRule' ? info.from + 1 : info.from
  const para = tr.doc.lastChild!
  if (start !== first || para.content.size === 0 || !isPreambleLine(para.textContent)) return false
  tr.delete(start + 1, start + 1 + para.content.size)
  return true
}

/**
 * Appends streamed operations at the end of the scene. Returns null if no stream is active.
 * Replacing, the first words take the place of the scene's text in the same step, and the
 * cursor goes to the start of the scene (where it was has gone with the old text).
 */
export function appendStream(state: EditorState, ops: StreamOp[]): Transaction | null {
  let info = activeStream(state)
  if (!info || ops.length === 0) return null
  const schema = state.schema
  const para = schema.nodes.paragraph
  const tr = state.tr
  let wrote = false
  let replaced = false
  for (const op of ops) {
    if (waitingToReplace(info)) {
      // Only words take the old text away (paragraph breaks only ever follow words).
      if (op.kind !== 'text' || !op.text) continue
      tr.replaceWith(0, tr.doc.content.size, para.create())
      info = { ...info, from: 0, placeholder: true, before: state }
      replaced = true
    }
    if (op.kind === 'paragraph') {
      // The next words go into the emptied paragraph instead.
      if (dropPreamble(tr, info)) continue
      formatLastParagraph(tr, info.from)
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
  if (waitingToReplace(info)) return null
  formatLastParagraph(tr, info.from)
  if (!tr.docChanged) return null
  if (replaced) tr.setSelection(Selection.atStart(tr.doc))
  else keepSelection(state, tr)
  tr.setMeta('addToHistory', false)
  // Anything Adam types from here is an undo step of its own (undoVerdict counts on it).
  if (replaced) closeHistory(tr).setMeta(streamKey, { type: 'replaced', before: state } satisfies StreamMeta)
  else if (wrote) tr.setMeta(streamKey, { type: 'wrote' } satisfies StreamMeta)
  return tr
}

/** True when the page has any words on it. */
const hasWords = (doc: PMNode): boolean => doc.textContent.trim() !== ''

/**
 * The last step of a stream that changes the text: a final "***" line becomes a scene break.
 * Replacing, when all that came was a heading or lead-in that was left out, the old text is put
 * back as it was (a draft that brings nothing leaves the scene as it was).
 */
export function finishStreamText(state: EditorState): Transaction | null {
  const info = activeStream(state)
  if (!info || waitingToReplace(info)) return null
  const tr = state.tr
  formatLastParagraph(tr, info.from)
  convertSceneBreak(tr, info.from)
  const before = info.replace ? info.before : null
  if (before && !hasWords(tr.doc) && !tr.doc.eq(before.doc)) {
    tr.replaceWith(0, tr.doc.content.size, before.doc.content)
    try {
      tr.setSelection(Selection.fromJSON(tr.doc, before.selection.toJSON()))
    } catch {
      tr.setSelection(Selection.atStart(tr.doc))
    }
    return tr.setMeta(streamKey, { type: 'restored' } satisfies StreamMeta).setMeta('addToHistory', false)
  }
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
  if (info.replace) return commitReplace(state, info)
  const end: StreamMeta = { type: 'end' }
  const size = state.doc.content.size
  const from = info.from
  const usable = info.wrote && from >= 0 && from < size && state.doc.resolve(from).depth === 0
  const before = info.placeholder ? Fragment.from(state.schema.nodes.paragraph.create()) : Fragment.empty
  if (!usable) {
    const tr = state.tr.setMeta(streamKey, end).setMeta('addToHistory', false)
    // Nothing arrived: take away the scene break put in for the draft, if it is still just that.
    if (info.breakAdded && !info.wrote && from >= 0 && from < size && state.doc.resolve(from).depth === 0) {
      const hr = state.schema.nodes.horizontalRule
      const region = state.doc.slice(from, size).content
      const untouched = region.firstChild?.type === hr && (region.childCount === 1 || (region.childCount === 2 && isEmptyParagraph(region.lastChild)))
      if (untouched) {
        tr.replaceWith(from, size, before)
        keepSelection(state, tr)
      }
    }
    return state.apply(closeHistory(tr))
  }
  try {
    const draft = state.doc.slice(from, size).content
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

/**
 * Ends a stream that replaced the scene's text. The whole draft is recorded as one step on top of
 * the editor as it was just before the first words, so one Ctrl+Z puts the old text back exactly
 * and Adam's earlier undo steps are still there after it. Typing during the stream stays in the
 * draft (as when adding a draft below).
 */
function commitReplace(state: EditorState, info: StreamInfo): EditorState {
  const end: StreamMeta = { type: 'end' }
  const plainEnd = (): EditorState => state.apply(closeHistory(state.tr.setMeta(streamKey, end).setMeta('addToHistory', false)))
  const before = info.before
  // Nothing arrived (or only a lead-in, and the old text is back already): the scene is as it was.
  if (!before) return plainEnd()
  const selection = state.selection.toJSON()
  try {
    if (!samePlugins(before, state)) throw new Error('the editor was set up again')
    const tr = before.tr.setMeta(streamKey, end)
    if (!state.doc.eq(before.doc)) {
      tr.replaceWith(0, before.doc.content.size, state.doc.content)
      if (!tr.doc.eq(state.doc)) throw new Error('draft did not round-trip')
    } else tr.setMeta('addToHistory', false)
    tr.setSelection(Selection.fromJSON(tr.doc, selection))
    const s = before.apply(closeHistory(tr))
    return s.apply(closeHistory(s.tr))
  } catch {
    // The same swap as for a draft added below, over the whole scene.
    if (state.doc.eq(before.doc)) return plainEnd()
    try {
      const draft = state.doc.content
      const tr1 = state.tr.replaceWith(0, state.doc.content.size, before.doc.content)
      const s1 = state.apply(tr1.setMeta('addToHistory', false).setMeta(streamKey, end))
      const tr2 = closeHistory(s1.tr.replaceWith(0, s1.doc.content.size, draft))
      if (!tr2.doc.eq(state.doc)) throw new Error('draft did not round-trip')
      tr2.setSelection(Selection.fromJSON(tr2.doc, selection))
      const s2 = s1.apply(tr2)
      return s2.apply(closeHistory(s2.tr))
    } catch {
      return plainEnd()
    }
  }
}

/** The two states run the same plugins (the editor wasn't set up again in between). */
const samePlugins = (a: EditorState, b: EditorState): boolean =>
  a.plugins.length === b.plugins.length && a.plugins.every((p, i) => p === b.plugins[i])
