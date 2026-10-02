// Text helpers for the memory keeper: paragraphs and what changed between two versions of a
// scene, finding the exact words a fact rests on, sentence splitting, word overlap and token
// estimates. Pure, no Electron imports.

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
 * The text with curly quotes, dashes and ellipses made plain, runs of white space made one
 * space and letters in lower case, plus where each character came from in the original, so a
 * match in the plain text can be cut out of the original exactly.
 */
export function plainWithMap(s: string): { plain: string; from: number[]; to: number[] } {
  let plain = ''
  const from: number[] = []
  const to: number[] = []
  let space = false
  for (let i = 0; i < s.length; ) {
    const cp = s.codePointAt(i)!
    const ch = String.fromCodePoint(cp)
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
      const mapped = (CHAR_MAP[ch] ?? ch).toLowerCase()
      for (const c of mapped) {
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

// ---------- Paragraphs and what changed ----------

/** The scene's paragraphs (each non-empty line), trimmed. */
export function paragraphs(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean)
}

export interface ParagraphDiff {
  /** The new text's paragraphs. */
  paragraphs: string[]
  /** Indexes (into `paragraphs`) of paragraphs that are new or changed since the old text. */
  changed: number[]
  /** Old paragraphs that are no longer there (deleted, or changed into something else). */
  gone: string[]
}

/**
 * Compares two versions of a scene paragraph by paragraph. A paragraph is unchanged when the
 * same words were there before (anywhere: moving a paragraph changes no fact).
 */
export function diffParagraphs(oldText: string, newText: string): ParagraphDiff {
  const before = new Map<string, number>()
  for (const p of paragraphs(oldText)) before.set(plain(p), (before.get(plain(p)) ?? 0) + 1)
  const now = paragraphs(newText)
  const changed: number[] = []
  now.forEach((p, i) => {
    const k = plain(p)
    const n = before.get(k) ?? 0
    if (n > 0) before.set(k, n - 1)
    else changed.push(i)
  })
  const gone: string[] = []
  for (const p of paragraphs(oldText)) {
    const k = plain(p)
    const n = before.get(k) ?? 0
    if (n > 0) {
      gone.push(p)
      before.set(k, n - 1)
    }
  }
  return { paragraphs: now, changed, gone }
}

// ---------- Words and sentences ----------

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu

/** Lower-case words, without a trailing possessive ("Mara's" counts as "mara"). */
export function words(s: string): string[] {
  return (s.match(WORD_RE) ?? []).map((w) =>
    w
      .toLowerCase()
      .replace(/[’]/g, "'")
      .replace(/'s$/, '')
  )
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
  for (const p of paragraphs(text)) {
    const re = /[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)/gu
    for (const m of p.matchAll(re)) {
      const s = m[0].trim()
      if (s && /[\p{L}\p{N}]/u.test(s)) out.push(s)
    }
  }
  return out
}

// ---------- Finding the words a fact rests on ----------

/** True when the quote is in the text (ignoring curly quotes, dashes, case and spacing). */
export function hasQuote(text: string, quote: string): boolean {
  const q = plain(quote)
  return q.length > 0 && plain(text).includes(q)
}

/** The quote cut exactly out of the text when it is there (ignoring curly quotes, dashes, case and spacing). */
function exactly(text: string, quote: string): string | null {
  if (!quote.trim()) return null
  if (text.includes(quote.trim())) return quote.trim()
  const t = plainWithMap(text)
  const q = plain(quote)
  if (!q) return null
  const at = t.plain.indexOf(q)
  if (at < 0) return null
  return text.slice(t.from[at], t.to[at + q.length - 1])
}

/** The least likeness to a sentence for a quote that isn't word for word to count as that sentence. */
export const CLOSE_ENOUGH = 0.6

/**
 * The exact words in the text that a quote from the memory model stands for: the quote itself
 * when it is there word for word (allowing for curly quotes, case and spacing); else the longest
 * part of it when the model joined pieces with "..."; else the sentence closest to it, if close
 * enough. Null when nothing in the text matches.
 */
export function locateQuote(text: string, quote: string): string | null {
  const raw = (quote ?? '').trim()
  // Models often wrap the words in quotation marks of their own.
  const q = raw.replace(/^["“”'‘’]+/, '').replace(/["“”'‘’]+$/, '').trim()
  const direct = exactly(text, raw) ?? exactly(text, q)
  if (direct) return direct
  const parts = q
    .split(/\s*(?:\.\.\.|…)\s*/)
    .map((p) => p.trim())
    .filter((p) => wordCount(p) >= 4)
    .sort((a, b) => b.length - a.length)
  for (const p of parts) {
    const found = exactly(text, p)
    if (found) return found
  }
  if (wordCount(q) < 3) return null
  let best: { s: string; score: number } | null = null
  for (const s of sentences(text)) {
    const score = likeness(q, s)
    if (!best || score > best.score) best = { s, score }
  }
  return best && best.score >= CLOSE_ENOUGH ? best.s : null
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
      const ws = s.split(/\s+/)
      let part: string[] = []
      for (const w of ws) {
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

/** Upper-cases nothing, lower-cases the first word when it is an ordinary word ("The Duke is dead" → "the Duke is dead"). */
export function lowerFirstWord(s: string): string {
  return s.replace(/^(The|A|An|His|Her|Their|Its|That|This|There|Someone|Something|Nobody|No one)\b/, (w) => w.toLowerCase())
}
