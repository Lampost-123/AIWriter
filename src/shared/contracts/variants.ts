// Variants (milestone 4): 2 or 3 drafts of a scene written side by side; Adam picks one, or takes
// paragraphs from each. Owned by the Variants part. See docs/ARCHITECTURE.md, "Milestone 4".
//
// Each variant is a 'draft' generation record with `params.variant` ({ setId, index, of }), written with
// the shared draft runner (startDraftJob with exclusive: false), so its text arrives as
// 'generation:chunk' events and it ends with 'generation:done'. Variants never go into the page until
// Adam picks, and unchosen ones never reach the memory (it reads only the scene's text).
//
// A set is briefed once (draftBriefing: the memory catches up with earlier scenes first, then the
// briefing is made), and every variant in it is sent that same briefing, with the scene's draft options
// (direction, length, creativity), the same ones Generate and the Context tab use.
import type { Creativity, DraftOptions, GenerationStatus, ID } from '../types'

/** How many variants a set has. */
export type VariantCount = 2 | 3

export interface StartVariantsInput {
  /** Made by the interface (any unique id), so it knows the set before anything arrives. */
  setId: ID
  sceneId: ID
  count: VariantCount
  /** The scene's draft options, as Generate would draft with them. */
  options: DraftOptions
}

export interface VariantsStarted {
  setId: ID
  /** One draft per variant, in order (variant 1 first). */
  generationIds: ID[]
}

/** One variant of a set, as its record has it. */
export interface Variant {
  generationId: ID
  /** Which variant it is, from 1. */
  index: number
  status: GenerationStatus
  /** Its text as the model wrote it (so far, while it is being written). */
  text: string
  /** Plain words with a next step, when status is 'error'. */
  error: string | null
  /** USD, the provider's own figure or AI Write's estimate (costEstimated); null when unknown. */
  cost: number | null
  costEstimated: boolean
  /** It ran into the reply limit, so it stops before the scene's end. */
  cutOff: boolean
  modelId: string
}

/** A set of variants, read from their records. */
export interface VariantSet {
  setId: ID
  sceneId: ID
  /** How many variants the set was started with. */
  of: number
  createdAt: string
  /** The options it was written with. */
  direction: string
  targetWords: number | null
  creativity: Creativity | null
  /** In order, variant 1 first. */
  variants: Variant[]
}

export interface VariantsApi {
  /**
   * Starts a set of 2 or 3 variants of a scene, side by side. The memory catches up with earlier scenes
   * and the briefing is made once for the whole set; then every variant is sent it and writes in the
   * background (their text arrives as 'generation:chunk' events, by generationId). Nothing goes into the
   * scene. Refused in plain words (code 'busy') while a draft of the scene, or another set of its
   * variants, is being written; fails with the code 'cancelled' when stopVariants called it off before it
   * began (nothing was sent).
   */
  startVariants(input: StartVariantsInput): Promise<VariantsStarted>
  /**
   * Stops a set: one still getting ready is called off (nothing is sent), and every variant still being
   * written stops, keeping what arrived. Resolves once their records are finished. Stop one variant with
   * stopGeneration.
   */
  stopVariants(setId: ID): Promise<void>
  /** The scene's latest set of variants, from their records, or null when it has none. */
  getVariantSet(sceneId: ID): Promise<VariantSet | null>
}

export interface VariantsEvents {
  // None beyond the generation events: each variant streams as 'generation:chunk' and ends with 'generation:done'.
}
