// Text helpers for the memory keeper: a scene's paragraphs (with the editor's stable paragraph
// ids), what changed between two readings, finding the exact words a fact rests on, sentences,
// word likeness and token estimates. Pure, no Electron imports.

import { createHash } from 'node:crypto'

// ---------- Normalising ----------

const CHAR_MAP: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '‛': "'",
  '′': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '‟': '"',
  '″': '"',
  '«': '"',
  '»': '"',
  '‐': '-',
  '‑': '-',
  '‒': '-',
  '–': '-',
  '—': '-',
  '―': '-',
  '−': '-',
  '…': '...',
  ' ': ' '
}

/**
 * The text with curly quotes, dashes and ellipses made plain, runs of white space made one space
 * and letters in lower case, plus where each character came from in the original, so a match in
 * the plain text can be cut out of the original exactly.
 */
export function plainWithMap(s: string): { plain: string; from: number[]; to: number[] } {
  let plain = ''
  const from: number[] = []
  const to: number[] = []
  let space = false
  for (let i = 0; i < s.length; ) {
    const ch = String.fromCodePoint(s.codePointAt(i)!)
    const end = i + ch.length
    if (/\s/u.test(ch)) {
      if (!space && plain.length) {
        plain += ' '
        from.push(i)
        to.push(end)
      }
      space = true
    } else {
      space = false
      for (const c of (CHAR_MAP[ch] ?? ch).toLowerCase()) {
        plain += c
        from.push(i)
        to.push(end)
      }
    }
    i = end
  }
  if (plain.endsWith(' ')) {
    plain = plain.slice(0, -1)
    from.pop()
    to.pop()
  }
  return { plain, from, to }
}

/** For comparing: plain quotes and dashes, one space, lower case. */
export const plain = (s: string): string => plainWithMap(s).plain

/** A short, stable fingerprint of some text. */
export const hashText = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 32)

// ---------- Paragraphs ----------

/** The lines of a text that have words on them, trimmed. */
export function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean)
}

/** A paragraph of the scene: its id ('#n', its place, when the editor gave it none), its words and their hash. */
export interface Para {
  id: string
  /** The editor's stable paragraph id (attrs.pid), or null. */
  pid: string | null
  text: string
  hash: string
  /** Where it starts in the scene's plain text (paragraphs without an editor id). */
  offset: number | null
}

const paraHash = (text: string): string => hashText(text.trim())

const TEXTBLOCKS = new Set(['paragraph', 'heading', 'codeBlock'])

/** Plain text of one editor block, as the editor writes it (hard breaks are new lines). */
function blockText(node: Record<string, unknown>): string {
  let t = ''
  for (const c of (node.content as Record<string, unknown>[] | undefined) ?? []) {
    if (c && c.type === 'text' && typeof c.text === 'string') t += c.text
    else if (c && c.type === 'hardBreak') t += '\n'
  }
  return t
}

/** The paragraphs of a scene's editor document with their ids, or null when not every paragraph has one. */
function docParas(doc: unknown): Para[] | null {
  if (!doc || typeof doc !== 'object') return null
  const out: Para[] = []
  let missing = false
  const visit = (node: Record<string, unknown>): void => {
    if (!node || typeof node !== 'object') return
    if (TEXTBLOCKS.has(node.type as string)) {
      const text = blockText(node).trim()
      if (!text) return
      const attrs = (node.attrs as Record<string, unknown> | undefined) ?? {}
      const raw = attrs.pid ?? attrs['data-pid']
      const pid = typeof raw === 'string' && raw ? raw : null
      if (!pid) missing = true
      out.push({ id: pid ?? `#${out.length}`, pid, text, hash: paraHash(text), offset: null })
      return
    }
    for (const c of (node.content as Record<string, unknown>[] | undefined) ?? []) visit(c)
  }
  visit(doc as Record<string, unknown>)
  if (!out.length || missing) return null
  // Two paragraphs can't share an id: the second keeps only its place.
  const seen = new Set<string>()
  out.forEach((p, i) => {
    if (seen.has(p.id)) out[i] = { ...p, id: `#${i}`, pid: null }
    seen.add(out[i].id)
  })
  return out
}

