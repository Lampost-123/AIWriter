// Story recipes: the handlers for src/shared/contracts/recipes.ts. The work is in src/main/recipes/*; this file
// connects it to the settings, the open world (for a new story from a recipe) and the window.
import type { Handlers } from './index'
import type { RecipesApi } from '@shared/contracts/recipes'
import * as world from '../world'
import * as repo from '../db/repo'
import * as providers from '../ai/providers'
import { jobModel } from '../ai/jobModel'
import { getSettings } from '../settings'
import { emit } from '../events'
import { newId, now, UserError } from '../util'
import { readText } from '../importing/text'
import { libraryChanged, maker, recipeFiles, recipeModel } from '../recipes'
import { guessRecipe, recipeCost } from '../recipes/estimate'
import { emptyParts } from '../recipes/parse'
import { recipeIntoStory, storyBeforeRecipe } from '../recipes/apply'
import { chapterText, sourceFromPlan, sourceWords, type RecipeSource } from '../recipes/source'
import { startRecipeStoryJob } from '../recipes/story'
import { noteStoryRecipe } from '../recipes/storyRecipe'
import { isRecipeId, NEWER, type StoredRecipe } from '../recipes/store'

const GONE = 'That recipe isn’t in your recipe library any more.'

/** The recipe, or a UserError. The id is checked first (2026-10-17); one made by a newer AI Write can't be opened, only deleted. */
function stored(id: string, o: { newer?: boolean } = {}): StoredRecipe {
  if (!isRecipeId(id)) throw new UserError(GONE, 'no-recipe')
  const r = recipeFiles().read(id)
  if (!r) throw new UserError(GONE, 'no-recipe')
  if (r.newer && !o.newer) throw new UserError(NEWER, 'newer-recipe')
  return r
}

const full = (r: StoredRecipe): Awaited<ReturnType<RecipesApi['getRecipe']>> => ({
  ...recipeFiles().summary(r),
  parts: r.parts,
  edited: r.edited,
  problem: r.problem,
  unread: r.unread ?? []
})

/** What reading these chapters would cost with the Recipe maker's model now. */
function estimateOf(src: RecipeSource): Awaited<ReturnType<RecipesApi['estimateRecipe']>> {
  const words = sourceWords(src)
  const chapters = src.chapters.length
  const m = recipeModel()
  if ('error' in m) return { words, chapters, cost: null, model: null, problem: m.error }
  const guess = guessRecipe(
    src.chapters.map((c) => chapterText(c).length),
    m.choice,
    getSettings().thinking?.recipe ?? 'off'
  )
  return { words, chapters, cost: recipeCost(guess, m.choice), model: m.choice.label || m.choice.modelId, problem: null }
}

const isId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 64

/** The Recipe maker's model, or a plain-words UserError saying what to set up. */
function needModel(): void {
  const m = recipeModel()
  if ('error' in m) throw new UserError(m.error, 'no-recipe-model')
}

const NAME_MAX = 120

