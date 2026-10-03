// Finding and replacing words in a scene ("Writing by hand": Ctrl+F in the open scene, Ctrl+Shift+F across
// the story). Pure (no editor, no database), so the window and the main process match words the same way
// and both are unit-tested.
//
// - A scene is read paragraph by paragraph. Words are matched inside one paragraph, across bold and italic
//   (the formatting doesn't matter), never across paragraphs or a line break.
// - Case doesn't matter unless Match case is on. Curly and straight quotes and apostrophes are the same
//   letter ("don't" finds "don’t"), and so are a space and a no-break space.
// - Whole word skips matches inside a longer word ("rain" in "brain"); an apostrophe or hyphen ends a word,
//   so "Mara" is found in "Mara’s".
// - Positions are ProseMirror document positions: `blocksOfDoc` works them out from a stored document
//   (TipTap JSON) exactly as the editor does from the same document, so a match found in the main process
//   is the same range in the page.
// - A replacement takes the formatting of the match's first letter, and the quote style of the match
//   (straight quotes typed in the replacement become curly when the words it replaces have curly ones).

/** How words are matched. */
export interface MatchOptions {
  matchCase?: boolean
  wholeWord?: boolean
}

/** One paragraph's text, and the document position of its first character. */
export interface TextBlock {
  pos: number
  text: string
}

/** A match: document positions, and the paragraph it is in (its index in the blocks). */
export interface FoundMatch {
  from: number
  to: number
  block: number
}

/** A change made by a replacement: where it was (from, to) and where the new words are (newFrom, newTo). */
export interface ChangedRange {
  from: number
  to: number
  newFrom: number
  newTo: number
}

/** In a paragraph's text, a line break reads as this (a query never holds one, so nothing matches across it). */
export const BREAK_CHAR = '\n'
/** Anything else in a paragraph that isn't text (a picture, say) reads as this. */
export const OBJECT_CHAR = '￼'

// ---------- Matching text ----------

const FOLD: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '‛': "'",
  '′': "'",
  'ʼ': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '‟': '"',
  '″': '"',
  ' ': ' ',
  ' ': ' ',
  ' ': ' '
}

/** The text as it is compared, one character for each (so indexes stay the same). */
function fold(text: string, matchCase: boolean): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    let c = FOLD[text[i]] ?? text[i]
    if (!matchCase) {
      const lower = c.toLowerCase()
      if (lower.length === 1) c = lower
    }
    out += c
  }
  return out
}

const WORD = /[\p{L}\p{N}\p{M}_]/u
const isWordChar = (c: string | undefined): boolean => !!c && WORD.test(c)

/** True when a query has something to find (not only spaces). */
export const hasQuery = (query: string): boolean => !!query && /\S/.test(query)

/** Where `query` stands in `text`, left to right, never overlapping: [start, end) indexes. */
export function findInText(text: string, query: string, opts: MatchOptions = {}): { start: number; end: number }[] {
  if (!hasQuery(query) || !text) return []
  const matchCase = !!opts.matchCase
  const hay = fold(text, matchCase)
  const needle = fold(query, matchCase)
  // Whole word only checks the edges that are letters: "-ish" can follow a word.
  const checkStart = !!opts.wholeWord && isWordChar(query[0])
  const checkEnd = !!opts.wholeWord && isWordChar(query[query.length - 1])
  const found: { start: number; end: number }[] = []
  let i = hay.indexOf(needle)
  while (i >= 0) {
    const end = i + needle.length
    const ok = (!checkStart || !isWordChar(text[i - 1])) && (!checkEnd || !isWordChar(text[end]))
    if (ok) {
      found.push({ start: i, end })
      i = hay.indexOf(needle, end)
    } else i = hay.indexOf(needle, i + 1)
  }
  return found
}

/** Every match in a document's paragraphs, in reading order. */
export function findInBlocks(blocks: TextBlock[], query: string, opts: MatchOptions = {}): FoundMatch[] {
  const out: FoundMatch[] = []
  blocks.forEach((b, block) => {
    for (const m of findInText(b.text, query, opts)) out.push({ from: b.pos + m.start, to: b.pos + m.end, block })
  })
  return out
}

// ---------- Stored documents (TipTap JSON) ----------

/** A node of a stored document, as TipTap saves it. */
export interface DocNode {
  type?: string
  text?: string
  content?: DocNode[]
  marks?: unknown[]
  attrs?: Record<string, unknown>
  [key: string]: unknown
}

/** Nodes that hold text directly (the scene editor has paragraphs; headings and code are here in case they are ever turned on). */
const TEXTBLOCKS = new Set(['paragraph', 'heading', 'codeBlock'])
/** Block nodes with nothing inside (a scene break, a picture). */
const LEAF_BLOCKS = new Set(['horizontalRule', 'image'])