/** The scene's paragraphs from its plain text (blank lines between them), with where each starts. */
export function textParas(text: string): Para[] {
  const out: Para[] = []
  for (const m of text.matchAll(/[^\n]+(?:\n(?![ \t]*\n)[^\n]*)*/g)) {
    const raw = m[0]
    if (!raw.trim()) continue
    const lead = raw.length - raw.trimStart().length
    const t = raw.trim()
    out.push({ id: `#${out.length}`, pid: null, text: t, hash: paraHash(t), offset: (m.index ?? 0) + lead })
  }
  return out
}

/**
 * The scene's paragraphs: from the editor document when every paragraph there has an id (so links
 * follow a paragraph as it moves), otherwise from the plain text.
 */
export function sceneParagraphs(doc: unknown, text: string): Para[] {
  return docParas(doc) ?? textParas(text)
}

/** The paragraphs' words, as the scene's plain text holds them. */
export const parasText = (ps: Pick<Para, 'text'>[]): string => ps.map((p) => p.text).join('\n\n')

// ---------- What changed ----------

export interface ParagraphDiff {
  /** Paragraphs that are new or edited since the last read, in scene order. */
  changed: Para[]
  /** Paragraphs read last time that are no longer there as they were (deleted, or edited into something else). */
  gone: { id: string; hash: string; text: string }[]
  /** For an edited paragraph that kept its editor id: what it said before. */
  before: Map<string, string>
}

/**
 * What changed since the last read, by paragraph hash. A paragraph whose words were there before is
 * unchanged wherever it is now: moving a paragraph changes no fact.
 */
export function diffParagraphs(read: { id: string; hash: string; text: string }[], now: Para[]): ParagraphDiff {
  const left = new Map<string, number>()
  for (const p of read) left.set(p.hash, (left.get(p.hash) ?? 0) + 1)
  const changed: Para[] = []
  for (const p of now) {
    const n = left.get(p.hash) ?? 0
    if (n > 0) left.set(p.hash, n - 1)
    else changed.push(p)
  }
  const gone: ParagraphDiff['gone'] = []
  for (const p of read) {
    const n = left.get(p.hash) ?? 0
    if (n > 0) {
      gone.push(p)
      left.set(p.hash, n - 1)
    }
  }
  const goneById = new Map(gone.filter((g) => !g.id.startsWith('#')).map((g) => [g.id, g.text]))
  const before = new Map<string, string>()
  for (const p of changed) if (p.pid && goneById.has(p.pid)) before.set(p.pid, goneById.get(p.pid)!)
  return { changed, gone, before }
}

const bareWords = (s: string): string[] => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []

/** True when `short` is `long` with one or two letters left out ("rivr", "accross"). */
function lettersLeftOut(short: string, long: string): boolean {
  if (long.length - short.length < 1 || long.length - short.length > 2) return false
  let i = 0
  for (const ch of long) if (i < short.length && short[i] === ch) i++
  return i === short.length
}

/**
 * True when two spellings are one word with a typo: a letter missing or doubled, two letters
 * swapped, or one wrong letter in a long word. A different word that happens to differ by a letter
 * or two ("west" and "east", "dead" and "deaf", "first" and "fifth") is not a typo.
 */
function typo(x: string, y: string): boolean {
  if (Math.min(x.length, y.length) < 4) return false
  if (x.length !== y.length) return x.length < y.length ? lettersLeftOut(x, y) : lettersLeftOut(y, x)
  const diffs: number[] = []
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) diffs.push(i)
  if (diffs.length === 1) return x.length >= 7
  return diffs.length === 2 && diffs[1] === diffs[0] + 1 && x[diffs[0]] === y[diffs[1]] && x[diffs[1]] === y[diffs[0]]
}

/**
 * True when an edit only fixed punctuation, capitals, spacing or one small typo, so the paragraph
 * says nothing new and needn't be read again.
 */
