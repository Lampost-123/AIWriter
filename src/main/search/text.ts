// The words of a search: folding text so case and accents don't matter, reading a query, finding
// its words in text, and the snippets and marked titles the results show. Pure (no database, no
// Electron), so it is unit-tested on its own.
//
// Matching rules (spec, Search): every word of the query must match, in any order; a word matches
// the start of a word in the text and, once Adam has typed past it, the whole word. Only the last
// word is matched by its start, since he may still be typing it ("drag" finds "dragon").

import type { TextPart } from '@shared/contracts/search'

/** One word of a query. `prefix`: it matches the start of a word (the word still being typed). */
export interface Term {
  word: string
  prefix: boolean
}

export interface Query {
  terms: Term[]
}

// ---------- Folding ----------

const MARKS = /\p{M}/gu
const NON_ASCII = /[^\u0000-\u007f]/

/** Lower case without accents: "Élodie" → "elodie". Lengths can change (ligatures), so offsets need foldMap. */
export function fold(s: string): string {
  if (!NON_ASCII.test(s)) return s.toLowerCase()
  // ς only ends a word; folding it to σ keeps a whole-string fold the same as a character-by-character one.
  return s.normalize('NFKD').replace(MARKS, '').toLowerCase().replace(/ς/g, 'σ')
}

const foldedChars = new Map<string, string>()

/** One character folded (cached: a world's text uses few distinct characters). */
function foldChar(ch: string): string {
  let f = foldedChars.get(ch)
  if (f === undefined) {
    f = fold(ch)
    foldedChars.set(ch, f)
  }
  return f
}

/** Folded text with, for each folded character, where its original character starts and ends. */
export interface FoldMap {
  folded: string
  start: number[]
  end: number[]
}

export function foldMap(s: string): FoldMap {
  let folded = ''
  const start: number[] = []
  const end: number[] = []
  for (let i = 0; i < s.length; ) {
    const code = s.codePointAt(i)!
    const len = code > 0xffff ? 2 : 1
    const f = code < 0x80 ? s[i].toLowerCase() : foldChar(s.slice(i, i + len))
    for (let k = 0; k < f.length; k++) {
      start.push(i)
      end.push(i + len)
    }
    folded += f
    i += len
  }
  return { folded, start, end }
}

// ---------- Words ----------

const WORD = /[\p{L}\p{N}]/u

