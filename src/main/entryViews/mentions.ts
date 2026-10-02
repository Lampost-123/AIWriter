// Finding which entries a scene's words name, in one pass over the text. Uses the memory keeper's
// rule for names (mentionAt in keeper/text.ts): a single capitalised word must appear capitalised,
// phrases and lower-case aliases ignore case, spaces in a name match any run of spaces, and a match
// is a whole word or phrase. Each name is indexed by its first word (and, for a phrase, its second);
// the scan walks the text's words once, looks each up by a cheap hash, and compares the whole name
// only where those words match. So a world full of "the old woman" and "the Duke" doesn't check
// every "the". Names are compared character by character rather than with a regular expression per
// name, which would cost more to build than the whole scan. Pure, no Electron imports.
import type { ID } from '@shared/types'

export interface Named {
  id: ID
  name: string
  aliases: string[]
}

/** One name (shared by every entry with that name) and how to compare it. */
interface Pattern {
  /** Stable for the same name and case rule: lets a cache remember which names a scene was read for. */
  key: string
  /** The name, trimmed. */
  name: string
  /** Case doesn't matter (a phrase, or a name that doesn't start with a capital). */
  fold: boolean
  /** For a phrase: the hash of its second word in lower case (it is indexed by it too); null for one word. */
  second: number | null
}

/** The names that start with one word: single words, and phrases by the lower-case hash of their second word. */
interface FirstWord {
  single: Pattern[]
  phrases: Map<number, Pattern[]>
}

export interface NameIndex {
  /** Every pattern by key, with the entries that have that name. */
  patterns: Map<string, { pattern: Pattern; entryIds: ID[] }>
  /** Case-sensitive patterns by the hash of their first word, and case-insensitive ones by the hash of their first word in lower case. */
  exact: Map<number, FirstWord>
  folded: Map<number, FirstWord>
  /** Names that don't start with a letter or number ("'Bones'"): looked for wherever their first character is. */
  odd: Pattern[]
}

// Which UTF-16 code units are letters or numbers, and their lower case: worked out the first time
// a scene is read, not while the app starts.
let WORD: Uint8Array = new Uint8Array(0)
let LOWER: Uint16Array = new Uint16Array(0)
function tables(): void {
  if (WORD.length) return
  WORD = new Uint8Array(65536)
  LOWER = new Uint16Array(65536)
  const word = /[\p{L}\p{N}]/u
  for (let c = 0; c < 65536; c++) {
    const ch = String.fromCharCode(c)
    WORD[c] = word.test(ch) ? 1 : 0
    const low = ch.toLowerCase()
    LOWER[c] = low.length === 1 ? low.charCodeAt(0) : c
  }
}

const ASTRAL_WORD = /^[\p{L}\p{N}]/u

/** How many code units the letter or number at `i` takes (two for one outside the basic plane), or 0 when it is neither. */
function wordUnits(text: string, i: number): number {
  if (i >= text.length) return 0
  const c = text.charCodeAt(i)
  if (c < 0xd800 || c > 0xdbff) return WORD[c]
  return ASTRAL_WORD.test(String.fromCodePoint(text.codePointAt(i) ?? c)) ? 2 : 0
}

/** True when a letter or number ends just before `i`. */
function wordBefore(text: string, i: number): boolean {
  if (i <= 0) return false
  const c = text.charCodeAt(i - 1)
  if (c >= 0xdc00 && c <= 0xdfff && i >= 2) return wordUnits(text, i - 2) === 2
  return WORD[c] === 1
}

/** White space as regular expressions count it (\s). */
function isSpace(c: number): boolean {
  return (
    c === 32 ||
    (c >= 9 && c <= 13) ||
    c === 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000 ||
    c === 0xfeff
  )
}

/** The word starting at `i`: where it ends, and its hash as written and in lower case. */
function wordAt(text: string, i: number): { end: number; h: number; hl: number } {
  let h = 0
  let hl = 0
  let j = i
  for (let w = wordUnits(text, j); w; w = wordUnits(text, j)) {
    for (const stop = j + w; j < stop; j++) {
      const c = text.charCodeAt(j)
      h = (Math.imul(h, 31) + c) | 0
      hl = (Math.imul(hl, 31) + LOWER[c]) | 0
    }
  }
  return { end: j, h, hl }
}

