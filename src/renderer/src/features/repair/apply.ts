// Check and repair in the page (step 3 of the consistency plan; contracts/repair.ts): the pure parts, written against
// plain ProseMirror state so they are unit-tested. Where new AI words are in the page as they land (each paragraph's
// id, its words, and which of them are the AI's), and the mending itself: each fix is a tiny edit of the AI's own
// words, made only while its paragraph is exactly as it landed (Adam hasn't touched it), never where his cursor or
// selection is, all in one step. Undo puts back what the AI wrote, where the fix is still as it was made.

import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { LandedParagraph, RepairFix } from '@shared/contracts/repair'

/** One paragraph the new words are in, with its id so it can be found again. */
export interface LandedPart extends LandedParagraph {
  pid: string | null
  /** Where the AI's words in it begin in the page (a position). */
  at: number
}

/** A paragraph's words, one character for each position inside it (a line break is "\n"). */
export function paragraphText(node: PMNode): string {
  let t = ''
  node.forEach((child) => {
    if (child.isText) t += child.text ?? ''
    else t += child.type.name === 'hardBreak' ? '\n' : '￼'.repeat(child.nodeSize)
  })
  return t
}

/**
 * The paragraphs the words from `from` to `to` (positions) are in, in order, and which part of each they are. `typed`:
 * the ids of paragraphs Adam typed in while the words streamed in (marks.ts): marked `edited`, so nothing in them is
 * ever mended.
 */
export function landedParts(doc: PMNode, from: number, to: number, typed: Set<string> = new Set()): LandedPart[] {
  const out: LandedPart[] = []
  if (to <= from) return out
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true
    const start = pos + 1
    const a = Math.max(from, start) - start
    const b = Math.min(to, start + node.content.size) - start
    const text = paragraphText(node)
    const pid = typeof node.attrs.pid === 'string' && node.attrs.pid ? node.attrs.pid : null
    if (b > a && text.slice(a, b).trim()) out.push({ pid, text, from: a, to: b, at: start + a, ...(!pid || typed.has(pid) ? { edited: true } : {}) })
    return false
  })
  return out
}

/** Where a paragraph with this id starts its words (the position just inside it), and the paragraph. */
function findParagraph(doc: PMNode, pid: string): { start: number; node: PMNode } | null {
  let found: { start: number; node: PMNode } | null = null
  doc.descendants((node, pos) => {
    if (found) return false
    if (node.isTextblock) {
      if (node.attrs.pid === pid) found = { start: pos + 1, node }
      return false
    }
    return true
  })
  return found
}

/** A fix made in the page: where its words are now, and what the AI had written there. */
export interface MadeFix {
  id: string
  from: number
  to: number
  was: string
  now: string
  why: string
}

/**
 * The fixes to make now, as one transaction (null when none can be made), and which were made. A fix is made only
 * when its paragraph is exactly as it landed, its words are the AI's part of it and still say what the AI wrote, and
 * neither Adam's cursor nor his selection is in them; `blocked` says where else not to change (a draft being
 * written, an AI change waiting).
 */
export function fixesTr(
  state: EditorState,
  parts: LandedPart[],
  fixes: RepairFix[],
  blocked: (from: number, to: number) => boolean = () => false
): { tr: Transaction; made: MadeFix[] } | null {
  const doc = state.doc
  const sel = state.selection
  const places: (MadeFix & { order: number })[] = []
  fixes.forEach((f, order) => {
    const part = parts[f.para]
    if (!part?.pid || f.start < part.from || f.end > part.to || f.end <= f.start) return
    const p = findParagraph(doc, part.pid)
    if (!p || paragraphText(p.node) !== part.text || part.text.slice(f.start, f.end) !== f.was) return
    const from = p.start + f.start
    const to = p.start + f.end
    // Adam's cursor inside the words, or a selection touching them: left alone.
    if (sel.empty ? sel.head > from && sel.head < to : sel.from < to && sel.to > from) return
    if (blocked(from, to)) return
    if (places.some((x) => x.from < to && from < x.to)) return
    places.push({ id: f.id, from, to, was: f.was, now: f.now, why: f.why, order })
  })
  if (!places.length) return null
  // From the end back, so each fix's place is still right when it is made.
  const sorted = [...places].sort((a, b) => b.from - a.from)
  const tr = state.tr
  sorted.forEach((x) => tr.insertText(x.now, x.from, x.to))
  const made = sorted
    .map((x, i) => {
      const later = tr.mapping.slice(i + 1)
      return { id: x.id, from: later.map(x.from, -1), to: later.map(x.from + x.now.length, 1), was: x.was, now: x.now, why: x.why, order: x.order }
    })
    .sort((a, b) => a.order - b.order)
    .map(({ order: _o, ...m }) => m)
  return { tr, made }
}

/** Undo: the AI's words back in place of each fix still as it was made (null when none is). */
export function undoFixesTr(state: EditorState, made: Pick<MadeFix, 'from' | 'to' | 'was' | 'now'>[]): Transaction | null {
  const doc = state.doc
  const still = made.filter((m) => m.to <= doc.content.size && m.from < m.to && doc.textBetween(m.from, m.to, '\n', '\n') === m.now)
  if (!still.length) return null
  const tr = state.tr
  for (const m of [...still].sort((a, b) => b.from - a.from)) tr.insertText(m.was, m.from, m.to)
  return tr
}
