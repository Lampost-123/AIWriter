// Writing by hand: the pure parts of spelling and synonyms (tested in spelling.test.ts). The main process
// loads the thesaurus and sets Chromium's spell checker's language (src/main/spelling/); the window marks the words
// that count as correct and puts a picked synonym into the page (features/spelling/).
import type { Spelling } from './types'
import type { PartOfSpeech, SynonymSense } from './contracts/spelling'

// ---------- Language ----------

/** The spell checker's language for a spelling. */
export const languageFor = (spelling: Spelling): 'en-GB' | 'en-US' => (spelling === 'US' ? 'en-US' : 'en-GB')

// ---------- The world's words ----------

/**
 * The words of the world's names and aliases that count as correct while the world is open: every word of every
 * name ("Mara Vell" gives Mara and Vell), and a hyphenated name whole and in parts (Ash-Kel, Ash, Kel). Words
 * without a letter, or of one letter, are left out. (A possessive, "Mara's", counts too: see isKnownWord.)
 */
export function worldWordsOf(entries: { name: string; aliases: string[] }[]): string[] {
  const out = new Set<string>()
  const add = (w: string): void => {
    const word = w.replace(/^['’-]+|['’-]+$/g, '')
    if (word.length >= 2 && /\p{L}/u.test(word)) out.add(word)
  }
  for (const e of entries) {
    for (const name of [e.name, ...(e.aliases ?? [])]) {
      for (const raw of String(name ?? '').split(/[^\p{L}\p{M}\p{N}'’-]+/u)) {
        const word = raw.replace(/’/g, "'")
        if (!word) continue
        add(word)
        if (word.includes('-')) word.split('-').forEach(add)
      }
    }
  }
  return [...out].sort()
}

/**
 * True when a word counts as correct: it is one of `known` (lower case), whatever its capitals, or its possessive
 * ("Mara’s" when Mara is known).
 */
export function isKnownWord(known: ReadonlySet<string>, word: string): boolean {
  const w = String(word ?? '').trim().replace(/’/g, "'").toLocaleLowerCase()
  if (!w) return false
  return known.has(w) || (/'s$/.test(w) && known.has(w.slice(0, -2)))
}

/** Where known words are in a paragraph's text, as [from, to) offsets: whole words only. */
export function knownWordRanges(text: string, known: ReadonlySet<string>): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  if (!known.size) return out
  const re = /[\p{L}\p{M}][\p{L}\p{M}'’-]*/gu
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let word = m[0]
    while (/['’-]$/.test(word)) word = word.slice(0, -1)
    if (isKnownWord(known, word)) out.push({ from: m.index, to: m.index + word.length })
    else if (word.includes('-')) {
      // A hyphenated word: its known parts (Chromium checks each part of one).
      let at = m.index
      for (const part of word.split('-')) {
        if (part && isKnownWord(known, part)) out.push({ from: at, to: at + part.length })
        at += part.length + 1
      }
    }
  }
  return out
}

// ---------- The thesaurus ----------

/** The thesaurus as loaded: each word's line (parsed when asked for), and the US-to-UK spellings. */
export interface Thesaurus {
  words: Map<string, string>
  ukOf: Map<string, string>
  usOf: Map<string, string>
}

const POS: Record<string, PartOfSpeech> = { n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb' }

/** Reads the thesaurus file's text (build/thesaurus.mjs makes it). */
export function parseThesaurus(text: string): Thesaurus {
  const words = new Map<string, string>()
  const ukOf = new Map<string, string>()
  const usOf = new Map<string, string>()
  let section = ''
  for (const line of text.split('\n')) {
    if (!line) continue
    if (line.startsWith('#')) {
      section = line
      continue
    }
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    const key = line.slice(0, tab)
    const rest = line.slice(tab + 1)
    if (section === '#variants') {
      // One word spelt two (or more) ways: its US spelling, its UK one, then any others.
      const [uk, ...others] = rest.split('\t')
      for (const w of [key, ...others]) ukOf.set(w, uk)
      for (const w of [uk, ...others]) usOf.set(w, key)
    } else if (section === '#words') words.set(key, rest)
  }
  return { words, ukOf, usOf }
}

/** A word or phrase in the writer's spelling (word by word, and each part of a hyphenated word). */
export function inSpelling(t: Thesaurus, text: string, spelling: Spelling): string {
  const map = spelling === 'US' ? t.usOf : t.ukOf
  return text
    .split(/([ -])/)
    .map((w) => map.get(w) ?? w)
    .join('')
}

/** How many synonyms the menu shows at most. */
export const MAX_SYNONYMS = 12

/** A word as the thesaurus lists it: lower case, straight apostrophes. */
export const thesaurusKey = (word: string): string => word.trim().replace(/’/g, "'").toLowerCase()

/**
 * Synonyms for a word, grouped by sense, in the writer's spelling: a few senses and a handful of words each,
 * MAX_SYNONYMS at most in all. A UK spelling the thesaurus doesn't list is looked up by its US form (colour by
 * color), and the other way round. Empty when the word isn't there.
 */
export function synonymsFor(t: Thesaurus, word: string, spelling: Spelling): SynonymSense[] {
  const key = thesaurusKey(word)
  const line = t.words.get(key) ?? t.words.get(t.usOf.get(key) ?? '') ?? t.words.get(t.ukOf.get(key) ?? '')
  if (!line) return []
  const senses = line.split('\t').map((part) => {
    const [pos, ...words] = part.split('|')
    return { pos: POS[pos] ?? 'noun', words }
  })
  // The word itself (in either spelling) never shows; nor does any word twice.
  const seen = new Set([key, t.usOf.get(key), t.ukOf.get(key)].filter(Boolean).map((w) => inSpelling(t, w!, spelling)))
  const per = Math.max(3, Math.floor(MAX_SYNONYMS / senses.length))
  const out: SynonymSense[] = []
  let total = 0
  for (const s of senses) {
    const words: string[] = []
    for (const raw of s.words) {
      const w = inSpelling(t, raw, spelling)
      if (seen.has(w)) continue
      seen.add(w)
      words.push(w)
      if (words.length >= per || total + words.length >= MAX_SYNONYMS) break
    }
    if (words.length) {
      out.push({ pos: s.pos, words })
      total += words.length
    }
    if (total >= MAX_SYNONYMS) break
  }
  return out
}

// ---------- Putting a synonym in ----------

/** The replacement with the word's capitals: "Happy" gives "Glad", "HAPPY" gives "GLAD", "happy" leaves "glad". */
export function matchCase(original: string, replacement: string): string {
  const letters = original.replace(/[^\p{L}]/gu, '')
  if (letters.length > 1 && letters === letters.toLocaleUpperCase() && letters !== letters.toLocaleLowerCase()) return replacement.toLocaleUpperCase()
  const first = letters.charAt(0)
  if (first && first === first.toLocaleUpperCase() && first !== first.toLocaleLowerCase()) {
    return replacement.charAt(0).toLocaleUpperCase() + replacement.slice(1)
  }
  return replacement
}

/** The characters a word is made of, for finding the word under the pointer: letters, marks and inner apostrophes and hyphens. */
const WORD_CHAR = /[\p{L}\p{M}'’-]/u

/**
 * The word in `text` around offset `at` (a click between two characters counts the one after it, then the one
 * before), as [from, to) offsets; null when there is no word there. Apostrophes and hyphens at its ends are left out.
 */
export function wordAt(text: string, at: number): { from: number; to: number; word: string } | null {
  const isWord = (i: number): boolean => i >= 0 && i < text.length && WORD_CHAR.test(text[i])
  const i = isWord(at) ? at : isWord(at - 1) ? at - 1 : -1
  if (i < 0) return null
  let from = i
  let to = i + 1
  while (isWord(from - 1)) from--
  while (isWord(to)) to++
  while (from < to && /['’-]/.test(text[from])) from++
  while (to > from && /['’-]/.test(text[to - 1])) to--
  if (to <= from || !/\p{L}/u.test(text.slice(from, to))) return null
  return { from, to, word: text.slice(from, to) }
}

/** True when a selection is one word (for the synonyms menu): letters, with inner apostrophes or hyphens. */
export const isOneWord = (text: string): boolean => /^\p{L}[\p{L}\p{M}'’-]*$/u.test(text) && !/['’-]$/.test(text)
