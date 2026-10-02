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

function findInParagraphs(doc: PMNode, quote: string): { from: number; to: number } | null {
  const want = normalise(quote).norm
  if (!want) return null
  let found: { from: number; to: number } | null = null
  doc.descendants((node, pos) => {
    if (found) return false
    if (!node.isTextblock) return true
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
    const i = norm.indexOf(want)
    if (i >= 0) found = { from: at[map[i]], to: at[map[i + want.length - 1]] + 1 }
    return false
  })
  return found
}

/**
 * Where `quote` is in the scene, as a range of positions, or null when the words aren't there any
 * more. Case, curly quotes and spacing don't matter. Words spanning paragraphs are found by their
 * first paragraph's part.
 */
export function findTextRange(doc: PMNode, quote: string): { from: number; to: number } | null {
  const whole = findInParagraphs(doc, quote)
  if (whole) return whole
  const first = quote
    .split(/\n+/)
    .map((s) => s.trim())
    .find(Boolean)
  return first && first !== quote.trim() ? findInParagraphs(doc, first) : null
}
