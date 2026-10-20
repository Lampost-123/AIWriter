// The Plan hub (Adam, 2026-10-20: "the one place to plan with AI", and "we should also be able to return after we have
// already written part of a story and plan the next part of it"). One page per story (View 'planHub',
// features/planHub/): where the story stands (the last scene written, in a line), what happens next in Adam's own words,
// the plot threads waiting, and the story line with the AI's suggestions in their place. What it needs from the main
// process, with no AI call: the last scene's gist (the story index's, else its summary), the open plot threads there, and
// where the planned scenes no longer fit what has been written (the free card check). One AI call: the drifting scene
// cards written again so they fit, shown first and kept or discarded by Adam. Main side: src/main/planHub/.
import type { ID } from '../types'

/** A plot thread still open where the story has got to, for the hub's "Threads waiting" chips. */
export interface HubThread {
  id: ID
  name: string
  /** Where it was opened, by chapter: "Ch 2" ('' when not known). */
  since: string
  /** How many scenes it has been quiet for, up to the last scene written. */
  quiet: number
}

/** One planned scene, after the last one written, whose card the story has moved on from. */
export interface HubDrift {
  sceneId: ID
  chapterId: ID
  /** "Ch 5, Sc 1". */
  label: string
  /** The scene's title ('' for a plain "Scene 2"). */
  title: string
  /** What no longer fits, in plain words (the card check's own words). */
  text: string
}

export interface PlanHubFacts {
  storyId: ID
  /** The last scene with words, as the main process counts them (null: nothing written yet). */
  lastSceneId: ID | null
  /** What happens in it, in a line or two: the story index's gist, else its summary ('' when neither has anything yet). */
  lastGist: string
  /** The plot threads open at the last scene written (or, with nothing written, at the story's end), longest quiet first. */
  threads: HubThread[]
  /** Planned scenes after the last one written whose cards no longer fit what has been written (at most a few). */
  drift: HubDrift[]
}

export interface PlanUpdateRequest {
  /** Made by the interface, so every task event can be matched to it. */
  taskId: ID
  storyId: ID
  /** The planned scenes to write again, in story order (the drift card's). */
  sceneIds: ID[]
}

/** What the main process says each scene's card is now, for showing Adam what changes before he keeps it. */
export interface PlanUpdateScene {
  sceneId: ID
  label: string
  title: string
  goal: string
  when: string
  beats: string[]
}

export interface PlanHubApi {
  /** The hub's facts for a story (no AI call): the story index is brought up to date first. */
  planHubFacts(storyId: ID): Promise<PlanHubFacts>
  /** The scenes' cards as they are now, in the order given (for the update's preview). */
  planUpdateScenes(sceneIds: ID[]): Promise<PlanUpdateScene[]>
  /**
   * "Update the plan": the chat model writes those scene cards again so they fit what has been written. It streams as
   * task events with job 'outline', in the outline helper's scene form, one card for each scene given, in order; nothing
   * changes until Adam keeps it. Throws (plain words) only before it starts.
   */
  startPlanUpdate(input: PlanUpdateRequest): Promise<{ generationId: ID }>
}

export interface PlanHubEvents {
  // None: the update streams as task events (contracts/tasks.ts).
}
