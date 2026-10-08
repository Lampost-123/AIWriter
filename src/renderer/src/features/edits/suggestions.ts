// Tracked changes in the page (milestone 4, Editing with AI): an AI edit shows as the old words struck
// through and the new words highlighted, with Accept and Reject; the scene's text itself changes only on
// Accept. A TipTap extension, in the editor's list (features/editor/extensions.ts). Owned by the AI edits
// part.
//
// How it works:
//  - A suggestion lives in this plugin's state, never in the document: the old words get a decoration
//    (struck through) and the new words are a widget after them, so autosave, crash recovery, snapshots
//    and the memory only ever see the scene's own text. One suggestion at a time.
//  - Its place is mapped through every change. Typing elsewhere (or right at its edges) keeps it; a change
//    to the words under it, a new draft starting, or the whole scene being replaced drops it, and the
//    interface says so. Opening another scene builds a new editor state, so it goes then too.
//  - Accept puts the new words in place of the old as ONE undo step (Ctrl+Z puts the old words back,
//    Ctrl+Y the new ones again). The first new paragraph keeps the paragraph id of the one it starts in,
//    the last takes the id of the one it ends in, and the ones between reuse the old ones' ids. New
//    paragraphs ahead of a paragraph (Continue from its start) go in whole, and it keeps its own id.
//  - The new words show inline, each new paragraph after the first below a gap like a paragraph's, so
//    the last line of them is the paragraph's last line too (no empty line opens below the change). In the New
//    look the words that have just arrived fade in, carrying on across the widget being drawn again (arrivalSpans.ts).
//  - Reject changes nothing in the text. Ctrl+Z while a suggestion waits (and nothing was typed since it
//    showed) rejects it, and Ctrl+Y then brings it back, so undo and redo cover AI changes as they do
//    typing.
//  - Below the change, a block-level gap (its height set by the interface) makes room for its buttons,
//    which SuggestionLayer.tsx draws over it.

import { Extension } from '@tiptap/core'
import { Fragment, Slice, type Node as PMNode, type Schema } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { closeHistory, redoDepth, undoDepth } from '@tiptap/pm/history'
import type { EditTool, ID } from '@shared/types'
import { streamKey } from '@/features/editor/streamDoc'
import { parseEmphasis } from '@/features/editor/streamText'
import { reducedMotion } from '@/features/look/motion'
import { BREAK, joinSpaces, newParagraphs } from './text'
import { ArrivalSpans, runsOf, type ArrivalSpan } from './arrivalSpans'

export type SuggestionStatus =
  /** Being set up (the briefing is being put together): nothing is struck through yet. */
  | 'starting'
  | 'writing'
  /** Stop was pressed; the last words are on their way. */
  | 'stopping'
  | 'ready'
  /** Accept was pressed; a snapshot of the scene is being kept first. */
  | 'accepting'

export interface Suggestion {
  /** The task writing it (made by the interface). */
  id: ID
  sceneId: ID
  tool: EditTool
  /** Adam's instruction, or the tone (Rewrite and Change tone). */
  direction: string
  /** The words it takes the place of; for Continue, from = to, where the new words go. Mapped through every change. */
  from: number
  to: number
  /**
   * 'replace': the selected words. Continue: 'inline' carries on the paragraph at `from`; 'paragraph'
   * adds paragraphs after the one `from` ends; 'before' adds paragraphs ahead of the one `from` starts.
   */
  mode: 'replace' | 'inline' | 'paragraph' | 'before'
  /** The new words so far: paragraphs on their own lines, *italics* and **bold**. For Alternatives, the picked version's. */
  text: string
  /** A single newline in the new words is a line break inside a paragraph (the words sent had one), not a new paragraph. */
  lineBreaks: boolean
  /** Alternatives: the versions so far, how many are complete, and the one Adam picked (null while he picks). */
  versions: string[] | null
  versionsDone: number
  chosen: number | null
  status: SuggestionStatus
  /** Its record, for What the AI saw. */
  generationId: ID | null
  /** A plain-words note about it (whose voices Fix voice matched, words cut short...). */
  note: string | null
  /** What it is called beside it, in place of its tool's name (a ready-made change: "Polish pass"). */
  label?: string | null
  /** The AI service was busy, so the request is being tried again. */
  retrying: boolean
  /** The undo history's depth when it showed: Ctrl+Z with nothing done since then rejects it. */
  undoDepth: number
  /** Goes up whenever what it shows changes. */
  rev: number
}

