// How much of the story's memory the writer is given, from how much its model can read (Adam, 2026-10-15, after the
// long story memory research: the story so far was capped at about 1,850 words, and five passages found by searching,
// whether the model could read 16,000 tokens or a million). The memory now grows with the reading limit: the canon
// timeline (timeline.ts) may take 15% of what the model reads (RisuAI, an open-source chat tool, keeps a fifth for
// memory), and a search offers more passages (retrieval/), from the smallest model's amounts up to MOST_SCALE times
// them, so the whole briefing stays in the low tens of thousands of tokens, where long-reading tests find models
// dependable. It depends on the model's reading limit only, never on what a step of a scene adds, so the timeline reads
// the same at every step of a scene (the provider's cache). Pure.

/** The share of the model's reading limit the story so far may have, in tokens, against what it was given before. */
const STORY_SHARE = 0.15
/** The story so far's room before (timeline.ts TIMELINE_WORDS[0], about 2,500 tokens): scale 1. */
const BASE_TOKENS = 2_500
/** The most the memory grows: about 9,000 tokens of story so far (a model that reads 60,000 tokens or more). */
export const MOST_SCALE = 3.6

/**
 * How many times the smallest model's memory this model is given: 1 for a model that reads 16,000 tokens (or when
 * that isn't known), up to MOST_SCALE for one that reads 60,000 or more.
 */
export function memoryScale(contextLength: number | null | undefined): number {
  if (!contextLength || contextLength <= 0) return 1
  const f = (contextLength * STORY_SHARE) / BASE_TOKENS
  return Math.round(Math.max(1, Math.min(MOST_SCALE, f)) * 100) / 100
}

/**
 * The share of the briefing's room kept for what step 5 finds by searching (retrieval/briefing.ts: entries recalled, what
 * was said, earlier passages), so they are no longer only given what is left over (ai/context.ts finishContext). Only as
 * much as they need.
 */
export const RECALL_SHARE = 0.1

/** How many earlier passages a search offers at most (retrieval/recall.ts), and how many the passages block holds. */
export const passagesFound = (scale: number): number => Math.round(6 * Math.min(2, Math.max(1, scale)))
export const passagesShown = (scale: number): number => Math.round(5 * Math.min(2, Math.max(1, scale)))
