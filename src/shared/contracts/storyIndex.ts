// The story index (overhaul phase 1): "Fill in the whole story" (Adam, 2026-10-19). The free part of the index is built
// for every story by itself; the physical details (what people wear, carry and suffer, and where they end up) come from
// where things stand, which the memory model works out scene by scene. For an existing story only its last chapters get
// them by themselves; this fills in every scene of a story whenever Adam asks, after saying roughly what it costs, as
// background memory work with progress (MemoryStatus.filling) and Stop. Main side: src/main/storyIndex/fill.ts.
import type { ID } from '../types'

/** What filling in a story would take, asked before it starts. */
export interface StoryFillEstimate {
  storyId: ID
  /** Scenes with words in the story. */
  total: number
  /** Of those, the scenes not yet filled in (one AI call each), and their words. */
  scenes: number
  words: number
  /** Roughly how many tokens it sends (the scenes' words and what goes with each). */
  tokens: number
  /** USD, roughly; null when the memory model's price isn't known (see `free`). */
  cost: number | null
  /** The memory model runs on this computer (a local server): nothing to pay. */
  free: boolean
  /** The memory model, as Settings › Models names it; null when there is none. */
  model: string | null
  /** Plain words when there is no model to fill in with (the fix is in Settings › Models). */
  problem: string | null
}

/** How far a fill has got: scenes done of how many. */
export interface StoryFillProgress {
  storyId: ID
  title: string
  done: number
  total: number
}

/** A fill is over: done, stopped by Adam, or given up (`problem` says why, in plain words). */
export interface StoryFillDone {
  storyId: ID
  title: string
  total: number
  /** Scenes filled in. */
  filled: number
  /** Scenes the model couldn't (or wouldn't) read. */
  failed: number
  stopped: boolean
  problem: string | null
}

export interface StoryIndexApi {
  /** Roughly what filling in every scene of a story would cost (no model is asked). */
  estimateStoryFill(storyId: ID): Promise<StoryFillEstimate>
  /**
   * Fills in every scene of the story not yet filled, one after another in the background, after the memory's own work
   * and never in front of a draft. Refused while this month's spending limit holds AI calls, or with no memory model.
   */
  startStoryFill(storyId: ID): Promise<void>
  /** Stops a fill: what was filled in stays. */
  stopStoryFill(): Promise<void>
}

export interface StoryIndexEvents {
  /** A fill Adam asked for is over (a quiet note says how it went). */
  'storyFill:done': StoryFillDone
}
