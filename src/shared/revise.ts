// "Keep this, change that" (Change it…, 2026-10-19): the sentences of a passage, for Adam to mark the ones to keep, and
// the check that each kept sentence came back word for word in the revised passage, putting back any the AI changed or
// left out. Both sides use it: the window to show the sentences and check the reply, the main process to tidy what it is
// sent. Pure, so it is unit-tested (revise.test.ts).
//
// A passage is written as the AI is sent the page's words: paragraphs between blank lines, *italics*, a scene break as
// "* * *". "Word for word" allows only for spacing and the shape of quotation marks and apostrophes.

/** One sentence of a passage: its words exactly as they are there, and where they are. */
export interface Sentence {
  text: string
  start: number
  end: number
}

/** A scene break line ("* * *", "***", "#"). */
const BREAK_LINE = /^\s*(?:\*\s*){3,}\s*$|^\s*#\s*$/

/** Words that end with a full stop without ending a sentence. */
const ABBREVIATIONS = new Set(['mr', 'mrs', 'ms', 'dr', 'st', 'mt', 'sr', 'jr', 'prof', 'capt', 'col', 'gen', 'lt', 'sgt', 'rev', 'fr', 'vs', 'etc', 'e.g', 'i.e'])

/** Where each paragraph of a text starts and ends (blank lines between them). */
function paragraphSpans(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  const re = /\n[ \t]*\n\s*/g
  let start = 0
  for (;;) {
    const m = re.exec(text)
    const end = m ? m.index : text.length
    const lead = text.slice(start, end).match(/^\s*/)![0].length
    const trail = text.slice(start, end).match(/\s*$/)![0].length
    if (end - trail > start + lead) out.push({ start: start + lead, end: end - trail })
    if (!m) break
    start = m.index + m[0].length
  }
  return out
}

/**
 * The sentences of a passage, paragraph by paragraph (a scene break has none). A sentence ends at . ! ? or … (with any
 * closing quotation marks, brackets or asterisks after it) where the next word starts a new sentence: a capital, a digit
 * or an opening quotation mark, so "“Go!” she said." stays one, as does "Mr. Hale".
 */
