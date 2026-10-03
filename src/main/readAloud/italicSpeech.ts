// Speech set in italics rather than quote marks (Adam, 2026-10-04: a character that is a ring talks like this:
// *Go on,* said the ring. *Take the floor, boy.*). Reading aloud finds dialogue by its quote marks, so a paragraph's
// italic speech is given them before it is planned or marked: an italic stretch is speech when a dialogue tag sits
// right beside it ("said the ring", "the ring said:"), and every later italic stretch of a few words in that paragraph
// is too (the same speaker carrying on). A word in italics for stress, or a thought ("she thought"), stays narration.
// The quote marks are only for reading aloud: `back` puts a place in the marked text back where it is on the page.
// No Electron imports.

import type { ReadParagraph } from '@shared/contracts/readAloud'
import { VERBS } from './cast'

const END = '(?![\\p{L}\\p{N}])'
const WORD = "[\\p{L}\\p{N}][\\p{L}\\p{N}’'-]*"
/** A tag after the speech: "said the ring", "the ring said", "she whispered". */
const TAG_AFTER = new RegExp(
  `^\\s*,?\\s*(?:(?:${VERBS})${END}\\s+${WORD}|(?:${WORD}\\s+){0,3}${WORD}\\s+(?:${VERBS})${END})`,
  'iu'
)
/** A tag before the speech, ending its sentence's lead-in: "The ring said, ", "Then the ring whispered: ". */
const TAG_BEFORE = new RegExp(`(?:^|[.!?…]\\s+)(?:${WORD}\\s+){0,4}(?:${VERBS})${END}[^.!?"“”]{0,30}[,:]\\s*$`, 'iu')

/** The italic stretches of a paragraph that are speech, [from, to) in its text, trimmed of spaces. */
export function speechSpans(text: string, italics: readonly [number, number][] | undefined): [number, number][] {
  const out: [number, number][] = []
  let speaking = false
  for (const [a, b] of [...(italics ?? [])].sort((x, y) => x[0] - y[0])) {
    let from = Math.max(0, a)
    let to = Math.min(text.length, b)
    while (from < to && /\s/.test(text[from])) from++
    while (to > from && /\s/.test(text[to - 1])) to--
    const words = text.slice(from, to)
    if (!/[\p{L}\p{N}]/u.test(words) || words.includes('\n')) continue
    // Already inside quote marks: it is a quote anyway.
    const before = text.slice(0, from)
    const count = (re: RegExp): number => before.match(re)?.length ?? 0
    if (count(/“/g) > count(/”/g) || count(/"/g) % 2 === 1) continue
    const several = words.trim().split(/\s+/).length >= 2
    // Speech before a tag ends with its own punctuation ("Go on," said); a stressed word doesn't.
    const tagged = (/[,.!?…—–-]["”’]?$/.test(words) && TAG_AFTER.test(text.slice(to, to + 60))) || TAG_BEFORE.test(before.slice(-120))
    if (tagged || (speaking && several)) {
      out.push([from, to])
      speaking = true
    }
  }
  return out
}

export interface Spoken {
  /** The paragraph with its italic speech in quote marks, and those stretches no longer counted as italics. */
  para: ReadParagraph
  /** A place in `para.text` as a place in the page's text. */
  back(pos: number): number
  /** A place in the page's text as a place in `para.text`. */
  forward(pos: number): number
}

/** A paragraph as reading aloud reads it: italic speech given quote marks. Unchanged when it has none. */
export function asSpoken(p: ReadParagraph): Spoken {
  const spans = speechSpans(p.text, p.italics)
  if (!spans.length) return { para: p, back: (n) => n, forward: (n) => n }
  // Where each mark goes, in the page's text: an opening mark before `from`, a closing one after `to`.
  const marks: { at: number; ch: string }[] = spans.flatMap(([from, to]) => [
    { at: from, ch: '“' },
    { at: to, ch: '”' }
  ])
  let text = ''
  let last = 0
  for (const m of marks) {
    text += p.text.slice(last, m.at) + m.ch
    last = m.at
  }
  text += p.text.slice(last)
  // Marks before (or at) a place in the page's text push it on by one each.
  const forward = (n: number): number => n + marks.filter((m) => m.at <= n).length
  // Each mark sits at its page place plus the marks before it.
  const placed = marks.map((m, k) => m.at + k)
  const back = (n: number): number => n - placed.filter((t) => t < n).length
  const inSpeech = (a: number, b: number): boolean => spans.some(([f, t]) => a < t && f < b)
  const italics = (p.italics ?? []).filter(([a, b]) => !inSpeech(a, b)).map(([a, b]): [number, number] => [forward(a), forward(b)])
  return { para: { ...p, text, ...(italics.length ? { italics } : { italics: undefined }) }, back, forward }
}
