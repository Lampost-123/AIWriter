// Providers, models and drafting. The work is done in src/main/ai/*; this file
// connects it to the open world, the settings and the window.
import type { Handlers } from './index'
import type { ID } from '@shared/types'
import { UserError } from '../util'
import * as world from '../world'
import { emit } from '../events'
import * as gens from '../db/generations'
import * as providers from '../ai/providers'
import { isDrafting, startDraftJob, stopDraft } from '../ai/drafts'
import { isStartingBeat } from '../beats'
import { assemble, draftBriefing, providerNotes } from '../ai/draftFlow'
import { memorySettingsChanged } from '../keeper'
import { VARIANTS_WRITING, variantsBusy } from '../variants'

type AiMethods =
  | 'listProviders' | 'saveProvider' | 'deleteProvider' | 'restoreProvider' | 'testProvider' | 'listModels'
  | 'previewContext' | 'startDraft' | 'stopGeneration' | 'cancelDraftStart' | 'listGenerations' | 'getGeneration' | 'keepReplacedText'

function afterProviders<T>(result: T): T {
  memorySettingsChanged()
  return result
}

/** Scenes whose draft is being started (the memory may be catching up first), with how to stop each. */
const starting = new Map<ID, AbortController>()

/** True while a draft of this scene is being started (milestone 4's Variants and Beat by beat check it too). */
export const isStartingDraft = (sceneId: ID): boolean => starting.has(sceneId)

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
    // Milestone 4: the scene's variants (getting ready, or being written) have it for now.
    if (variantsBusy(sceneId)) throw new UserError(VARIANTS_WRITING, 'busy')
    if (isDrafting(sceneId) || starting.has(sceneId)) {
      throw new UserError('A draft is already being written for this scene. Stop it first, or wait for it to finish.')
    }
    // Milestone 4: a beat of the scene getting ready (Beat by beat) has it for now too.
    if (isStartingBeat(sceneId)) throw new UserError('A beat is being written for this scene. Stop it first, or wait for it to finish.')
    const db = world.db()
    const stop = new AbortController()
    starting.set(sceneId, stop)
    try {
      const b = await draftBriefing(sceneId, options, { signal: stop.signal })
      return startDraftJob({
        db,
        sceneId,
        options: b.input.options,
        preview: b.preview,
        provider: b.target,
        model: b.choice,
        thinking: b.thinking,
        intensity: b.input.style.intensity,
        entryVersions: b.entryVersions,
        emit,
        ...providerNotes(b.target.id)
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
  getGeneration: (id) => gens.getGeneration(world.db(), id),
  keepReplacedText: (id, replaced) => gens.keepReplacedText(world.db(), id, replaced)
}
