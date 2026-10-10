// Italics and bold from a model's asterisks, for both sides: the editor turns a streamed draft's emphasis into marks
// (features/editor/streamText.ts re-exports these), and the chapter writer builds pages in the main process the same
// way (src/main/chapterWriter/page.ts). Pure.

/** A run of text and how it is marked. */
export interface MarkedPiece {
  text: string
  italic?: boolean
  bold?: boolean
}

/**
 * A complete pair of markers: **bold**, __bold__, *italic* or _italic_. The opening
 * marker is followed by a non-space and the closing one follows a non-space; neither
 * touches a letter or digit on its outer side, so snake_case, "5 * 3" and a lone
 * asterisk are left alone.
 */
const PAIR = /(?<![\p{L}\p{N}*_\\])(\*\*|__|\*|_)(?![\s*_])(.*?[^\s\\])\1(?![\p{L}\p{N}*_])/u

/** Turns Markdown emphasis in one paragraph's text into marked pieces. Unpaired markers stay as they are. */
export function parseEmphasis(text: string, marks: { italic?: boolean; bold?: boolean } = {}): MarkedPiece[] {
  const out: MarkedPiece[] = []
  const push = (t: string, m: { italic?: boolean; bold?: boolean }): void => {
    if (!t) return
    const last = out[out.length - 1]
    if (last && !!last.italic === !!m.italic && !!last.bold === !!m.bold) last.text += t
    else out.push({ text: t, ...(m.italic ? { italic: true } : {}), ...(m.bold ? { bold: true } : {}) })
  }
  let rest = text
  for (;;) {
    const m = PAIR.exec(rest)
    if (!m) break
    push(rest.slice(0, m.index), marks)
    const inner = m[1].length === 2 ? { ...marks, bold: true } : { ...marks, italic: true }
    for (const p of parseEmphasis(m[2], inner)) push(p.text, { italic: p.italic, bold: p.bold })
    rest = rest.slice(m.index + m[0].length)
  }
  push(rest, marks)
  return out
}

/** True when the text holds at least one complete pair of emphasis markers. */
export const hasEmphasis = (text: string): boolean => (text.includes('*') || text.includes('_')) && PAIR.test(text)
