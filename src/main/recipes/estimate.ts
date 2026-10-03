// Roughly what making a recipe costs, before anything is sent: one request for each chapter (or each piece of a
// long chapter, cut to fit the Recipe maker's model) with the instructions, a short reply of notes each, then the
// recipe written from all the notes, and sometimes one request to rewrite a part that named the story's people.
// Said as "About $0.40". Null when the model's prices aren't known. Pure.

import type { ModelChoice, ThinkingLevel } from '@shared/types'
import { estimateTokens } from '../keeper/text'
import { chapterSystem, combineSystem } from './prompts'

const THINKING_COST: Record<ThinkingLevel, number> = { off: 1, auto: 1.5, low: 1.5, medium: 2, high: 3 }

/** Room for a chapter's notes, and for the recipe. */
export const NOTES_REPLY = 700
export const RECIPE_REPLY = 3500
export const FIX_REPLY = 2000
/** Context length assumed when the model's is unknown. */
export const DEFAULT_RECIPE_CONTEXT = 16_000

/** How many characters of story text fit in one request to this model, with room for the notes. */
export function pieceChars(choice: Pick<ModelChoice, 'contextLength'>): number {
  const length = choice.contextLength && choice.contextLength > 0 ? choice.contextLength : DEFAULT_RECIPE_CONTEXT
  const room = length - NOTES_REPLY * 2 - estimateTokens(chapterSystem()) - 300 - Math.ceil(length * 0.05)
  // Even a huge window is read a few chapters' worth at a time at most: the notes stay sharp.
  return Math.max(2000, Math.min(room, 60_000) * 3.5)
}

export interface RecipeGuess {
  input: number
  output: number
}

/** About how many tokens reading these chapters (their characters) and writing the recipe takes. */
export function guessRecipe(chapterChars: number[], choice: Pick<ModelChoice, 'contextLength'>, thinking: ThinkingLevel): RecipeGuess {
  const per = pieceChars(choice)
  const system = estimateTokens(chapterSystem())
  let input = 0
  let output = 0
  let notes = 0
  for (const chars of chapterChars) {
    const pieces = Math.max(1, Math.ceil(chars / per))
    input += pieces * (system + 150) + Math.ceil(chars / 3.5)
    const reply = pieces * Math.round(NOTES_REPLY * 0.6)
    output += reply
    notes += reply
  }
  input += estimateTokens(combineSystem()) + notes + chapterChars.length * 30
  output += Math.round(RECIPE_REPLY * 0.6)
  // Now and then a part names someone from the story and is asked for again.
  input += 400
  output += 300
  return { input, output: Math.round(output * THINKING_COST[thinking]) }
}

/** USD, or null when the model's prices aren't known. */
export function recipeCost(g: RecipeGuess, choice: Pick<ModelChoice, 'promptPrice' | 'completionPrice'>): number | null {
  if (choice.promptPrice == null || choice.completionPrice == null) return null
  return g.input * choice.promptPrice + g.output * choice.completionPrice
}
