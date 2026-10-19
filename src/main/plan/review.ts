// Show me the plan first (2026-10-19; contract: shared/contracts/planReview.ts). With the draft options' "Show me the plan
// first" (DraftOptions.showPlan) or Settings › Models' "Show me the plan before writing" (Settings.showPlanFirst), Generate
// and Add below stop once the scene is planned (ai/draftFlow.ts withPlan asks `review`) and the plan waits for Adam, with
// no time limit, until he writes to it (as he left it), cancels, or stops the draft. The plan is made anyway, so this costs
// no tokens. What he changes is what the writer gets: the plan's notes are written again from his plan (MadePlan
// writeAgain), and the scene's kept plan becomes his (keepChangedPlan), so Continue and later beats follow it. What must
// happen first for a beat stays with that beat while its words are as they were. No Electron imports but through `emit`.

import type { ID } from '@shared/types'
import type { DraftOptions, Settings } from '@shared/types'
import type { ScenePlanAnswer, ScenePlanParts, ScenePlanReview } from '@shared/contracts/planReview'
import { UserError, newId } from '../util'
import { keepChangedPlan, planWanted } from '.'
import { planText, type MadePlan, type ScenePlan } from './plan'

/** The longest line Adam's plan keeps, and the most lines of each list. */
export const REVIEW_MOST = { line: 400, beats: 12, lines: 10 }

/** What Adam is told when he cancels: nothing was written (draftRun hears the code and says nothing more). */
export const CANCELLED_BEFORE_WRITING = 'Cancelled before writing: nothing in the scene changed.'

/** True when this draft stops to show its plan first: its own choice, else Settings; never while planning is off. */
export function reviewWanted(options: Partial<Pick<DraftOptions, 'showPlan'>> | undefined, settings: Partial<Pick<Settings, 'showPlanFirst'>>): boolean {
  const asked = typeof options?.showPlan === 'boolean' ? options.showPlan : settings.showPlanFirst === true
  return asked && planWanted()
}

const clean = (s: unknown): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, REVIEW_MOST.line) : '')
const lines = (v: unknown, most: number): string[] => (Array.isArray(v) ? v.map(clean).filter(Boolean).slice(0, most) : [])

/** The parts of a plan Adam can change, as they are. */
export function partsOf(p: ScenePlan): ScenePlanParts {
  return {
    wants: p.point.wants,
    against: p.point.against,
    turn: p.point.turn,
    beats: [...p.beats],
    whoWhere: [...p.whoWhere],
    changes: [...p.changes],
    closing: p.closing
  }
}

/** The review Adam is shown: the plan (or none, when none could be made), what the card check noted, and what can't happen. */
export function reviewOf(sceneId: ID, made: MadePlan | null, notes: readonly string[], carryingOn: boolean): ScenePlanReview {
  const p = made?.plan ?? null
  return {
    reviewId: `plan-review-${newId()}`,
    sceneId,
    carryingOn,
    plan: p ? { ...partsOf(p), first: [...(p.first ?? [])], keep: [...p.keep], mustStay: [...p.mustStay] } : null,
    notes: [...notes],
    flags: [...(made?.flags ?? [])]
  }
}

/**
 * The plan as Adam changed it (pure): his words for each part he can change, empty lines left out, each list at most its
 * most; what must happen first for a beat kept with that beat while its words are as they were (wherever it now is). What
 * the scene rests on, what must stay true, what it asked for and what must change are the plan's as made.
 */
export function changedPlan(p: ScenePlan, parts: Partial<ScenePlanParts>): ScenePlan {
  const beats = parts.beats !== undefined ? lines(parts.beats, REVIEW_MOST.beats) : [...p.beats]
  const same = (a: string, b: string): boolean => clean(a).toLowerCase() === clean(b).toLowerCase()
  const first = (p.first ?? []).flatMap((f) => {
    const was = p.beats[f.beat]
    const at = was === undefined ? -1 : beats.findIndex((b) => same(b, was))
    return at < 0 ? [] : [{ beat: at, note: f.note }]
  })
  const out: ScenePlan = {
    ...p,
    point: {
      wants: parts.wants !== undefined ? clean(parts.wants) : p.point.wants,
      against: parts.against !== undefined ? clean(parts.against) : p.point.against,
      turn: parts.turn !== undefined ? clean(parts.turn) : p.point.turn
    },
    beats,
    whoWhere: parts.whoWhere !== undefined ? lines(parts.whoWhere, REVIEW_MOST.lines) : [...p.whoWhere],
    changes: parts.changes !== undefined ? lines(parts.changes, REVIEW_MOST.lines) : [...p.changes],
    closing: parts.closing !== undefined ? clean(parts.closing) : p.closing
  }
  delete out.first
  return first.length ? { ...out, first } : out
}

