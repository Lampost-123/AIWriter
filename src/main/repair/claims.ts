// Reading the memory model's claims about new words, and judging each one (check and repair, step 3). Pure.
//
// The model lists the claims the new words make, each with its quote, the line it touches and its verdict. The app
// then takes them one at a time and keeps only what it can stand behind:
//   - a claim whose quote isn't in the new words (the AI's own words that just landed) is dropped: every flag quotes
//     words that are really there;
//   - a claim about a line that doesn't exist is dropped: there is nothing to compare it with;
//   - only "slip" counts, and a slip the model itself says could be true together with the stage ("bothTrue": yes) is
//     no slip at all: nothing is said.
//   - A slip is mended in place only when it plainly can't be true at that moment (Adam, 2026-10-07, after the trap
//     story showed the repair too eager: a hand on the floor "fixed" for a man asleep against a wall, a man who went
//     home "fixed" when later seen by his own fire, someone gone for the night "fixed" when seen in the yard):
//       - the model says the two can't both be true ("bothTrue": no) and that nothing could have happened in between
//         ("between": nothing: no time passing, no one moving, no action off the page);
//       - the line it breaks is what someone wears or holds, a thing in the place (a case set on the sill a moment
//         before; step 2b), or an injury (`MENDABLE`), never where someone is, how they are placed, who they touch or
//         can see, what they did, the time or the mood: moving, getting up and time passing can explain those;
//       - the line is on the stage with the story's own words for it (never a value with no words behind it, nor one
//         from the memory's notes), and the fix is about the thing that line names (a word such as "pipe" or "hat" in
//         both: `sameThing`);
//       - it is the same moment (`sameMoment`): the line's words are just before the claim, within about a hundred
//         words, with no scene break between. A hat put on at the ford and held in a hand by the fire later is no
//         contradiction: people take hats off, put things down, go indoors and sleep;
//       - the fix changes at most a few of the AI's own words (`FIX_MOST_WORDS`, inside or overlapping the quote, in one
//         paragraph), adds at most `FIX_MORE_WORDS`, brings in no new name, and doesn't overlap another fix.
//     Anything else is asked as one question, with the model's rewrite to review.
//   - "the AI's own words": only a paragraph whose AI part is all in the record of what the AI wrote, in order, and that
//     Adam didn't type in while it streamed (`allTheAis`); the fix's words are whole words there (never "up" in "cup").

import { findSceneQuote, plainQuote } from '../checks/quote'
import { findQuote } from '../keeper/text'
import { parseLenient, str } from '../keeper/json'
import { plain, wordCount } from '../keeper/text'
import type { LandedParagraph } from '@shared/contracts/repair'
import { isPlaced } from '@shared/continuity'
import type { CodexLine, StageLine } from './prompts'

export const ABOUT = ['where', 'posture', 'wearing', 'holding', 'touching', 'sees', 'thing', 'condition', 'knows', 'owns', 'time'] as const
export type About = (typeof ABOUT)[number]

