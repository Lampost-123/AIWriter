// The editor chat's tolerant matching of the words a model copies from a scene (chat overhaul E5/E6, lab switch
// ANCHOR). A model copies `find` (or a rewrite's `start` and `end`) with straight quotes for curly ones, spaces
// squashed or added, a line break for a space, wrapped in quotes, cut with an ellipsis, or a word off; today's tools
// turn all of those down (the free matcher measurement: 6 of 44 accepted). Here, in order, until something is found:
//   1. the words exactly (with or without the *asterisks* read_scene shows italics with);
//   2. the same with quotes, dashes, spacing and line breaks evened out (as the page's own matcher, findTextRange,
//      and Find and replace treat them), then also case;
//   3. the words unwrapped from quotes, without a leading or trailing ellipsis, and "A … B" as A, then B after it;
//   4. words that run across paragraphs are said to (an edit stays in one paragraph; a rewrite can take them);
//   5. last, fuzzy: a stretch of the paragraph with ≥ 85% of the words in order.
// Whatever is found is a range of the scene's plain text, so the proposal keeps the scene's EXACT words. Several
// matches are never guessed between (unless `occurrence` says which); nothing found comes back with the closest
// stretch, quoted exactly, so the model can call again with it. Pure, no database.

import type { ParaAnchor } from '@shared/contracts/ask'

/** A paragraph of a scene's plain text: [from, to). `n` is its number as read_scene shows it ([n]); 0 for a scene break. */
export interface Para {
  n: number
  pid: string | null
  from: number
  to: number
}

/** A scene's words as matched: its plain text and the same with *asterisks* around italics (agent.ts SceneWords). */
export interface MatchWords {
  plain: string
  marked: string
  toPlain: number[]
  toMarked: number[]
}

/** Every place `needle` starts in `hay` at or after `from` (overlapping ones too). */
export function occurrences(hay: string, needle: string, from = 0): number[] {
  const out: number[] = []
  if (!needle) return out
  for (let i = hay.indexOf(needle, from); i >= 0; i = hay.indexOf(needle, i + 1)) out.push(i)
  return out
}

/**
 * Where words the model copied are in a scene, as ranges of the plain text: copied with the italics' asterisks (as
 * read_scene shows them), as plain words, or with the asterisks left off. `from` is a place in the plain text.
 */
export function locate(w: MatchWords, needle: string, from = 0): [number, number][] {
  if (!needle) return []
  if (w.marked !== w.plain) {
    const hits = occurrences(w.marked, needle, w.toMarked[from]).map((at): [number, number] => [w.toPlain[at], w.toPlain[at + needle.length]])
    if (hits.length) return hits
  }
  const plain = occurrences(w.plain, needle, from).map((at): [number, number] => [at, at + needle.length])
  if (plain.length) return plain
  const bare = needle.replace(/\*/g, '')
  if (bare === needle || !bare.trim()) return []
  return occurrences(w.plain, bare, from).map((at): [number, number] => [at, at + bare.length])
}

/** A scene's paragraphs from its plain text alone (paragraphs a blank line apart), for a scene with no page to read. */
export function parasOfPlain(plain: string): Para[] {
  const out: Para[] = []
  let n = 0
  let at = 0
  for (const t of plain.split('\n\n')) {
    if (t.trim()) out.push({ n: t.trim() === '* * *' ? 0 : ++n, pid: null, from: at, to: at + t.length })
    at += t.length + 2
  }
  return out
}

/** The numbered paragraphs (scene breaks left out). */
export const numbered = (paras: Para[]): Para[] => paras.filter((p) => p.n > 0)

/** The paragraph a place in the plain text is in (a scene break's too), or null (between paragraphs). */
export const paraAt = (paras: Para[], at: number): Para | null => paras.find((p) => p.from <= at && at <= p.to) ?? null

/** Where a place in the plain text is, as a paragraph and an offset in it. */
export function anchorAt(paras: Para[], at: number): ParaAnchor | undefined {
  const p = paraAt(paras, at)
  return p && p.n > 0 ? { paragraph: p.n, pid: p.pid, offset: at - p.from } : undefined
}

