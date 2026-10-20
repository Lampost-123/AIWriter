// Roughly how long Write the whole chapter takes, and what it costs, once its plan is made (Build with AI's plan review,
// 2026-10-20: "About 6 minutes · about 9 cents"). From the plan on, each scene is drafted by the writer model (its
// briefing, then the card's length of words), read by the memory (the memory model), planned before writing when that
// is on (two requests of the memory model: the plan and its look-ups' answer), checked once (the check model) and fixed
// about once (the writer model, one passage); then the critic reads the chapter once (the writer model) when it reads at
// all. The sizes are the measured ones of "The plan reads less" and "Write the chapter, reworked" (docs/ARCHITECTURE.md),
// rounded; the times are typical replies' speeds. It is an "about": the review says so. Pure.

import type { ChapterWriterEstimate } from '@shared/contracts/chapterWriter'

/** A model's prices, US dollars a token (null: not known). */
export interface Price {
  prompt: number | null
  completion: number | null
}

export interface EstimateInput {
  /** Each scene's length, in words (its card's, else the usual length). */
  scenes: { words: number }[]
  writer: Price
  memory: Price
  check: Price
  /** Plan before writing is on (Settings › Models). */
  planFirst: boolean
  /** The critic reads the chapter (Settings › Models). */
  critic: boolean
}

/** Tokens a word of prose takes, about. */
const TOKENS_A_WORD = 1.35

/** What each call sends and gets back, in tokens, about (the measured sizes, rounded). */
export const SIZES = {
  draft: { prompt: 9_000 },
  read: { prompt: 3_500, completion: 900 },
  plan: { prompt: 30_000, completion: 1_200 },
  check: { prompt: 9_000, completion: 700 },
  fix: { prompt: 4_000, completion: 500 },
  critic: { prompt: 4_000, completion: 1_500 }
} as const

/** How long things take, in seconds, about: the writer's words at its speed, and each other call. */
export const SECONDS = { wordsPerSecond: 35, read: 20, plan: 30, check: 15, fix: 12, critic: 40 } as const

const cost = (p: Price, prompt: number, completion: number): number | null =>
  p.prompt == null || p.completion == null ? null : p.prompt * prompt + p.completion * completion

/** The estimate (see the top of this file). Minutes at least 1; cost null when any model in use has no price. */
export function chapterEstimate(i: EstimateInput): ChapterWriterEstimate {
  let seconds = 0
  const parts: (number | null)[] = []
  const prices: Price[] = [i.writer, i.memory, i.check]
  let words = 0
  for (const s of i.scenes) {
    const w = Math.max(100, s.words)
    words += w
    const out = Math.ceil(w * TOKENS_A_WORD)
    parts.push(cost(i.writer, SIZES.draft.prompt, out))
    parts.push(cost(i.memory, SIZES.read.prompt + out, SIZES.read.completion))
    if (i.planFirst) parts.push(cost(i.memory, SIZES.plan.prompt, SIZES.plan.completion))
    parts.push(cost(i.check, SIZES.check.prompt + out, SIZES.check.completion))
    parts.push(cost(i.writer, SIZES.fix.prompt, SIZES.fix.completion))
    seconds += w / SECONDS.wordsPerSecond + SECONDS.read + (i.planFirst ? SECONDS.plan : 0) + SECONDS.check + SECONDS.fix
  }
  if (i.critic && i.scenes.length) {
    parts.push(cost(i.writer, SIZES.critic.prompt + Math.ceil(words * TOKENS_A_WORD), SIZES.critic.completion))
    seconds += SECONDS.critic
  }
  const free = prices.every((p) => p.prompt === 0 && p.completion === 0)
  const known = parts.every((c) => c != null)
  return {
    minutes: Math.max(1, Math.round(seconds / 60)),
    cost: known ? parts.reduce<number>((a, c) => a + (c ?? 0), 0) : null,
    free
  }
}
