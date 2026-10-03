// A new story from a recipe (spec, "Story recipes"): the AI lays out the new story's premise, acts, chapters and
// scene cards from the recipe and Adam's guidance, which wins wherever it differs. It is the outline helper at
// work: the chat and brainstorm model, an 'outline' record in the world (it holds the recipe and the guidance,
// never the story the recipe came from), the outline helper's form after a "Premise:" line, read and kept, edited
// or discarded by its suggestions (features/outline). The world's characters, places and threads go with it, so
// the cast roles can be matched to his own. No Electron imports.

import type { RecipeParts, RecipeStoryRequest } from '@shared/contracts/recipes'
import type { ID } from '@shared/types'
import { MODEL_NAMES } from '../ai/jobModel'
import { startTask } from '../ai/tasks'
import { castText, fitBlocks, storyText, threadsText, type BlockDraft } from '../outline/brief'
import { outlineFacts } from '../outline/context'
import { briefingBudget, outlineReplyTokens, OUTLINE_TEMPERATURE, type JobDeps } from '../outline/jobs'
import { cleanSize } from '../outline/prompts'
import { UserError } from '../util'
import { recipeText, storyAsk, storySystem } from './prompts'

/** Room for the premise on top of the outline. */
const PREMISE_REPLY = 200

export function startRecipeStoryJob(deps: JobDeps, recipe: { name: string; parts: RecipeParts }, input: RecipeStoryRequest): { generationId: ID } {
  const size = cleanSize(input.size)
  const reply = outlineReplyTokens(size) + PREMISE_REPLY
  const most = deps.model.choice.maxOutput
  if (most && most > 0 && reply > most) {
    throw new UserError(
      `That is more than the ${MODEL_NAMES.chat} can answer in one go. Ask for fewer chapters or fewer scenes in each, or pick a model that writes longer answers in Settings › Models.`,
      'reply-too-long'
    )
  }
  const guidance = (input.guidance ?? '').trim().slice(0, 6000)
  const facts = outlineFacts(deps.db, input.storyId, '')
  const system = storySystem(size.acts > 0)
  const drafts: BlockDraft[] = [
    { id: 'guidance', title: 'My guidance (it wins wherever it differs from the recipe)', priority: 1, forms: [guidance || 'None: follow the recipe, with new characters and a new setting.'] },
    { id: 'recipe', title: `The recipe: ${recipe.name.trim() || 'Untitled recipe'}`, priority: 1, forms: [recipeText(recipe.parts)] },
    { id: 'story', title: 'The world and the story', priority: 2, forms: [storyText(facts.story)] },
    {
      id: 'threads',
      title: 'Open plot threads in the world',
      priority: 4,
      forms: [threadsText(facts.threads), threadsText(facts.threads, true)],
      entryIds: facts.threads.map((t) => t.id)
    },
    {
      id: 'cast',
      title: 'Characters and places in the world',
      priority: 3,
      forms: [castText(facts.cast, 40), castText(facts.cast, 15), castText(facts.cast, 30, true)],
      entryIds: facts.cast.map((c) => c.id)
    },
    { id: 'ask', title: 'What to plan', priority: 0, forms: [storyAsk(size)] }
  ]
  const fitted = fitBlocks(drafts, system, briefingBudget(deps.model, reply), MODEL_NAMES.chat)
  const versions = new Map([...facts.cast, ...facts.threads].map((l) => [l.id, l.version]))
  const ids = new Set(fitted.blocks.filter((b) => !b.dropped).flatMap((b) => b.entryIds))
  return startTask({
    db: deps.db,
    taskId: input.taskId,
    job: 'outline',
    sceneId: '',
    model: deps.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: fitted.text }
    ],
    reply,
    temperature: OUTLINE_TEMPERATURE,
    direction: guidance,
    blocks: fitted.blocks,
    entries: [...ids].flatMap((entryId) => (versions.has(entryId) ? [{ entryId, version: versions.get(entryId)! }] : [])),
    emit: deps.emit,
    onKeyRejected: deps.onKeyRejected
  })
}
