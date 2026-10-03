// Story recipes (spec, "Story recipes"; its own update after milestone 6). Adam imports a whole story (Word,
// Markdown, plain text, or pasted) and the AI distils it into a recipe: the story's themes, writing style and
// structure, without its words. He keeps recipes in a recipe library on his computer and can start a new story
// from one. Owned by the Story recipes part. See docs/ARCHITECTURE.md, "Story recipes".
//
// How it goes: the import page's readers and split (milestone 6) turn the file into chapters; startRecipe copies
// the story's text into the recipe's own folder (`<library>/Recipes/<id>/`) and the Recipe maker reads it chapter
// by chapter in the background, then writes the recipe and checks it against the story (no names, places or
// copied sentences). It carries on after a restart. Calls go to the "Recipe maker" model only (Settings ›
// Models; the memory model until Adam picks one). A new story from a recipe is planned with the outline
// helper's model and its suggestions (keep, edit or discard), and takes the recipe's style and themes.

import type { ID } from '../types'
import type { ImportPlan, Manuscript } from './importing'
import type { OutlineSize } from './outline'

/** The parts of a recipe, each plain text Adam can edit. */
export interface RecipeParts {
  /** What the story is about underneath, how each theme surfaces and where it is tested, each act's tone and mood. */
  themes: string
  /** The story's tone in a few words (it goes into a new story's tone). */
  tone: string
  /** Narrative point of view ("Close third person, one character at a time"). */
  pov: string
  /** Tense ("Past"). */
  tense: string
  /** The writing style in plain words: voice, sentence rhythm, vocabulary, the balance of description, inner
   * thought and dialogue, how scenes open and close. */
  style: string
  /** A short passage the AI wrote fresh in that style (never taken from the story). */
  sample: string
  /** Acts and chapters with the job each does, and where the turning points fall (as a share of the way through). */
  shape: string
  /** The story's events chapter by chapter, as general moves. */
  beats: string
  /** The parts the characters play, each one's arc, and how they relate. */
  cast: string
  /** Chapter and scene lengths, how much is dialogue, where tension rises and falls. */
  pacing: string
  /** Set-ups and pay-offs, twists and recurring motifs. */
  devices: string
}

export type RecipePartId = keyof RecipeParts

/** The parts in the order the recipe page shows them. */
export const RECIPE_PARTS: RecipePartId[] = ['themes', 'tone', 'style', 'pov', 'tense', 'sample', 'shape', 'beats', 'cast', 'pacing', 'devices']

/**
 * 'making': being read or written now (or waiting its turn); 'paused': it couldn't go on (`problem` says why;
 * Try again carries on); 'ready': finished, or written by hand.
 */
export type RecipeStatus = 'making' | 'paused' | 'ready'

export interface RecipeSummary {
  id: ID
  /** A neutral name the AI suggested, or Adam's own. Never the story's own title. */
  name: string
  status: RecipeStatus
  /** How long the story it was made from is (0 for one written by hand). */
  words: number
  chapters: number
  createdAt: string
  updatedAt: string
  /** The story's text is still kept with the recipe, so it can be read again. */
  hasSource: boolean
  /** Written by hand ("Write one yourself"), not made from a story. */
  byHand: boolean
}

export interface Recipe extends RecipeSummary {
  parts: RecipeParts
  /** Parts Adam has changed: reading the story again never overwrites them. */
  edited: RecipePartId[]
  /** Why it is paused, in plain words. */
  problem: string | null
}

/** What making a recipe from this story would take, before anything is sent. */
export interface RecipeEstimate {
  words: number
  chapters: number
  /** USD, roughly; null when the model's prices aren't known. */
  cost: number | null
  /** The Recipe maker's model, as Settings › Models names it; null when there is none. */
  model: string | null
  /** Plain words when there is no model to read with (the fix is in Settings › Models). */
  problem: string | null
}

