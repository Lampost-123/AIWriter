// The calm overhaul (Adam: the app is "annoying and frustrating", 2026-10-19): one Check and one Issues list, one note
// per draft, plain waits, refusals with a way on, and a Check that starts at once. What the window needs from the main
// process for it: the steps a draft goes through before its first word, a scene the memory model turned down, and a check
// waiting on the memory that can go ahead now. Additive only.
import type { ID } from '../types'

/**
 * What a draft is doing before its first word (main ai/steps.ts), in order: the memory catching up with earlier scenes,
 * gathering what the scene needs (the briefing), planning the scene, looking things up for the plan, then writing (the
 * request is out; the first words are on their way). A step can come again (the plan after its look-ups).
 */
export type DraftStepKind = 'memory' | 'gathering' | 'plan' | 'lookups' | 'writing'

export interface DraftStep {
  sceneId: ID
  step: DraftStepKind
  /** Look-ups: how many things are being looked up. */
  count?: number
  /**
   * Look-ups: what is being looked up, by the look-up's name (state_of, who_knows, what_happened…), so the window can say
   * it in plain words ("Planning the scene: looking up where everyone is…", the Plan hub's fold-in, 2026-10-20).
   */
  about?: string[]
}

/** A scene whose words, as they are now, the memory model turned down (main keeper/refusals.ts). */
export interface MemoryRefusal {
  sceneId: ID
  /** What it wouldn't do: read the scene (so the memory doesn't know what happens in it) or write its summary. */
  kind: 'read' | 'summary'
  /** The memory model, as Settings › Models names it. */
  model: string
}

export interface CalmApi {
  /** The memory model turned this scene down as its words are now (Issues › Memory); null when it didn't. */
  memoryRefusal(sceneId: ID): Promise<MemoryRefusal | null>
  /** A check waiting for the memory to catch up goes ahead now, with what the memory has (the wait is said, never silent). */
  checkWithoutWaiting(runId: ID): Promise<void>
}

export interface CalmEvents {
  /** A draft moved on to its next step before its first word. */
  'draft:step': DraftStep
}