const isNode = (n: unknown): n is DocNode => !!n && typeof n === 'object' && !Array.isArray(n)
const childrenOf = (n: DocNode): DocNode[] => (Array.isArray(n.content) ? n.content.filter(isNode) : [])

function isTextblock(n: DocNode): boolean {
  if (n.type === 'text') return false
  return TEXTBLOCKS.has(n.type ?? '') || childrenOf(n).some((c) => c.type === 'text')
}

/** A node's size in document positions, as ProseMirror counts it. */
function sizeOf(n: DocNode, inline: boolean): number {
  if (n.type === 'text') return typeof n.text === 'string' ? n.text.length : 0
  if (Array.isArray(n.content)) return 2 + childrenOf(n).reduce((s, c) => s + sizeOf(c, inline || isTextblock(n)), 0)
  // A node with no content: inline ones (a line break) and leaf blocks are one position; an empty paragraph is two.
  return inline || LEAF_BLOCKS.has(n.type ?? '') ? 1 : 2
}

/** A paragraph's inline content as text: a line break is BREAK_CHAR, anything else that isn't text OBJECT_CHAR per position. */
function inlineText(block: DocNode): string {
  let t = ''
  for (const c of childrenOf(block)) {
    if (c.type === 'text') t += typeof c.text === 'string' ? c.text : ''
    else if (c.type === 'hardBreak') t += BREAK_CHAR
    else t += OBJECT_CHAR.repeat(sizeOf(c, true))
  }
  return t
}

/** Every paragraph of a stored document, in reading order, with the position of its first character. */
export function blocksOfDoc(doc: unknown): TextBlock[] {
  const out: TextBlock[] = []
  if (!isNode(doc)) return out
  const walk = (nodes: DocNode[], start: number): void => {
    let pos = start
    for (const n of nodes) {
      if (isTextblock(n)) out.push({ pos: pos + 1, text: inlineText(n) })
      else if (Array.isArray(n.content)) walk(childrenOf(n), pos + 1)
      pos += sizeOf(n, false)
    }
  }
  walk(childrenOf(doc), 0)
  return out
}

/** A scene's plain text from its stored document, as the editor saves it: paragraphs apart by a blank line, scene breaks "* * *". */
export function docText(doc: unknown): string {
  const blocks: string[] = []
  const visit = (n: DocNode): void => {
    if (n.type === 'horizontalRule') {
      blocks.push('* * *')
      return
    }
    if (isTextblock(n)) {
      let t = ''
      for (const c of childrenOf(n)) {
        if (c.type === 'text') t += typeof c.text === 'string' ? c.text : ''
        else if (c.type === 'hardBreak') t += '\n'
      }
      if (t.trim()) blocks.push(t)
      return
    }
    childrenOf(n).forEach(visit)
  }
  if (isNode(doc)) childrenOf(doc).forEach(visit)
  return blocks.join('\n\n')
}

const marksKey = (marks: unknown): string => JSON.stringify(Array.isArray(marks) ? marks : [])

/** A text node, its keys in the editor's own order. */
function textNode(text: string, marks: unknown): DocNode {
  return Array.isArray(marks) && marks.length ? { type: 'text', marks, text } : { type: 'text', text }
}

/** Joins neighbouring text with the same formatting and drops empty text, as the editor does. */
function tidyInline(nodes: DocNode[]): DocNode[] {
  const out: DocNode[] = []
  for (const n of nodes) {
    if (n.type === 'text') {
      if (!n.text) continue
      const prev = out[out.length - 1]
      if (prev?.type === 'text' && marksKey(prev.marks) === marksKey(n.marks)) {
        out[out.length - 1] = { ...prev, text: (prev.text ?? '') + n.text }
        continue
      }
    }
    out.push(n)
  }
  return out
}

/** One paragraph's inline content with these edits made (offsets inside the paragraph, ascending, not overlapping). */
function spliceInline(content: DocNode[], edits: { a: number; b: number; text: string }[]): DocNode[] {
  const out: DocNode[] = []
  let off = 0
  let ei = 0
  for (const node of content) {
    if (node.type !== 'text') {
      out.push(node)
      off += sizeOf(node, true)
      continue
    }
    const t = node.text ?? ''
    let i = 0
    while (i < t.length) {
      while (ei < edits.length && edits[ei].b <= off + i) ei++
      const e = edits[ei]
      const abs = off + i
      if (e && abs >= e.a) {
        // Inside a match: its new words go in once, at its first letter, with that letter's formatting.
        if (abs === e.a && e.text) out.push(textNode(e.text, node.marks))
        i = Math.min(e.b - off, t.length)
        continue
      }
      const next = e ? Math.min(t.length, e.a - off) : t.length
      out.push(textNode(t.slice(i, next), node.marks))
      i = next
    }
    off += t.length
  }
  return tidyInline(out)
}

