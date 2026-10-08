// What a margin note is about, and how to find it on the page (the desk, UI overhaul phase 3). A note is anchored to a
// paragraph by its stable id (`pid`, features/editor/paragraphIds.ts) and the first character of the word it is about,
// or to the top of the page (the scene card, beside the title). Finding where that is in the document, telling whether a
// change to the page moved paragraphs about (so the notes need measuring again), and drawing a tether are pure, so they
// are unit-tested; MarginLayer does the measuring.
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'

/** A word in a paragraph: the paragraph's id, and how far into its text the word starts. */
export interface Anchor {
  pid: string
  offset: number
}

/** The kinds of note: their ink (the kind's colour) and their place in the order. */
export type SlipKind = 'card' | 'character' | 'place' | 'item' | 'group' | 'lore' | 'event' | 'issue' | 'memory'

/** A note to show in the margin. */
export interface PlacedSlip {
  id: string
  kind: SlipKind
  anchor: Anchor | 'top'
  /** Stays where it wants to be (the scene card). */
  pinned?: boolean
}

/** The paragraph (or other text block) with this id, and where it starts. */
export function blockOf(doc: PMNode, pid: string): { node: PMNode; pos: number } | null {
  let found: { node: PMNode; pos: number } | null = null
  doc.descendants((node, pos) => {
    if (found) return false
    if (node.isTextblock) {
      if (node.attrs.pid === pid) found = { node, pos }
      return false
    }
    return true
  })
  return found
}

/** Where an anchored word is in the document (inside its paragraph, kept within it), or null once the paragraph has gone. */
export function posOfAnchor(doc: PMNode, a: Anchor): number | null {
  const b = blockOf(doc, a.pid)
  if (!b) return null
  return b.pos + 1 + Math.max(0, Math.min(a.offset, b.node.content.size))
}

/** The anchor for a position in the document: its paragraph's id and the offset in it. Null outside a paragraph with an id. */
export function anchorAt(doc: PMNode, pos: number): Anchor | null {
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)))
  const block = $pos.parent
  if (!block.isTextblock || typeof block.attrs.pid !== 'string' || !block.attrs.pid) return null
  return { pid: block.attrs.pid, offset: $pos.parentOffset }
}

/**
 * True when a change to the page may have moved paragraphs about: one added or taken away, or a change spanning more
 * than one paragraph. Typing inside a paragraph is not (a paragraph that grows a line is caught by the page's size).
 */
export function changesBlocks(tr: Transaction): boolean {
  if (!tr.docChanged) return false
  if (tr.before.childCount !== tr.doc.childCount) return true
  return tr.steps.some((step, i) => {
    const map = step.getMap()
    let wide = false
    map.forEach((from, to) => {
      if (wide) return
      const doc = tr.docs[i]
      if (to > from && doc.resolve(from).sharedDepth(Math.min(to, doc.content.size)) < 1) wide = true
    })
    return wide
  })
}

/**
 * A tether: a hairline from the word (x1, y1) to the note's edge (x2, y2), level at both ends and curving between them,
 * as an SVG path.
 */
export function tetherPath(x1: number, y1: number, x2: number, y2: number): string {
  const r = (n: number): number => Math.round(n * 10) / 10
  const mid = r((x1 + x2) / 2)
  return `M${r(x1)} ${r(y1)}C${mid} ${r(y1)} ${mid} ${r(y2)} ${r(x2)} ${r(y2)}`
}
