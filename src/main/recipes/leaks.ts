// A recipe never keeps the original's names, places or sentences (spec, "Story recipes"). The Recipe maker is
// told so, and this makes sure of it: after the recipe is written it is checked against the story itself.
//   - Names: words the story uses as names (people, places, ships, houses...): capitalised in the middle of a
//     sentence more often than they appear in lower case, or capitalised at sentence starts only and never an
//     ordinary English word, or written in capitals ("KESTRAL") and no common acronym. Looked for in the recipe as
//     whole words, in any case (2026-10-17): a made-up name even in lower case ("mara"), another only capitalised, and
//     one that is also an ordinary word ("Will", "Rose") only where it is capitalised mid-sentence.
//   - Copied words: any run of COPY_RUN or more words in a row that is also in the story (case, punctuation and
//     spacing aside), unless it is short and made only of little words ("and then he said that it was").
// What is found is taken out a sentence at a time (`scrubText`); the maker first asks the model once to rewrite
// the parts that leak. Pure; no Electron.

import { isCommonWord, isStopWord } from '@shared/liveChecks'

/** Runs of this many words copied from the story are taken out. */
export const COPY_RUN = 8

export interface SourceCheck {
  /** Names as the story writes them ("Mara", "Varn"). */
  names: Set<string>
  /** Every run of COPY_RUN words in the story, folded (see `fold`). */
  runs: Set<string>
  /**
   * Names, in lower case, that are plainly made up: capitalised at least twice in the story, never in lower case, and
   * no ordinary word. Found in the recipe in lower case too ("mara"); other names only when capitalised.
   */
  invented?: Set<string>
}

export interface Leak {
  kind: 'name' | 'copied'
  /** The name, or the copied words as they stand in the recipe. */
  words: string
}

