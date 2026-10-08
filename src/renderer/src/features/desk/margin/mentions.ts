// Where things are in the page for the desk's margin notes (UI overhaul, phase 3): where each entry is first named,
// where an issue's words are, and where a memory fact's words are. Each answer is the paragraph's anchor (its stable
// id and the offset of the word) and the paragraph's place in reading order, as pickSlips.ts takes them.
// Names are found paragraph by paragraph, and each paragraph's names are kept with the paragraph itself: ProseMirror
// keeps an unchanged paragraph as the same node, so after a keystroke only the paragraph typed in is scanned again,
// even in a 10,000-word scene.
import type { Node as PMNode } from '@tiptap/pm/model'
import type { ID } from '@shared/types'
import { findNames, type NameIndex, type NameMatch } from '@/features/editor/names/nameMatch'
import { findTextRange } from '@/features/editor/findText'
import { occurrencesIn, pickOccurrence } from '@/features/issues/issuesLogic'
import type { Placed } from './pickSlips'

/** Each paragraph's names, kept per name index (a new list of names starts afresh). */
const scanned = new WeakMap<NameIndex, WeakMap<PMNode, NameMatch[]>>()

/** One character per position: a line break inside a paragraph reads as a space. */
const textOf = (node: PMNode): string => node.textBetween(0, node.content.size, undefined, ' ')

function namesIn(node: PMNode, index: NameIndex): NameMatch[] {
  let cache = scanned.get(index)
  if (!cache) {
    cache = new WeakMap()
    scanned.set(index, cache)
  }
  let found = cache.get(node)
  if (!found) {
    found = findNames(textOf(node), index)
    cache.set(node, found)
  }
  return found
}

/** Calls `fn` for each paragraph (text block) with an id, with its position and its place in reading order. */
function eachBlock(doc: PMNode, fn: (node: PMNode, pos: number, block: number) => boolean | void): void {
  let block = 0
  let stop = false
  doc.descendants((node, pos) => {
    if (stop) return false
    if (!node.isTextblock) return true
    if (typeof node.attrs.pid === 'string' && node.attrs.pid) {
      if (fn(node, pos, block) === false) stop = true
    }
    block++
    return false
  })
}

/** Where each entry is first named in the page. */
export function firstMentions(doc: PMNode, index: NameIndex): Map<ID, Placed> {
  const out = new Map<ID, Placed>()
  if (!index.size) return out
  eachBlock(doc, (node, _pos, block) => {
    for (const m of namesIn(node, index)) {
      if (!out.has(m.entryId)) out.set(m.entryId, { anchor: { pid: node.attrs.pid as string, offset: m.start }, block })
    }
  })
  return out
}

/** The paragraph a position is in, as a place for a note. */
export function placeAt(doc: PMNode, pos: number): Placed | null {
  let found: Placed | null = null
  eachBlock(doc, (node, start, block) => {
    if (pos >= start && pos <= start + node.nodeSize) {
      found = { anchor: { pid: node.attrs.pid as string, offset: Math.max(0, Math.min(pos - start - 1, node.content.size)) }, block }
      return false
    }
  })
  return found
}

/**
 * Where an issue's words are: the appearance the check named (its `occurrence`), else the only one, else the first;
 * null when they aren't in the page any more.
 */
export function placeOfQuote(doc: PMNode, quote: string, occurrence?: number): Placed | null {
  if (!quote.trim()) return null
  const places: Placed[] = []
  eachBlock(doc, (node, pos, block) => {
    for (const r of occurrencesIn(textOf(node), quote)) places.push({ anchor: { pid: node.attrs.pid as string, offset: r.from }, block })
    void pos
  })
  const one = pickOccurrence(places, occurrence) ?? places[0]
  if (one) return one
  // Running across two paragraphs: where its first part is.
  const range = findTextRange(doc, quote)
  return range ? placeAt(doc, range.from) : null
}
