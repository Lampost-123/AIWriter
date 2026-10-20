// Directed writing (Adam's spec, "Directed writing (an option)"; src/main/director): a director watches the writer while
// it writes and steers it between stretches, like a film director giving notes between takes. The director never writes
// prose. The draft is one record and one stream into the page, as any Generate draft is ('generation:chunk',
// 'generation:done', Stop is stopGeneration); these add what the window shows while it is directed (the director's line
// and Adam's notes) and the one thing a plain draft never does: take its last paragraph back for a retake.
import type { ID } from '../types'

/** What the director decided after reading a stretch. */
export type DirectorVerdict = 'continue' | 'retake' | 'done'

/** What a directed draft is doing: writing a stretch, reading it, asking the director, writing a paragraph again, or done. */
export type DirectorPhase = 'writing' | 'checking' | 'directing' | 'retaking' | 'done'

export interface DirectorProgress {
  generationId: ID
  sceneId: ID
  /** The stretch being written, or just read, from 1. */
  stretch: number
  /** How many stretches the scene is planned in (it may take one or two more). */
  of: number
  phase: DirectorPhase
  /** The director's line, in plain words ("Carry on — next, the knock at the door"). */
  line: string
  /** The note the writer is given for the next stretch; '' for none. */
  note: string
  /** Adam's notes waiting for the next pause. */
  waiting: number
  /** Adam's notes that went in at this pause, as he wrote them. */
  taken?: string[]
}

export interface DirectorApi {
  /**
   * Adam's note for a directed draft while it writes ("slower", "she wouldn't say that"): it goes in at the next pause.
   * False when that draft isn't being directed any more (it ended).
   */
  directorNote(generationId: ID, note: string): Promise<boolean>
}

export interface DirectorEvents {
  'director:progress': DirectorProgress
  /**
   * A retake: the draft's last paragraph is taken back from the page (`text`: the words taken back, the paragraph whole),
   * and the paragraph written again streams in where it was.
   */
  'generation:takeBack': { generationId: ID; sceneId: ID; text: string }
}
