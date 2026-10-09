// The lamp (the New look): how a draft's words arrive in the page while Add below, Generate or Beat by beat writes
// them (streamDoc.ts), drawn with decorations only, so the document and its undo steps are never touched.
//  - Each chunk's new words fade in (opacity only, 160 ms). Only the tail of the draft that is new in this step is
//    marked: the draft's text length now, less what it was, counted back from its end. Marking the step's own ranges
//    instead would fade whole phrases again whenever *asterisks* become italics (streamDoc's formatLastParagraph
//    makes the run again). Marks older than 200 ms go on the next chunk (or a moment later), so a paragraph's DOM
//    that is made again never replays them.
//  - The draft's paragraphs are written in a warm ink (aw-drafting), and the paragraph being written has the lamp
//    line in the margin beside it (aw-writing: a thin amber line drawn by CSS, as tall as the paragraph).
//  - When the draft ends, its paragraphs settle into the page's ink over a second (aw-settle); a step that changes
//    nothing in the text takes the class away again 1.2 s later (left on, it would replay if a paragraph were drawn
//    again). Continue's words settle the same way once accepted (settleWords, from features/edits/session.ts).
// The words never move: opacity and colour only. With less motion nothing fades or settles; nothing at all in Classic.
// The caret where the words arrive is streamCaret.ts.
import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { reducedMotion } from '@/features/look/motion'
import { activeStream, landedIn, streamKey } from './streamDoc'

/** How long a word takes to fade in (the CSS keyframes run this long). */
export const ARRIVE_MS = 160
/** A word's fade mark goes once it is this old: its fade has played out. */
export const PRUNE_MS = 200
/** How long the class that lets the draft settle into ink stays on (the CSS settles it in 1000 ms). */
export const SETTLE_MS = 1200

type Kind = 'arrive' | 'drafting' | 'writing' | 'settle'
interface Spec {
  aw: Kind
  /** When the words arrived (arrive marks only). */
  at?: number
}

export interface ArrivalState {
  set: DecorationSet
  /** Some words are still marked as arriving: they are let go a moment later. */
  arriving: boolean
  /** A draft that just ended (or accepted words) settling into ink: since when, and where (mapped through every change). */
  settle: { at: number; from: number; to: number; blocks: boolean } | null
}

type ArrivalMeta = { type: 'prune' } | { type: 'unsettle' } | { type: 'settle'; from: number; to: number }

export const arrivalKey = new PluginKey<ArrivalState>('aiwriteArrival')

const EMPTY: ArrivalState = { set: DecorationSet.empty, arriving: false, settle: null }

export interface ArrivalOptions {
  /** The clock (for tests). */
  now?: () => number
  /** Whether the New look shows (for tests). */
  look?: () => boolean
  /** Whether words may fade and settle: not with less motion (for tests). */
  motion?: () => boolean
}

const newLook = (): boolean => typeof document !== 'undefined' && document.documentElement.dataset.look === 'new'
const clock = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** The top-level blocks from `from` (a block boundary) to the end of the document, with where each starts. */
function blocksFrom(doc: PMNode, from: number, to = doc.content.size): { node: PMNode; pos: number }[] {
  const out: { node: PMNode; pos: number }[] = []
  if (from < 0 || from >= doc.content.size) return out
  // Straight to the block at `from` (the draft's region is the end of a long scene: its start isn't scanned for).
  const $from = doc.resolve(from)
  let i = $from.index(0)
  let pos = $from.posAtIndex(i, 0)
  for (; i < doc.childCount && pos < to; i++) {
    const node = doc.child(i)
    if (pos >= from) out.push({ node, pos })
    pos += node.nodeSize
  }
  return out
}

/** How many characters of text the draft's region has (from `from` to the end): the paragraphs' content, no scan of the words. */
export function regionTextLength(doc: PMNode, from: number): number {
  let len = 0
  for (const b of blocksFrom(doc, from)) if (b.node.isTextblock) len += b.node.content.size
  return len
}