/**
 * A stored document with words replaced: each edit puts `text` in place of [from, to) (document
 * positions inside one paragraph, not overlapping). Paragraphs keep their ids and everything else; the
 * new words take the formatting of the first letter they replace. Returns the new document and where
 * each change is in it.
 */
export function replaceInDoc(doc: unknown, edits: { from: number; to: number; text: string }[]): { doc: DocNode; ranges: ChangedRange[] } {
  const sorted = [...edits].sort((a, b) => a.from - b.from)
  const ranges: ChangedRange[] = []
  let delta = 0
  for (const e of sorted) {
    ranges.push({ from: e.from, to: e.to, newFrom: e.from + delta, newTo: e.from + delta + e.text.length })
    delta += e.text.length - (e.to - e.from)
  }
  if (!isNode(doc)) return { doc: { type: 'doc', content: [] }, ranges: [] }
  const rebuild = (nodes: DocNode[], start: number): DocNode[] => {
    let pos = start
    return nodes.map((n) => {
      const size = sizeOf(n, false)
      const at = pos
      pos += size
      if (!sorted.some((e) => e.from >= at && e.to <= at + size)) return n
      if (isTextblock(n)) {
        const inner = sorted.filter((e) => e.from >= at + 1 && e.to <= at + size - 1).map((e) => ({ a: e.from - at - 1, b: e.to - at - 1, text: e.text }))
        const content = spliceInline(childrenOf(n), inner)
        const copy: DocNode = { ...n }
        if (content.length) copy.content = content
        else delete copy.content
        return copy
      }
      if (Array.isArray(n.content)) return { ...n, content: rebuild(childrenOf(n), at + 1) }
      return n
    })
  }
  return { doc: { ...doc, content: rebuild(childrenOf(doc), 0) }, ranges }
}

/** The same value with every object's keys in order, so two that hold the same compare the same as text. */
function sortedKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortedKeys)
  if (!v || typeof v !== 'object') return v
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = sortedKeys((v as Record<string, unknown>)[k])
  return out
}

/**
 * The same document with neighbouring text of the same formatting joined, empty text dropped and keys in order,
 * so two documents that show the same can be compared (with comparableDoc, which leaves paragraph ids out).
 */
export function tidyDoc(doc: unknown): unknown {
  if (!isNode(doc)) return doc
  const visit = (n: DocNode): DocNode => {
    if (!Array.isArray(n.content)) return n
    const kids = childrenOf(n).map(visit)
    return { ...n, content: isTextblock(n) ? tidyInline(kids) : kids }
  }
  return sortedKeys(visit(doc))
}

// ---------- The words that go in ----------

const CURLY = /[‘’“”]/
const OPENS_QUOTE = /[\s([{—–-]/

/**
 * The replacement as it goes in: when the words it replaces use curly quotes, straight quotes typed in it
 * become curly too (an apostrophe after a letter is ’, a quote at the start of a word opens). `before` is
 * the character just ahead of the match.
 */
export function curlLike(replacement: string, matched: string, before = ''): string {
  if (!CURLY.test(matched) || !/['"]/.test(replacement)) return replacement
  let out = ''
  for (let i = 0; i < replacement.length; i++) {
    const c = replacement[i]
    const prev = i > 0 ? replacement[i - 1] : before
    const opens = !prev || OPENS_QUOTE.test(prev)
    if (c === "'") out += opens ? '‘' : '’'
    else if (c === '"') out += opens ? '“' : '”'
    else out += c
  }
  return out
}

/** A little text around a match, for a list: cut at whole words, with "…" where it was cut. */
export function snippetAround(text: string, start: number, end: number, room = 48): { before: string; match: string; after: string } {
  const clean = (s: string): string => s.replace(/[\n￼]/g, ' ')
  let a = Math.max(0, start - room)
  let before = text.slice(a, start)
  if (a > 0) {
    const cut = before.search(/\s/)
    if (cut >= 0 && cut < before.length - 1) {
      before = before.slice(cut + 1)
      a += cut + 1
    }
    before = '…' + before
  }
  let after = text.slice(end, end + room)
  if (end + room < text.length) {
    const cut = after.search(/\s\S*$/)
    if (cut > 0) after = after.slice(0, cut)
    after = after + '…'
  }
  return { before: clean(before), match: clean(text.slice(start, end)), after: clean(after) }
}

/** True when a replacement over [from, to) would change words of a range held back (an AI suggestion waiting): a point counts when it falls inside. */
export function touches(m: { from: number; to: number }, kept: { from: number; to: number }): boolean {
  return kept.from === kept.to ? m.from < kept.from && m.to > kept.from : m.from < kept.to && m.to > kept.from
}
