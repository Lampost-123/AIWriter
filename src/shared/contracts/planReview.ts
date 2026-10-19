// Show me the plan first (2026-10-19; src/main/plan/review.ts): with the draft options' "Show me the plan first" or
// Settings › Models' "Show me the plan before writing", Generate and Add below stop once the scene is planned (the plan is
// made anyway, so it costs nothing more) and the plan waits for Adam: what the point-of-view character wants, what stands
// in the way and the turn, the beats, who is where, what changes and the image it ends on, with what the app noted before
// writing (the scene card against the story so far, plan/cardCheck.ts) and what must happen first for a beat. Write writes
// to the plan as Adam left it; Cancel ends the draft before anything is written. The draft itself is started, stopped and
// heard as any Generate draft (startDraft resolves once the plan is answered; Stop while it waits is cancelDraftStart).
import type { ID } from '../types'

/** The parts of a scene plan Adam can change. */
export interface ScenePlanParts {
  /** What the point-of-view character wants, what stands in the way, and how it turns; '' for any not said. */
  wants: string
  against: string
  turn: string
  /** What happens, in order. */
  beats: string[]
  /** Who is where as it starts ("Wren: by the hearth"). */
  whoWhere: string[]
  /** What changes on the page, in order. */
  changes: string[]
  /** The image it ends on; '' for none. */
  closing: string
}

/** A scene plan waiting for Adam. */
export interface ScenePlanReview {
  reviewId: ID
  sceneId: ID
  /** Add below: the plan is for the next stretch of the scene, carried on from its words. */
  carryingOn: boolean
  /** The plan as the AI made it and the app checked it; null when no plan could be made this time. */
  plan:
    | (ScenePlanParts & {
        /** What must happen first for a beat to be able to happen, after that beat (by its index from 0). */
        first: { beat: number; note: string }[]
        /** What the scene rests on, as things stand, and what must stay true all through it: shown, not changed here. */
        keep: string[]
        mustStay: string[]
      })
    | null
  /** What the app noted before writing, comparing the scene card with the story so far ("Before writing, note: …"). */
  notes: string[]
  /** Beats that can't happen as planned, as the story so far has things (left as planned). */
  flags: string[]
}

/** Adam's answer: write (with the plan as he changed it, if he did) or cancel. */
export interface ScenePlanAnswer {
  reviewId: ID
  write: boolean
  /** The plan as Adam changed it; left out: as the AI made it. */
  plan?: ScenePlanParts
}

export interface PlanReviewApi {
  /** Write to the plan, or cancel the draft. Throws when the plan isn't waiting any more. */
  answerScenePlan(answer: ScenePlanAnswer): Promise<void>
  /** The plans waiting for Adam now (a window that opens while one waits shows it). */
  scenePlansWaiting(): Promise<ScenePlanReview[]>
}

export interface PlanReviewEvents {
  /** A scene plan is ready for Adam. */
  'scenePlan:review': ScenePlanReview
  /** It isn't waiting any more: answered, the draft stopped, or the world closed. */
  'scenePlan:closed': { reviewId: ID; sceneId: ID }
}