/** Fade marks for the last `count` characters of the region, walking back from its end across paragraphs. */
function tailMarks(doc: PMNode, from: number, count: number, at: number): Decoration[] {
  const out: Decoration[] = []
  const blocks = blocksFrom(doc, from)
  let left = count
  for (let i = blocks.length - 1; i >= 0 && left > 0; i--) {
    const { node, pos } = blocks[i]
    if (!node.isTextblock || node.content.size === 0) continue
    const end = pos + 1 + node.content.size
    const take = Math.min(left, node.content.size)
    out.push(Decoration.inline(end - take, end, { class: 'aw-arrive' }, { aw: 'arrive', at } satisfies Spec))
    left -= take
  }
  return out
}

const ofKind = (set: DecorationSet, kind: Kind): Decoration[] => set.find(undefined, undefined, (s: Spec) => s.aw === kind)

/** The same decorations, at the same places (so the set, and the page, can stay as they are). */
const samePlaces = (a: Decoration[], b: Decoration[]): boolean => a.length === b.length && a.every((d, i) => d.from === b[i].from && d.to === b[i].to)

/** Swaps the decorations of one kind for `next`, leaving the set as it is when they are the same. */
function swapKind(set: DecorationSet, doc: PMNode, kind: Kind, next: Decoration[]): DecorationSet {
  const old = ofKind(set, kind).sort((x, y) => x.from - y.from)
  if (samePlaces(old, next)) return set
  return (old.length ? set.remove(old) : set).add(doc, next)
}

/** Takes away the fade marks older than PRUNE_MS. */
function prune(set: DecorationSet, now: number): DecorationSet {
  const old = set.find(undefined, undefined, (s: Spec) => s.aw === 'arrive' && now - (s.at ?? 0) >= PRUNE_MS)
  return old.length ? set.remove(old) : set
}

/** A node decoration giving each paragraph of a range a class. */
const blockMarks = (doc: PMNode, from: number, to: number, cls: string, aw: Kind): Decoration[] =>
  blocksFrom(doc, from, to)
    .filter((b) => b.node.isTextblock)
    .map((b) => Decoration.node(b.pos, b.pos + b.node.nodeSize, { class: cls }, { aw } satisfies Spec))

function apply(o: Required<ArrivalOptions>, tr: Transaction, value: ArrivalState, oldState: EditorState, newState: EditorState): ArrivalState {
  if (!o.look()) return value === EMPTY ? value : EMPTY
  const meta = tr.getMeta(arrivalKey) as ArrivalMeta | undefined
  const stream = tr.getMeta(streamKey) as { type: string } | undefined
  const motion = o.motion()
  const doc = tr.doc
  let set = tr.docChanged ? value.set.map(tr.mapping, doc) : value.set
  let settle = value.settle
  // Its end goes with words put in right at it: ending a draft takes the draft out and puts it back in one piece.
  if (settle && tr.docChanged) settle = { ...settle, from: tr.mapping.map(settle.from, -1), to: tr.mapping.map(settle.to, 1) }
  let settleSet = false
  const now = o.now()

  // A chunk of the draft arrived: its new words fade in.
  if (meta?.type === 'prune' || (tr.docChanged && stream)) set = prune(set, now)
  const info = activeStream(newState)
  if (motion && info && tr.docChanged && (stream?.type === 'wrote' || stream?.type === 'replaced')) {
    const before = activeStream(oldState)
    // Replacing, the old text went in this step: all the region has is new.
    const was = stream.type === 'replaced' || !before ? 0 : regionTextLength(oldState.doc, before.from)
    const added = regionTextLength(doc, info.from) - was
    if (added > 0) set = set.add(doc, tailMarks(doc, info.from, added, now))
  }

  // While it writes: the draft's paragraphs in warm ink, the lamp line beside the one being written.
  if (info?.wrote) {
    if (tr.docChanged || stream) {
      const blocks = blocksFrom(doc, info.from)
      const last = blocks[blocks.length - 1]
      const writing = last && last.node.isTextblock ? [Decoration.node(last.pos, last.pos + last.node.nodeSize, { class: 'aw-writing' }, { aw: 'writing' } satisfies Spec)] : []
      set = swapKind(set, doc, 'writing', writing)
      set = swapKind(set, doc, 'drafting', blockMarks(doc, info.from, doc.content.size, 'aw-drafting', 'drafting'))
    }
  } else if (value.set !== DecorationSet.empty) {
    set = swapKind(swapKind(set, doc, 'writing', []), doc, 'drafting', [])
  }

  // The draft ended: its paragraphs settle into ink.
  if (stream?.type === 'end') {
    const landed = landedIn(tr)
    if (landed !== null && motion) {
      settle = { at: now, from: landed, to: doc.content.size, blocks: true }
      settleSet = true
    }
  }
  // Accepted words settle too.
  if (meta?.type === 'settle' && motion && meta.to > meta.from) {
    settle = { at: now, from: meta.from, to: meta.to, blocks: false }
    settleSet = true
  }
  if (meta?.type === 'unsettle' && settle) {
    settle = null
    settleSet = true
  }
  if (settleSet) {
    const marks = !settle
      ? []
      : settle.blocks
        ? blockMarks(doc, settle.from, settle.to, 'aw-settle', 'settle')
        : [Decoration.inline(settle.from, settle.to, { class: 'aw-settle-words' }, { aw: 'settle' } satisfies Spec)]
    set = swapKind(set, doc, 'settle', marks)
  } else if (settle?.blocks && tr.docChanged) {
    // The paragraphs are found again after each change: ending a draft takes it out and puts it back (one undo step).
    set = swapKind(set, doc, 'settle', blockMarks(doc, settle.from, settle.to, 'aw-settle', 'settle'))
  }

  const arriving = ofKind(set, 'arrive').length > 0
  if (set === value.set && settle === value.settle && arriving === value.arriving) return value
  return { set, arriving, settle }
}

