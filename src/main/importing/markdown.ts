// Reading a Markdown file (.md): # and ## headings (and the underlined kind), bold and italic (**, __, *, _),
// scene breaks (***, ---, * * *, a # on its own), and paragraphs. Links keep their words; pictures, code
// marks, HTML comments and front matter are left out (front matter's title: is the book's title). A file
// written one paragraph to a line, with few blank lines, is read a line to a paragraph. Pure.

import type { Manuscript, ManuscriptBlock, ManuscriptRun } from '@shared/contracts/importing'
import { baseName, blockOfLine, finishBlocks, headingHint, isBreakMark, plainLine, tidy } from './lines'
import { linesPerParagraph, splitLines, standsAlone } from './text'

// ---------- Bold and italic ----------

/** Stand-ins for escaped marks (\* and \_), put back once the emphasis is read. */
const ESC_STAR = ''
const ESC_UNDER = ''

interface Look {
  bold: boolean
  italic: boolean
}

/** Emphasis, strongest first: ***both***, **bold**, __bold__, *italic*, _italic_ (underscores only at word edges). */
const EMPHASIS: { re: RegExp; bold?: boolean; italic?: boolean }[] = [
  { re: /\*\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*\*/, bold: true, italic: true },
  { re: /(?<![\p{L}\d])___(?=\S)([\s\S]+?)(?<=\S)___(?![\p{L}\d])/u, bold: true, italic: true },
  { re: /\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*/, bold: true },
  { re: /(?<![\p{L}\d])__(?=\S)([\s\S]+?)(?<=\S)__(?![\p{L}\d])/u, bold: true },
  { re: /\*(?=[^\s*])([\s\S]+?)(?<=[^\s*])\*/, italic: true },
  { re: /(?<![\p{L}\d])_(?=[^\s_])([\s\S]+?)(?<=[^\s_])_(?![\p{L}\d])/u, italic: true }
]

/** The text as runs, reading its emphasis, nested as far as it goes ("**bold *and italic* bold**"). */
function emphasis(text: string, look: Look, out: ManuscriptRun[]): void {
  let rest = text
  while (rest) {
    let best: { index: number; length: number; inner: string; bold?: boolean; italic?: boolean } | null = null
    for (const e of EMPHASIS) {
      const m = e.re.exec(rest)
      if (m && (!best || m.index < best.index)) best = { index: m.index, length: m[0].length, inner: m[1], bold: e.bold, italic: e.italic }
    }
    if (!best) {
      push(out, rest, look)
      return
    }
    push(out, rest.slice(0, best.index), look)
    emphasis(best.inner, { bold: look.bold || !!best.bold, italic: look.italic || !!best.italic }, out)
    rest = rest.slice(best.index + best.length)
  }
}

function push(out: ManuscriptRun[], raw: string, look: Look): void {
  const text = raw.replaceAll(ESC_STAR, '*').replaceAll(ESC_UNDER, '_')
  if (!text) return
  const last = out[out.length - 1]
  if (last && !!last.bold === look.bold && !!last.italic === look.italic) last.text += text
  else out.push({ text, ...(look.bold ? { bold: true } : {}), ...(look.italic ? { italic: true } : {}) })
}