/** What a new suggestion needs; the rest starts empty. */
export type NewSuggestion = Pick<Suggestion, 'id' | 'sceneId' | 'tool' | 'direction' | 'from' | 'to' | 'mode'> & Partial<Suggestion>

/** Why a suggestion went. */
export type GoneReason = 'accepted' | 'rejected' | 'cleared' | 'edited' | 'replaced' | 'draft'

export interface SuggestionsState {
  active: Suggestion | null
  /** The last one rejected, while its words are as they were: Undo or Ctrl+Y brings it back. */
  rejected: { s: Suggestion; undoDepth: number; redoDepth: number } | null
  /** The last one that went, and why (`seq` goes up each time). */
  gone: { seq: number; id: ID; reason: GoneReason } | null
  /** Words an AI tool is about to work on, softly marked while its menu is open (the page has no focus then). */
  target: { from: number; to: number } | null
}

type Meta =
  | { type: 'show'; s: Suggestion }
  | { type: 'update'; id: ID; patch: Partial<Suggestion> }
  | { type: 'accept'; id: ID }
  | { type: 'reject'; id: ID; undoDepth: number; redoDepth: number }
  | { type: 'clear'; id: ID }
  | { type: 'restore' }
  | { type: 'target'; target: { from: number; to: number } | null }

export const suggestionsKey = new PluginKey<SuggestionsState>('aiwriteSuggestions')

const EMPTY: SuggestionsState = { active: null, rejected: null, gone: null, target: null }

let goneSeq = 0

// ---------- Where it is ----------

/** New paragraphs ahead of a paragraph need it to start where they were asked for. */
function stillFits(doc: PMNode, s: Pick<Suggestion, 'mode' | 'from'>): boolean {
  if (s.mode !== 'before') return true
  const $from = doc.resolve(s.from)
  return $from.parent.isTextblock && $from.parentOffset === 0
}

/**
 * A range mapped through a transaction, or why it can't be: a change inside it ('edited'), or the whole
 * document replaced ('replaced'). Changes right at its edges stay outside it; for a point (Continue),
 * text typed at it goes after the new words, as the page shows.
 */
export function mapRange(r: { from: number; to: number }, tr: Transaction): { from: number; to: number } | 'edited' | 'replaced' {
  let { from, to } = r
  const point = from === to
  for (let i = 0; i < tr.mapping.maps.length; i++) {
    const map = tr.mapping.maps[i]
    const size = tr.docs[i]?.content.size ?? Number.MAX_SAFE_INTEGER
    let hit: 'edited' | 'replaced' | null = null
    map.forEach((start, end) => {
      if (hit) return
      const inside = point ? start < from && end > from : end > start ? start < to && end > from : start > from && start < to
      if (inside) hit = start === 0 && end >= size ? 'replaced' : 'edited'
    })
    if (hit) return hit
    if (point) from = to = map.map(from, -1)
    else {
      from = map.map(from, 1)
      to = map.map(to, -1)
    }
  }
  return to >= from ? { from, to } : 'edited'
}

