// Roughly what making a recipe costs, before anything is sent: one request for each chapter (or each piece of a
// long chapter, cut to fit the Recipe maker's model) with the instructions, a short reply of notes each, then the
// recipe written from all the notes, and sometimes one request to rewrite a part that named the story's people.
// Said as "About $0.40". Null when the model's prices aren't known. Pure.

import type { ModelChoice, ThinkingLevel } from '@shared/types'
import { estimateTokens } from '../keeper/text'
import { chapterSystem, combineSystem, fixSystem } from './prompts'

const THINKING_COST: Record<ThinkingLevel, number> = { off: 1, auto: 1.5, low: 1.5, medium: 2, high: 3 }

/** Room for a chapter's notes, and for the recipe. */
export const NOTES_REPLY = 700
export const RECIPE_REPLY = 3500
export const FIX_REPLY = 2000
/** Context length assumed when the model's is unknown. */
export const DEFAULT_RECIPE_CONTEXT = 16_000

/** The model's longest answer, when it is known. */
const mostOut = (choice: Pick<ModelChoice, 'maxOutput'>): number => (choice.maxOutput && choice.maxOutput > 0 ? choice.maxOutput : Infinity)

/**
 * Room for the recipe (2026-10-17): its beats have a line a chapter, so a long novel needs more than a short one,
 * up to what the model can answer.
 */
export function recipeReply(chapters: number, choice: Pick<ModelChoice, 'maxOutput'>): number {
  return Math.min(mostOut(choice), RECIPE_REPLY + 40 * Math.max(0, chapters))
}

/** Room for the fix: the leaking parts come back rewritten, about as long as they went (2026-10-17). */
export function fixReply(partsText: string, choice: Pick<ModelChoice, 'maxOutput'>): number {
  return Math.min(mostOut(choice), Math.max(FIX_REPLY, Math.ceil(estimateTokens(partsText) * 1.3) + 200))
}

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
export function guessRecipe(chapterChars: number[], choice: Pick<ModelChoice, 'contextLength' | 'maxOutput'>, thinking: ThinkingLevel): RecipeGuess {
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
  const recipe = Math.round(recipeReply(chapterChars.length, choice) * 0.6)
  output += recipe
  // Most recipes have a part or two that name someone from the story: those parts (about a third of the recipe,
  // often the long cast and beats) are sent again and come back rewritten.
  const fix = Math.round(recipe / 3)
  input += estimateTokens(fixSystem()) + 100 + fix
  output += fix
  return { input, output: Math.round(output * THINKING_COST[thinking]) }
}

/** USD, or null when the model's prices aren't known. */
export function recipeCost(g: RecipeGuess, choice: Pick<ModelChoice, 'promptPrice' | 'completionPrice'>): number | null {
  if (choice.promptPrice == null || choice.completionPrice == null) return null
  return g.input * choice.promptPrice + g.output * choice.completionPrice
}
