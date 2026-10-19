// Show me the plan first, in the window (contract: shared/contracts/planReview.ts; main: src/main/plan/review.ts): the scene
// plans waiting for Adam ('scenePlan:review' until 'scenePlan:closed'), his answer, and the draft options' choice for one
// draft ("Show me the plan first" on or off for this scene's next draft, else Settings' switch), as the director's is kept
// (features/director/store.ts).
import { create } from 'zustand'
import type { ID } from '@shared/types'
import type { ScenePlanParts, ScenePlanReview } from '@shared/contracts/planReview'
import { api, onEvent } from '@/lib/api'
import { useApp } from '@/lib/store'

interface PlanReviewState {
  /** The plans waiting for Adam, oldest first (one at a time in practice: one draft at a time). */
  waiting: ScenePlanReview[]
  /** The draft options' choice for one draft, by scene: on or off; left out, as Settings › Models says. */
  once: Record<ID, boolean>
}

export const usePlanReview = create<PlanReviewState>(() => ({ waiting: [], once: {} }))

let listening = false

/** Hears the plans waiting and those that no longer wait, once, for as long as the window is open. */
export function listenForPlanReviews(): void {
  if (listening) return
  listening = true
  onEvent('scenePlan:review', (r) => usePlanReview.setState((s) => ({ waiting: [...s.waiting.filter((x) => x.reviewId !== r.reviewId), r] })))
  onEvent('scenePlan:closed', (p) => usePlanReview.setState((s) => ({ waiting: s.waiting.filter((x) => x.reviewId !== p.reviewId) })))
  // A window opened (or reloaded) while a plan waits shows it.
  void api
    .scenePlansWaiting()
    .then((list) => usePlanReview.setState((s) => ({ waiting: [...s.waiting, ...list.filter((r) => !s.waiting.some((x) => x.reviewId === r.reviewId))] })))
    .catch(() => undefined)
  // Another world: its waiting plans ended as it closed.
  useApp.subscribe((a, prev) => {
    if (a.world?.id !== prev.world?.id) usePlanReview.setState({ waiting: [] })
  })
}

/** Writes to the plan (as Adam changed it, if he did). */
export async function writeToPlan(reviewId: ID, plan?: ScenePlanParts): Promise<void> {
  await api.answerScenePlan({ reviewId, write: true, ...(plan ? { plan } : {}) })
}

/** Cancels the draft before anything is written. A plan that no longer waits is let go of quietly. */
export async function cancelPlan(reviewId: ID): Promise<void> {
  try {
    await api.answerScenePlan({ reviewId, write: false })
  } catch {
    usePlanReview.setState((s) => ({ waiting: s.waiting.filter((x) => x.reviewId !== reviewId) }))
  }
}

const without = (r: Record<ID, boolean>, id: ID): Record<ID, boolean> => {
  if (!(id in r)) return r
  const out = { ...r }
  delete out[id]
  return out
}

/** The draft options' choice for this scene's next draft: on, off, or as Settings say (undefined). */
export function setShowPlanOnce(sceneId: ID, on: boolean | undefined): void {
  usePlanReview.setState((s) => ({ once: on === undefined ? without(s.once, sceneId) : { ...s.once, [sceneId]: on } }))
}

/**
 * The draft options' one-draft choice (DraftOptions.showPlan), which is then used up: the next draft follows Settings
 * again. Undefined when there is no choice.
 */
export function takeShowPlan(sceneId: ID): boolean | undefined {
  const once = usePlanReview.getState().once[sceneId]
  if (once !== undefined) setShowPlanOnce(sceneId, undefined)
  return once
}
