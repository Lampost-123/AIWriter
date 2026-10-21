// The handlers for src/shared/contracts/storyBuilder.ts (the Story builder). The work is in src/main/storyBuilder/*;
// this file connects it to the open world, the settings, the recipe library and the window. Building the codex is the
// World builder's own build (ipc/worldBuilder.ts startIn), given the list Adam ticked.
import type { Handlers } from './index'
import type { StoryBuilderApi } from '@shared/contracts/storyBuilder'
import type { RecipeParts } from '@shared/contracts/recipes'
import type { ID } from '@shared/types'
import * as world from '../world'
import * as repo from '../db/repo'
import * as providers from '../ai/providers'
import { jobModel } from '../ai/jobModel'
import { getSettings, getWritingPrefs } from '../settings'
import { emit } from '../events'
import { UserError } from '../util'
import { recipeFiles } from '../recipes'
import { isRecipeId } from '../recipes/store'
import { noteStoryRecipe } from '../recipes/storyRecipe'
import { askQuestion } from '../worldBuilder/interview'
import { briefText, cleanBrief, readBrief, recipeAsUsed, styleText, writeBrief } from '../storyBuilder/brief'
import { buildSummary, planOf } from '../storyBuilder/codex'
import { cleanCodex } from '../storyBuilder/brief'
import {
  planStoryCodex,
  recipeChat,
  redoCodexItem,
  redoRecipePart,
  startPlanChat,
  startPlanRedo,
  storyCodexChat,
  type StoryDeps
} from '../storyBuilder/jobs'
import { startIn } from './worldBuilder'

const modelSources = () => ({ settings: getSettings(), getProvider: providers.getProvider, providerTarget: providers.providerTarget })

/** A finished recipe in the library, by id; null when it is gone, newer than this AI Write, or still being made. */
function readRecipe(id: ID): { name: string; parts: RecipeParts } | null {
  if (!isRecipeId(id)) return null
  try {
    const r = recipeFiles().read(id)
    return r && !r.newer && r.status === 'ready' ? { name: r.name, parts: r.parts } : null
  } catch (e) {
    console.warn('Could not read the story’s recipe', e)
    return null
  }
}

export const storyBuilderDeps = (): StoryDeps => deps()

function deps(): StoryDeps {
  const model = jobModel('chat', modelSources())
  return { db: world.db(), model, emit, onKeyRejected: () => providers.markCheck(model.target.id, false), prefs: getWritingPrefs(), readRecipe }
}

/** The story, checked to be in the open world, and its brief. */
function storyBrief(storyId: unknown): { storyId: ID; brief: ReturnType<typeof readBrief> } {
  const db = world.db()
  const id = typeof storyId === 'string' ? storyId : ''
  if (!id || !repo.listStories(db).some((s) => s.id === id)) throw new UserError('That story isn’t here any more. It may have been deleted.', 'no-story')
  return { storyId: id, brief: readBrief(db, id) }
}

export const storyBuilderHandlers: Handlers<keyof StoryBuilderApi> = {
  getStoryBrief: (storyId) => storyBrief(storyId).brief,
  saveStoryBrief: (storyId, brief) => {
    const { storyId: id } = storyBrief(storyId)
    const db = world.db()
    const clean = cleanBrief(brief)
    writeBrief(db, id, clean)
    // The recipe it follows, so its world build and the recipe page know (only the id is kept).
    if (clean.recipe) noteStoryRecipe(db, id, clean.recipe.id)
    repo.touchWorld(db)
  },
  askStoryQuestion: (input) => {
    const { storyId, brief } = storyBrief(input?.storyId)
    const db = world.db()
    const story = repo.getStory(db, storyId)
    const model = jobModel('world', modelSources())
    const summary = [briefText(brief, story), styleText(db, story, getWritingPrefs())].filter((s) => s.trim()).join('\n\n')
    const asked = (Array.isArray(input?.asked) ? input.asked : []).map((a) => ({ topic: String(a?.topic ?? ''), question: String(a?.question ?? ''), skipped: !String(a?.answer ?? '').trim(), answer: String(a?.answer ?? '') }))
    return askQuestion({ db, model, emit, onKeyRejected: () => providers.markCheck(model.target.id, false) }, { taskId: String(input?.taskId ?? ''), summary, asked })
  },
  planStoryCodex: (input) => {
    const { storyId, brief } = storyBrief(input?.storyId)
    return planStoryCodex(deps(), { taskId: String(input?.taskId ?? ''), storyId }, brief)
  },
  storyCodexChat: (input) => {
    const { storyId, brief } = storyBrief(input?.storyId)
    return storyCodexChat(deps(), { ...input, storyId }, brief)
  },
  redoCodexItem: (input) => {
    const { storyId, brief } = storyBrief(input?.storyId)
    return redoCodexItem(deps(), { ...input, storyId }, brief)
  },
  buildStoryCodex: (input) => {
    const { storyId, brief } = storyBrief(input?.storyId)
    const db = world.db()
    const items = cleanCodex(input?.items).filter((it) => it.on)
    if (!items.length) throw new UserError('Tick at least one thing to build first.')
    const story = repo.getStory(db, storyId)
    const recipe = recipeAsUsed(brief.recipe ? readRecipe(brief.recipe.id) : null, brief)
    const summary = buildSummary(briefText(brief, story), styleText(db, story, getWritingPrefs()), recipe?.parts.cast ?? '', items)
    startIn({ buildId: String(input?.buildId ?? ''), summary, storyId, plan: planOf(items) })
  },
  startPlanChat: (input) => {
    const { storyId, brief } = storyBrief(input?.storyId)
    return startPlanChat(deps(), { ...input, storyId }, brief)
  },
  startPlanRedo: (input) => {
    const { storyId, brief } = storyBrief(input?.storyId)
    return startPlanRedo(deps(), { ...input, storyId }, brief)
  },
  recipeChat: (input) => recipeChat(deps(), input),
  redoRecipePart: (input) => redoRecipePart(deps(), input)
}
