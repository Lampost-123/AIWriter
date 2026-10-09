// Finds quoted words in a scene, so "What changed" can open the scene at the words a fact came
// from. Pure (no editor, no window), so it is unit-tested.

import type { Node as PMNode } from '@tiptap/pm/model'

const QUOTES: Record<string, string> = { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-' }

/** Lower case, straight quotes, one space for any run of white space; `map[i]` is the original index of each character. */
function normalise(text: string): { norm: string; map: number[] } {
  let norm = ''
  const map: number[] = []
  let space = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (/\s/.test(ch)) {
      if (!space && norm) {
        norm += ' '
        map.push(i)
      }
      space = true
      continue
    }
    space = false
    norm += (QUOTES[ch] ?? ch).toLowerCase()
    map.push(i)
  }
  if (norm.endsWith(' ')) {
    norm = norm.slice(0, -1)
    map.pop()
  }
  return { norm, map }
}

/**
 * Options for finding words: `wholeWord` skips matches inside a longer word ("rain" in "brain"); `paragraphId` looks in
 * that paragraph first (the one a fact's words were read from: Jump to source, World Memory Overhaul B2), then anywhere.
 */
export interface FindOptions {
  wholeWord?: boolean
  paragraphId?: string | null
}

// A possessive's apostrophe ends the word ("king" is found in "king's"); a hyphen doesn't.
const WORDY = /[\p{L}\p{N}-]/u

/** Where `want` first stands in `norm` (as a whole word, when asked), or -1. */
function indexIn(norm: string, want: string, wholeWord: boolean): number {
  for (let i = norm.indexOf(want); i >= 0; i = norm.indexOf(want, i + 1)) {
    if (!wholeWord) return i
    const before = i > 0 ? norm[i - 1] : ''
    const after = norm[i + want.length] ?? ''
    if ((!before || !WORDY.test(before)) && (!after || !WORDY.test(after))) return i
  }
  return -1
}

function findInParagraphs(doc: PMNode, quote: string, opts: FindOptions = {}, onlyPid?: string): { from: number; to: number } | null {
  const want = normalise(quote).norm
  if (!want) return null
  let found: { from: number; to: number } | null = null
  doc.descendants((node, pos) => {
    if (found) return false
    if (!node.isTextblock) return true
    if (onlyPid && node.attrs.pid !== onlyPid) return false
    // The paragraph's text, with the document position of each character.
    let text = ''
    const at: number[] = []
    node.forEach((child, offset) => {
      const start = pos + 1 + offset
      if (child.isText) {
        const t = child.text ?? ''
        for (let i = 0; i < t.length; i++) at.push(start + i)
        text += t
      } else {
        // A line break inside the paragraph reads as a space.
        at.push(start)
        text += ' '
      }
    })
    const { norm, map } = normalise(text)
    const i = indexIn(norm, want, !!opts.wholeWord)
    if (i >= 0) found = { from: at[map[i]], to: at[map[i + want.length - 1]] + 1 }
    return false
  })
  return found
}

/**
 * Where `quote` first is at or after the position `after`, within one paragraph (case, curly quotes and spacing don't
 * matter), or null: the end of a passage the editor chat proposes rewriting, found after its start.
 */
export function findTextRangeAfter(doc: PMNode, quote: string, after: number): { from: number; to: number } | null {
  const want = normalise(quote).norm
  if (!want) return null
  let found: { from: number; to: number } | null = null
  doc.descendants((node, pos) => {
    if (found) return false
    if (!node.isTextblock) return true
    if (pos + node.nodeSize <= after) return false
    let text = ''
    const at: number[] = []
    node.forEach((child, offset) => {
      const start = pos + 1 + offset
      if (child.isText) {
        const t = child.text ?? ''
        for (let i = 0; i < t.length; i++) at.push(start + i)
        text += t
      } else {
        at.push(start)
        text += ' '
      }
    })
    const { norm, map } = normalise(text)
    for (let i = norm.indexOf(want); i >= 0; i = norm.indexOf(want, i + 1)) {
      if (at[map[i]] >= after) {
        found = { from: at[map[i]], to: at[map[i + want.length - 1]] + 1 }
        break
      }
    }
    return false
  })
  return found
}

/**
 * Where `quote` is in the scene, as a range of positions, or null when the words aren't there any
 * more. Case, curly quotes and spacing don't matter. Words spanning paragraphs are found by their
 * first paragraph's part.
 */
export function findTextRange(doc: PMNode, quote: string, opts: FindOptions = {}): { from: number; to: number } | null {
  const first = quote
    .split(/\n+/)
    .map((s) => s.trim())
    .find(Boolean)
  const tryIn = (pid?: string): { from: number; to: number } | null =>
    findInParagraphs(doc, quote, opts, pid) ?? (first && first !== quote.trim() ? findInParagraphs(doc, first, opts, pid) : null)
  return (opts.paragraphId ? tryIn(opts.paragraphId) : null) ?? tryIn()
}

/** The text of the paragraph with this id, as a range of positions; null when there is no such paragraph (or it is empty). */
export function findParagraphRange(doc: PMNode, paragraphId: string): { from: number; to: number } | null {
  if (!paragraphId) return null
  let found: { from: number; to: number } | null = null
  doc.descendants((node, pos) => {
    if (found) return false
    if (!node.isTextblock) return true
    if (node.attrs.pid === paragraphId && node.content.size > 0) found = { from: pos + 1, to: pos + 1 + node.content.size }
    return false
  })
  return found
}
