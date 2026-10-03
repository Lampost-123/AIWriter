// A recipe into a new story (applyRecipeToStory) and its Undo (unapplyRecipe): the recipe's point of view, tense,
// writing style, sample passage, genres and content levels go into the story's style guide, its themes and tone
// into the story's. Only parts with something in them change anything; genres and levels only when the
// "Genre and content" part names one the app knows (feel.ts). Pure: it works out the change, ipc/recipes.ts saves it.

import type { RecipeParts, RecipeStoryBefore } from '@shared/contracts/recipes'
import { cleanGenres } from '@shared/genres'
import { cleanIntensity } from '@shared/intensity'
import type { Story } from '@shared/types'
import { parseFeel } from './feel'

type StoryPatch = Pick<Story, 'style'> & Partial<Pick<Story, 'themes' | 'tone'>>

export function recipeIntoStory(story: Pick<Story, 'id' | 'themes' | 'tone' | 'style'>, p: RecipeParts): { before: RecipeStoryBefore; patch: StoryPatch } {
  const s = story.style
  const before: RecipeStoryBefore = {
    storyId: story.id,
    themes: story.themes,
    tone: story.tone,
    style: { pov: s.pov, tense: s.tense, proseStyle: s.proseStyle, samplePassage: s.samplePassage }
  }
  const style: Story['style'] = { ...s }
  if (p.pov.trim()) style.pov = p.pov.trim()
  if (p.tense.trim()) style.tense = p.tense.trim()
  if (p.style.trim()) style.proseStyle = p.style.trim()
  if (p.sample.trim()) style.samplePassage = p.sample.trim()
  const feel = parseFeel(p.feel ?? '')
  if (feel.genres.length) {
    before.style.genres = cleanGenres(s.genres)
    style.genres = feel.genres
  }
  if (Object.keys(feel.intensity).length) {
    before.style.intensity = cleanIntensity(s.intensity)
    style.intensity = { ...cleanIntensity(s.intensity), ...feel.intensity }
  }
  return {
    before,
    patch: { style, ...(p.themes.trim() ? { themes: p.themes.trim() } : {}), ...(p.tone.trim() ? { tone: p.tone.trim() } : {}) }
  }
}

/** The story's style guide, themes and tone as they were before the recipe went in. */
export function storyBeforeRecipe(story: Pick<Story, 'style'>, before: RecipeStoryBefore): Required<StoryPatch> {
  const style: Story['style'] = { ...story.style }
  for (const k of ['pov', 'tense', 'proseStyle', 'samplePassage'] as const) {
    const v = before.style[k]
    if (v) style[k] = v
    else delete style[k]
  }
  // Only when the recipe set them: then they go back to what the story had (nothing, if it had none).
  if (before.style.genres) {
    const g = cleanGenres(before.style.genres)
    if (g.length) style.genres = g
    else delete style.genres
  }
  if (before.style.intensity) {
    const i = cleanIntensity(before.style.intensity)
    if (Object.keys(i).length) style.intensity = i
    else delete style.intensity
  }
  return { style, themes: before.themes ?? '', tone: before.tone ?? '' }
}
