// The page as reading aloud sees it: each paragraph's id, its words (a line break is "\n") and the stretches
// in italics, with where it sits in the document, so a place in the words and a place on the page can be
// turned into each other. Plain ProseMirror, so it is tested without a browser.
import type { Node as PMNode } from '@tiptap/pm/model'
import type { ReadParagraph } from '@shared/contracts/readAloud'

export interface PageParagraph extends ReadParagraph {
  /** Where the paragraph node starts in the document: its words start one after. */
  pos: number
  italics: [number, number][]
}

/** Every paragraph with an id, in reading order (paragraphs in a quoted passage too). */
export function pageParagraphs(doc: PMNode): PageParagraph[] {
  const out: PageParagraph[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    const pid = node.attrs.pid as string | null | undefined
    if (!pid) return false
    let text = ''
    const italics: [number, number][] = []
    node.forEach((child) => {
      const at = text.length
      // A line break is "\n"; any other inline leaf keeps its one place, so offsets and positions agree.
      text += child.isText ? (child.text ?? '') : child.type.name === 'hardBreak' ? '\n' : '￼'
      if (child.isText && child.marks.some((m) => m.type.name === 'italic')) {
        const last = italics[italics.length - 1]
        if (last && last[1] === at) last[1] = text.length
        else italics.push([at, text.length])
      }
    })
    out.push({ pid, pos, text, italics })
    return false
  })
  return out
}

/** The document position of a place in a paragraph's words. */
export const posIn = (p: Pick<PageParagraph, 'pos'>, offset: number): number => p.pos + 1 + offset

/**
 * The paragraph a document position is in, and how far into its words; a position between paragraphs is the
 * start of the next one. Null past the last paragraph.
 */
export function placeOf(paragraphs: readonly PageParagraph[], pos: number): { index: number; offset: number } | null {
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i]
    const end = posIn(p, p.text.length)
    if (pos <= end) return { index: i, offset: Math.max(0, Math.min(p.text.length, pos - p.pos - 1)) }
  }
  return null
}

/** True when a paragraph has words to read. */
export const hasWords = (p: Pick<ReadParagraph, 'text'>): boolean => /[\p{L}\p{N}]/u.test(p.text)

const WORD = /[\p{L}\p{N}'’]/u

/** A place in a paragraph's words moved back to the start of the word it is in, so reading never starts mid-word. */
export function wordStart(text: string, offset: number): number {
  let k = Math.max(0, Math.min(offset, text.length))
  if (!WORD.test(text[k] ?? '')) return k
  while (k > 0 && WORD.test(text[k - 1])) k--
  return k
}

/** What is sent to plan a reading: the paragraphs only, without where they sit. */
export const forPlan = (p: PageParagraph): ReadParagraph => ({
  pid: p.pid,
  text: p.text,
  ...(p.italics.length ? { italics: p.italics } : {})
})
