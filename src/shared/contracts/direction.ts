// The direction composer (overhaul, 2026-10-19): the one box Adam tells the AI what to write in (Generate's draft
// options, the desk's steer box, a beat's note, Variants, the AI edits' Rewrite and Continue). It offers back what he
// asked before and the directions he starred. Read-only over the generation records (every direction is saved with its
// draft there already), so no migration; the starred ones live in his writing preferences file, outside every world.
import type { ID } from '../types'

/** Where a direction was given: Generate (a draft, Add below), Variants, a beat's note, Continue, or Rewrite. */
export type DirectionSource = 'draft' | 'variants' | 'beat' | 'continue' | 'rewrite'

/** Which directions a box offers back: those for writing on ('scene'), those for rewriting chosen words, or both. */
export type DirectionKind = 'scene' | 'rewrite' | 'all'

/** A direction Adam gave before, as the records keep it (the same words given again count once, newest first). */
export interface RecentDirection {
  text: string
  /** When it was last given (ISO). */
  at: string
  /** Where it was last given. */
  source: DirectionSource
  /** How many times it was given. */
  uses: number
}

/** The longest direction kept as a favourite (the boxes take 2,000 characters; a favourite is a short ask). */
export const FAVOURITE_MAX_CHARS = 600
/** How many favourites are kept (the oldest starred go first). */
export const FAVOURITES_MAX = 60

export interface DirectionApi {
  /**
   * The directions given in the open world (in one story when `storyId` is given), newest first, the same words once
   * (case, spacing and a closing full stop don't count). `kind` 'scene' (the default): Generate, Variants (and each
   * variant's own), beats' notes and Continue; 'rewrite': the AI edits' Rewrite. At most `limit` (40 by default, 200 at
   * most). Directions the app wrote itself (Write the whole chapter, its fixes) are never offered.
   */
  recentDirections(storyId?: ID | null, limit?: number, kind?: DirectionKind): Promise<RecentDirection[]>
  /** The directions Adam starred, most recently starred first (kept in his writing preferences, for every world). */
  directionFavourites(): Promise<string[]>
  /** Stars a direction (`on`) or takes its star away; returns the favourites as they now are. */
  setDirectionFavourite(text: string, on: boolean): Promise<string[]>
}