function apply(tr: Transaction, value: SuggestionsState): SuggestionsState {
  const meta = tr.getMeta(suggestionsKey) as Meta | undefined
  let { active, rejected, gone, target } = value
  const went = (reason: GoneReason): void => {
    if (!active) return
    gone = { seq: ++goneSeq, id: active.id, reason }
    active = null
  }
  switch (meta?.type) {
    case 'show':
      active = meta.s
      rejected = null
      target = null
      break
    case 'update':
      if (active?.id === meta.id) active = { ...active, ...meta.patch, rev: active.rev + 1 }
      break
    case 'accept':
      if (active?.id === meta.id) went('accepted')
      break
    case 'reject':
      if (active?.id === meta.id) {
        // Kept to bring back when it has words (what had come, if it was still being written).
        const words = active.versions ? active.versions.some((v) => v.trim()) : !!active.text.trim()
        const s: Suggestion = { ...active, status: 'ready', retrying: false, versionsDone: active.versions?.length ?? 0 }
        rejected = words ? { s, undoDepth: meta.undoDepth, redoDepth: meta.redoDepth } : null
        went('rejected')
      }
      break
    case 'clear':
      if (active?.id === meta.id) went('cleared')
      break
    case 'restore':
      if (!active && rejected) {
        active = { ...rejected.s, rev: rejected.s.rev + 1 }
        rejected = null
      }
      break
    case 'target':
      target = meta.target
      break
  }
  // A draft starting takes the page: the suggestion goes.
  if ((tr.getMeta(streamKey) as { type?: string } | undefined)?.type === 'start') {
    went('draft')
    rejected = null
    target = null
  }
  if (tr.docChanged) {
    if (active) {
      const m = mapRange(active, tr)
      if (typeof m === 'string') went(m)
      else if (!stillFits(tr.doc, { mode: active.mode, from: m.from })) went('edited')
      else if (m.from !== active.from || m.to !== active.to) active = { ...active, from: m.from, to: m.to }
    }
    if (rejected) {
      const m = mapRange(rejected.s, tr)
      rejected =
        typeof m === 'string' || !stillFits(tr.doc, { mode: rejected.s.mode, from: m.from })
          ? null
          : m.from === rejected.s.from && m.to === rejected.s.to
            ? rejected
            : { ...rejected, s: { ...rejected.s, ...m } }
    }
    if (target) {
      const m = mapRange(target, tr)
      target = typeof m === 'string' ? null : m
    }
  }
  if (active === value.active && rejected === value.rejected && gone === value.gone && target === value.target) return value
  return { active, rejected, gone, target }
}

export const suggestionsOf = (state: EditorState): SuggestionsState => suggestionsKey.getState(state) ?? EMPTY

export const activeSuggestion = (state: EditorState): Suggestion | null => suggestionsOf(state).active

/** Alternatives waiting for a version to be picked (from the start, while they are written). */
export const picking = (s: Suggestion): boolean => s.tool === 'alternatives' && s.chosen === null

// ---------- Changes to it ----------

/** Shows a new suggestion (writing, or setting up), with the caret after it. */
export function showSuggestion(state: EditorState, s: NewSuggestion): Transaction {
  const full: Suggestion = {
    text: '',
    lineBreaks: false,
    versions: null,
    versionsDone: 0,
    chosen: null,
    status: 'starting',
    generationId: null,
    note: null,
    retrying: false,
    rev: 0,
    ...s,
    undoDepth: undoDepth(state)
  }
  // Anything typed from here is an undo step of its own, so Ctrl+Z can tell typing from the suggestion.
  const tr = closeHistory(state.tr).setMeta(suggestionsKey, { type: 'show', s: full } satisfies Meta)
  return tr.setSelection(TextSelection.near(state.doc.resolve(s.to), -1))
}

export const updateSuggestion = (state: EditorState, id: ID, patch: Partial<Suggestion>): Transaction =>
  state.tr.setMeta(suggestionsKey, { type: 'update', id, patch } satisfies Meta)

/** Rejects it: nothing in the text changes. It can be brought back (restoreSuggestion) while its words stay as they are. */
export const rejectSuggestion = (state: EditorState, id: ID): Transaction =>
  closeHistory(state.tr).setMeta(suggestionsKey, {
    type: 'reject',
    id,
    undoDepth: undoDepth(state),
    redoDepth: redoDepth(state)
  } satisfies Meta)

/** Takes it away without keeping it (it failed, or brought no words). */
export const clearSuggestion = (state: EditorState, id: ID): Transaction =>
  state.tr.setMeta(suggestionsKey, { type: 'clear', id } satisfies Meta)

