// Story recipes, connected to the settings (the library folder, the Recipe maker's model), the monthly spending
// limit and the window. The pieces:
//   paths.ts     where the recipe library is (<library>/Recipes), never a world
//   store.ts     its files: each recipe, the story's text, the notes while it is made, Undo for removing
//   source.ts    the story as kept, and what code counts about it (words, scenes, dialogue)
//   prompts.ts   what the Recipe maker is asked; parse.ts reads its answers
//   leaks.ts     no names, places or copied sentences in a recipe
//   maker.ts     making a recipe in the background, carrying on after a restart
//   estimate.ts  roughly what it costs, before anything is sent
//   spending.ts  what its calls cost, kept in Recipes/spending.db without their words (ledger.ts keeps it open)
//   story.ts     a new story from a recipe, through the outline helper
// The story's text goes only to the Recipe maker's model, and only while a recipe is made (or read again).

import { getSettings } from '../settings'
import * as providers from '../ai/providers'
import { jobModel, type JobModel } from '../ai/jobModel'
import { runTask, stopTask } from '../ai/tasks'
import { emit } from '../events'
import { onMemorySettingsChanged } from '../keeper'
import { heldAt } from '../usage/gate'
import { recipeCallFinished } from '../usage'
import { reachedWords } from '@shared/contracts/usage'
import { newId, UserError } from '../util'
import { closeSpending, spendingDb } from './ledger'
import { RecipeMaker, type CallOutcome, type CallRequest } from './maker'
import { recipesDir } from './paths'
import { wipeWords } from './spending'
import { RecipeFiles } from './store'

let files: RecipeFiles | null = null

/** The recipe library's files for the library folder Adam has now. */
export function recipeFiles(): RecipeFiles {
  const dir = recipesDir(getSettings().libraryPath)
  if (!files || files.dir !== dir) files = new RecipeFiles(dir)
  return files
}

/** The Recipe maker's model, or why there is none, in plain words. */
export function recipeModel(): JobModel | { error: string } {
  try {
    return jobModel('recipe', { settings: getSettings(), getProvider: providers.getProvider, providerTarget: providers.providerTarget })
  } catch (e) {
    if (e instanceof UserError) return { error: e.message }
    throw e
  }
}

/** While the monthly limit holds AI calls, what the recipe's line says. */
function heldWords(): string | null {
  const limit = heldAt()
  return limit == null
    ? null
    : `${reachedWords(limit)} Making recipes is paused until you choose Carry on this month, raise the limit on the Usage and cost page, or the month turns.`
}

async function call(req: CallRequest, signal: AbortSignal): Promise<CallOutcome> {
  const model = recipeModel()
  if ('error' in model) return { status: 'error', text: '', error: model.error, cutOff: false }
  const db = spendingDb(getSettings().libraryPath)
  const taskId = newId()
  const stop = (): void => void stopTask(taskId).catch(() => undefined)
  signal.addEventListener('abort', stop, { once: true })
  try {
    const done = await runTask({
      db,
      taskId,
      job: 'recipe',
      sceneId: '',
      model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user }
      ],
      reply: req.reply,
      temperature: req.temperature,
      // Nothing in the window listens for a recipe's words: only how it is going ('recipes:maker'). So a window
      // reload doesn't stop the call (it would be paid for twice when asked again).
      emit: () => undefined,
      outlivesWindow: true,
      onKeyRejected: () => providers.markCheck(model.target.id, false)
    })
    try {
      wipeWords(db, done.generationId)
    } catch (e) {
      console.warn('Could not clear the words of a recipe call', e)
    }
    recipeCallFinished()
    return { status: done.status === 'complete' ? 'complete' : done.status === 'stopped' ? 'stopped' : 'error', text: done.text, error: done.error, cutOff: done.cutOff }
  } catch (e) {
    // Turned down before anything was sent (the spending limit, say).
    return { status: 'error', text: '', error: e instanceof Error ? e.message : String(e), cutOff: false }
  } finally {
    signal.removeEventListener('abort', stop)
  }
}

const libraryChanged = (): void => emit('recipes:changed', { at: new Date().toISOString() })

export const maker = new RecipeMaker({
  files: () => {
    try {
      return recipeFiles()
    } catch {
      return null
    }
  },
  model: recipeModel,
  held: heldWords,
  call,
  emit: (s) => emit('recipes:maker', s),
  changed: libraryChanged
})

export { libraryChanged }

/** At start: recipes left being made carry on; a recipe removed long enough ago is deleted for good. */
export function initRecipes(): void {
  onMemorySettingsChanged(() => maker.settingsChanged())
  setTimeout(() => {
    try {
      recipeFiles().purgeRemoved()
    } catch (e) {
      console.warn('Could not tidy the recipe library', e)
    }
    maker.resume()
  }, 1500)
}

/** Quitting: the call under way stops (what was read is kept); removed recipes go for good. */
export function closeRecipes(): void {
  maker.close()
  try {
    recipeFiles().purgeRemoved(Date.now(), true)
  } catch {
    /* the library may be out of reach */
  }
  closeSpending()
}
