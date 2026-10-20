// The truth check and the outcome line for the talks (chat-truth R1, R2, R6): the Plan, recipe and cast talks. The
// same shared check as Ask (shared/askTruth) puts right an answer that says it changed something: with no change sent,
// as an offer under "No change was made"; with one waiting in the preview, as waiting ("The change is ready to apply").
// The line under each answer is the app's own (shared/askOutcome), from what came of it, never from the AI's words.

import { changeClaims, checkClaims, honestReply, type Proposed } from '@shared/askTruth'
import { outcomeOf, type Outcome } from '@shared/askOutcome'
import type { TalkTurn } from './talkStore'

/**
 * A talk's preview, as the check sees it: one change that can touch anything its subject holds (scene cards, beats,
 * chapters, new parts, titles, threads, entries, words), so any claim of a change is backed while one waits. Without
 * ids, so the words that put it right say "The change is ready to apply", not "Change 1".
 */
const PREVIEW: Proposed[] = (['card', 'beats', 'chapterCard', 'thread', 'entry', 'newEntry', 'newScene', 'rename', 'text'] as const).map((kind) => ({ kind }))

/** True when an answer says it made (or proposed) a change in its own words: not an offer, a question or a quote. */
export const claimsChange = (answer: string): boolean => changeClaims(answer).some((c) => !c.earlier)

/**
 * The answer as Adam sees it. `changed`: a change came with it (it waits in the preview). A claim with nothing sent is
 * put right under "No change was made" (the outcome line says why); one of a change made, while it only waits, is said
 * as waiting. `applyLabel`: the words on the button that makes it ("Make this change" on the Plan hub).
 */
export function settleTalk(answer: string, changed: boolean, applyLabel = 'Apply'): string {
  const checked = checkClaims(answer, changed ? PREVIEW : [])
  const bad = checked.filter((c) => !c.ok).map((c) => c.claim)
  const backed = checked.filter((c) => c.ok && c.claim.made && !c.claim.earlier).map((c) => ({ claim: c.claim, ids: [] }))
  if (!bad.length && !backed.length) return answer
  return honestReply(answer, bad, { proposed: [], backed, applyLabel })
}

/** Why nothing changed, in plain words after "Nothing was changed: " (talks that sent a change that didn't read). */
export const NO_CHANGE = {
  lost: 'the parts it named aren’t in the plan',
  notPlan: 'its reply didn’t read as a plan',
  notSent: 'it didn’t send the change'
} as const

/** The outcome line for a hand-off (the Plan hub's talk, asked to change what is already in the story). */
export const SUGGESTIONS_ONLY = 'This talk changes suggestions only.'

/**
 * The line under a talk's answer. `where`: what holds the waiting change ("The plan below"). An answer kept from before
 * the talks recorded what came of them has none, rather than a wrong one. `applyLabel`: the words on its Apply button.
 */
export function talkOutcome(turn: TalkTurn, where: string, applyLabel = 'Apply'): Outcome {
  if (turn.role !== 'assistant' || !turn.recorded) return outcomeOf({ finished: true, recorded: false, changes: [] })
  if (turn.handOff) return { state: 'refused', parts: [{ text: SUGGESTIONS_ONLY }], words: SUGGESTIONS_ONLY }
  switch (turn.outcome) {
    case 'offered': {
      const waiting = outcomeOf({ finished: true, where, changes: Array.from({ length: Math.max(1, turn.changes?.length ?? 0) }, () => ({ status: 'pending' as const })) })
      // The button's own words ("Make this change" on the Plan hub).
      const parts = waiting.parts.map((p) => ({ ...p, text: p.text.replace('press Apply', `press ${applyLabel}`) }))
      return { ...waiting, parts, words: parts.map((p) => p.text).join('') }
    }
    case 'applied':
      return outcomeOf({ finished: true, changes: [{ status: 'applied' }] })
    case 'declined':
      return outcomeOf({ finished: true, changes: [{ status: 'declined' }] })
    case 'revised':
      return { state: 'none', parts: [{ text: 'Built on in the answer below.' }], words: 'Built on in the answer below.' }
    default:
      return outcomeOf({ finished: true, changes: [], refused: turn.reason ?? null })
  }
}
