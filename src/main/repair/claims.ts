// Reading the memory model's claims about new words, and judging each one (check and repair, step 3). Pure.
//
// The model lists the claims the new words make, each with its quote, the line it touches and its verdict. The app
// then takes them one at a time and keeps only what it can stand behind:
//   - a claim whose quote isn't in the new words (the AI's own words that just landed) is dropped: every flag quotes
//     words that are really there;
//   - a claim about a line that doesn't exist is dropped: there is nothing to compare it with;
//   - only "slip" counts. A slip is mended in place only when the line it breaks is on the stage with the story's own
//     words for it (never a value with no words behind it, nor one from the memory's notes), the fix changes a few of
//     the AI's own words (at most a dozen, inside or overlapping the quote, in one paragraph, written in the record of
//     the AI's words), and it doesn't overlap another fix. Anything else is asked as one question.

import { findSceneQuote, plainQuote } from '../checks/quote'
import { parseLenient, str } from '../keeper/json'
import { plain, wordCount } from '../keeper/text'
import type { LandedParagraph } from '@shared/contracts/repair'
import type { CodexLine, StageLine } from './prompts'

export const ABOUT = ['where', 'posture', 'wearing', 'holding', 'condition', 'knows', 'owns', 'time'] as const
export type About = (typeof ABOUT)[number]

export interface Claim {
  quote: string
  who: string
  about: About | 'other'
  line: string
  verdict: 'fits' | 'shown' | 'slip'
  why: string
  fix: { replace: string; with: string } | null
  question: string
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** The claims in a reply, or null when it can't be read at all. */
export function readClaims(reply: string): Claim[] | null {
  const parsed = parseLenient(reply)
  if (!parsed.ok) return null
  const v = parsed.value
  const list = Array.isArray(v) ? v : isObj(v) ? (v.claims ?? v.issues ?? null) : null
  if (list === null) return isObj(v) && 'claims' in v ? [] : null
  if (!Array.isArray(list)) return null
  return list.filter(isObj).map((c) => {
    const about = str(c.about, 20).toLowerCase()
    const verdict = str(c.verdict, 10).toLowerCase()
    const fix = isObj(c.fix) ? { replace: typeof c.fix.replace === 'string' ? c.fix.replace : '', with: typeof c.fix.with === 'string' ? c.fix.with : '' } : null
    return {
      quote: typeof c.quote === 'string' ? c.quote.trim().slice(0, 600) : '',
      who: str(c.who, 80),
      about: (ABOUT as readonly string[]).includes(about) ? (about as About) : 'other',
      line: str(c.line, 12).toUpperCase().replace(/[^A-Z0-9]/g, ''),
      verdict: verdict === 'slip' ? 'slip' : verdict === 'shown' ? 'shown' : 'fits',
      why: str(c.why, 400),
      fix: fix && fix.replace.trim() ? fix : null,
      question: str(c.question, 400)
    }
  })
}

/** The new words as the model read them: the AI's part of each paragraph, a blank line between. */
export function newWordsOf(paragraphs: LandedParagraph[]): string {
  return paragraphs.map((p) => p.text.slice(p.from, p.to)).join('\n\n')
}

/** Where a place in the new words is: the paragraph and the character in its whole text. Null on a paragraph's gap. */
function placeOf(paragraphs: LandedParagraph[], at: number): { para: number; offset: number } | null {
  let start = 0
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i]
    const len = p.to - p.from
    if (at >= start && at <= start + len) return { para: i, offset: p.from + (at - start) }
    start += len + 2
  }
  return null
}

/** The most words a fix may change, and how many more words it may put in their place. */
export const FIX_MOST_WORDS = 12
const FIX_MORE_WORDS = 6

/** A slip mended in place: in paragraph `para`, `start` to `end` (`was`) becomes `now`. */
export interface FoundFix {
  para: number
  start: number
  end: number
  was: string
  now: string
  claim: Claim
  /** The claim's quote as it stands in the new words. */
  quote: string
}

/** A slip that needs Adam's choice: one question, on the claim's own words. */
export interface FoundQuestion {
  /** The new words it is about, exactly as they stand. */
  quote: string
  /** Which of those words' appearances in the new words it is (0 for the first). */
  start: number
  message: string
  /** A rewrite of `quote` that would mend it, when there is one ("Review the fix"). */
  fix: string | null
  claim: Claim
}