export interface Claim {
  quote: string
  who: string
  about: About | 'other'
  line: string
  verdict: 'fits' | 'shown' | 'slip'
  /** Could the new words and the stage's value both be true at the same moment? */
  bothTrue: 'yes' | 'no' | 'maybe'
  /** What could have happened between the stage's moment and the new words' to explain the change. */
  between: 'nothing' | 'time' | 'movement' | 'action' | 'unclear'
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
    const both = str(c.bothTrue ?? c.both_true, 10).toLowerCase()
    const between = str(c.between, 12).toLowerCase()
    const fix = isObj(c.fix) ? { replace: typeof c.fix.replace === 'string' ? c.fix.replace : '', with: typeof c.fix.with === 'string' ? c.fix.with : '' } : null
    return {
      quote: typeof c.quote === 'string' ? c.quote.trim().slice(0, 600) : '',
      who: str(c.who, 80),
      about: (ABOUT as readonly string[]).includes(about) ? (about as About) : 'other',
      line: str(c.line, 12).toUpperCase().replace(/[^A-Z0-9]/g, ''),
      verdict: verdict === 'slip' ? 'slip' : verdict === 'shown' ? 'shown' : 'fits',
      bothTrue: both === 'yes' || both === 'no' ? both : 'maybe',
      between: (['nothing', 'time', 'movement', 'action'] as const).find((b) => b === between) ?? 'unclear',
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

/** The most words a fix made without asking may change, and how many more words it may put in their place. */
export const FIX_MOST_WORDS = 6
export const FIX_MORE_WORDS = 2

/**
 * The stage's values a slip may be mended in place against: what someone wears or holds, a thing in the place, and an
 * injury, and then only at the same moment (sameMoment: a door barred a hundred words before can't be open with nothing
 * between). Where someone is, how they are placed, who they touch or can see, what they did, the time and the mood can
 * be changed by moving, getting up or time passing, so a slip against them is always asked.
 */
export const MENDABLE: ReadonlySet<string> = new Set(['wearing', 'holding', 'thing', 'condition'])

/** Little words that say nothing about what a thing is. */
const LITTLE = new Set(
  'the and with his her hers their its was were had has have from into onto over under back off out down then that this them they she him still just own not nothing both all some any before after again away round around about across through upon while when where what which who been being for but one now there here very each other until once too'.split(
    ' '
  )
)

/**
 * The words that name things in some words: three letters or more, not little words, and not names (a capital letter:
 * the same person in both says nothing about the same thing); "hands" is "hand".
 */
function things(s: string): Set<string> {
  return new Set(
    (s.match(/\p{L}+/gu) ?? [])
      .filter((w) => w.length >= 3 && !/^\p{Lu}/u.test(w) && !LITTLE.has(w.toLowerCase()))
      .map((w) => w.toLowerCase())
      .map((w) => (w.length > 3 ? w.replace(/s$/, '') : w))
  )
}

/** How far apart (characters) the stage's words and the claim may be for the two to be the same moment: about 100 words. */
export const SAME_MOMENT_CHARS = 600

/** A scene break on a line of its own ("* * *", "***"). */
const SCENE_BREAK = /(^|\n)[ \t]*(?:\*[ \t]*){3,}[ \t]*(?=\n|$)/

/** Where a stage value's words last appear in `text` (the last piece, when they join places with "…"), or null. */
function lastPlace(text: string, quote: string): { start: number; end: number } | null {
  const piece = quote.split(/\u2026|\.{3}/).map((p) => p.trim()).filter(Boolean).at(-1) ?? ''
  if (!piece) return null
  let found: { start: number; end: number } | null = null
  for (let at = 0; at <= text.length; ) {
    const r = findQuote(text.slice(at), piece)
    if (!r) break
    found = { start: at + r.start, end: at + r.end }
    at = found.start + 1
  }
  return found
}

/**
 * True when a claim at `claimStart` in the new words is at the same moment as the stage's value: the value's own words
 * are in the words just before (`leadIn`), and between them and the claim there are at most `SAME_MOMENT_CHARS`
 * characters and no scene break. Otherwise time may have passed, or people moved, slept or put things down.
 */
export function sameMoment(stageQuote: string | null, leadIn: string, newWords: string, claimStart: number): boolean {
  if (!stageQuote?.trim()) return false
  const r = lastPlace(leadIn, stageQuote)
  if (!r) return false
  const between = `${leadIn.slice(r.end)}\n\n${newWords.slice(0, Math.max(0, claimStart))}`
  return between.length <= SAME_MOMENT_CHARS && !SCENE_BREAK.test(between)
}

/** True when the words a fix is about name the thing the stage's line names (its value or its words): the same pipe, the same hat. */
export function sameThing(words: string, line: Pick<StageLine, 'value' | 'quote'>): boolean {
  const there = things(`${line.value} ${line.quote ?? ''}`)
  return [...things(words)].some((w) => there.has(w))
}

/** A slip mended in place: in paragraph `para`, `start` to `end` (`was`) becomes `now`. */
export interface FoundFix {
  para: number
  start: number
  end: number
  was: string
  now: string
  claim: Claim
  /** The claim's quote as it stands in the new words, and where it starts in them. */
  quote: string
  quoteStart: number
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
  ctx: { stage: StageLine[]; codex: CodexLine[]; paragraphs: LandedParagraph[]; aiText: string; leadIn?: string }
): Judged {
  const newWords = newWordsOf(ctx.paragraphs)
  const stage = new Map(ctx.stage.map((l) => [l.code, l]))
  const codex = new Map(ctx.codex.map((l) => [l.code, l]))
  const ai = plain(ctx.aiText.replace(/\{[^{}\n]*\}/g, '').replace(/\*+/g, ''))
  const out: Judged = { fixes: [], questions: [], claims: 0, slips: 0 }
  const asked = new Set<string>()
  const ours = ctx.paragraphs.map((p) => allTheAis(p, ai))
  for (const c of claims) {
    const found = findSceneQuote(newWords, c.quote)
    if (!found) continue
    const line = stage.get(c.line) ?? null
    if (!line && !codex.has(c.line)) continue
    out.claims++
    // A thing put down in this scene, moved off the page: always asked, whatever the model made of it (see below).
    if (line && pickedUpOffPage(c, line, found.quote, newWords.slice(0, found.start + found.quote.length), ctx.leadIn ?? '')) {
      out.slips++
      const key = plainQuote(found.quote)
      if (asked.has(key)) continue
      asked.add(key)
      out.questions.push({ quote: found.quote, start: found.start, message: offPageQuestion(c, line), fix: c.fix && found.whole ? rewriteOf(found.quote, c.fix) : null, claim: c })
      continue
    }
    // A "slip" the model itself says could be true together with the stage is no slip.
    if (c.verdict !== 'slip' || c.bothTrue === 'yes') continue
    out.slips++
    const qStart = found.start
    const qEnd = found.start + found.quote.length
    // Mended without asking only when it plainly can't be true at that moment (see the top of this file).
    const plainly =
      !!line?.quote &&
      // Words shared by a whole one-line outfit show the line, not this piece.
      !line.shared &&
      MENDABLE.has(line.field) &&
      c.bothTrue === 'no' &&
      c.between === 'nothing' &&
      sameMoment(line.quote, ctx.leadIn ?? '', newWords, qStart)
    const fix = line && plainly && found.whole ? fixFor(c, newWords, qStart, qEnd, ctx.paragraphs, ai, ours, line, found.quote) : null
    if (fix && !out.fixes.some((f) => f.para === fix.para && f.start < fix.end && fix.start < f.end)) {
      out.fixes.push({ ...fix, claim: c, quote: found.quote, quoteStart: qStart })
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

// ---------- Nothing is picked up off the page ----------
// Adam, 2026-10-07: in a trap run Wren set the survey case down flat on the sill, and a few lines later the new words
// had her sit up "with the case against her hip". The model compared them with the sill line and said they fit: she
// could have picked it up off the page ("between": action). Within one stretch of a scene that is no excuse. When the
// line is a thing put somewhere, or an empty hand, with its words in this scene, and the claim names the same thing as
// moved there by something off the page, and nothing in the words since shows it picked up or moved, it is asked as a
// question, whatever the model's verdict: never mended without asking, and never let pass.

/** Words that show a thing picked up or moved: "picked the case up", "took it from the sill", "slung it on". */
const MOVED =
  /\b(?:pick(?:s|ed|ing)?|took|takes|taking|lift(?:s|ed|ing)?|snatch(?:es|ed|ing)?|grab(?:s|bed|bing)?|caught|catch(?:es)?|gather(?:s|ed)?|sl(?:ing|ings|ung)|shoulder(?:s|ed)|hoist(?:s|ed)?|fetch(?:es|ed)?|seiz(?:es|ed)|scoop(?:s|ed)?|reach(?:es|ed)|carr(?:y|ies|ied)|br(?:ing|ings|ought)|mov(?:es|ed)|dragg(?:ed)?|drags?|haul(?:s|ed)?|pull(?:s|ed)|tuck(?:s|ed)|clutch(?:es|ed)|hugg(?:ed)?|hugs?|retriev(?:es|ed)|recover(?:s|ed)|collect(?:s|ed)|got|gets)\b/i

/** The same, with "it" or "them" right after: "picked it up", "took them from the sill". */
const MOVED_IT = new RegExp(`${MOVED.source}\\s+(?:it|them)\\b`, 'i')

/**
 * True when a stage line says a thing is put somewhere ("the survey case: on the windowsill, flat"; not a door barred),
 * or that a hand is empty: something a claim can't move off the page.
 */
const putSomewhere = (line: StageLine): boolean =>
  line.field === 'thing'
    ? /:\s/.test(line.value) && isPlaced(line.value.slice(line.value.indexOf(':') + 1))
    : line.field === 'holding' && /^(?:nothing|none|empty[- ]?handed|(?:(?:his|her|their|both) )?hands? (?:are |is )?(?:empty|free))\b/i.test(line.value)

/**
 * True when a claim has a thing put down earlier in this scene picked up or moved off the page (see above): the line is
 * a thing put somewhere or an empty hand, with words in this scene (`here`); the model put the change down to something
 * done off the page ("between": action); the claim names the same thing (sameThing); and no sentence since the line's
 * words (in `leadIn`, then the new words up to the claim's end, `upTo`) shows that thing (or "it") picked up or moved.
 */
export function pickedUpOffPage(c: Pick<Claim, 'between'>, line: StageLine, quote: string, upTo: string, leadIn: string): boolean {
  if (c.between !== 'action' || !line.here || !line.quote || !putSomewhere(line)) return false
  const shared = [...things(quote)].filter((w) => things(`${line.value} ${line.quote}`).has(w))
  if (!shared.length) return false
  const r = lastPlace(leadIn, line.quote)
  const since = `${r ? leadIn.slice(r.end) : ''}\n\n${upTo}`
  const sentences = since.split(/(?<=[.!?…])\s+|\n+/)
  return !sentences.some((s) => MOVED_IT.test(s) || (MOVED.test(s) && [...things(s)].some((w) => shared.includes(w))))
}

/** The question for a thing picked up off the page: what the line says, and the choice. */
function offPageQuestion(c: Pick<Claim, 'who'>, line: StageLine): string {
  const what = line.field === 'thing' ? `${line.value.replace(/:\s*/, ' was ')} ("${line.quote}")` : `"${line.quote}"`
  const who = c.who.trim() || 'someone'
  return `Earlier in this scene: ${what}. Nothing since shows it picked up or moved. Should ${who} take it up on the page first, or should it stay where it was?`
}

const WORD_CHAR = /[\p{L}\p{N}]/u

/**
 * True when a paragraph's AI part is all the AI's own: Adam didn't type in it while it streamed in, and all of it (made
 * plain) is in the record of what the AI wrote (`ai`, made plain), in order. Anything else may hold his words.
 */
export function allTheAis(p: LandedParagraph, ai: string): boolean {
  if (p.edited) return false
  const part = plain(p.text.slice(p.from, p.to))
  return !!part && ai.includes(part)
}

/** True when `len` characters at `i` in `text` are whole words there: no letter or digit runs on at either end. */
function wholeWords(text: string, i: number, len: number): boolean {
  const first = text[i] ?? ''
  const last = text[i + len - 1] ?? ''
  if (WORD_CHAR.test(first) && i > 0 && WORD_CHAR.test(text[i - 1])) return false
  if (WORD_CHAR.test(last) && WORD_CHAR.test(text[i + len] ?? '')) return false
  return true
}

/** Capitalised words in `s` (names, mostly). */
const names = (s: string): string[] => s.match(/\b\p{Lu}\p{L}+/gu) ?? []

/**
 * The fix where the model put it: exact whole words in the AI part of one paragraph that is all the AI's own (`ours`),
 * overlapping the quote, small, about the thing the stage's line names, and bringing in no new name.
 */
function fixFor(
  c: Claim,
  newWords: string,
  qStart: number,
  qEnd: number,
  paragraphs: LandedParagraph[],
  ai: string,
  ours: boolean[],
  line: StageLine,
  quote: string
): Omit<FoundFix, 'claim' | 'quote' | 'quoteStart'> | null {
  const f = c.fix
  if (!f) return null
  const was = f.replace
  const now = f.with.replace(/\s+/g, ' ')
  if (!was.trim() || was === now || /\n/.test(was) || !now.trim()) return null
  if (wordCount(was) > FIX_MOST_WORDS || wordCount(now) > wordCount(was) + FIX_MORE_WORDS) return null
  if (plain(was) === plain(now)) return null
  if (!sameThing(`${quote} ${was}`, line)) return null
  const known = new Set(names(`${quote} ${was} ${line.who ?? ''} ${line.value} ${line.quote ?? ''}`))
  if (names(now).some((n) => !known.has(n))) return null
  // Only words the AI wrote are changed.
  if (!ai.includes(plain(was))) return null
  for (let i = newWords.indexOf(was); i >= 0; i = newWords.indexOf(was, i + 1)) {
    if (i >= qEnd || i + was.length <= qStart || !wholeWords(newWords, i, was.length)) continue
    const a = placeOf(paragraphs, i)
    const b = placeOf(paragraphs, i + was.length)
    if (!a || !b || a.para !== b.para || !ours[a.para]) continue
    const p = paragraphs[a.para]
    if (a.offset < p.from || b.offset > p.to) continue
    return { para: a.para, start: a.offset, end: b.offset, was, now }
  }
  return null
}

/** The claim's quote with the fix's words changed in it, or null when they aren't in it (or it changes nothing). */
function rewriteOf(quote: string, fix: { replace: string; with: string }): string | null {
  const i = quote.indexOf(fix.replace)
  if (i < 0 || !fix.with.trim() || fix.with.trim() === fix.replace.trim()) return null
  return quote.slice(0, i) + fix.with + quote.slice(i + fix.replace.length)
}
