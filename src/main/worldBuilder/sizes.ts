// How big a build's requests are, shared by the build and its cost estimate: the room each job's reply
// gets, how many things one request lays out, and how much of the summary and the world fit beside the
// instructions. A request always leaves the reply its room (and the model 5% spare), so a long summary
// goes in parts for the first look, and each later request reads the paragraphs about what it lays out.
// Pure.

import type { ModelChoice } from '@shared/types'
import type { WorldJob } from './prompts'

/** Context length assumed when the model's is unknown. */
export const DEFAULT_CONTEXT = 16_000

type Job = 'overview' | 'character' | 'batch' | 'relationships' | 'themes' | 'check'

/** Room for each job's reply, in tokens (thinking gets room on top, as the World builder's Thinking says). */
export const REPLY_TOKENS: Record<Job, number> = {
  overview: 4000,
  character: 5000,
  batch: 6000,
  relationships: 3000,
  themes: 800,
  check: 2000
}

/** The most things of one kind laid out in one request, and about how much reply each takes. */
export const BATCH_MOST = 6
export const BATCH_ITEM_TOKENS = 800

/** The most of the world (its rules, lore, groups and characters) told with each profile. */
export const WORLD_TOKENS = 2500

/** The most of the world's names told with the first look. */
export const NAMES_TOKENS = 2000

/** The most of the summary the first look reads at once, in tokens, however big the model: a part it can list in full. */
export const OVERVIEW_PART_TOKENS = 6000

/** How many times the first look reads a part again for what it left out (it stops when a look finds nothing new). */
export const MORE_LOOKS = 2

/** The longest summary a build takes, in characters (about 30 pages). */
export const MAX_SUMMARY_CHARS = 120_000

export const jobSize = (job: WorldJob): Job =>
  job === 'overview' || job === 'character' || job === 'relationships' || job === 'themes' || job === 'check' ? job : 'batch'

export const contextOf = (choice: Pick<ModelChoice, 'contextLength'>): number =>
  choice.contextLength && choice.contextLength > 0 ? choice.contextLength : DEFAULT_CONTEXT

/** The reply room for a job with this model: its own, within what the model writes in one go and half its window. */
export function replyRoom(choice: Pick<ModelChoice, 'contextLength' | 'maxOutput'>, job: WorldJob): number {
  const most = choice.maxOutput && choice.maxOutput > 0 ? choice.maxOutput : Infinity
  return Math.max(512, Math.min(REPLY_TOKENS[jobSize(job)], most, Math.floor(contextOf(choice) * 0.5)))
}

/** How many tokens of summary fit in a request beside `fixed` tokens of instructions and world, leaving the reply its room. */
export function summaryRoom(choice: Pick<ModelChoice, 'contextLength' | 'maxOutput'>, job: WorldJob, fixed: number): number {
  const ctx = contextOf(choice)
  return Math.max(300, ctx - replyRoom(choice, job) - Math.ceil(ctx * 0.05) - fixed - 200)
}

/** How much of the world fits with a profile: the most, or a quarter of what the window has beside the reply. */
export function worldRoom(choice: Pick<ModelChoice, 'contextLength' | 'maxOutput'>, job: WorldJob): number {
  return Math.max(300, Math.min(WORLD_TOKENS, Math.floor((contextOf(choice) - replyRoom(choice, job)) * 0.25)))
}
