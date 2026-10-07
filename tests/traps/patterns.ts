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

/** The first sentence that breaks the truth (and isn't excused), or null. */
export function firstBreak(p: Pick<PatternCheck, 'broken' | 'not' | 'unlessBefore'>, text: string, from = 0): Sentence | null {
  const broken = once(p.broken)
  const not = p.not ? once(p.not) : null
  const unless = p.unlessBefore ? once(p.unlessBefore) : null
  for (const s of sentences(text)) {
    if (s.start < from) continue
    if (!broken.test(s.text) || not?.test(s.text)) continue
    if (unless?.test(text.slice(0, s.start))) continue
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

/** The first sentence matching all of `all` (and none of `none`), for finding where a planted event happens. */
export function findSentence(text: string, all: RegExp[], none: RegExp[] = []): Sentence | null {
  return sentences(text).find((s) => all.every((r) => once(r).test(s.text)) && !none.some((r) => once(r).test(s.text))) ?? null
}