/** Brings back the last suggestion rejected, if its words are still as they were. Null when there's none. */
export function restoreSuggestion(state: EditorState): Transaction | null {
  const ps = suggestionsOf(state)
  if (ps.active || !ps.rejected) return null
  return state.tr.setMeta(suggestionsKey, { type: 'restore' } satisfies Meta)
}

/** Marks the words an AI tool is about to work on (or null to stop). */
export const markTarget = (state: EditorState, target: { from: number; to: number } | null): Transaction =>
  state.tr.setMeta(suggestionsKey, { type: 'target', target } satisfies Meta).setMeta('addToHistory', false)

/** What Ctrl+Z or Ctrl+Y does with a suggestion: reject the one waiting, bring back the one just rejected, or nothing (a normal undo). */
export function suggestionUndo(state: EditorState, action: 'undo' | 'redo'): 'reject' | 'restore' | 'none' {
  const ps = suggestionsOf(state)
  if (action === 'undo') return ps.active && ps.active.status !== 'accepting' && undoDepth(state) <= ps.active.undoDepth ? 'reject' : 'none'
  const r = ps.rejected
  return !ps.active && r && undoDepth(state) === r.undoDepth && redoDepth(state) === r.redoDepth ? 'restore' : 'none'
}

// ---------- The new words ----------

/** The new words as they show and go in: paragraphs, with the spaces a continuation needs where it joins. */
export function shownParagraphs(doc: PMNode, s: Suggestion): { paras: string[]; firstInline: boolean } {
  const paras = newParagraphs(s.text, s.lineBreaks)
  if (s.mode === 'paragraph' || s.mode === 'before') return { paras, firstInline: false }
  const $from = doc.resolve(s.from)
  const $to = doc.resolve(s.to)
  if (s.mode === 'inline') {
    const para = $from.parent
    const before = para.textBetween(0, $from.parentOffset, undefined, '\n')
    const after = para.textBetween($from.parentOffset, para.content.size, undefined, '\n')
    if (paras.length) {
      const { lead, trail } = joinSpaces(before, paras[0], after)
      paras[0] = lead + paras[0]
      paras[paras.length - 1] += trail
    }
    return { paras, firstInline: true }
  }
  // Whole paragraphs take whole paragraphs' place: the new ones show below the old ones.
  const whole = $from.parentOffset === 0 && $to.parentOffset === $to.parent.content.size
  return { paras, firstInline: !whole }
}

/** One paragraph's words, with italics and bold, and a line break for each single newline in it. */
function inlineNodes(schema: Schema, text: string): PMNode[] {
  const italic = schema.marks.italic
  const bold = schema.marks.bold
  const lineBreak = schema.nodes.hardBreak
  return text.split('\n').flatMap((line, i) => [
    ...(i > 0 ? [lineBreak ? lineBreak.create() : schema.text(' ')] : []),
    ...parseEmphasis(line)
      .filter((p) => p.text)
      .map((p) => schema.text(p.text, [...(p.bold && bold ? [bold.create()] : []), ...(p.italic && italic ? [italic.create()] : [])]))
  ])
}

/**
 * Accept: the new words in place of the old ones, as one undo step (dispatch closeHistory after it too, so
 * typing straight after is a step of its own). Null when there's nothing to put in.
 */