export function sentencesOf(passage: string): Sentence[][] {
  const out: Sentence[][] = []
  for (const p of paragraphSpans(passage)) {
    const para = passage.slice(p.start, p.end)
    if (BREAK_LINE.test(para)) continue
    const list: Sentence[] = []
    const end = /[.!?…]+["'”’)\]*_]*(?=\s+(\S))/gu
    let from = 0
    for (;;) {
      const m = end.exec(para)
      if (!m) break
      const next = m[1] ?? ''
      const stop = m.index + m[0].length
      const word = para.slice(0, m.index).match(/([\p{L}.]+)$/u)?.[1]?.toLowerCase() ?? ''
      const startsNew = /[\p{Lu}\p{N}"“‘'«(*_—–-]/u.test(next)
      if (!startsNew || (m[0].startsWith('.') && m[0].length === 1 && ABBREVIATIONS.has(word))) continue
      push(list, passage, p.start + from, p.start + stop)
      from = stop
    }
    push(list, passage, p.start + from, p.end)
    if (list.length) out.push(list)
  }
  return out
}

function push(list: Sentence[], text: string, start: number, end: number): void {
  const piece = text.slice(start, end)
  const lead = piece.match(/^\s*/)![0].length
  const trail = piece.match(/\s*$/)![0].length
  const s = start + lead
  const e = end - trail
  if (e > s) list.push({ text: text.slice(s, e), start: s, end: e })
}

/** A text as "word for word" compares it: spacing, and the shapes of quotation marks and apostrophes, don't count. */
export const keepKey = (s: string): string =>
  s
    .replace(/[“”„«»]/g, '"')
    .replace(/[‘’‚]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

/** True when `text` has the sentence in it word for word. */
export const hasSentence = (text: string, sentence: string): boolean => {
  const k = keepKey(sentence)
  return !!k && keepKey(text).includes(k)
}

/**
 * The kept sentences that are in the passage, once each, in the order the passage has them (a sentence no longer in it,
 * after the passage changed, is left out).
 */
export function keepsIn(passage: string, keeps: readonly string[]): string[] {
  const text = keepKey(passage)
  const seen = new Set<string>()
  const found: { s: string; at: number }[] = []
  for (const raw of keeps) {
    const k = keepKey(raw)
    if (!k || seen.has(k)) continue
    const at = text.indexOf(k)
    if (at < 0) continue
    seen.add(k)
    found.push({ s: raw.trim(), at })
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.s)
}

/** The kept sentences the revised passage doesn't have word for word. */
export const missingKeeps = (revised: string, keeps: readonly string[]): string[] => keeps.filter((k) => !hasSentence(revised, k))

const words = (s: string): string[] => (s.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).map((w) => w.replace(/'/g, ''))

/** How alike two sentences are in their words (0 to 1). */
export function likeness(a: string, b: string): number {
  const wa = words(a)
  const wb = words(b)
  if (!wa.length || !wb.length) return 0
  const count = new Map<string, number>()
  for (const w of wb) count.set(w, (count.get(w) ?? 0) + 1)
  let shared = 0
  for (const w of wa) {
    const n = count.get(w) ?? 0
    if (n > 0) {
      shared++
      count.set(w, n - 1)
    }
  }
  return (2 * shared) / (wa.length + wb.length)
}

/** A changed sentence at least this alike to a kept one is taken for it, and the kept one put back in its place. */
export const LIKENESS_TO_SWAP = 0.5

export interface KeptCheck {
  /** The revised passage with every kept sentence in it word for word (as far as could be). */
  text: string
  /** How many kept sentences were put back (the AI had changed them, or left them out). */
  restored: number
  /** Kept sentences that couldn't be put back anywhere that makes sense. */
  missing: string[]
}

/**
 * Makes sure each kept sentence is in the revised passage word for word. One the AI reworded goes back in place of the
 * sentence most like it; one it left out goes back after the kept sentence before it (or before the one after it); one
 * with neither stays out, and is said to be missing. `keeps` in the order the passage had them (keepsIn).
 */
export function restoreKeeps(revised: string, keeps: readonly string[]): KeptCheck {
  let text = revised
  let restored = 0
  const missing: string[] = []
  /** The kept sentences already in their place: none of them is ever taken for another. */
  const placed = new Set<string>()
  for (const k of keeps) if (hasSentence(text, k)) placed.add(keepKey(k))
  keeps.forEach((k, i) => {
    if (hasSentence(text, k)) return
    const all = sentencesOf(text).flat()
    const free = all.filter((s) => ![...placed].some((p) => keepKey(s.text).includes(p)))
    let best: Sentence | null = null
    let score = 0
    for (const s of free) {
      const l = likeness(k, s.text)
      if (l > score) {
        best = s
        score = l
      }
    }
    if (best && score >= LIKENESS_TO_SWAP) {
      text = text.slice(0, best.start) + k.trim() + text.slice(best.end)
    } else {
      const before = keeps.slice(0, i).reverse().find((p) => hasSentence(text, p))
      const after = keeps.slice(i + 1).find((p) => hasSentence(text, p))
      const anchor = before ? sentenceHolding(all, before) : after ? sentenceHolding(all, after) : null
      if (!anchor) {
        missing.push(k)
        return
      }
      text = before ? `${text.slice(0, anchor.end)} ${k.trim()}${text.slice(anchor.end)}` : `${text.slice(0, anchor.start)}${k.trim()} ${text.slice(anchor.start)}`
    }
    placed.add(keepKey(k))
    restored++
  })
  return { text, restored, missing }
}

/** The sentence of the text holding a kept sentence (the last of them, when it runs over more than one). */
function sentenceHolding(all: Sentence[], kept: string): Sentence | null {
  const k = keepKey(kept)
  const first = keepKey(sentencesOf(kept).flat()[0]?.text ?? kept)
  const whole = all.find((s) => keepKey(s.text).includes(k))
  if (whole) return whole
  // A kept sentence the splitter reads as two: from its first part to where it ends.
  const i = all.findIndex((s) => keepKey(s.text).startsWith(first) || first.startsWith(keepKey(s.text)))
  if (i < 0) return null
  let end = i
  while (end + 1 < all.length && !keepKey(all.slice(i, end + 1).map((s) => s.text).join(' ')).includes(k)) end++
  return { text: '', start: all[i].start, end: all[end].end }
}