/** Inline Markdown as plain words with their bold and italic: links keep their words, pictures and code marks go. */
export function inlineRuns(source: string): ManuscriptRun[] {
  let s = tidy(source)
    .replace(/\\\*/g, ESC_STAR)
    .replace(/\\_/g, ESC_UNDER)
    .replace(/\\([\\`#[\]()!>+\-.{}|~])/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/<(https?:[^>\s]+)>/g, '$1')
    .replace(/`+([^`]*)`+/g, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(em|i)>/gi, '*')
    .replace(/<\/?(strong|b)>/gi, '**')
    .replace(/<\/?[a-z][^>]*>/gi, '')
  // A line ending in two spaces or a backslash is a line break; any other line end is a space.
  s = s.replace(/( {2,}|\\)\n/g, '\n\u0000').replace(/\n(?!\u0000)/g, ' ').replace(/\u0000/g, '')
  const out: ManuscriptRun[] = []
  emphasis(s, { bold: false, italic: false }, out)
  // Spaces at either end go (inside the paragraph they stay as written).
  if (out.length) {
    out[0].text = out[0].text.replace(/^[ \n]+/, '')
    out[out.length - 1].text = out[out.length - 1].text.replace(/[ \n]+$/, '')
  }
  return out.filter((r) => r.text)
}

// ---------- Blocks ----------

const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*#*[ \t]*$/
const THEMATIC = /^ {0,3}([*\-_])(?:[ \t]*\1){2,}[ \t]*$/
const LIST = /^ {0,3}(?:[-*+]|\d{1,3}[.)])[ \t]+/
const FENCE = /^ {0,3}(```|~~~)/

/** The level a line under a heading gives it ("=====" 1, "-----" 2), or 0 when it isn't one (a long line over "---" is text and a break). */
function underline(next: string | undefined, line: string): 0 | 1 | 2 {
  if (next == null || !line.trim()) return 0
  if (/^ {0,3}=+[ \t]*$/.test(next)) return 1
  if (/^ {0,3}-+[ \t]*$/.test(next) && line.trim().length <= 80 && !/[.!?…"”]$/.test(line.trim())) return 2
  return 0
}

/** The front matter's title (between --- lines at the very top), and the text after it. */
function frontMatter(text: string): { title: string; body: string } {
  const m = /^---[ \t]*\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(text)
  if (!m || !/^[\w-]+:/m.test(m[1])) return { title: '', body: text }
  const t = /^title:[ \t]*(.*)$/im.exec(m[1])
  return { title: t ? t[1].trim().replace(/^(["'])(.*)\1$/, '$2') : '', body: text.slice(m[0].length) }
}

/** Reads a Markdown file's text into blocks. */
export function readMarkdown(source: string, fileName: string): Manuscript {
  const fm = frontMatter(source.replace(/\r\n?/g, '\n').replace(/^﻿/, ''))
  const body = fm.body.replace(/<!--[\s\S]*?-->/g, '')
  const lines = splitLines(body)
  const perLine = linesPerParagraph(lines)
  const blocks: ManuscriptBlock[] = []
  let para: string[] = []
  let fenced = false

  const flush = (): void => {
    if (!para.length) return
    const text = para.join('\n')
    para = []
    const runs = inlineRuns(text)
    const plain = runs.map((r) => r.text).join('')
    if (!plainLine(plain)) return
    blocks.push(blockOfLine(plain, () => ({ kind: 'para', text: plain, runs })))
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    if (FENCE.test(raw)) {
      flush()
      fenced = !fenced
      continue
    }
    if (fenced) {
      para.push(raw)
      flush()
      continue
    }
    const line = raw.replace(/^ {0,3}>[ \t]?/, '')
    if (!line.trim()) {
      flush()
      continue
    }
    const atx = ATX.exec(line)
    if (atx) {
      flush()
      const text = plainLine(inlineRuns(atx[2] ?? '').map((r) => r.text).join(''))
      // A # with nothing after it is a scene break mark.
      if (!text || isBreakMark(text)) blocks.push({ kind: 'break', text: atx[1] })
      else blocks.push({ kind: 'heading', text, level: atx[1].length, hint: headingHint(text) })
      continue
    }
    // An underlined heading: one line of text over "=====" (level 1) or "-----" (level 2).
    const under = underline(lines[i + 1], line)
    if (!para.length && under) {
      const text = plainLine(inlineRuns(line).map((r) => r.text).join(''))
      if (text) blocks.push({ kind: 'heading', text, level: under, hint: headingHint(text) })
      i++
      continue
    }
    if (THEMATIC.test(line)) {
      flush()
      blocks.push({ kind: 'break', text: plainLine(line) })
      continue
    }
    // A heading by its words ("Chapter 3") or a break mark stands alone, even with no blank line around it.
    if (standsAlone(line)) {
      flush()
      para.push(line)
      flush()
      continue
    }
    if (LIST.test(line)) {
      flush()
      para.push(line.replace(LIST, ''))
      continue
    }
    para.push(line.replace(/^[ \t]+/, ''))
    if (perLine) flush()
  }
  flush()
  const firstTop = blocks.find((b) => b.kind === 'heading' && b.level === 1)
  // A single # heading at the very top, over the rest, is the book's title.
  const topCount = blocks.filter((b) => b.kind === 'heading' && b.level === 1).length
  let title = fm.title
  if (!title && firstTop && !firstTop.hint && topCount === 1 && blocks[0] === firstTop && blocks.some((b) => b.kind === 'heading' && b.level === 2)) {
    title = firstTop.text
    blocks[0] = { kind: 'title', text: firstTop.text }
  }
  return finishBlocks(fileName, 'markdown', title || baseName(fileName), blocks)
}
