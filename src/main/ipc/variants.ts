// Milestone 4: the handlers for src/shared/contracts/variants.ts (one part owns both files). See
// docs/ARCHITECTURE.md, "Milestone 4". The work is done in src/main/variants/; this file connects it to
// the open world, the window and the draft flow (the memory catching up, the briefing fitted to the
// writer model, the provider's bookkeeping), as Generate's startDraft does.
import type { Handlers } from './index'
import type { VariantsApi } from '@shared/contracts/variants'
import * as world from '../world'
import { emit } from '../events'
import { draftBriefing, providerNotes } from '../ai/draftFlow'
import { latestVariantSet, startVariantSet, stopVariantSet } from '../variants'
import { isStartingBeat } from '../beats'
import { isStartingDraft } from './ai'
import { noteGenerationSpeakers } from '../readAloud'

export const variantsHandlers: Handlers<keyof VariantsApi> = {
  startVariants: (input) =>
    startVariantSet(input, {
      db: world.db(),
      emit,
      briefing: (sceneId, options, signal) => draftBriefing(sceneId, options, { signal }),
      // Generate's draft or a beat of Beat by beat getting ready.
      startingElsewhere: (sceneId) => isStartingDraft(sceneId) || isStartingBeat(sceneId),
      providerNotes,
      onSpeakers: noteGenerationSpeakers
    }),
  stopVariants: (setId) => stopVariantSet(setId),
  getVariantSet: (sceneId) => latestVariantSet(world.db(), sceneId)
}