const WORD = /[\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu
/** Titles and family words that show capitalised before a name or in place of one, but name no one. */
const NOT_NAMES = new Set(
  `i mr mrs ms miss dr sir madam lord lady captain king queen prince princess duke duchess sister brother mother father mum mom dad
  grandma grandpa granny gran aunt uncle chapter part book act scene god ok tv monday tuesday wednesday thursday friday saturday
  sunday january february march april may june july august september october november december english french german spanish
  christmas easter i'm i'll i've i'd i’m i’ll i’ve i’d o'clock o’clock`
    .split(/\s+/)
    .filter(Boolean)
)

/** All-caps words that name no one in the story (2026-10-17: other all-caps words of 3 letters or more are names). */
const ACRONYMS = new Set(
  `usa uk eu un nato fbi cia nsa nasa bbc cnn nbc cbs abc itv nhs mit ucla nyc ceo cfo cto vip rsvp sos asap aka diy faq
  dna rna atm gps html pdf url usb dvd cd mri icu cpr er dui awol mia pow swat raf rpg ufo tnt led lcd mph kph rpm am pm
  bc ad bce ce ok tv id ai omg lol wtf iou phd mba bsc msc`
    .split(/\s+/)
    .filter(Boolean)
)

const baseOf = (w: string): string => w.replace(/['’]s$/u, '').replace(/['’-]+$/u, '')
const isCapital = (w: string): boolean => /^\p{Lu}/u.test(w) && !/^\p{Lu}[\p{Lu}\p{N}'’-]+$/u.test(w)
const isLower = (w: string): boolean => /^\p{Ll}/u.test(w)
const isAllCaps = (w: string): boolean => /^\p{Lu}{3,}$/u.test(w)
const isRoman = (w: string): boolean => /^[IVXLCDM]+$/.test(w)
/** An ordinary English word ("Will", "Rose"): as a name, only found where it is capitalised mid-sentence. */
const isWord = (low: string): boolean => isCommonWord(low) || isStopWord(low)

/** True when the word at `index` of `text` starts a sentence (or a line, or a quotation). */
function atStart(text: string, index: number): boolean {
  let i = index - 1
  while (i >= 0 && /[\s"“‘'(\[*_—–-]/.test(text[i])) {
    if (text[i] === '\n') return true
    if (/["“‘(]/.test(text[i])) return true
    i--
  }
  return i < 0 || /[.!?…:;]/.test(text[i])
}

/** The names the story uses, from its paragraphs, plus words of its title that aren't ordinary words. */
export function sourceNames(paragraphs: string[], title = ''): Set<string> {
  return readNames(paragraphs, title).names
}

function readNames(paragraphs: string[], title: string): { names: Set<string>; invented: Set<string> } {
  const mid = new Map<string, number>()
  const start = new Map<string, number>()
  const lower = new Map<string, number>()
  const caps = new Map<string, number>()
  /** How often each word (in lower case) is capitalised or in capitals, anywhere. */
  const upper = new Map<string, number>()
  for (const p of paragraphs) {
    for (const m of p.matchAll(WORD)) {
      const w = baseOf(m[0])
      if (w.length < 2) continue
      if (isLower(w)) {
        lower.set(w.toLowerCase(), (lower.get(w.toLowerCase()) ?? 0) + 1)
        continue
      }
      if (isAllCaps(w)) {
        caps.set(w, (caps.get(w) ?? 0) + 1)
        upper.set(w.toLowerCase(), (upper.get(w.toLowerCase()) ?? 0) + 1)
        continue
      }
      if (!isCapital(w)) continue
      upper.set(w.toLowerCase(), (upper.get(w.toLowerCase()) ?? 0) + 1)
      const into = atStart(p, m.index ?? 0) ? start : mid
      into.set(w, (into.get(w) ?? 0) + 1)
    }
  }
  const names = new Set<string>()
  // A name the story writes in capitals ("KESTRAL"), unless it is a common acronym, a numeral or an ordinary word
  // shouted ("STOP").
  for (const w of caps.keys()) {
    const low = w.toLowerCase()
    if (!ACRONYMS.has(low) && !isRoman(w) && !NOT_NAMES.has(low) && !isWord(low)) names.add(w)
  }
  // Capitalised in the middle of a sentence twice, or once and never in lower case: a name, even one that is also
  // an ordinary word ("Will", "Hope", "Grace", "Rose" in a story that has roses in it).
  for (const [w, n] of mid) {
    const low = w.toLowerCase()
    if (NOT_NAMES.has(low)) continue
    if (n >= 2 || !lower.has(low)) names.add(w)
  }
  // A name only ever at the start of sentences ("Mara ran. Mara stopped.").
  for (const [w, n] of start) {
    const low = w.toLowerCase()
    if (names.has(w) || NOT_NAMES.has(low) || isCommonWord(low) || isStopWord(low)) continue
    if (n >= 2 && !lower.has(low)) names.add(w)
  }
  for (const m of title.matchAll(WORD)) {
    const w = baseOf(m[0])
    const low = w.toLowerCase()
    if (w.length >= 3 && isCapital(w) && !NOT_NAMES.has(low) && !isCommonWord(low) && !isStopWord(low)) names.add(w)
  }
  const invented = new Set<string>()
  for (const w of names) {
    const low = w.toLowerCase()
    if ((upper.get(low) ?? 0) >= 2 && !lower.has(low) && !isWord(low)) invented.add(low)
  }
  return { names, invented }
}

/** A word as runs are compared: lower case, straight apostrophes, no accents. */
const fold = (w: string): string =>
  w
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")

interface Tok {
  word: string
  start: number
  end: number
}

function tokens(text: string): Tok[] {
  const out: Tok[] = []
  for (const m of text.matchAll(WORD)) out.push({ word: fold(m[0]), start: m.index ?? 0, end: (m.index ?? 0) + m[0].length })
  return out
}

/** A run passes as too ordinary to be copying only when it is short and every word of it is a little word. */
export const ORDINARY_MOST = 12
const ordinary = (words: string[]): boolean => words.length < ORDINARY_MOST && words.every((w) => isStopWord(w))

/** Every run of COPY_RUN words in the story's text. */
export function sourceRuns(paragraphs: string[]): Set<string> {
  const runs = new Set<string>()
  for (const p of paragraphs) {
    const words = tokens(p).map((t) => t.word)
    for (let i = 0; i + COPY_RUN <= words.length; i++) runs.add(words.slice(i, i + COPY_RUN).join(' '))
  }
  return runs
}

export function buildCheck(paragraphs: string[], title = ''): SourceCheck {
  const { names, invented } = readNames(paragraphs, title)
  return { names, runs: sourceRuns(paragraphs), invented }
}

/** The names by lower case, kept with each check (it is built once and looked in many times). */
const byLower = new WeakMap<Set<string>, Set<string>>()
function lowerNames(names: Set<string>): Set<string> {
  let s = byLower.get(names)
  if (!s) byLower.set(names, (s = new Set([...names].map((n) => n.toLowerCase()))))
  return s
}

/**
 * True when the recipe's word `w` (at `index` of `text`) is one of the story's names (2026-10-17): in any case when the
 * name is made up; capitalised or in capitals for another name; and only capitalised mid-sentence for a name that is
 * also an ordinary word, so "Will she stay?" keeps its sentence.
 */
function isName(w: string, text: string, index: number, check: SourceCheck): boolean {
  const low = w.toLowerCase()
  if (!lowerNames(check.names).has(low)) return false
  if (isWord(low)) return isCapital(w) && !atStart(text, index)
  if (isLower(w)) return !!check.invented?.has(low)
  return true
}

/** Where in `text` the story's names and copied runs are, as character ranges (merged, in order). */
export function leakSpans(text: string, check: SourceCheck): { start: number; end: number; leak: Leak }[] {
  const spans: { start: number; end: number; leak: Leak }[] = []
  for (const m of text.matchAll(WORD)) {
    const w = baseOf(m[0])
    if (isName(w, text, m.index ?? 0, check)) spans.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, leak: { kind: 'name', words: w } })
  }
  const toks = tokens(text)
  let i = 0
  while (i + COPY_RUN <= toks.length) {
    if (!check.runs.has(toks.slice(i, i + COPY_RUN).map((t) => t.word).join(' '))) {
      i++
      continue
    }
    // The whole run that matches first, then whether all of it is too ordinary to count.
    let j = i + COPY_RUN
    while (j < toks.length && check.runs.has(toks.slice(j - COPY_RUN + 1, j + 1).map((t) => t.word).join(' '))) j++
    if (ordinary(toks.slice(i, j).map((t) => t.word))) {
      i = j
      continue
    }
    const start = toks[i].start
    const end = toks[j - 1].end
    spans.push({ start, end, leak: { kind: 'copied', words: text.slice(start, end) } })
    i = j
  }
  return spans.sort((a, b) => a.start - b.start)
}

/** What leaks in `text`, each name or copied run once. */
export function findLeaks(text: string, check: SourceCheck): Leak[] {
  const seen = new Set<string>()
  const out: Leak[] = []
  for (const s of leakSpans(text, check)) {
    const key = `${s.leak.kind}:${s.leak.words}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s.leak)
  }
  return out
}

/** A line's sentences, each with what follows it, so joining them gives the line back. */
const sentences = (line: string): string[] => line.match(/[^.!?…]*[.!?…]+["'”’)\]]*\s*|[^.!?…]+$/gu) ?? [line]

/**
 * `text` with every sentence that names the story's people or places, or copies its words, taken out; a line
 * left with nothing (a list item, say) goes too. Says how many sentences went.
 */
export function scrubText(text: string, check: SourceCheck): { text: string; removed: number } {
  if (!findLeaks(text, check).length) return { text, removed: 0 }
  let removed = 0
  const lines: string[] = []
  for (const line of text.split('\n')) {
    if (!findLeaks(line, check).length) {
      lines.push(line)
      continue
    }
    const bullet = /^\s*(?:[-*•]|\d+[.)])\s+/.exec(line)?.[0] ?? ''
    const kept = sentences(line.slice(bullet.length)).filter((s) => {
      const bad = findLeaks(s, check).length > 0
      if (bad) removed++
      return !bad
    })
    const rest = kept.join('').trim()
    if (rest) lines.push(bullet + rest)
  }
  // Two blank lines where a paragraph went become one.
  const out = lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { text: out, removed }
}