export function acceptSuggestion(state: EditorState, id: ID): Transaction | null {
  const s = activeSuggestion(state)
  if (!s || s.id !== id) return null
  const doc = state.doc
  const schema = state.schema
  const { paras } = shownParagraphs(doc, s)
  if (!paras.some((p) => p !== BREAK && p.trim())) return null
  const $from = doc.resolve(s.from)
  const $to = doc.resolve(s.to)
  if (!$from.parent.isTextblock || !$to.parent.isTextblock) return null
  const sameBlock = $from.before() === $to.before()
  // The paragraphs between the first and the last keep their ids in the new ones between (in order).
  const middle: string[] = []
  if (s.mode === 'replace' && !sameBlock) {
    doc.nodesBetween($from.after(), $to.before(), (node) => {
      if (!node.isTextblock) return true
      if (typeof node.attrs.pid === 'string' && node.attrs.pid) middle.push(node.attrs.pid)
      return false
    })
  }
  const lastPid = s.mode === 'replace' && !sameBlock ? (($to.parent.attrs.pid as string | null) ?? null) : null
  const nodes = paras.map((p, i) => {
    if (p === BREAK) return schema.nodes.horizontalRule.create()
    const pid = i === 0 ? null : i === paras.length - 1 ? lastPid : (middle.shift() ?? null)
    return schema.nodes.paragraph.create({ pid }, inlineNodes(schema, p))
  })
  const tr = closeHistory(state.tr)
  const sel = state.selection
  const caretHere = sel.from >= s.from && sel.to <= s.to
  if (s.mode === 'before') {
    // Whole paragraphs ahead of the one Continue started at, which stays as it was (with its id); the
    // caret, if it was at the change, goes to the end of the new words.
    const at = $from.before()
    tr.insert(at, nodes)
    if (caretHere) tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(at, 1)), -1))
    return tr.setMeta(suggestionsKey, { type: 'accept', id } satisfies Meta)
  }
  // The next paragraphs, after the one Continue carried on from: an empty first one joins that paragraph.
  if (s.mode === 'paragraph') nodes.unshift(schema.nodes.paragraph.create())
  tr.replace(s.from, s.to, new Slice(Fragment.fromArray(nodes), 1, 1))
  // The caret, if it was at the change, goes to the end of the new words.
  if (caretHere) tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(s.to, 1)), -1))
  return tr.setMeta(suggestionsKey, { type: 'accept', id } satisfies Meta)
}

// ---------- In the page ----------

const BLOCK_ROOM_CLASS = 'aw-sugg-room'

/**
 * The new words: after the old ones (or where Continue carries on), or, for new paragraphs ahead of a
 * paragraph, a block of their own just before it. Each new paragraph after the first starts below a gap
 * like a paragraph's while its words stay inline, so the last line of the new words is also the line the
 * page's own end-of-paragraph marker sits on, and no empty line opens below the change.
 */
function renderNew(s: Suggestion, paras: string[], firstInline: boolean): HTMLElement {
  const writing = s.status === 'starting' || s.status === 'writing' || s.status === 'stopping'
  const own = s.mode === 'before'
  const root = document.createElement(own ? 'div' : 'span')
  root.className = ['aw-sugg-new', own ? 'on-its-own' : '', s.to > s.from && firstInline ? 'after-old' : ''].filter(Boolean).join(' ')
  root.spellcheck = false
  root.setAttribute('data-suggestion', s.id)
  const add = (className: string): HTMLElement => {
    const el = document.createElement('span')
    el.className = className
    root.appendChild(el)
    return el
  }
  let last: HTMLElement | null = null
  // The New look: the words that have just arrived fade in, each fade carrying on from where it had got to when the
  // words were drawn again (arrivalSpans.ts).
  const parsed = paras.map((p) => (p === BREAK ? [] : parseEmphasis(p)))
  const shown = parsed.reduce((n, pieces) => n + pieces.reduce((m, piece) => m + piece.text.length, 0), 0)
  const spans = wordsFade() ? arrivals.note(s.id, shown, performance.now(), writing) : []
  let offset = 0
  paras.forEach((p, i) => {
    if (p === BREAK) {
      add('aw-sugg-break').textContent = '*  *  *'
      return
    }
    // A new paragraph (not the first, when it carries on a line) starts below a gap, unless a scene break
    // or the start of a block of their own already parts it from what is above.
    const newLine = !(i === 0 && firstInline)
    if (newLine && !(i === 0 && own) && paras[i - 1] !== BREAK) add('aw-sugg-gap')
    const words = add('aw-sugg-words')
    for (const piece of parsed[i]) {
      let node: Node = spans.length ? withFades(piece.text, offset, spans) : withBreaks(piece.text)
      offset += piece.text.length
      if (piece.italic) {
        const em = document.createElement('em')
        em.appendChild(node)
        node = em
      }
      if (piece.bold) {
        const strong = document.createElement('strong')
        strong.appendChild(node)
        node = strong
      }
      words.appendChild(node)
    }
    last = words
  })
  if (writing) {
    const caret = document.createElement('span')
    caret.className = 'aw-sugg-caret'
    if (last) (last as HTMLElement).appendChild(caret)
    else {
      if (!firstInline && !own) add('aw-sugg-gap')
      root.appendChild(caret)
    }
  }
  return root
}