/** Where the name ends when it is in the text at `start` as a whole word or phrase; -1 when it isn't. */
function matchAt(p: Pattern, text: string, start: number): number {
  const name = p.name
  const n = text.length
  let j = start
  for (let k = 0; k < name.length; ) {
    const c = name.charCodeAt(k)
    if (isSpace(c)) {
      while (k < name.length && isSpace(name.charCodeAt(k))) k++
      if (j >= n || !isSpace(text.charCodeAt(j))) return -1
      while (j < n && isSpace(text.charCodeAt(j))) j++
      continue
    }
    if (j >= n) return -1
    const t = text.charCodeAt(j)
    if (t !== c && !(p.fold && LOWER[t] === LOWER[c])) return -1
    j++
    k++
  }
  if (wordBefore(text, start) || wordUnits(text, j)) return -1
  return j
}

/** Placeholder names the app gives new entries ("New character", "Unnamed"): never looked for in the text. */
const PLACEHOLDER = /^(unnamed|new (character|place|group|item|lore|event|plot thread|term))$/i

/** A name as mentionAt reads it, or null when it can't match anything (too short, or a placeholder). */
function patternFor(raw: string): { pattern: Pattern; first: { h: number; hl: number } | null } | null {
  const name = raw.trim()
  if (name.length < 2 || PLACEHOLDER.test(name)) return null
  const fold = /\s/.test(name) || !/^\p{Lu}/u.test(name)
  const key = `${fold ? 'i' : 'c'}:${fold ? name.toLowerCase().replace(/\s+/g, ' ') : name}`
  if (!wordUnits(name, 0)) return { pattern: { key, name, fold, second: null }, first: null }
  const first = wordAt(name, 0)
  let k = first.end
  while (k < name.length && !wordUnits(name, k)) k++
  const second = k < name.length ? wordAt(name, k).hl : null
  return { pattern: { key, name, fold, second }, first }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

function addFirst(map: Map<number, FirstWord>, hash: number, p: Pattern): void {
  let f = map.get(hash)
  if (!f) map.set(hash, (f = { single: [], phrases: new Map() }))
  if (p.second === null) f.single.push(p)
  else push(f.phrases, p.second, p)
}

/** Indexes every entry's name and aliases. `only` keeps just those pattern keys (to read scenes again for new names only). */
export function buildNameIndex(entries: Named[], only?: Set<string>): NameIndex {
  tables()
  const ix: NameIndex = { patterns: new Map(), exact: new Map(), folded: new Map(), odd: [] }
  for (const e of entries) {
    for (const raw of [e.name, ...e.aliases]) {
      const p = patternFor(raw)
      if (!p || (only && !only.has(p.pattern.key))) continue
      const known = ix.patterns.get(p.pattern.key)
      if (known) {
        if (!known.entryIds.includes(e.id)) known.entryIds.push(e.id)
        continue
      }
      ix.patterns.set(p.pattern.key, { pattern: p.pattern, entryIds: [e.id] })
      if (!p.first) ix.odd.push(p.pattern)
      else addFirst(p.pattern.fold ? ix.folded : ix.exact, p.pattern.fold ? p.first.hl : p.first.h, p.pattern)
    }
  }
  return ix
}

/**
 * The names (pattern keys) the text mentions, each with where its first mention starts. One pass
 * over the words: a word whose hash isn't a first word of any name costs a map lookup and nothing else.
 */
export function findMentions(ix: NameIndex, text: string): Map<string, number> {
  const hits = new Map<string, number>()
  if (!text || !ix.patterns.size) return hits
  tables()
  const hasExact = ix.exact.size > 0
  const hasFolded = ix.folded.size > 0
  const n = text.length
  // Local copies of the tables, and the basic plane handled inline: this loop runs once per character.
  const W = WORD
  const L = LOWER
  let i = 0
  while (i < n) {
    let c = text.charCodeAt(i)
    if (c < 0xd800 || c > 0xdbff ? W[c] === 0 : !wordUnits(text, i)) {
      i++
      continue
    }
    // The word's hashes, as written and in lower case.
    let h = 0
    let hl = 0
    let j = i
    while (j < n) {
      c = text.charCodeAt(j)
      if (c < 0xd800 || c > 0xdbff) {
        if (W[c] === 0) break
        h = (Math.imul(h, 31) + c) | 0
        hl = (Math.imul(hl, 31) + L[c]) | 0
        j++
      } else {
        if (!wordUnits(text, j)) break
        const low = text.charCodeAt(j + 1)
        h = (Math.imul(Math.imul(h, 31) + c, 31) + low) | 0
        hl = (Math.imul(Math.imul(hl, 31) + c, 31) + low) | 0
        j += 2
      }
    }
    const a = hasExact ? ix.exact.get(h) : undefined
    const b = hasFolded ? ix.folded.get(hl) : undefined
    if (a !== undefined || b !== undefined) {
      // The next word's lower-case hash, for phrases, worked out only when one starts here.
      let next: number | null = null
      for (let li = 0; li < 2; li++) {
        const f = li === 0 ? a : b
        if (!f) continue
        for (const p of f.single) if (!hits.has(p.key) && matchAt(p, text, i) >= 0) hits.set(p.key, i)
        if (!f.phrases.size) continue
        if (next === null) {
          let k = j
          while (k < n && !wordUnits(text, k)) k++
          next = k < n ? wordAt(text, k).hl : 0
        }
        for (const p of f.phrases.get(next) ?? []) if (!hits.has(p.key) && matchAt(p, text, i) >= 0) hits.set(p.key, i)
      }
    }
    i = j
  }
  for (const p of ix.odd) {
    for (let at = text.indexOf(p.name[0]); at >= 0; at = text.indexOf(p.name[0], at + 1)) {
      if (matchAt(p, text, at) >= 0) {
        hits.set(p.key, at)
        break
      }
    }
  }
  return hits
}

/** The keys of every pattern an entry's names make (for mapping hits back to it). */
export function patternKeys(e: Named): string[] {
  tables()
  const out: string[] = []
  for (const raw of [e.name, ...e.aliases]) {
    const p = patternFor(raw)
    if (p && !out.includes(p.pattern.key)) out.push(p.pattern.key)
  }
  return out
}

/** Where a name's match that starts at `at` ends; `at` when it no longer matches there. */
export function mentionEnd(ix: NameIndex, key: string, text: string, at: number): number {
  const p = ix.patterns.get(key)?.pattern
  const end = p ? matchAt(p, text, at) : -1
  return end < 0 ? at : end
}

/**
 * The words around a mention, for showing it and for opening the scene at it: the sentence it is in,
 * within its paragraph, cut to a few words either side of the name on a long sentence. Exactly as
 * the text has them, so the editor can find them again.
 */
export function quoteAround(text: string, start: number, end: number = start, before = 10, after = 14): string {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1
  const lineEndAt = text.indexOf('\n', start)
  const line = text.slice(lineStart, lineEndAt < 0 ? text.length : lineEndAt)
  const from = start - lineStart
  const to = Math.max(from, Math.min(line.length, end - lineStart))
  // The sentence: just after the end of the one before, up to its own end (after the name, so "Dr. Venn" isn't cut).
  let s = 0
  const ends = /[.!?…]+["'”’)\]]*\s+/g
  for (let m = ends.exec(line); m && m.index + m[0].length <= from; m = ends.exec(line)) s = m.index + m[0].length
  const close = /[.!?…]+["'”’)\]]*(?=\s|$)/g
  close.lastIndex = to
  const cm = close.exec(line)
  const e = cm ? cm.index + cm[0].length : line.length
  const words = [...line.slice(s, e).matchAll(/\S+/g)].map((w) => ({ start: s + (w.index ?? 0), end: s + (w.index ?? 0) + w[0].length }))
  if (!words.length) return line.slice(from, to).trim()
  let k = words.findIndex((w) => w.end > from)
  if (k < 0) k = words.length - 1
  let last = words.findIndex((w) => w.end >= to)
  if (last < 0) last = words.length - 1
  const first = Math.max(0, k - before)
  const stop = Math.min(words.length - 1, last + after)
  return line.slice(words[first].start, words[stop].end)
}