/** Marks the words a step puts in (Continue's, accepted) to settle into ink like a finished draft's. */
export function settleWords(tr: Transaction, from: number, to: number): Transaction {
  return tr.setMeta(arrivalKey, { type: 'settle', from, to } satisfies ArrivalMeta)
}

/** The plugin; the options are for tests. */
export function arrivalPlugin(options: ArrivalOptions = {}): Plugin<ArrivalState> {
  const o: Required<ArrivalOptions> = { now: options.now ?? clock, look: options.look ?? newLook, motion: options.motion ?? (() => !reducedMotion()) }
  return new Plugin<ArrivalState>({
    key: arrivalKey,
    state: {
      init: () => EMPTY,
      apply: (tr, value, oldState, newState) => apply(o, tr, value, oldState, newState)
    },
    props: {
      decorations(state) {
        if (!o.look()) return null
        const st = arrivalKey.getState(state)
        if (!st || st.set === DecorationSet.empty) return null
        // A scene written into while away (kept for its draft) comes back with its marks long done: never replayed.
        if (st.settle && o.now() - st.settle.at > SETTLE_MS) return st.set.remove(ofKind(st.set, 'settle'))
        return st.set
      }
    },
    view: (view: EditorView) => {
      let pruneTimer: ReturnType<typeof setTimeout> | null = null
      let settleTimer: ReturnType<typeof setTimeout> | null = null
      let settling: number | null = null
      const send = (meta: ArrivalMeta): void => {
        if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(arrivalKey, meta).setMeta('addToHistory', false))
      }
      const update = (v: EditorView): void => {
        const st = arrivalKey.getState(v.state)
        if (!st) return
        // Fade marks go a moment after the last chunk (each new chunk also lets go of the old ones).
        if (st.arriving && !pruneTimer) {
          pruneTimer = setTimeout(() => {
            pruneTimer = null
            send({ type: 'prune' })
          }, PRUNE_MS + 40)
        }
        // The settle class goes once the colour has settled.
        const at = st.settle?.at ?? null
        if (at !== settling) {
          if (settleTimer) clearTimeout(settleTimer)
          settleTimer = null
          settling = at
          if (at !== null) {
            settleTimer = setTimeout(
              () => {
                settleTimer = null
                settling = null
                if (arrivalKey.getState(view.state)?.settle?.at === at) send({ type: 'unsettle' })
              },
              Math.max(0, at + SETTLE_MS - o.now())
            )
          }
        }
      }
      update(view)
      return {
        update,
        destroy() {
          if (pruneTimer) clearTimeout(pruneTimer)
          if (settleTimer) clearTimeout(settleTimer)
        }
      }
    }
  })
}

export const Arrival = Extension.create({
  name: 'aiwriteArrival',
  addProseMirrorPlugins: () => [arrivalPlugin()]
})