// ---------- Evening the words out ----------

const QUOTE_FOLD: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '‛': "'",
  '′': "'",
  'ʼ': "'",
  '`': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '‟': '"',
  '″': '"',
  '«': '"',
  '»': '"'
}
const DASH = /[-‐‑‒–—―−]/

/**
 * Words evened out for matching: curly quotes straight, any dash (or "--") one hyphen with no space around it, an
 * ellipsis three dots, any run of white space (a line break too) one space, asterisks gone; lower case when asked.
 * `start[k]` and `end[k]`: the characters of the original that the k-th character stands for.
 */
export function evenOut(s: string, foldCase: boolean): { t: string; start: number[]; end: number[] } {
  let t = ''
  const start: number[] = []
  const end: number[] = []
  let space = -1
  let afterDash = false
  const push = (c: string, a: number, b: number): void => {
    t += c
    start.push(a)
    end.push(b)
  }
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '*') continue
    if (/\s/.test(ch)) {
      if (space < 0) space = i
      continue
    }
    if (DASH.test(ch)) {
      space = -1
      if (!afterDash) push('-', i, i + 1)
      else end[end.length - 1] = i + 1
      afterDash = true
      continue
    }
    if (space >= 0 && t && !afterDash) push(' ', space, i)
    space = -1
    afterDash = false
    if (ch === '…') {
      for (let k = 0; k < 3; k++) push('.', i, i + 1)
      continue
    }
    let c = QUOTE_FOLD[ch] ?? ch
    if (foldCase) {
      const lower = c.toLowerCase()
      if (lower.length === 1) c = lower
    }
    push(c, i, i + 1)
  }
  return { t, start, end }
}

// ---------- Finding ----------

export type How = 'exact' | 'evened' | 'case' | 'unwrapped' | 'ellipsis' | 'fuzzy'

export type Found =
  | { ok: true; from: number; to: number; para: Para; how: How; elsewhere?: boolean }
  | { ok: false; why: 'empty' }
  | { ok: false; why: 'no-paragraph'; count: number }
  | { ok: false; why: 'none'; near: { from: number; to: number; para: Para } | null }
  | { ok: false; why: 'many'; places: Para[]; count: number; occurrence?: number }
  | { ok: false; why: 'spans'; from: number; to: number; first: Para; last: Para }

export interface FindOptions {
  /** Look in this paragraph (its number, from 1) first. */
  paragraph?: number
  /** Of several matches (in the paragraph, when one is given), which one, from 1. */
  occurrence?: number
  /** Only at or after this place in the plain text (a rewrite's end, after its start). */
  after?: number
  /** Take the first match at or after `after` rather than asking which (a rewrite's end). */
  first?: boolean
}

type Range = [number, number]

/** A letter or digit: words inside longer words are matched last. */
const WORDY = /[\p{L}\p{N}]/u

