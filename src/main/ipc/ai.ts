// Providers, models and drafting. The work is done in src/main/ai/*; this file
// connects it to the open world, the settings and the window.
import type { Handlers } from './index'
import type { ContextPreview, DraftOptions, ID } from '@shared/types'
import { UserError } from '../util'
import * as world from '../world'
import { getSettings, getWritingPrefs } from '../settings'
import { emit } from '../events'
import * as gens from '../db/generations'
import * as providers from '../ai/providers'
import { cachedCounter, finishContext, lengthTooLong, prepareContext, sentEntryVersions, type ContextInput } from '../ai/context'
import { catchUpBeforeDraft, gatherContextInput } from '../ai/gather'
import { countTokens } from '../ai/tokenService'
import { isLocalUrl, providerWho } from '../ai/errors'
import { isDrafting, startDraftJob, stopDraft } from '../ai/drafts'
import { memorySettingsChanged } from '../keeper'

type AiMethods =
  | 'listProviders' | 'saveProvider' | 'deleteProvider' | 'restoreProvider' | 'testProvider' | 'listModels'
  | 'previewContext' | 'startDraft' | 'stopGeneration' | 'cancelDraftStart' | 'listGenerations' | 'getGeneration'

/** The preview is made again as Adam edits the scene card: only the blocks that changed are counted again. */
const countCached = cachedCounter(countTokens)

/** Assembles the briefing for a scene with the current writer model's context length. */
async function assemble(sceneId: ID, options: Partial<DraftOptions> | undefined): Promise<{ input: ContextInput; preview: ContextPreview }> {
  const settings = getSettings()
  const input = gatherContextInput(world.db(), sceneId, options, {
    prefs: getWritingPrefs(),
    contextLength: settings.models.writer?.contextLength ?? null,
    creativity: settings.creativity
  })
  const prepared = prepareContext(input)
  const counts = await countCached(prepared.texts)
  return { input, preview: finishContext(prepared, counts) }
}

function afterProviders<T>(result: T): T {
  memorySettingsChanged()
  return result
}

/** Scenes whose draft is being started (the memory may be catching up first), with how to stop each. */
const starting = new Map<ID, AbortController>()

/** Adam stopped the draft before it began: nothing more is done or sent. */
const stoppedBeforeStart = (): UserError => new UserError('The draft was stopped before it began.', 'cancelled')

export const aiHandlers: Handlers<AiMethods> = {
  listProviders: () => providers.listProviders(),
  // A key added or a provider removed changes what the memory keeper can use, so it tries again now.
  saveProvider: (input) => afterProviders(providers.saveProvider(input)),
  deleteProvider: (id) => afterProviders(providers.deleteProvider(id)),
  restoreProvider: (id) => afterProviders(providers.restoreProvider(id)),
  testProvider: (id, modelId) => providers.testProvider(id, modelId),
  listModels: (providerId) => providers.listModels(providerId),

  previewContext: async (sceneId, options) => (await assemble(sceneId, options)).preview,

  startDraft: async (sceneId, options) => {
    const choice = getSettings().models.writer
    if (!choice) throw new UserError('Choose a writer model first, in Settings › Models.', 'no-writer-model')
    const provider = providers.getProvider(choice.providerId)
    if (!provider) throw new UserError("The writer model's provider has been removed. Choose a writer model in Settings › Models.", 'no-writer-model')
    const target = providers.providerTarget(provider)
    if (!target.apiKey && !(provider.kind === 'custom' && isLocalUrl(provider.baseUrl))) {
      throw new UserError(`${providerWho(provider)} needs an API key. Add it in Settings › Models.`, 'no-key')
    }
    if (isDrafting(sceneId) || starting.has(sceneId)) {
      throw new UserError('A draft is already being written for this scene. Stop it first, or wait for it to finish.')
    }
    const db = world.db()
    const stop = new AbortController()
    starting.set(sceneId, stop)
    try {
      // Earlier scenes the memory hasn't read yet are read first, so the briefing is up to date
      // (spec, Memory upkeep). This never waits long, a failure drafts with what the memory has,
      // and Stop (cancelDraftStart) ends the wait at once.
      await catchUpBeforeDraft(db, sceneId, undefined, stop.signal)
      if (stop.signal.aborted) throw stoppedBeforeStart()
      if (world.maybeCurrentWorld()?.db !== db) throw new UserError('The world was closed before the draft could start.')
      const { input, preview } = await assemble(sceneId, options)
      if (stop.signal.aborted) throw stoppedBeforeStart()
      if (world.maybeCurrentWorld()?.db !== db) throw new UserError('The world was closed before the draft could start.')
      // A model whose window is known can't take a reply longer than what's left of it: say so
      // before sending, rather than letting the provider turn it down with a message about the briefing.
      const tooLong = choice.contextLength != null && choice.contextLength > 0 ? lengthTooLong(preview.budget) : null
      if (tooLong) {
        if (tooLong.maxWords >= 100) {
          throw new UserError(
            `This model can write about ${tooLong.maxWords.toLocaleString('en-GB')} words in one go. Lower the length in the draft options or on the scene card, or pick a model that can read more in Settings › Models.`,
            'too-long'
          )
        }
        throw new UserError(
          "This model can't read the style guide and the scene card and still write the scene. Pick a model that can read more in Settings › Models, or shorten the scene card or the style guide.",
          'briefing-too-long'
        )
      }
      return startDraftJob({
        db,
        sceneId,
        options: input.options,
        preview,
        provider: target,
        model: choice,
        // The version of each entry actually sent, for "What the AI saw".
        entryVersions: sentEntryVersions(input.memory, preview.blocks),
        emit,
        onKeyRejected: () => providers.markCheck(provider.id, false),
        // A provider marked as not working that has just written a draft works again.
        onWorked: () => {
          if (providers.getProvider(provider.id)?.lastCheck?.ok === false) providers.markCheck(provider.id, true)
        }
      })
    } finally {
      if (starting.get(sceneId) === stop) starting.delete(sceneId)
    }
  },
  stopGeneration: (id) => stopDraft(id),
  cancelDraftStart: (sceneId) => {
    starting.get(sceneId)?.abort()
  },
  listGenerations: (sceneId) => gens.listGenerations(world.db(), sceneId),
  getGeneration: (id) => gens.getGeneration(world.db(), id)
}