export interface Judged {
  fixes: FoundFix[]
  questions: FoundQuestion[]
  /** Claims kept (their quote is in the new words and their line exists), and how many were slips. */
  claims: number
  slips: number
}

/** A sentence ending in a question, from the model's question or, failing that, its reason. */
export function questionOf(c: Pick<Claim, 'question' | 'why'>): string {
  const q = c.question.trim()
  if (q) return /[?]["”’']?$/.test(q) ? q : `${q}?`
  const why = c.why.trim().replace(/\s*$/, '')
  return `${why ? `${/[.!?]["”’']?$/.test(why) ? why : `${why}.`} ` : ''}Change it, or keep it as it is?`
}

/**
 * Judges the claims one at a time (see the top of this file). `aiText` is the record of the AI's words (what it wrote),
 * so a fix only ever changes words the AI wrote.
 */
export function judgeClaims(
  claims: Claim[],
  ctx: { stage: StageLine[]; codex: CodexLine[]; paragraphs: LandedParagraph[]; aiText: string }
): Judged {
  const newWords = newWordsOf(ctx.paragraphs)
  const stage = new Map(ctx.stage.map((l) => [l.code, l]))
  const codex = new Map(ctx.codex.map((l) => [l.code, l]))
  const ai = plain(ctx.aiText.replace(/\{[^{}\n]*\}/g, '').replace(/\*+/g, ''))
  const out: Judged = { fixes: [], questions: [], claims: 0, slips: 0 }
  const asked = new Set<string>()
  for (const c of claims) {
    const found = findSceneQuote(newWords, c.quote)
    if (!found) continue
    const line = stage.get(c.line) ?? null
    if (!line && !codex.has(c.line)) continue
    out.claims++
    if (c.verdict !== 'slip') continue
    out.slips++
    const qStart = found.start
    const qEnd = found.start + found.quote.length
    const fix = line?.quote && found.whole ? fixFor(c, newWords, qStart, qEnd, ctx.paragraphs, ai) : null
    if (fix && !out.fixes.some((f) => f.para === fix.para && f.start < fix.end && fix.start < f.end)) {
      out.fixes.push({ ...fix, claim: c, quote: found.quote })
      continue
    }
    const key = plainQuote(found.quote)
    if (asked.has(key)) continue
    asked.add(key)
    // The model's rewrite, as a rewrite of the claim's own words, for "Review the fix".
    const rewrite = c.fix && found.whole ? rewriteOf(found.quote, c.fix) : null
    out.questions.push({ quote: found.quote, start: qStart, message: questionOf(c), fix: rewrite, claim: c })
  }
  return out
}

/** The fix where the model put it: exact words in one paragraph's AI part, overlapping the quote, small, the AI's own. */
function fixFor(
  c: Claim,
  newWords: string,
  qStart: number,
  qEnd: number,
  paragraphs: LandedParagraph[],
  ai: string
): Omit<FoundFix, 'claim' | 'quote'> | null {
  const f = c.fix
  if (!f) return null
  const was = f.replace
  const now = f.with.replace(/\s+/g, ' ')
  if (!was.trim() || was === now || /\n/.test(was) || !now.trim()) return null
  if (wordCount(was) > FIX_MOST_WORDS || wordCount(now) > wordCount(was) + FIX_MORE_WORDS) return null
  if (plain(was) === plain(now)) return null
  // Only words the AI wrote are changed.
  if (!ai.includes(plain(was))) return null
  for (let i = newWords.indexOf(was); i >= 0; i = newWords.indexOf(was, i + 1)) {
    if (i >= qEnd || i + was.length <= qStart) continue
    const a = placeOf(paragraphs, i)
    const b = placeOf(paragraphs, i + was.length)
    if (!a || !b || a.para !== b.para) continue
    const p = paragraphs[a.para]
    if (a.offset < p.from || b.offset > p.to) continue
    return { para: a.para, start: a.offset, end: b.offset, was, now }
  }
  return null
}

/** The claim's quote with the fix's words changed in it, or null when they aren't in it. */
function rewriteOf(quote: string, fix: { replace: string; with: string }): string | null {
  const i = quote.indexOf(fix.replace)
  if (i < 0 || !fix.with.trim()) return null
  return quote.slice(0, i) + fix.with + quote.slice(i + fix.replace.length)
}
