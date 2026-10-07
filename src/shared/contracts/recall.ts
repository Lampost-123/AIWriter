// Recall (Adam, 2026-10-04): where things stand as a scene ends, from the continuity tracker
// (src/main/continuity/tracker.ts), shown in the scene panel so Adam can browse it and put it right: change a value,
// take a character out, or read the scene again. What he changes is kept until the scene's words change; a state
// whose words (or an earlier scene's state) changed is shown as out of date, never used as it is. At the cursor
// (Adam, 2026-10-07): where things stand at any point in the scene, from the checkpoints kept inside it.
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

/** Where things stand at a point in a scene (the cursor): the scene's words up to it. */
export interface RecallAtView {
  sceneId: ID
  /** Null when nothing is worked out at or before that point. */
  state: SceneState | null
  /** Worked out at that very point; otherwise at the nearest point before it. */
  exact: boolean
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
  /** Where things stand after `words` (the scene up to the cursor), as kept: no model is asked. */
  getRecallAt(sceneId: ID, words: string): Promise<RecallAtView>
  /** Works out where things stand after `words` with the memory model, reading on from the nearest checkpoint. */
  refreshRecallAt(sceneId: ID, words: string): Promise<RecallAtView>
}

export interface RecallEvents {
  /** Where things stand in a scene was brought up to date on its own (after the memory read it): Recall reloads. */
  'recall:changed': { sceneId: ID }
}
