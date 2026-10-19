// The free rules over words as findings (free rules, 2026-10-19): time claims (timeClaims.ts) and the card place's name
// (placeNames.ts), each quoting the sentence its words are in and, where it is obvious, that sentence put right. One
// shape for both places they run, so they agree: the rule-based checks over a whole scene (rules.ts, after every reading
// and every check) and check and repair over a draft's new words as they land (repair/index.ts), whose findings are kept
// under the same keys (checks/ruleChecks.ts ruleKey) and so are never raised twice. Pure.

import type { IssueSource } from '@shared/contracts/checks'
import type { ID } from '@shared/types'
import { sentencesOf } from '../storyIndex/routes'
import { timeClaims, type TimeContext } from './timeClaims'
import { placeNameSlips, type PlaceNameContext, type PlaceSlip } from './placeNames'
import type { RuleFinding } from './rules'

/** What the free rules over words read of a scene (checks/freeContext.ts reads it from the world). */
export interface FreeContext {
  time: TimeContext
  place: PlaceNameContext
}

/** The longest a quote may be: a longer sentence is quoted from its clause. */
const QUOTE_MOST = 280

/** The sentence words are in (their clause, in a long sentence), as start and end in the text. */
export function sentenceAround(text: string, start: number, end: number): { start: number; end: number } {
  const s = sentencesOf(text).find((x) => x.start <= start && end <= x.end) ?? { start, end }
  if (s.end - s.start <= QUOTE_MOST) return s
  const before = text.slice(s.start, start)
  const after = text.slice(end, s.end)
  const a = Math.max(before.lastIndexOf(','), before.lastIndexOf(';'), before.lastIndexOf('—'))
  const b = after.search(/[,;—]/)
  let from = a >= 0 ? s.start + a + 1 : s.start
  while (from < start && /\s/.test(text[from])) from++
  return { start: from, end: b >= 0 ? end + b : s.end }
}

/** Words in a key: lower case, one space, one kind of apostrophe. */
const keyWords = (s: string): string => s.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim()

/** A finding over words: quoted from its sentence, with the sentence put right when there is a fix. */
function quoted(
  text: string,
  at: { start: number; end: number },
  fix: string | null
): { quote: string; fix: string | undefined } {
  const s = sentenceAround(text, at.start, at.end)
  const quote = text.slice(s.start, s.end)
  if (fix === null) return { quote, fix: undefined }
  const put = quote.slice(0, at.start - s.start) + fix + quote.slice(at.end - s.start)
  return { quote, fix: put === quote ? undefined : put }
}

/** The time claims in `text` that don't fit, as the rules' findings. `opening`: how much of the text is the scene's opening. */
export function timeRuleFindings(text: string, ctx: TimeContext, opening = 0): RuleFinding[] {
  return timeClaims(text, ctx, opening).map((f) => {
    const q = quoted(text, f, f.fix)
    const sources: IssueSource[] = f.sources
    return {
      rule: 'time-claim',
      about: `${f.kind}:${keyWords(f.words)}`,
      kind: 'timeline',
      severity: f.severity,
      quote: q.quote,
      message: f.message,
      sources,
      ...(q.fix ? { fix: q.fix } : {}),
      at: { start: f.start, end: f.end }
    }
  })
}

/** The places `text` names wrong (placeNames.ts), as the rules' findings, with the slips themselves for check and repair's fixes. */
export function placeRuleFindings(text: string, ctx: PlaceNameContext, scene = text): { findings: RuleFinding[]; slips: PlaceSlip[] } {
  const slips = placeNameSlips(text, ctx, scene)
  const findings = slips.map((s): RuleFinding => {
    const q = quoted(text, s, s.right)
    return {
      rule: 'place-name',
      about: placeAbout(s.placeId, s.words),
      kind: 'fact',
      severity: 'warning',
      quote: q.quote,
      message: s.message,
      sources: [{ kind: 'entry', entryId: s.placeId, name: s.placeName, field: null }],
      entryId: s.placeId,
      ...(q.fix ? { fix: q.fix } : {}),
      at: { start: s.start, end: s.end }
    }
  })
  return { findings, slips }
}

/** What a place-name finding is about, for its key: the card's place and the words that named it wrong. */
export const placeAbout = (placeId: ID, words: string): string => `${placeId}:${keyWords(words)}`

/**
 * How much of a scene's words is its opening, for "The next morning" and the like: its first sentence only. Later in the
 * scene, "That afternoon" is the scene's own day going on (a trap run's planted passage), not how far it is from the
 * scene before.
 */
export function openingOf(text: string): number {
  return sentencesOf(text)[0]?.end ?? 0
}
