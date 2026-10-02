// The character builder and the lighter builders for places, groups and items (milestone 3).
// Owned by the Builder part. See docs/ARCHITECTURE.md, "Milestone 3".
import type { ID } from '../types'

/** Entry kinds that have a builder. */
export type BuilderKind = 'character' | 'place' | 'group' | 'item'

export interface BuilderApi {}

export interface BuilderEvents {}

/** Where the builder was opened from, so it can start with Adam's words already in place. */
export interface BuilderStart {
  /** Notes to start Quick start with (a passage Adam selected in a scene, say). */
  notes?: string
  /** The scene the notes came from. */
  sceneId?: ID | null
  /** 'quick' opens Quick start; 'guided' the first step. */
  mode?: 'quick' | 'guided'
}
