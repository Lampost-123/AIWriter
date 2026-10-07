// Deterministic checks, sentence by sentence: no model, so they never misread a passage the way a judge can (story
// version 2's B2 counted Tobin as never coming down although every passage had him on the stairs). Used to score
// passages (a broken claim, a kept one, or not touched) and, while the story is written, to make sure each scene keeps
// to what earlier scenes made true. Pure.

export interface PatternCheck {
  id: string
  trap: string
  /** What it checks, in plain words (shown in the report). */
  what: string
  /** A sentence that matches breaks the truth... */
  broken: RegExp
  /** ...unless the same sentence also matches this (a mention that isn't a slip: "the compass she no longer had"). */
  not?: RegExp
  /** ...or this matches anywhere earlier in the passage (the change shown on the page: "Bryn came back in"). */
  unlessBefore?: RegExp
  /**
   * Only what the narration says counts, not what someone says aloud: words inside quotation marks are left out before
   * `broken` is tried ("'Bryn said it wasn't hers to know,'" is Ash reporting her, not Bryn speaking).
   */
  outsideQuotes?: boolean
  /** The passage touches the subject at all (else the check is "not touched", not "kept"). */
  touches: RegExp
}

export interface Sentence {
  text: string
  start: number
}

/** The passage's sentences (a line break ends one too), with where each starts. */
export function sentences(text: string): Sentence[] {
  const out: Sentence[] = []
  for (const m of text.matchAll(/[^.!?\n]+(?:[.!?]+["'”’)\]]*|\n|$)/g)) {
    const t = m[0].trim()
    if (t) out.push({ text: t, start: m.index ?? 0 })
  }
  return out
}

const once = (r: RegExp): RegExp => new RegExp(r.source, r.flags.replace('g', ''))

const isLetter = (c: string | undefined): boolean => !!c && /[\p{L}\p{N}]/u.test(c)

/**
 * The text with what is said aloud blanked out (kept the same length): words between quotation marks, curly or
 * straight, double or single. A single straight or curly apostrophe inside a word ("wasn't", "Bryn's") is not a quote.
 */
export function outsideQuotes(text: string): string {
  let out = ''
  let open: string | null = null
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const before = text[i - 1]
    const after = text[i + 1]
    if (!open) {
      const opens = c === '“' || c === '"' || ((c === '‘' || c === "'") && !isLetter(before))
      if (opens) {
        open = c === '“' ? '”' : c === '‘' ? '’' : c
        out += ' '
        continue
      }
      out += c
      continue
    }
    // Speech running on into the next paragraph opens again there: a quote never outlasts its paragraph.
    if (c === '\n') {
      open = null
      out += c
      continue
    }
    const closes = open === '”' || open === '"' ? c === open || (open === '”' && c === '"') : (c === open || (open === '’' && c === "'")) && !isLetter(after)
    if (closes) open = null
    out += ' '
  }
  return out
}

/** The first sentence that breaks the truth (and isn't excused), or null. */
export function firstBreak(p: Pick<PatternCheck, 'broken' | 'not' | 'unlessBefore' | 'outsideQuotes'>, text: string, from = 0): Sentence | null {
  const broken = once(p.broken)
  const not = p.not ? once(p.not) : null
  const unless = p.unlessBefore ? once(p.unlessBefore) : null
  // Quotation marks can span sentences: blank out what is said in the whole text first.
  const narration = p.outsideQuotes ? outsideQuotes(text) : text
  for (const s of sentences(text)) {
    if (s.start < from) continue
    const tried = p.outsideQuotes ? narration.slice(s.start, s.start + s.text.length) : s.text
    const m = broken.exec(tried)
    if (!m || not?.test(s.text)) continue
    // The change shown earlier in the passage, or earlier in this very sentence ("the bar lifting ... while he came in").
    if (unless?.test(text.slice(0, s.start + m.index))) continue
    return s
  }
  return null
}

/** One check's verdict on a passage: broken (with the sentence), kept (touched and not broken) or silent. */
export function patternVerdict(p: PatternCheck, text: string): { verdict: 'broken' | 'kept' | 'silent'; quote: string } {
  const b = firstBreak(p, text)
  if (b) return { verdict: 'broken', quote: b.text }
  const touched = sentences(text).find((s) => once(p.touches).test(s.text))
  return touched ? { verdict: 'kept', quote: touched.text } : { verdict: 'silent', quote: '' }
}

/** Where something happens in a scene: its paragraph, where that starts in the joined text, and its words. */
export interface Place {
  paragraph: number
  start: number
  end: number
  quote: string
}

/**
 * The first paragraph where all of `all` match (and none of `none`), for finding where a planted event happens: a whole
 * paragraph, since a writer often spreads one event over a few sentences ("She got the bead out of her pocket. ... She
 * put it in Pell's hand."). The quote is that paragraph's sentences that match any of `all`. `paragraphs` are joined
 * with a blank line, as the scene's text is.
 */
export function findPlace(paragraphs: string[], all: RegExp[], none: RegExp[] = []): Place | null {
  let start = 0
  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i]
    if (all.every((r) => once(r).test(para)) && !none.some((r) => once(r).test(para))) {
      const quote = sentences(para)
        .filter((x) => all.some((r) => once(r).test(x.text)))
        .map((x) => x.text)
        .join(' ')
      return { paragraph: i, start, end: start + para.length, quote: quote || para }
    }
    start += para.length + 2
  }
  return null
}

/** The first sentence matching all of `all` (and none of `none`), for finding where a planted event happens. */
export function findSentence(text: string, all: RegExp[], none: RegExp[] = []): Sentence | null {
  return sentences(text).find((s) => all.every((r) => once(r).test(s.text)) && !none.some((r) => once(r).test(s.text))) ?? null
}