/** The recipe being made now (one at a time; others wait their turn). */
export interface RecipeMaking {
  recipeId: ID
  name: string
  /** 'reading': chapter `chapter` of `chapters`; 'writing': putting the recipe together; 'checking': making sure
   * none of the story's names or sentences are in it. */
  step: 'reading' | 'writing' | 'checking'
  chapter: number
  chapters: number
  status: 'starting' | 'going' | 'paused' | 'stopping'
  error: string | null
  /** Other recipes waiting their turn. */
  waiting: number
}

export interface RecipeMakerState {
  running: RecipeMaking | null
  /** The last recipe finished since the app started (for its toast). `removed`: bits taken out because they
   * named the story's people or places or copied its words. */
  finished: { recipeId: ID; name: string; at: string; removed: number } | null
}

export interface RecipeStoryRequest {
  /** Made by the interface, so every task event can be matched to it. */
  taskId: ID
  storyId: ID
  recipeId: ID
  /** Adam's own guidance ("set it on a space station"); it wins wherever it differs from the recipe. */
  guidance: string
  size: OutlineSize
}

/** What a story had before the recipe's style and themes went in, to put back with Undo. */
export interface RecipeStoryBefore {
  storyId: ID
  themes: string
  tone: string
  style: { pov?: string; tense?: string; proseStyle?: string; samplePassage?: string }
}

export interface RecipesApi {
  /** Every recipe in the library, newest first. */
  listRecipes(): Promise<RecipeSummary[]>
  getRecipe(id: ID): Promise<Recipe>
  /** Pasted text, read as the import reads a plain text file (chapters found by their headings). */
  readPastedStory(text: string): Promise<Manuscript>
  /** Roughly what making a recipe from this split would cost, with the Recipe maker's model. Nothing is sent. */
  estimateRecipe(plan: ImportPlan): Promise<RecipeEstimate>
  /** Copies the story's text into a new recipe's folder and starts reading it in the background. `name` may be ''. */
  startRecipe(input: { name: string; plan: ImportPlan }): Promise<RecipeSummary>
  getRecipeMaker(): Promise<RecipeMakerState>
  /** Try again: a paused recipe carries on. */
  carryOnRecipe(id: ID): Promise<void>
  /** Cancel: stops making it and moves it out of the library (restoreRecipe brings it back, paused). */
  cancelRecipe(id: ID): Promise<void>
  /** Reads the story kept with the recipe again and writes the recipe afresh; parts Adam changed stay as they are. */
  readRecipeAgain(id: ID): Promise<void>
  /** A blank recipe to write by hand. */
  newRecipe(): Promise<Recipe>
  /** Renames it or changes its parts (each changed part becomes Adam's). */
  updateRecipe(id: ID, patch: { name?: string; parts?: Partial<RecipeParts> }): Promise<Recipe>
  duplicateRecipe(id: ID): Promise<RecipeSummary>
  /** Moves it out of the library; restoreRecipe (the toast's Undo) brings it back. Gone for good after a few minutes. */
  deleteRecipe(id: ID): Promise<void>
  restoreRecipe(id: ID): Promise<void>
  /** Deletes the story's text kept with the recipe (it can't be read again after); restoreRecipeSource is its Undo. */
  forgetRecipeSource(id: ID): Promise<void>
  restoreRecipeSource(id: ID): Promise<void>
  /** Plans a new story from a recipe and Adam's guidance; it streams as task events with job 'outline'. */
  startRecipeStory(input: RecipeStoryRequest): Promise<{ generationId: ID }>
  /** Puts the recipe's writing style into the story's style guide and its themes and tone into the story's. */
  applyRecipeToStory(storyId: ID, recipeId: ID): Promise<RecipeStoryBefore>
  /** Undo for applyRecipeToStory. */
  unapplyRecipe(before: RecipeStoryBefore): Promise<void>
}

export interface RecipesEvents {
  /** The recipe being made moved on (a chapter read, paused, finished...). */
  'recipes:maker': RecipeMakerState
  /** The library changed (a recipe made, renamed, deleted...). */
  'recipes:changed': { at: string }
}