/** True when Adam's parts say anything other than the plan as made. */
export function changesAnything(p: ScenePlan, parts: Partial<ScenePlanParts> | undefined): boolean {
  if (!parts) return false
  return JSON.stringify(partsOf(changedPlan(p, parts))) !== JSON.stringify(partsOf(p))
}

/**
 * The plan to write to, with Adam's answer: as made when he changed nothing; otherwise his plan, with the writer's notes
 * written again from it, and the scene's kept plan his from now on.
 */
export function withAnswer(sceneId: ID, made: MadePlan, parts: ScenePlanParts | undefined): MadePlan {
  if (!made.plan || !changesAnything(made.plan, parts)) return made
  const plan = changedPlan(made.plan, parts!)
  keepChangedPlan(sceneId, made.plan, plan)
  const text = made.writeAgain ? made.writeAgain(plan) : planText(plan, false)
  return { ...made, plan, text }
}

// ---------- Waiting for Adam ----------

interface Waiting {
  review: ScenePlanReview
  done: (answer: ScenePlanAnswer | null) => void
}
const waiting = new Map<ID, Waiting>()

/**
 * Shows Adam the plan (the 'scenePlan:review' event) and waits for his answer, with no time limit: null when he cancels,
 * the draft is stopped (`signal`) or the world closes (stopWaitingPlans). 'scenePlan:closed' says it no longer waits.
 */
export function waitForReview(
  review: ScenePlanReview,
  signal: AbortSignal | undefined,
  emit: (name: 'scenePlan:review' | 'scenePlan:closed', payload: unknown) => void
): Promise<ScenePlanAnswer | null> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(null)
    const done = (answer: ScenePlanAnswer | null): void => {
      if (waiting.get(review.reviewId)?.done !== done) return
      waiting.delete(review.reviewId)
      signal?.removeEventListener('abort', stop)
      emit('scenePlan:closed', { reviewId: review.reviewId, sceneId: review.sceneId })
      resolve(answer && answer.write ? answer : null)
    }
    const stop = (): void => done(null)
    waiting.set(review.reviewId, { review, done })
    signal?.addEventListener('abort', stop, { once: true })
    emit('scenePlan:review', review)
  })
}

/** Adam's answer to a plan waiting for him (answerScenePlan). Throws when it isn't waiting any more. */
export function answerScenePlan(answer: ScenePlanAnswer): void {
  const w = waiting.get(String(answer?.reviewId ?? ''))
  if (!w) throw new UserError('The AI isn’t waiting for this plan any more. Start the draft again.')
  if (answer.write !== true) return w.done(null)
  const p = answer.plan
  const parts: ScenePlanParts | undefined =
    p && typeof p === 'object'
      ? {
          wants: clean(p.wants),
          against: clean(p.against),
          turn: clean(p.turn),
          beats: lines(p.beats, REVIEW_MOST.beats),
          whoWhere: lines(p.whoWhere, REVIEW_MOST.lines),
          changes: lines(p.changes, REVIEW_MOST.lines),
          closing: clean(p.closing)
        }
      : undefined
  w.done({ reviewId: w.review.reviewId, write: true, ...(parts ? { plan: parts } : {}) })
}

/** The plans waiting for Adam now, oldest first. */
export const scenePlansWaiting = (): ScenePlanReview[] => [...waiting.values()].map((w) => w.review)

/** Stops every plan waiting (the world is closing): each draft ends before anything is written. */
export function stopWaitingPlans(): void {
  for (const w of [...waiting.values()]) w.done(null)
}
