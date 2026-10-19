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
import { soFarBlock } from '../beats/instructions'
import * as repo from '../db/repo'
import { getSettings } from '../settings'
import { draftBriefing, previewBriefing, providerNotes } from '../ai/draftFlow'
import { noteContract, noteStage, stageTold } from '../repair'
import { memorySettingsChanged } from '../keeper'
import { VARIANTS_WRITING, variantsBusy } from '../variants'
import { noteWriterSpeakers } from '../readAloud'
import { chapterWriterHolds, HELD } from '../chapterWriter/active'
import { directDraft, directedWanted, directorModel } from '../director'

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

  // With the last continuity brief written for the scene, while drafts get one (long story memory fix 14).
  previewContext: (sceneId, options) => previewBriefing(sceneId, options),

  startDraft: async (sceneId, options) => {
    // Write the whole chapter is working on this scene.
    if (chapterWriterHolds(sceneId)) throw new UserError(HELD, 'busy')
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
      // Add below carries on from the scene's words (saved by the window first): the writer is given the scene so
      // far, where things stand at its end, and a closing instruction to carry on rather than start the scene.
      const soFar = options?.addBelow ? repo.getScene(db, sceneId).text : ''
      const block = soFar.trim() ? soFarBlock(soFar, getSettings().models.writer?.contextLength ?? null) : null
      const b = await draftBriefing(
        sceneId,
        block ? options : { ...options, addBelow: false },
        block ? { signal: stop.signal, soFar, extras: { extraBlocks: [block] } } : { signal: stop.signal }
      )
      // Directed writing (src/main/director): a stretch at a time, with the director's notes between, when the draft options
      // or Settings › Models say so.
      const settings = getSettings()
      const stream = directedWanted(options, settings)
        ? directDraft({
            db,
            sceneId,
            briefing: b,
            carryOn: block ? soFar : '',
            model: directorModel({ settings, getProvider: providers.getProvider, providerTarget: providers.providerTarget }),
            emit
          })
        : null
      const started = startDraftJob({
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
        onSpeakers: (speakers) => noteWriterSpeakers(sceneId, speakers),
        ...(stream ? { stream } : {}),
        ...providerNotes(b.target.id)
      })
      // Check and repair: the draft's words are checked against where things stood as the writer was told it, and against
      // the scene's contract it was given (long story memory fix 13).
      noteStage(started.generationId, sceneId, stageTold(b, !!block))
      noteContract(started.generationId, sceneId, b.contract ?? null)
      // Only the record's id goes back to the window (its `done` promise can't cross IPC), with anything Adam should
      // know about how it was briefed (where things stand wasn't ready: review, 2026-10-16).
      return { generationId: started.generationId, note: b.note ?? null }
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
