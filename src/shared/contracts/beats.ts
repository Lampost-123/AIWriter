// Beat by beat (milestone 4): writes one beat of the scene card at a time and pauses, so Adam can steer
// before the next. Owned by the Beat by beat part. See docs/ARCHITECTURE.md, "Milestone 4".
//
// Each beat is a 'beat' generation record with `params.beat` ({ sessionId, index, of }), written with the
// shared draft runner (startDraftJob with job 'beat') and a briefing from draftBriefing with its own
// closing instruction and the scene so far, so it streams into the page like a draft.
//
// The interface keeps the session (which beats are on the page, Adam's note for the next one) and asks
// for one beat at a time with startBeat. The beat's words arrive by the usual generation events
// ('generation:chunk', 'generation:retrying', 'generation:done'), and Stop is stopGeneration, as for
// Generate.
import type { DraftOptions, ID } from '../types'

export interface BeatStart {
  sceneId: ID
  /** The Beat by beat session the beat belongs to (the interface makes its id), kept with the beat's record. */
  sessionId: ID
  /** Which of the scene card's beats to write, from 1 (blank beats on the card don't count). */
  index: number
  /** The scene's draft options, as Generate would take them. The length is the whole scene's: each beat gets its share. */
  options: DraftOptions
  /** Adam's note for this beat ("make her hesitate at the door"), or ''. */
  steer: string
  /**
   * The scene so far that this beat carries on from, as the page shows it: '' for a first beat that
   * starts the scene (on an empty page, in place of its text, or below a scene break).
   */
  soFar: string
}

export interface BeatsApi {
  /**
   * Starts writing one beat of the scene card into the scene: the beat's record is made and its words
   * stream in by the generation events. Before the first beat, the memory first catches up with
   * earlier scenes (cancelBeatStart calls that off). Fails in plain words: no writer model, no such
   * beat on the scene card, a draft already being written for this scene...
   */
  startBeat(input: BeatStart): Promise<{ generationId: ID; of: number }>
  /** Calls off a beat that is still getting ready (the memory catching up first): nothing is sent. */
  cancelBeatStart(sceneId: ID): Promise<void>
}

export interface BeatsEvents {
  // Beat by beat needs no events beyond the generation events.
}
