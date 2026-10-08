// Roughly what the import catch-up would cost, before it starts: the memory keeper's reading requests for
// each unread scene (in chunks that fit the memory model, each with the instructions and some of the memory),
// each scene's summary, and the chapter and story roll-ups after. Said as "About $1.40", since what the memory
// sends grows as it learns the story and replies vary. Null when the model's prices aren't known. Pure.

import type { ModelChoice, ThinkingLevel } from '@shared/types'
import { readingBudget } from '../keeper/request'
import { READING_SYSTEM, SUMMARY_SYSTEM } from '../keeper/prompts'
import { estimateTokens } from '../keeper/text'

/** How much more a model writes when asked to think (its thinking is paid for too), as the World builder reckons it. */
const THINKING_COST: Record<ThinkingLevel, number> = { off: 1, auto: 1.5, low: 1.5, medium: 2, high: 3 }

/** About how much of the memory goes with each reading request, at most, in tokens. */
const MEMORY_TOKENS = 1800
/** About how long a reading reply is: a little for each request, more for longer text. */
const REPLY_BASE = 250
const REPLY_SHARE = 0.15
/** A scene's summary, and a roll-up's. */
const SUMMARY_REPLY = 160
const ROLL_UP_REPLY = 260
/** Scenes shorter than this get no summary (keeper/summaries.ts). */
const SUMMARY_MIN_WORDS = 40

export interface CatchUpGuess {
  input: number
  output: number
}

/** About how many tokens reading these scenes (characters and words of each) and their chapters takes. */
export function guessCatchUp(
  scenes: { chars: number; words: number }[],
  chapters: number,
  choice: Pick<ModelChoice, 'contextLength' | 'maxOutput'>,
  thinking: ThinkingLevel
): CatchUpGuess {
  const budget = readingBudget(choice)
  const system = estimateTokens(READING_SYSTEM)
  const summarySystem = estimateTokens(SUMMARY_SYSTEM)
  let input = 0
  let output = 0
  for (const s of scenes) {
    const tokens = Math.ceil(s.chars / 3.5)
    const chunks = budget ? Math.max(1, Math.ceil(tokens / budget.text)) : 1
    const memory = budget ? Math.min(MEMORY_TOKENS, Math.floor(budget.available * 0.4)) : MEMORY_TOKENS
    input += chunks * (system + memory + 150) + tokens
    output += Math.min(budget?.reply ?? 4000, chunks * REPLY_BASE + Math.round(tokens * REPLY_SHARE))
    if (s.words >= SUMMARY_MIN_WORDS) {
      input += summarySystem + tokens + 120
      output += SUMMARY_REPLY
    }
  }
  // A summary for each chapter from its scenes', and one for the story from its chapters'.
  input += chapters * (summarySystem + 200) + Math.round(scenes.length * SUMMARY_REPLY * 1.1) + (summarySystem + chapters * ROLL_UP_REPLY)
  output += (chapters + 1) * ROLL_UP_REPLY
  return { input, output: Math.round(output * THINKING_COST[thinking]) }
}

/** USD, or null when the model's prices aren't known. */
export function catchUpCost(g: CatchUpGuess, choice: Pick<ModelChoice, 'promptPrice' | 'completionPrice'>): number | null {
  if (choice.promptPrice == null || choice.completionPrice == null) return null
  return g.input * choice.promptPrice + g.output * choice.completionPrice
}

/**
 * About how many tokens reading these scenes again takes (World Memory Overhaul B8, "Re-read"): the memory keeper's
 * reading requests only, as the catch-up reckons them (no summaries: a re-read writes none unless the scene changed).
 */
export function guessReread(
  scenes: { chars: number }[],
  choice: Pick<ModelChoice, 'contextLength' | 'maxOutput'>,
  thinking: ThinkingLevel
): CatchUpGuess {
  const budget = readingBudget(choice)
  const system = estimateTokens(READING_SYSTEM)
  let input = 0
  let output = 0
  for (const s of scenes) {
    const tokens = Math.ceil(s.chars / 3.5)
    const chunks = budget ? Math.max(1, Math.ceil(tokens / budget.text)) : 1
    const memory = budget ? Math.min(MEMORY_TOKENS, Math.floor(budget.available * 0.4)) : MEMORY_TOKENS
    input += chunks * (system + memory + 150) + tokens
    output += Math.min(budget?.reply ?? 4000, chunks * REPLY_BASE + Math.round(tokens * REPLY_SHARE))
  }
  return { input, output: Math.round(output * THINKING_COST[thinking]) }
}

/**
 * What a re-read costs in USD (B8): at what the memory model has lately cost per token in its own runs' records when
 * there are any (they show what is really paid, cached prompts and all), else at the model's prices; null when neither
 * is known.
 */
export function rereadCost(g: CatchUpGuess, choice: Pick<ModelChoice, 'promptPrice' | 'completionPrice'>, perToken: number | null): number | null {
  if (perToken != null) return (g.input + g.output) * perToken
  return catchUpCost(g, choice)
}
