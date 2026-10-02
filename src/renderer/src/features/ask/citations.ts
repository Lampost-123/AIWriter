// Reading an answer from Ask the world. The model names what it used from the memory as [[Mara Venn]];
// each such name that is a page in the world becomes a link to it, and anything else in brackets stays
// plain words, so a link is never made up. Words a model sets in italics (*The Salt Lamp*, a title) show
// in italics. Also takes out what models add despite being asked not to (bold, headings), and hides a
// name's brackets or an italics mark while it is still arriving. Pure, so it is unit-tested.

import type { EntryKind, ID } from '@shared/types'

/** A page an answer can link to. */
export interface LinkTarget {
  id: ID
  kind: EntryKind
  name: string
  aliases: string[]
}

/** A run of an answer's text: plain words, or a cited name with the page it links to. */
export interface AnswerPart {
  text: string
  target: LinkTarget | null
  /** Set in italics. */
  em?: true
}

/** Names compared as the reader sees them: case, spacing and curly quotes don't matter. */
const fold = (s: string): string => s.normalize('NFC').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLocaleLowerCase()

/** Every page by its name and its other names. The first page with a name keeps it. */
export function nameIndex(targets: LinkTarget[]): Map<string, LinkTarget> {
  const byName = new Map<string, LinkTarget>()
  for (const t of targets) {
    for (const n of [t.name, ...t.aliases]) {
      const k = fold(n)
      if (k.length >= 2 && !byName.has(k)) byName.set(k, t)
    }
  }
  return byName
}