export function onlyTypos(before: string, after: string): boolean {
  const a = bareWords(before)
  const b = bareWords(after)
  if (a.length !== b.length) return false
  const diffs: number[] = []
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs.push(i)
  if (diffs.length === 0) return true
  return diffs.length === 1 && typo(a[diffs[0]], b[diffs[0]])
}

// ---------- Words and sentences ----------

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu

/** Lower-case words, without a trailing possessive ("Mara's" counts as "mara"). */
export function words(s: string): string[] {
  return (s.match(WORD_RE) ?? []).map((w) => w.toLowerCase().replace(/’/g, "'").replace(/'s$/, ''))
}

export const wordCount = (s: string): number => (s.match(WORD_RE) ?? []).length

/** How alike two pieces of text are by their words (Dice: 1 is the same words, 0 none in common). */
export function likeness(a: string, b: string): number {
  const wa = words(a)
  const wb = words(b)
  if (!wa.length || !wb.length) return 0
  const count = new Map<string, number>()
  for (const w of wb) count.set(w, (count.get(w) ?? 0) + 1)
  let common = 0
  for (const w of wa) {
    const n = count.get(w) ?? 0
    if (n > 0) {
      common++
      count.set(w, n - 1)
    }
  }
  return (2 * common) / (wa.length + wb.length)
}

/** The sentences of a text, exactly as written (closing quotes and brackets stay with their sentence). */
export function sentences(text: string): string[] {
  const out: string[] = []
  for (const p of lines(text)) {
    for (const m of p.matchAll(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)/gu)) {
      const s = m[0].trim()
      if (s && /[\p{L}\p{N}]/u.test(s)) out.push(s)
    }
  }
  return out
}

// ---------- Finding the words a fact rests on ----------

/** Where the quote is in the text (ignoring curly quotes, dashes, case and spacing), as a character range. */
export function findQuote(text: string, quote: string): { start: number; end: number } | null {
  const q = quote.trim()
  if (!q) return null
  const at = text.indexOf(q)
  if (at >= 0) return { start: at, end: at + q.length }
  const t = plainWithMap(text)
  const pq = plain(q)
  if (!pq) return null
  const i = t.plain.indexOf(pq)
  if (i < 0) return null
  return { start: t.from[i], end: t.to[i + pq.length - 1] }
}

/** True when the quote is in the text (ignoring curly quotes, dashes, case and spacing). */
export const hasQuote = (text: string, quote: string): boolean => findQuote(text, quote) !== null

/**
 * Where the quote is in the text when only punctuation, capitals, spacing or one small typo differ
 * (see onlyTypos), as a character range; null otherwise. Lets a fact follow its words through a
 * typo fix without asking the memory model.
 */
export function findNearQuote(text: string, quote: string): { start: number; end: number } | null {
  const exact = findQuote(text, quote)
  if (exact) return exact
  const want = bareWords(quote)
  if (!want.length) return null
  const found = [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({
    w: m[0].toLowerCase(),
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length
  }))
  for (let i = 0; i + want.length <= found.length; i++) {
    const window = found.slice(i, i + want.length)
    if (!onlyTypos(want.join(' '), window.map((x) => x.w).join(' '))) continue
    return { start: window[0].start, end: window[window.length - 1].end }
  }
  return null
}

/** The least likeness to a sentence for a quote that isn't word for word to count as that sentence. */
export const CLOSE_ENOUGH = 0.6

/**
 * The exact words in the text that a quote from the memory model stands for: the quote itself when
 * it is there (allowing for curly quotes, case and spacing); else the longest part of it when the
 * model joined pieces with "..."; else the sentence closest to it, if close enough. Null when nothing
 * in the text matches.
 */
export function locateQuote(text: string, quote: string): string | null {
  const raw = (quote ?? '').trim()
  // Models often wrap the words in quotation marks of their own.
  const q = raw
    .replace(/^["“”'‘’]+/, '')
    .replace(/["“”'‘’]+$/, '')
    .trim()
  for (const candidate of [raw, q]) {
    const r = findQuote(text, candidate)
    if (r) return text.slice(r.start, r.end)
  }
  const parts = q
    .split(/\s*(?:\.\.\.|…)\s*/)
    .map((p) => p.trim())
    .filter((p) => wordCount(p) >= 4)
    .sort((a, b) => b.length - a.length)
  for (const p of parts) {
    const r = findQuote(text, p)
    if (r) return text.slice(r.start, r.end)
  }
  if (wordCount(q) < 3) return null
  const best = closestSentence(text, q)
  return best && best.score >= CLOSE_ENOUGH ? best.sentence : null
}

/** The sentence in the text most like the quote, and how alike they are. */
export function closestSentence(text: string, quote: string): { sentence: string; score: number } | null {
  let best: { sentence: string; score: number } | null = null
  for (const s of sentences(text)) {
    const score = likeness(quote, s)
    if (!best || score > best.score) best = { sentence: s, score }
  }
  return best
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Where a name first appears in the text as a whole word or phrase, or -1. A single capitalised word
 * ("Will", "Rose") must appear capitalised, so ordinary words don't count; phrases and lower-case
 * aliases ("the old woman") ignore case.
 */
export function mentionAt(text: string, name: string): { start: number; end: number } | null {
  const n = name.trim()
  if (n.length < 2 || !text) return null
  const flags = /\s/.test(n) || !/^\p{Lu}/u.test(n) ? 'iu' : 'u'
  const m = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, flags).exec(text)
  return m ? { start: m.index, end: m.index + m[0].length } : null
}

// ---------- Sizes ----------

/** A cautious token estimate (real tokenisers give fewer for English prose). */
export const estimateTokens = (s: string): number => Math.ceil(s.length / 3.5)

/** The first `n` words of a text, or its last `n` words. */
export function firstWords(s: string, n: number): string {
  const parts = s.split(/\s+/).filter(Boolean)
  return parts.length <= n ? s.trim() : `${parts.slice(0, n).join(' ')} …`
}
export function lastWords(s: string, n: number): string {
  const parts = s.split(/\s+/).filter(Boolean)
  return parts.length <= n ? s.trim() : `… ${parts.slice(-n).join(' ')}`
}

/**
 * Splits a paragraph too long for one request into pieces of whole sentences, each within
 * `maxTokens` where possible (a single sentence longer than that is cut by words).
 */
export function splitLong(p: string, maxTokens: number): string[] {
  if (estimateTokens(p) <= maxTokens) return [p]
  const out: string[] = []
  let cur = ''
  const flush = (): void => {
    if (cur.trim()) out.push(cur.trim())
    cur = ''
  }
  const pieces = sentences(p)
  for (const s of pieces.length ? pieces : [p]) {
    if (estimateTokens(s) > maxTokens) {
      flush()
      let part: string[] = []
      for (const w of s.split(/\s+/)) {
        part.push(w)
        if (estimateTokens(part.join(' ')) >= maxTokens) {
          out.push(part.join(' '))
          part = []
        }
      }
      if (part.length) out.push(part.join(' '))
      continue
    }
    if (cur && estimateTokens(`${cur} ${s}`) > maxTokens) flush()
    cur = cur ? `${cur} ${s}` : s
  }
  flush()
  return out
}

/** Lower-cases the first word when it is an ordinary word ("The Duke is dead" → "the Duke is dead"). */
export function lowerFirstWord(s: string): string {
  return s.replace(/^(The|A|An|His|Her|Their|Its|That|This|There|Someone|Something|Nobody|No one)\b/, (w) => w.toLowerCase())
}

/** Upper-cases the first letter ("lost her left hand" → "Lost her left hand"). */
export const upperFirst = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** Cuts text to about `n` words for a short display, ending with an ellipsis when cut. */
export function clip(s: string, n = 40): string {
  const parts = s.trim().split(/\s+/).filter(Boolean)
  return parts.length <= n ? s.trim() : `${parts.slice(0, n).join(' ')}…`
}