/**
 * Words with their line breaks (a newline inside a paragraph, when the words had them) as breaks: in the page,
 * a widget's text doesn't keep newlines (ProseMirror sets `white-space: normal` on it).
 */
function withBreaks(text: string): DocumentFragment {
  const out = document.createDocumentFragment()
  text.split('\n').forEach((line, i) => {
    if (i) out.appendChild(document.createElement('br'))
    if (line) out.appendChild(document.createTextNode(line))
  })
  return out
}

/** How far the change being written has got, so its newest words fade in (one change at a time). */
const arrivals = new ArrivalSpans()

/** New words fade in only in the New look, and not with less motion. */
const wordsFade = (): boolean => document.documentElement.dataset.look === 'new' && !reducedMotion()

/** Words (starting `offset` characters into the new words) with the stretches still fading in their own spans. */
function withFades(text: string, offset: number, spans: ArrivalSpan[]): DocumentFragment {
  const out = document.createDocumentFragment()
  for (const run of runsOf(text, offset, spans)) {
    if (run.delay === null) {
      out.appendChild(withBreaks(run.text))
      continue
    }
    const span = document.createElement('span')
    span.className = 'aw-arrive'
    span.style.animationDelay = `${Math.round(run.delay)}ms`
    span.appendChild(withBreaks(run.text))
    out.appendChild(span)
  }
  return out
}

function renderRoom(): HTMLElement {
  const el = document.createElement('div')
  el.className = BLOCK_ROOM_CLASS
  el.setAttribute('aria-hidden', 'true')
  return el
}

/** Where the new words show: after the old ones, or (new paragraphs ahead of a paragraph) just before it. */
const newWordsPos = (doc: PMNode, s: Suggestion): number => (s.mode === 'before' ? doc.resolve(s.from).before() : s.to)

/** Where the room for the buttons goes: just after the top-level block the change ends in, or just after new paragraphs of their own. */
function roomPos(doc: PMNode, s: Suggestion): number {
  if (s.mode === 'before') return newWordsPos(doc, s)
  const $pos = doc.resolve(s.to)
  return $pos.depth >= 1 ? $pos.after(1) : doc.content.size
}

function decorations(state: EditorState): DecorationSet | null {
  const ps = suggestionsKey.getState(state)
  if (!ps) return null
  const s = ps.active
  const out: Decoration[] = []
  if (!s) {
    if (ps.target && ps.target.to > ps.target.from) out.push(Decoration.inline(ps.target.from, ps.target.to, { class: 'aw-sugg-target' }))
    return out.length ? DecorationSet.create(state.doc, out) : null
  }
  if (s.to > s.from) out.push(Decoration.inline(s.from, s.to, { class: s.status === 'starting' ? 'aw-sugg-target' : 'aw-sugg-old' }))
  // Three versions show beside the page until one is picked; then it shows here like any other change.
  if (!picking(s)) {
    const { paras, firstInline } = shownParagraphs(state.doc, s)
    const key = `aw-new:${s.id}:${s.rev}:${firstInline ? 'i' : 'b'}:${paras[0]?.[0] === ' ' ? 's' : ''}:${paras.length}`
    out.push(
      Decoration.widget(newWordsPos(state.doc, s), () => renderNew(s, paras, firstInline), {
        side: -1,
        marks: [],
        ignoreSelection: true,
        key
      })
    )
  }
  out.push(
    Decoration.widget(roomPos(state.doc, s), renderRoom, {
      side: 1,
      ignoreSelection: true,
      stopEvent: () => true,
      key: `aw-room:${s.id}`
    })
  )
  return DecorationSet.create(state.doc, out)
}

