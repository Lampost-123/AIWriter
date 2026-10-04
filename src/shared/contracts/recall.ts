// Recall (Adam, 2026-10-04): where things stand as a scene ends, from the continuity tracker
// (src/main/continuity/tracker.ts), shown in the scene panel so Adam can browse it and put it right: change a value,
// take a character out, or read the scene again. What he changes is kept until the scene's words change; a state
// whose words (or an earlier scene's state) changed is shown as out of date, never used as it is.
import type { ID } from '../types'
import type { SceneState, StateField } from '../continuity'

export interface RecallView {
  sceneId: ID
  /** As the scene ends, with Adam's changes; null when it hasn't been worked out yet. */
  state: SceneState | null
  /** False when the scene's words, or an earlier scene's state, changed since: Read again brings it up to date. */
  current: boolean
  /** Adam changed something in it. */
  edited: boolean
}

/** A value to change: one of a character's (`character` is their name), or the scene's time, weather or light. */
export type RecallChange =
  | { character: string; field: StateField; value: string }
  | { character?: undefined; field: 'time' | 'weather' | 'light'; value: string }

export interface RecallApi {
  getRecall(sceneId: ID): Promise<RecallView>
  /** Works the scene's state out again from its words (and the scenes before it, as far as needed), with the memory model. */
  refreshRecall(sceneId: ID): Promise<RecallView>
  /** Adam's own value ('' clears it). Kept until the scene's words change. */
  setRecallValue(sceneId: ID, change: RecallChange): Promise<RecallView>
  /** Takes a character out of the scene's state. Kept until the scene's words change. */
  removeRecallCharacter(sceneId: ID, name: string): Promise<RecallView>
}

export interface RecallEvents {
  // Changes come back from each call; no events.
}
