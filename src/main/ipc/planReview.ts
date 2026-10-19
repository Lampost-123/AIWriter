// The handlers for src/shared/contracts/planReview.ts: Show me the plan first. The wait itself is in src/main/plan/review.ts;
// a draft that shows its plan first is started and stopped as any Generate draft is (ipc/ai.ts).
import type { Handlers } from './index'
import * as world from '../world'
import { answerScenePlan, scenePlansWaiting, stopWaitingPlans } from '../plan/review'

let watching = false

/** Closing a world ends every plan waiting in it: those drafts end before anything is written. */
export function watchWorldForPlans(): void {
  if (watching) return
  watching = true
  world.onWorldClosing(() => stopWaitingPlans())
}

export const planReviewHandlers: Handlers<'answerScenePlan' | 'scenePlansWaiting'> = {
  answerScenePlan: (answer) => answerScenePlan(answer),
  scenePlansWaiting: () => scenePlansWaiting()
}