// ---------- Keys ----------

/** What the interface does when a key asks for it (set by the AI edits session). */
export interface SuggestionHandlers {
  accept(id: ID): void
  reject(id: ID, how: 'key' | 'undo'): void
  stop(id: ID): void
  restore(): void
  /** Backspace just after the new words: they can't be edited until they're accepted. */
  blocked(): void
  /** Tab while Alternatives wait for a pick: the keyboard goes to the versions. */
  focusPicker(): void
}

let handlers: SuggestionHandlers | null = null

export function setSuggestionHandlers(h: SuggestionHandlers | null): void {
  handlers = h
}

const isMac = typeof navigator !== 'undefined' && /Mac|iP(hone|[oa]d)/.test(navigator.platform ?? '')

/** The editor's undo and redo keys, or null for any other key. */
function undoKeyOf(e: KeyboardEvent): 'undo' | 'redo' | null {
  const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
  if (!mod || e.altKey) return null
  const key = e.key.toLowerCase()
  if (key === 'z' || key === 'я') return e.shiftKey ? 'redo' : 'undo'
  return key === 'y' && !e.shiftKey ? 'redo' : null
}

/** Ctrl+Z or Ctrl+Y (or the Edit menu's Undo and Redo): true when it was about the suggestion. */
function onUndoKey(view: EditorView, action: 'undo' | 'redo' | null): boolean {
  if (!action || !handlers) return false
  const verdict = suggestionUndo(view.state, action)
  const s = activeSuggestion(view.state)
  if (verdict === 'reject' && s) handlers.reject(s.id, 'undo')
  else if (verdict === 'restore') handlers.restore()
  else return !!s && s.status === 'accepting' && action === 'undo'
  return true
}

function handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing || !handlers) return false
  const action = undoKeyOf(event)
  if (action) return onUndoKey(view, action)
  const s = activeSuggestion(view.state)
  if (!s) return false
  const plain = !event.ctrlKey && !event.metaKey && !event.altKey
  if (event.key === 'Tab' && plain && !event.shiftKey) {
    if (s.status === 'ready' && s.text.trim()) handlers.accept(s.id)
    else if (picking(s)) handlers.focusPicker()
    // While it is still written, Tab waits for it rather than taking the keyboard out of the page.
    return true
  }
  if (event.key === 'Escape' && plain && !event.shiftKey) {
    if (s.status === 'writing' || s.status === 'starting') handlers.stop(s.id)
    else if (s.status === 'ready') handlers.reject(s.id, 'key')
    return true
  }
  if (event.key === 'Backspace') {
    const sel = view.state.selection
    if (sel.empty && sel.head === s.to) {
      handlers.blocked()
      return true
    }
  }
  return false
}

const suggestionsPlugin = new Plugin<SuggestionsState>({
  key: suggestionsKey,
  state: {
    init: () => EMPTY,
    apply
  },
  props: {
    decorations,
    handleKeyDown,
    handleDOMEvents: {
      beforeinput: (view, event) => {
        const action = event.inputType === 'historyUndo' ? 'undo' : event.inputType === 'historyRedo' ? 'redo' : null
        if (!onUndoKey(view, action)) return false
        event.preventDefault()
        return true
      }
    }
  }
})

/**
 * The extension. Ahead of the editor's own keys (the undo history's, Tab), so Ctrl+Z, Tab and Esc reach a
 * waiting suggestion first.
 */
export const Suggestions = Extension.create({
  name: 'aiwriteSuggestions',
  priority: 900,
  addProseMirrorPlugins: () => [suggestionsPlugin]
})

/** For tests: the plugin itself. */
export const suggestionsPluginForTests = suggestionsPlugin