export const recipesHandlers: Handlers<keyof RecipesApi> = {
  listRecipes: () => {
    const files = recipeFiles()
    files.purgeRemoved()
    return files.list().map((r) => files.summary(r))
  },
  getRecipe: (id) => full(stored(id)),
  readPastedStory: (text) => {
    const clean = String(text ?? '')
    if (!clean.trim()) throw new UserError('Paste the story’s text first.', 'empty')
    const m = readText(clean, 'Pasted story')
    if (!m.blocks.some((b) => b.kind === 'para' || b.kind === 'heading')) throw new UserError('There is no text in it to read.', 'empty')
    return { ...m, fileName: 'Pasted text' }
  },
  estimateRecipe: (plan) => estimateOf(sourceFromPlan(plan)),
  startRecipe: ({ name, plan }) => {
    const src = sourceFromPlan(plan)
    if (!src.chapters.length) throw new UserError('There is no text in it to read. Choose another file or paste the story.', 'empty')
    needModel()
    const files = recipeFiles()
    files.ensure()
    const id = newId()
    const at = now()
    const own = String(name ?? '').trim().slice(0, NAME_MAX)
    const r: StoredRecipe = {
      version: 1,
      id,
      name: own,
      nameBy: own ? 'adam' : 'ai',
      status: 'making',
      problem: null,
      words: sourceWords(src),
      chapters: src.chapters.length,
      byHand: false,
      createdAt: at,
      updatedAt: at,
      parts: emptyParts(),
      edited: []
    }
    // The story's text and the notes come first, then the recipe that says it is being made: a crash or a failed
    // write never leaves a recipe "being made" with nothing to make it from (a folder with no recipe.json is ignored).
    files.writeSource(id, src)
    files.writeMaking(id, { version: 1, queuedAt: at, notes: src.chapters.map(() => null), held: null, wasReady: false })
    files.write(r)
    maker.resume()
    libraryChanged()
    return files.summary(files.read(id) ?? r)
  },
  getRecipeMaker: () => maker.state(),
  carryOnRecipe: (id) => {
    stored(id)
    needModel()
    maker.carryOn(id)
  },
  cancelRecipe: async (id) => {
    const r = stored(id)
    // A finished recipe isn't being made: Cancel would take it out of the library (2026-10-17).
    if (r.status === 'ready' && !recipeFiles().making(id)) {
      throw new UserError('This recipe is already made, so there is nothing to cancel. To remove it, use Delete on its page.', 'not-making')
    }
    await maker.stop(id)
    // A finished recipe being read again goes back to how it was; only a new one goes out of the library.
    const removed = !maker.backToReady(id)
    if (removed) recipeFiles().remove(id)
    maker.resume()
    libraryChanged()
    return { removed }
  },
  readRecipeAgain: (id) => {
    const r = stored(id)
    if (r.status !== 'ready') throw new UserError('This recipe is still being made.', 'busy')
    const src = recipeFiles().source(id)
    if (!src) throw new UserError('The story’s text isn’t kept with this recipe any more, so it can’t be read again.', 'no-source')
    needModel()
    // What it costs, for the toast that says it has started (with Cancel) (2026-10-17).
    const estimate = estimateOf(src)
    maker.start(id)
    libraryChanged()
    return estimate
  },
  newRecipe: () => {
    const files = recipeFiles()
    files.ensure()
    const at = now()
    const r: StoredRecipe = {
      version: 1,
      id: newId(),
      name: 'Untitled recipe',
      nameBy: 'adam',
      status: 'ready',
      problem: null,
      words: 0,
      chapters: 0,
      byHand: true,
      createdAt: at,
      updatedAt: at,
      parts: emptyParts(),
      edited: []
    }
    files.write(r)
    libraryChanged()
    return full(r)
  },
  updateRecipe: (id, patch) => {
    const r = stored(id)
    const next: StoredRecipe = { ...r, parts: { ...r.parts }, edited: [...r.edited], updatedAt: now() }
    if (patch?.name != null) {
      const name = String(patch.name).replace(/\s+/g, ' ').trim().slice(0, NAME_MAX)
      if (name) {
        next.name = name
        next.nameBy = 'adam'
      }
    }
    for (const [k, v] of Object.entries(patch?.parts ?? {})) {
      if (!(k in next.parts) || typeof v !== 'string') continue
      const key = k as keyof StoredRecipe['parts']
      if (next.parts[key] === v) continue
      next.parts[key] = v
      if (!next.edited.includes(key)) next.edited.push(key)
    }
    recipeFiles().write(next)
    libraryChanged()
    return full(next)
  },
  duplicateRecipe: (id) => {
    const r = stored(id)
    if (r.status !== 'ready') throw new UserError('Wait until this recipe is made, then make a copy.', 'busy')
    const files = recipeFiles()
    const at = now()
    // The copy doesn't take the story's text with it: one copy of that is enough.
    const copy: StoredRecipe = { ...r, id: newId(), name: `${r.name.trim() || 'Untitled recipe'} (copy)`, nameBy: 'adam', createdAt: at, updatedAt: at }
    files.write(copy)
    libraryChanged()
    return files.summary(copy)
  },
  deleteRecipe: async (id) => {
    const r = stored(id, { newer: true })
    if (r.status !== 'ready') await maker.stop(id)
    recipeFiles().remove(id)
    maker.resume()
    libraryChanged()
  },
  restoreRecipe: (id) => {
    if (!isRecipeId(id) || !recipeFiles().restore(id)) throw new UserError('That recipe can’t be brought back now.', 'gone')
    libraryChanged()
    emit('recipes:maker', maker.state())
  },
  forgetRecipeSource: (id) => {
    const r = stored(id)
    if (r.status !== 'ready') throw new UserError('Wait until this recipe is made, or cancel it.', 'busy')
    recipeFiles().removeSource(id)
    libraryChanged()
  },
  restoreRecipeSource: (id) => {
    stored(id)
    if (!recipeFiles().restoreSource(id)) throw new UserError('The story’s text can’t be brought back now.', 'gone')
    libraryChanged()
  },
  startRecipeStory: (input) => {
    // The ids first (2026-10-17), and only a finished recipe: one still being made has nothing to plan from yet.
    const r = stored(input?.recipeId)
    if (!isId(input.storyId) || !isId(input.taskId)) throw new UserError('That story isn’t here any more. Choose it again, then try again.', 'no-story')
    if (r.status !== 'ready') throw new UserError('This recipe is still being made. Wait until it is ready, then start the story from it.', 'busy')
    const db = world.db()
    repo.getStory(db, input.storyId)
    noteStoryRecipe(db, input.storyId, r.id)
    const model = jobModel('chat', { settings: getSettings(), getProvider: providers.getProvider, providerTarget: providers.providerTarget })
    return startRecipeStoryJob({ db, model, emit, onKeyRejected: () => providers.markCheck(model.target.id, false) }, r, input)
  },
  applyRecipeToStory: (storyId, recipeId) => {
    const r = stored(recipeId)
    if (!isId(storyId)) throw new UserError('That story isn’t here any more. Choose it again, then try again.', 'no-story')
    const db = world.db()
    const { before, patch } = recipeIntoStory(repo.getStory(db, storyId), r.parts)
    repo.updateStory(db, storyId, patch)
    repo.touchWorld(db)
    return before
  },
  unapplyRecipe: (before) => {
    if (!before || !isId(before.storyId)) throw new UserError('That story isn’t here any more, so there is nothing to undo.', 'no-story')
    const db = world.db()
    // What Adam changed since the recipe went in stays (storyBeforeRecipe).
    repo.updateStory(db, before.storyId, storyBeforeRecipe(repo.getStory(db, before.storyId), before))
    repo.touchWorld(db)
  },
  listRecipePlans: (recipeId) => {
    if (!isRecipeId(recipeId)) return []
    const files = recipeFiles()
    if (!files.read(recipeId)) return []
    return files.plans(recipeId).map((p) => ({ worldId: p.worldId, storyId: p.storyId, guidance: p.guidance, premise: p.premise }))
  },
  saveRecipePlan: (recipeId, storyId, plan) => {
    // Quietly nothing for a recipe or story that has gone: the plan page goes on as it is.
    if (!isRecipeId(recipeId) || !isRecipeId(storyId)) return
    const files = recipeFiles()
    if (!files.read(recipeId)) return
    if (!plan) return files.removePlan(recipeId, storyId)
    const premise = plan.premise ?? { status: 'open', text: null, before: null }
    files.writePlan(recipeId, {
      version: 1,
      worldId: String(plan.worldId ?? ''),
      storyId,
      guidance: String(plan.guidance ?? '').slice(0, 6000),
      premise: {
        status: premise.status === 'kept' || premise.status === 'discarded' ? premise.status : 'open',
        text: typeof premise.text === 'string' ? premise.text : null,
        before: typeof premise.before === 'string' ? premise.before : null
      },
      updatedAt: now()
    })
  }
}
