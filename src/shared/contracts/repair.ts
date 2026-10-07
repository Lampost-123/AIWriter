// Check and repair (step 3 of the consistency plan, Adam, 2026-10-07): as soon as a draft, Add below, a beat or
// Continue lands in the page, the memory model reads the new words claim by claim against where things stand at the
// point they start (the live stage, continuity/tracker.ts) and the memory's facts (who knows what, injuries, what
// people own, the timeline). A claim that contradicts them is a slip, and every slip quotes words that are really in
// the new words:
//   - a small slip, shown wrong by words the stage has (its own quote), is mended in place: a tiny edit of the AI's
//     own words, one undo step, shown in amber in the page with Undo;
//   - anything that needs a choice is asked as one question in the Issues tab.
// Only the AI's words that just landed are ever changed, never Adam's. One call on the memory model per landing.
import type { ID } from '../types'

/** One paragraph the new words are in, as it stood in the page when they landed. */
export interface LandedParagraph {
  /** The paragraph's whole text (a line break inside it is "\n"). */
  text: string
  /** Where the AI's words in it start and end (characters into `text`): a Continue may carry on one of Adam's paragraphs. */
  from: number
  to: number
}

export interface RepairInput {
  sceneId: ID
  /** The record of the AI's words (a draft, a beat, Continue's edit, a polished draft): only its words are mended. */
  recordId: ID
  /** Whose stage to compare with, when it isn't the record's own (a polished draft: the draft it polished). */
  stageOf?: ID
  /** The paragraphs the new words are in, in order. */
  paragraphs: LandedParagraph[]
  /** The end of the scene's words before the new ones (for what leads in; already counted in where things stand). */
  leadIn: string
}

/** A slip mended in place: in paragraph `para`, characters `start` to `end` (the AI's words `was`) become `now`. */
export interface RepairFix {
  id: ID
  para: number
  start: number
  end: number
  was: string
  now: string
  /** What was wrong, in one plain sentence ("Mara took her hood off earlier, so it stays down."). */
  why: string
}

export interface RepairOutcome {
  /** Null when nothing was checked (no memory model, nothing to check, or switched off). */
  repairId: ID | null
  /** Small slips to mend in the page, at most one per place. */
  fixes: RepairFix[]
  /** Questions raised in the Issues tab for slips that need Adam's choice. */
  questions: number
  /** How many claims the new words made that touch what is known, and how many of them were slips. */
  claims: number
  slips: number
}

export interface RepairApi {
  /** Checks the new words claim by claim (one call on the memory model). Never throws for a model problem: nothing is found. */
  checkNewWords(input: RepairInput): Promise<RepairOutcome>
  /**
   * The page says which fixes it made (`applied`) and which it couldn't (Adam was editing those words): the made ones
   * are kept as fixed issues, the rest are asked as questions. Returns each made fix's issue id, by fix id.
   */
  repairsApplied(repairId: ID, applied: ID[]): Promise<Record<ID, ID>>
}

export interface RepairEvents {
  // The issues the repair raises are told as 'issues:changed', as the checks' are.
}
