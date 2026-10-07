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

/** Where an event spread over neighbouring paragraphs happens: `paragraph` is the first of them, `last` the last. */
export interface SpreadPlace extends Place {
  last: number
}

/**
 * Like `findPlace`, but an event may be spread over up to `span` neighbouring paragraphs: a writer names Ash once and
 * says "he" after ("'I'll see to the horses,' he said." ... "He pulled his collar up and went out", round 7). The
 * event is placed where it is first complete: the earliest paragraph that ends a run of one, two or three (fewest first)
 * in which each of `all` matches one paragraph, and none of `none` any. `also` says a paragraph counts as matching a
 * pattern it doesn't (a person's name, where a pronoun stands for them: `refersTo`).
 */
export function findAcross(
  paragraphs: string[],
  all: RegExp[],
  none: RegExp[] = [],
  span = 3,
  also: (paragraph: number, pattern: RegExp) => boolean = () => false
): SpreadPlace | null {
  const starts: number[] = []
  let at = 0
  for (const p of paragraphs) {
    starts.push(at)
    at += p.length + 2
  }
  for (let end = 0; end < paragraphs.length; end++) {
    for (let size = 1; size <= Math.max(1, span) && size <= end + 1; size++) {
      const i = end - size + 1
      const window = paragraphs.slice(i, i + size)
      if (!all.every((r) => window.some((p, k) => once(r).test(p) || also(i + k, r))) || window.some((p) => none.some((r) => once(r).test(p)))) continue
      const quote = window
        .flatMap((p) => sentences(p))
        .filter((x) => all.some((r) => once(r).test(x.text)))
        .map((x) => x.text)
        .join(' ')
      const last = i + size - 1
      return { paragraph: i, last, start: starts[i], end: starts[last] + paragraphs[last].length, quote: quote || window.join(' ') }
    }
  }
  return null
}

/** Someone named, the pronouns that stand for them, and the names of others the same pronouns could stand for. */
export interface Referent {
  name: RegExp
  pronoun: RegExp
  others: RegExp
  /** The pronoun stands for them before anyone is named (the point-of-view character). */
  assumed?: boolean
}

/**
 * For each paragraph, whether it speaks of someone: by name, or by a pronoun in the narration (outside speech) when they
 * were the last of `name` and `others` named in the narration before it ("Ash got up. ... 'I know,' he said, and went
 * out", round 7). Names said aloud aren't tracked: in "'Cinder wants rubbing down,' he said" the "he" is still Ash.
 */
export function refersTo(paragraphs: string[], who: Referent): boolean[] {
  const all = (r: RegExp): RegExp => new RegExp(r.source, r.flags.includes('g') ? r.flags : `${r.flags}g`)
  let last: 'them' | 'other' | null = who.assumed ? 'them' : null
  return paragraphs.map((p) => {
    const narration = outsideQuotes(p)
    const seen: { at: number; kind: 'them' | 'other' | 'pronoun' }[] = []
    for (const [r, kind] of [
      [who.name, 'them'],
      [who.others, 'other'],
      [who.pronoun, 'pronoun']
    ] as const)
      for (const m of narration.matchAll(all(r))) seen.push({ at: m.index ?? 0, kind })
    seen.sort((a, b) => a.at - b.at)
    let hit = once(who.name).test(p)
    for (const e of seen) {
      if (e.kind === 'pronoun') hit ||= last === 'them'
      else last = e.kind
    }
    return hit
  })
}

/** The first sentence matching all of `all` (and none of `none`), for finding where a planted event happens. */
export function findSentence(text: string, all: RegExp[], none: RegExp[] = []): Sentence | null {
  return sentences(text).find((s) => all.every((r) => once(r).test(s.text)) && !none.some((r) => once(r).test(s.text))) ?? null
}