/** The ways of reading the model's words, most faithful first: as given, unwrapped from quotes, without an ellipsis at either end. */
function readings(raw: string): { words: string; how: How | null }[] {
  // Paragraph numbers copied from read_scene ("[12] ") are never the scene's words.
  const given = raw.replace(/(^|\n)[ \t]*\[\d+\][ \t]*/g, '$1').trim()
  const out: { words: string; how: How | null }[] = [{ words: given, how: null }]
  const add = (w: string): void => {
    const t = w.trim()
    if (t && !out.some((o) => o.words === t)) out.push({ words: t, how: 'unwrapped' })
  }
  const unwrap = (w: string): string => {
    const m = /^["“'‘«]([\s\S]+)["”'’»]$/.exec(w.trim())
    return m ? m[1] : w
  }
  const trimDots = (w: string): string => w.trim().replace(/^(?:\.\.\.|…)\s*/, '').replace(/\s*(?:\.\.\.|…)$/, '')
  add(unwrap(given))
  add(trimDots(given))
  add(trimDots(unwrap(given)))
  add(unwrap(trimDots(given)))
  return out
}

/** Every place the words stand inside one paragraph of `scope`, evened out (and case folded when asked). */
function evenHits(plain: string, scope: Para[], words: string, foldCase: boolean, after: number): { r: Range; para: Para }[] {
  const want = evenOut(words, foldCase).t.trim()
  if (!want) return []
  const out: { r: Range; para: Para }[] = []
  for (const p of scope) {
    if (p.to <= after) continue
    const e = evenOut(plain.slice(p.from, p.to), foldCase)
    for (const i of occurrences(e.t, want)) {
      const from = p.from + e.start[i]
      if (from < after) continue
      out.push({ r: [from, p.from + e.end[i + want.length - 1]], para: p })
    }
  }
  return out
}

/** "A … B" (or "A...B"): A, then B after it in the same paragraph; the range runs from A's start to B's end. */
function ellipsisHits(plain: string, scope: Para[], words: string, after: number): { r: Range; para: Para }[] {
  const parts = words
    .split(/\s*(?:\.\.\.|…)\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length < 2) return []
  const out: { r: Range; para: Para }[] = []
  for (const fold of [false, true]) {
    for (const h of evenHits(plain, scope, parts[0], fold, after)) {
      let to = h.r[1]
      let ok = true
      for (const part of parts.slice(1)) {
        const next = evenHits(plain, [h.para], part, fold, to)[0]
        if (!next) {
          ok = false
          break
        }
        to = next.r[1]
      }
      if (ok) out.push({ r: [h.r[0], to], para: h.para })
    }
    if (out.length) break
  }
  return out
}

/** Words the model gave that run from one paragraph into the next (evened out, case aside): where, or null. */
function spanning(plain: string, paras: Para[], words: string, after: number): { r: Range; first: Para; last: Para } | null {
  const want = evenOut(words, true).t.trim()
  if (!want) return null
  // The paragraphs evened out and joined with a space, each character's paragraph kept.
  let t = ''
  const start: number[] = []
  const end: number[] = []
  const owner: Para[] = []
  for (const p of paras) {
    if (p.n === 0) continue
    const e = evenOut(plain.slice(p.from, p.to), true)
    if (t) {
      t += ' '
      start.push(p.from)
      end.push(p.from)
      owner.push(p)
    }
    t += e.t
    for (let k = 0; k < e.t.length; k++) {
      start.push(p.from + e.start[k])
      end.push(p.from + e.end[k])
      owner.push(p)
    }
  }
  for (const i of occurrences(t, want)) {
    const j = i + want.length - 1
    if (start[i] < after) continue
    if (owner[i] !== owner[j]) return { r: [start[i], end[j]], first: owner[i], last: owner[j] }
  }
  return null
}

// ---------- Fuzzy ----------

const TOKEN = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu
const tokens = (s: string): { w: string; a: number; b: number }[] =>
  [...s.matchAll(TOKEN)].map((m) => ({ w: m[0].toLowerCase().replace(/’/g, "'"), a: m.index ?? 0, b: (m.index ?? 0) + m[0].length }))

function lcs(a: string[], b: string[]): number {
  const row = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    let prev = 0
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j]
      row[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(row[j], row[j - 1])
      prev = keep
    }
  }
  return row[b.length]
}