/** True for letters and digits in any language: what words are made of. */
export function isWordChar(ch: string | undefined): boolean {
  if (!ch) return false
  const c = ch.charCodeAt(0)
  if (c < 0x80) return (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || (c >= 65 && c <= 90)
  // A lone half of a surrogate pair: the letter is judged by both halves together.
  if (c >= 0xd800 && c <= 0xdfff) return true
  return WORD.test(ch)
}

const SPLIT = /[^\p{L}\p{N}]+/u

/**
 * The words of a query, folded, each once, in the order typed. The last is matched by its start
 * unless Adam has typed a space (or other mark) after it. Null when there are no words at all.
 */
export function parseQuery(q: string): Query | null {
  const words = fold(q).split(SPLIT).filter(Boolean)
  if (!words.length) return null
  const open = isWordChar(q.slice(-1))
  const seen = new Set<string>()
  const terms: Term[] = []
  words.forEach((word, i) => {
    // A word typed twice counts once (a finished word also matches as its own start).
    if (seen.has(word)) return
    seen.add(word)
    terms.push({ word, prefix: open && i === words.length - 1 })
  })
  return { terms }
}

/** Where `term` next matches in folded text at or after `from`, or -1. */
export function findTerm(text: string, term: Term, from = 0): number {
  const w = term.word
  let i = text.indexOf(w, from)
  while (i >= 0) {
    if (!isWordChar(text[i - 1]) && (term.prefix || !isWordChar(text[i + w.length]))) return i
    i = text.indexOf(w, i + 1)
  }
  return -1
}

export const hasTerm = (text: string, term: Term): boolean => findTerm(text, term) >= 0

/** True when every word matches somewhere in these folded texts (each word in any of them). */
export function matchesAll(texts: string[], terms: Term[]): boolean {
  return terms.every((t) => texts.some((s) => hasTerm(s, t)))
}

/**
 * True when the words appear together, in the order typed, with only spaces or marks between them
 * ("iron gate" in "the iron gate creaked"). One word always does when it matches.
 */
export function hasPhrase(text: string, terms: Term[]): boolean {
  if (terms.length < 2) return terms.length === 1 && hasTerm(text, terms[0])
  const [first, ...rest] = terms
  for (let i = findTerm(text, first); i >= 0; i = findTerm(text, first, i + 1)) {
    let at = i + first.word.length
    const ok = rest.every((t) => {
      let j = at
      while (j < text.length && !isWordChar(text[j]) && text[j] !== '\n') j++
      if (j === at || text.slice(j, j + t.word.length) !== t.word) return false
      if (!t.prefix && isWordChar(text[j + t.word.length])) return false
      at = j + t.word.length
      return true
    })
    if (ok) return true
  }
  return false
}

// ---------- Marked text and snippets ----------

interface Match {
  /** Folded positions. */
  from: number
  to: number
  term: number
}

/** Every match of every word in folded text, in order (at most `cap`). */
function matchesIn(folded: string, terms: Term[], cap = 400): Match[] {
  const out: Match[] = []
  terms.forEach((t, term) => {
    for (let i = findTerm(folded, t); i >= 0 && out.length < cap; i = findTerm(folded, t, i + 1)) out.push({ from: i, to: i + t.word.length, term })
  })
  out.sort((a, b) => a.from - b.from || b.to - a.to)
  // Overlaps ("ma" inside "mara") become one mark.
  const merged: Match[] = []
  for (const m of out) {
    const last = merged[merged.length - 1]
    if (last && m.from <= last.to) last.to = Math.max(last.to, m.to)
    else merged.push({ ...m })
  }
  return merged
}

/** Joins marked pieces, dropping empty ones and merging neighbours of the same kind. */
function parts(pieces: TextPart[]): TextPart[] {
  const out: TextPart[] = []
  for (const p of pieces) {
    if (!p.text) continue
    const last = out[out.length - 1]
    if (last && !!last.hit === !!p.hit) last.text += p.text
    else out.push(p.hit ? { text: p.text, hit: true } : { text: p.text })
  }
  return out
}

/** `text` with every match of the words marked (for a title or a name). */
export function marked(text: string, terms: Term[]): TextPart[] {
  const map = foldMap(text)
  const pieces: TextPart[] = []
  let at = 0
  for (const m of matchesIn(map.folded, terms)) {
    const from = map.start[m.from]
    const to = map.end[m.to - 1]
    pieces.push({ text: text.slice(at, from) }, { text: text.slice(from, to), hit: true })
    at = to
  }
  pieces.push({ text: text.slice(at) })
  return parts(pieces)
}

const oneLine = (s: string): string => s.replace(/\s+/g, ' ')

export interface Snippet {
  parts: TextPart[]
  /** The matched words as they are in the text, whole words, for opening the scene at them; null when nothing matched. */
  words: string | null
  /** Where those words start in the text. */
  at: number
}

/**
 * The words around the best match in `text`: the spot where the most different words of the query
 * are close together, earliest first. About `size` characters of its paragraph, cut at word breaks,
 * with "…" where text was left out and every match marked. With no match, the start of the text.
 */
export function snippet(text: string, terms: Term[], size = 180): Snippet {
  const map = foldMap(text)
  const all = matchesIn(map.folded, terms)
  const before = Math.round(size * 0.3)
  if (!all.length) {
    const end = cutEnd(text, Math.min(text.length, size))
    return { parts: parts([{ text: oneLine(text.slice(0, end)).trim() }, { text: end < text.length ? '…' : '' }]), words: null, at: 0 }
  }

  // The window (from each match, `size` folded characters on) holding the most different words.
  let best = 0
  let bestCount = 0
  for (let i = 0; i < all.length; i++) {
    const seen = new Set<number>()
    for (let j = i; j < all.length && all[j].from < all[i].from + size - before; j++) seen.add(all[j].term)
    if (seen.size > bestCount) {
      best = i
      bestCount = seen.size
      if (seen.size === terms.length) break
    }
  }
  const anchor = all[best]
  const anchorFrom = map.start[anchor.from]

  // The anchor's whole word(s): to the end of the last word of the query found right after it.
  let wordsEnd = map.end[anchor.to - 1]
  for (let j = best + 1; j < all.length && map.start[all[j].from] - wordsEnd <= 3 && !/\n/.test(text.slice(wordsEnd, map.start[all[j].from])); j++) {
    wordsEnd = map.end[all[j].to - 1]
  }
  while (wordsEnd < text.length && isWordChar(text[wordsEnd])) wordsEnd++
  let wordsStart = anchorFrom
  while (wordsStart > 0 && isWordChar(text[wordsStart - 1])) wordsStart--

  // The paragraph the anchor is in bounds the snippet, so it reads as one passage.
  const paraStart = text.lastIndexOf('\n', anchorFrom) + 1
  const nextBreak = text.indexOf('\n', anchorFrom)
  const paraEnd = nextBreak < 0 ? text.length : nextBreak
  let start = Math.max(paraStart, anchorFrom - before)
  let end = Math.min(paraEnd, start + size)
  if (end - start < size) start = Math.max(paraStart, end - size)
  start = cutStart(text, start, paraStart, anchorFrom)
  end = cutEnd(text, end, paraEnd)

  // "…" before, where text comes before it; after, only where the paragraph goes on (a "." then "…" reads oddly).
  const pieces: TextPart[] = [{ text: start > 0 ? '…' : '' }]
  let at = start
  for (const m of all) {
    const from = map.start[m.from]
    const to = map.end[m.to - 1]
    if (to <= start || from >= end) continue
    pieces.push({ text: oneLine(text.slice(at, Math.max(at, from))) }, { text: oneLine(text.slice(Math.max(at, from), Math.min(end, to))), hit: true })
    at = Math.min(end, to)
  }
  pieces.push({ text: oneLine(text.slice(at, end)) }, { text: end < paraEnd ? '…' : '' })
  return { parts: parts(pieces), words: text.slice(wordsStart, wordsEnd), at: wordsStart }
}

/** Moves a cut forward to the start of a word (never past `limit`). */
function cutStart(text: string, at: number, floor: number, limit: number): number {
  if (at <= floor) return floor
  let i = at
  while (i < limit && isWordChar(text[i - 1]) && isWordChar(text[i])) i++
  while (i < limit && /\s/.test(text[i])) i++
  return i
}

/** Moves a cut back to the end of a word. */
function cutEnd(text: string, at: number, ceiling = text.length): number {
  if (at >= ceiling) return ceiling
  let i = at
  while (i > 0 && isWordChar(text[i - 1]) && isWordChar(text[i])) i--
  while (i > 0 && /\s/.test(text[i - 1])) i--
  return i > 0 ? i : at
}

// ---------- Opening a scene at the words ----------

const QUOTES: Record<string, string> = { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-' }
const loose = (s: string): string => s.replace(/[‘’“”–—]/g, (c) => QUOTES[c]).toLowerCase()

/**
 * The words to select when a scene opens at a match: the matched words, with the words around them
 * added until the editor's finder (case-insensitive, first match in the scene, features/editor/
 * findText.ts) would find this spot and not an earlier one. Stays inside the paragraph.
 */
export function wordsToReveal(text: string, at: number, words: string): string {
  const para = text.lastIndexOf('\n', at) + 1
  const next = text.indexOf('\n', at)
  const paraEnd = next < 0 ? text.length : next
  const lower = loose(text)
  let from = at
  let to = at + words.length
  const firstAt = (): number => lower.indexOf(lower.slice(from, to))
  // Words here run from space to space, so "Mara’s" and "gate." come whole.
  const back = (): void => {
    let i = from
    while (i > para && /\s/.test(text[i - 1])) i--
    while (i > para && !/\s/.test(text[i - 1])) i--
    from = i
  }
  const on = (): void => {
    let i = to
    while (i < paraEnd && /\s/.test(text[i])) i++
    while (i < paraEnd && !/\s/.test(text[i])) i++
    to = i
  }
  // A word before first (which pins it down best), then one after, in turn.
  for (let step = 0; step < 12 && firstAt() !== from; step++) {
    if ((step % 2 === 0 || to >= paraEnd) && from > para) back()
    else if (to < paraEnd) on()
    else break
  }
  return text.slice(from, to)
}