/** The page a cited name means: as written, or without "'s" at its end or "the" at its start. */
export function resolveName(name: string, index: Map<string, LinkTarget>): LinkTarget | null {
  const k = fold(name)
  if (!k) return null
  const tries = [k, k.replace(/'s$/, ''), k.replace(/^the /, ''), `the ${k}`]
  for (const t of tries) {
    const hit = index.get(t)
    if (hit) return hit
  }
  return null
}

/**
 * Takes out bold and heading marks (asked for plain text, a model sometimes adds them anyway), and makes a
 * list marked with asterisks a dashed one, as it was asked for.
 */
export function tidyAnswer(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/^#{1,6}[ \t]+/gm, '')
    .replace(/\*\*([^*\n]+?)\*\*/g, '$1')
    .replace(/__([^_\n]+?)__/g, '$1')
    .replace(/^([ \t]*)\*[ \t]+/gm, '$1- ')
}

const CITE = /\[\[([^[\]\n]{1,120}?)\]\]/g

/**
 * Words in italics, *so* or _so_: the marks hug the words, and aren't inside a word (snake_case, 2*3*4 and
 * a lone asterisk stay as they are).
 */
const ITALIC =
  /(?<![\p{L}\p{N}\\*])\*(?=[^\s*])([^*\n]*?[^\s*\\])\*(?![\p{L}\p{N}*])|(?<![\p{L}\p{N}\\_])_(?=[^\s_])([^_\n]*?[^\s_\\])_(?![\p{L}\p{N}_])/gu

/** A mark that could start italics (one still arriving has no end yet). */
const OPENER = /(?<![\p{L}\p{N}\\*_])[*_](?![\s*_])/gu

/** The text with each cited name blotted out (same length), so marks inside a name never count as italics. */
const withoutNames = (text: string): string => text.replace(CITE, (m) => '\u0001'.repeat(m.length))

/**
 * One paragraph's runs. "[[Name]]" (or "[[Name|shown words]]") links to the page called Name; a name
 * the world doesn't have is shown as plain words. *Words* or _words_ are in italics, without the marks.
 * A name still arriving ("[[Mar" at the very end) shows without its brackets, and so does a lone "[" at
 * the end; italics still arriving ("*The Salt La") show without their mark.
 */
export function answerParts(text: string, index: Map<string, LinkTarget>): AnswerPart[] {
  const parts: AnswerPart[] = []
  const push = (t: string, target: LinkTarget | null, em: boolean): void => {
    if (!t) return
    const last = parts[parts.length - 1]
    if (!target && last && !last.target && !!last.em === em) last.text += t
    else parts.push(em ? { text: t, target, em } : { text: t, target })
  }
  /** A stretch's names and words; the last stretch also hides a name still arriving. */
  const names = (stretch: string, em: boolean, last: boolean): void => {
    let at = 0
    for (const m of stretch.matchAll(CITE)) {
      push(stretch.slice(at, m.index), null, em)
      const [name, shown] = m[1].split('|', 2)
      push((shown ?? name).trim() || name.trim(), resolveName(name, index), em)
      at = m.index + m[0].length
    }
    let rest = stretch.slice(at)
    if (last) {
      const open = rest.lastIndexOf('[[')
      if (open >= 0 && !rest.slice(open).includes(']]') && !rest.slice(open).includes('\n'))
        rest = rest.slice(0, open) + rest.slice(open + 2)
      if (rest.endsWith('[')) rest = rest.slice(0, -1)
    }
    push(rest, null, em)
  }
  const blotted = withoutNames(text)
  const spans = [...blotted.matchAll(ITALIC)]
  // Italics still arriving on the last line: the mark that starts them waits for the mark that ends them.
  const tail = spans.length ? spans[spans.length - 1].index + spans[spans.length - 1][0].length : 0
  const from = Math.max(tail, blotted.lastIndexOf('\n') + 1)
  const arriving = [...blotted.slice(from).matchAll(OPENER)].pop()
  if (arriving) {
    const i = from + arriving.index
    text = text.slice(0, i) + text.slice(i + 1)
  }
  let at = 0
  for (const m of spans) {
    names(text.slice(at, m.index), false, false)
    names(text.slice(m.index + 1, m.index + m[0].length - 1), true, false)
    at = m.index + m[0].length
  }
  names(text.slice(at), false, true)
  return parts
}

/** One line of a paragraph: prose, or an item of a list with its mark ("- ", "2. ") set apart. */
export interface AnswerLine {
  /** The list item's mark with the space after it; null for a line of prose. */
  mark: string | null
  /** How deep the item is in a list: 0 for the outermost. */
  depth: number
  parts: AnswerPart[]
}

const MARK = /^([ \t]*)([-–•]|\d{1,3}[.)])[ \t]+/

/** A paragraph's lines, at its single line breaks, each list item's mark set apart so its words can hang beside it. */
export function answerLines(paragraph: AnswerPart[]): AnswerLine[] {
  const lines: AnswerPart[][] = [[]]
  for (const part of paragraph) {
    part.text.split('\n').forEach((t, i) => {
      if (i > 0) lines.push([])
      if (t) lines[lines.length - 1].push({ ...part, text: t })
    })
  }
  return lines.map((parts) => {
    const first = parts[0]
    const m = first && !first.target && !first.em ? MARK.exec(first.text) : null
    if (!m) return { mark: null, depth: 0, parts }
    const rest = first.text.slice(m[0].length)
    return {
      mark: `${m[2]} `,
      depth: Math.floor(m[1].replace(/\t/g, '  ').length / 2),
      parts: rest ? [{ ...first, text: rest }, ...parts.slice(1)] : parts.slice(1)
    }
  })
}

/** An answer as paragraphs of runs (split at blank lines; single line breaks stay within a paragraph). */
export function answerParagraphs(text: string, index: Map<string, LinkTarget>): AnswerPart[][] {
  return tidyAnswer(text)
    .split(/\n[ \t]*\n+/)
    .map((p) => p.replace(/^\n+|\s+$/g, ''))
    .filter((p) => p.trim())
    .map((p) => answerParts(p, index))
}

/** The pages an answer cites, in the order it first names them. */
export function citedTargets(text: string, index: Map<string, LinkTarget>): LinkTarget[] {
  const out: LinkTarget[] = []
  for (const m of text.matchAll(CITE)) {
    const t = resolveName(m[1].split('|', 2)[0], index)
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}

/** An answer as words to keep, as it is shown: names without their brackets, and no marks (bold, italics, headings). */
export function plainAnswer(text: string): string {
  return answerParagraphs(text, new Map())
    .map((p) => p.map((part) => part.text).join(''))
    .join('\n\n')
    .trim()
}