/** The share of words in order a fuzzy match needs. */
export const FUZZY = 0.85
/** The least share of words in order for a stretch to be offered as "did you mean". */
const NEAR = 0.4
const OPENERS = /[“"‘'([«]/
const CLOSERS = /[.,;:!?…’'”")\]»]/

/**
 * Stretches of the paragraphs with most of the model's words in order: each window of about as many words, scored by
 * the words in order it shares over the longer of the two. The range takes in quotes and punctuation stuck to its
 * first and last words.
 */
function fuzzyHits(plain: string, scope: Para[], words: string, after: number): { r: Range; para: Para; score: number }[] {
  const want = tokens(words)
    .map((t) => t.w)
    .slice(0, 80)
  const n = want.length
  if (n < 3) return []
  const firsts = new Set(want.slice(0, 3))
  const out: { r: Range; para: Para; score: number }[] = []
  for (const p of scope) {
    if (p.to <= after) continue
    const toks = tokens(plain.slice(p.from, p.to))
    for (let i = 0; i < toks.length; i++) {
      if (!firsts.has(toks[i].w) || p.from + toks[i].a < after) continue
      let best: { len: number; score: number; ends: boolean } | null = null
      for (let len = Math.max(1, n - 2); len <= n + 2 && i + len <= toks.length; len++) {
        const score = lcs(
          want,
          toks.slice(i, i + len).map((t) => t.w)
        ) / Math.max(n, len)
        // Of windows scoring the same, the one ending on the model's last word, then the one nearest its length.
        const ends = toks[i + len - 1].w === want[n - 1]
        const better =
          !best ||
          score > best.score ||
          (score === best.score && ends && !best.ends) ||
          (score === best.score && ends === best.ends && Math.abs(len - n) < Math.abs(best.len - n))
        if (better) best = { len, score, ends }
      }
      if (!best) continue
      let from = p.from + toks[i].a
      let to = p.from + toks[i + best.len - 1].b
      while (from > p.from && OPENERS.test(plain[from - 1])) from--
      while (to < p.to && CLOSERS.test(plain[to])) to++
      out.push({ r: [from, to], para: p, score: best.score })
    }
  }
  // The best of overlapping windows only.
  out.sort((a, b) => b.score - a.score || a.r[0] - b.r[0])
  const kept: typeof out = []
  for (const h of out) if (!kept.some((k) => k.r[0] < h.r[1] && h.r[0] < k.r[1])) kept.push(h)
  return kept
}

/**
 * Where the model's words are in the scene, for a proposal: see the top of this file. `paras` are the scene's
 * paragraphs (a scene break's too).
 */
export function findWords(w: MatchWords, paras: Para[], raw: string, o: FindOptions = {}): Found {
  const plain = w.plain
  const after = o.after ?? 0
  const all = numbered(paras)
  if (!raw.trim()) return { ok: false, why: 'empty' }
  let scope = all
  if (o.paragraph != null) {
    const p = all.find((x) => x.n === o.paragraph)
    if (!p) return { ok: false, why: 'no-paragraph', count: all.length }
    scope = [p]
  }
  const inScope = (r: Range, s: Para[]): Para | null => s.find((p) => p.from <= r[0] && r[1] <= p.to) ?? null
  /** One of several matches: the one asked for, the first (a rewrite's end), or none (which is asked about). */
  const pick = (found: { r: Range; para: Para }[], how: How, elsewhere: boolean): Found | null => {
    if (!found.length) return null
    // Whole words before words inside longer ones ("the" in "other"), when there are any.
    const whole = found.filter((h) => !(WORDY.test(plain[h.r[0]] ?? '') && WORDY.test(plain[h.r[0] - 1] ?? '')) && !(WORDY.test(plain[h.r[1] - 1] ?? '') && WORDY.test(plain[h.r[1]] ?? '')))
    const hits = whole.length ? whole : found
    const sorted = [...hits].sort((a, b) => a.r[0] - b.r[0])
    const at = (h: { r: Range; para: Para }): Found => ({ ok: true, from: h.r[0], to: h.r[1], para: h.para, how, ...(elsewhere ? { elsewhere } : {}) })
    if (sorted.length === 1 || o.first) return at(sorted[0])
    if (o.occurrence != null && o.occurrence >= 1 && o.occurrence <= sorted.length) return at(sorted[o.occurrence - 1])
    const places = [...new Set(sorted.map((h) => h.para))]
    return { ok: false, why: 'many', places, count: sorted.length, ...(o.occurrence != null ? { occurrence: o.occurrence } : {}) }
  }
  const strict = (s: Para[], elsewhere: boolean): Found | null => {
    for (const { words, how } of readings(raw)) {
      const exact = locate(w, words, after)
        .map((r) => ({ r, para: inScope(r, s) }))
        .filter((h): h is { r: Range; para: Para } => !!h.para)
      const found =
        pick(exact, how ?? 'exact', elsewhere) ??
        pick(evenHits(plain, s, words, false, after), how ?? 'evened', elsewhere) ??
        pick(evenHits(plain, s, words, true, after), how ?? 'case', elsewhere)
      if (found) return found
    }
    for (const { words } of readings(raw)) {
      const found = pick(ellipsisHits(plain, s, words, after), 'ellipsis', elsewhere)
      if (found) return found
    }
    return null
  }
  const found = strict(scope, false) ?? (scope !== all ? strict(all, true) : null)
  if (found) return found
  for (const { words } of readings(raw)) {
    const sp = spanning(plain, paras, words, after)
    if (sp) return { ok: false, why: 'spans', from: sp.r[0], to: sp.r[1], first: sp.first, last: sp.last }
  }
  const words = readings(raw)[0].words
  let fuzzy = fuzzyHits(plain, scope, words, after)
  let elsewhere = false
  if (!fuzzy.some((h) => h.score >= FUZZY) && scope !== all) {
    const wide = fuzzyHits(plain, all, words, after)
    if (wide.some((h) => h.score >= FUZZY)) {
      fuzzy = wide
      elsewhere = true
    }
  }
  const strong = fuzzy.filter((h) => h.score >= FUZZY)
  const chosen = pick(strong, 'fuzzy', elsewhere)
  if (chosen) {
    // Of several, the best one when it is clearly the best (a rewrite's end takes the first anyway).
    if (!chosen.ok && chosen.why === 'many' && o.occurrence == null && strong[0].score > (strong[1]?.score ?? 0) + 0.1) {
      return { ok: true, from: strong[0].r[0], to: strong[0].r[1], para: strong[0].para, how: 'fuzzy', ...(elsewhere ? { elsewhere } : {}) }
    }
    return chosen
  }
  const near = fuzzy.find((h) => h.score >= NEAR)
  return { ok: false, why: 'none', near: near ? { from: near.r[0], to: near.r[1], para: near.para } : null }
}

// ---------- Where the page will look ----------

const PAGE_QUOTES: Record<string, string> = { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-' }

/** As the page evens words out (renderer features/editor/findText.ts normalise): lower case, its quotes and dashes, spacing. */
function pageNorm(text: string): { t: string; map: number[] } {
  let t = ''
  const map: number[] = []
  let space = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (/\s/.test(ch)) {
      if (!space && t) {
        t += ' '
        map.push(i)
      }
      space = true
      continue
    }
    space = false
    t += (PAGE_QUOTES[ch] ?? ch).toLowerCase()
    map.push(i)
  }
  if (t.endsWith(' ')) {
    t = t.slice(0, -1)
    map.pop()
  }
  return { t, map }
}

/**
 * Where the page will find words first, as a place in the plain text (paragraph by paragraph, at or after `after`,
 * as findTextRange / findTextRangeAfter do), or null.
 */
export function pageFinds(plain: string, paras: Para[], words: string, after = 0): number | null {
  const want = pageNorm(words).t
  if (!want) return null
  for (const p of paras) {
    if (p.n === 0 || p.to <= after) continue
    const { t, map } = pageNorm(plain.slice(p.from, p.to))
    for (let i = t.indexOf(want); i >= 0; i = t.indexOf(want, i + 1)) {
      if (p.from + map[i] >= after) return p.from + map[i]
    }
  }
  return null
}

/** The start of the word before `at` in the paragraph (white space skipped), or null at its start. */
export function wordBefore(plain: string, p: Para, at: number): number | null {
  let i = at
  while (i > p.from && /\s/.test(plain[i - 1])) i--
  if (i <= p.from) return null
  while (i > p.from && !/\s/.test(plain[i - 1])) i--
  return i
}

/** The end of the word after `at` in the paragraph (white space skipped), or null at its end. */
export function wordAfter(plain: string, p: Para, at: number): number | null {
  let i = at
  while (i < p.to && /\s/.test(plain[i])) i++
  if (i >= p.to) return null
  while (i < p.to && !/\s/.test(plain[i])) i++
  return i
}
