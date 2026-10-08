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
//
// Beat markers (2026-10-08): where each beat is on the page is kept with the scene (SceneBeatMarks), so the
// page can show where each beat begins after Finish and a restart, and an earlier beat can be written again
// in place as a tracked change (`after` quotes what follows it).
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
  /**
   * How the scene so far ends: with the beat before this one as it was written ('with-beat', the
   * default), part-way through it because it was stopped or cut off ('mid-beat'), or with more of
   * Adam's own writing after it ('after-beat').
   */
  soFarEnds?: SoFarEnd
  /**
   * An earlier beat written again in the middle of the scene: the page's text after the beat (the next
   * beat's words first), so the new version leads into it. Its first part is quoted as "What comes after
   * this beat". '' or missing: nothing comes after it (the usual case).
   */
  after?: string
}

export type SoFarEnd = 'with-beat' | 'mid-beat' | 'after-beat'

/** One version of a beat that went into the page: its record, when it went in, and a fingerprint of its words then. */
export interface BeatVersion {
  recordId: ID
  /** When it went in (ms since 1970), to tell which of two beats was written first. */
  at: number
  /** A short fingerprint of the beat's words as they went in (beatSig), to tell which version is on the page now. */
  sig: string
}

/** One beat of a scene's beat by beat session, as kept with the scene. */
export interface BeatMark {
  /** Which beat of the scene card, from 1. */
  index: number
  /** The ids of the paragraphs it wrote, every version's (so undo brings its markers back too). */
  pids: string[]
  /** Every version that went into the page, oldest first. */
  versions: BeatVersion[]
  /** Adam chose to keep it as it is although a beat before it changed after it was written (ms since 1970). */
  keptAt?: number
}

/**
 * Where each beat of a scene's latest beat by beat session is on the page (by paragraph ids), so the
 * markers, the per-beat menu and redoing an earlier beat outlive Finish and a restart. One per scene,
 * kept in the world (the meta table); a new session on the scene takes the place of the last one's.
 */
export interface SceneBeatMarks {
  sceneId: ID
  sessionId: ID
  /** How many beats the scene card had. */
  of: number
  /** Whether the beats were the whole scene, or went below a scene break under older text. */
  mode: 'whole' | 'below'
  beats: BeatMark[]
  /**
   * The session was still on when these were last kept: it didn't Finish (the app closed, another world or another
   * scene's session came first...), so opening the scene again carries it on (features/beats/flow.ts, resume).
   */
  open?: boolean
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
  /** Where the scene's beats are on the page (its latest session's), or null when it has none kept. */
  getBeatMarks(sceneId: ID): Promise<SceneBeatMarks | null>
  /** Keeps where the scene's beats are (tidied and kept to a sensible size); null forgets them. */
  saveBeatMarks(sceneId: ID, marks: SceneBeatMarks | null): Promise<void>
}

export interface BeatsEvents {
  // Beat by beat needs no events beyond the generation events.
}
