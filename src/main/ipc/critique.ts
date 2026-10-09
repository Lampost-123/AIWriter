// The handlers for src/shared/contracts/critique.ts: the scene and chapter critic. The work is done in
// src/main/critique/; this file connects it to the open world, the settings and the window.
import type { Handlers } from './index'
import type { CritiqueApi } from '@shared/contracts/critique'
import * as world from '../world'
import * as providers from '../ai/providers'
import { jobModel } from '../ai/jobModel'
import { providerNotes } from '../ai/draftFlow'
import { emit } from '../events'
import { getSettings, getWritingPrefs } from '../settings'
import { runCritique } from '../critique/run'
import { cleanTarget, savedCritique } from '../critique/store'

export const critiqueHandlers: Handlers<keyof CritiqueApi> = {
  startCritique: (input) => {
    // The writer model, as the AI tools for selected words use it (Adam: "the writing model").
    const model = jobModel('writer', {
      settings: getSettings(),
      getProvider: providers.getProvider,
      providerTarget: providers.providerTarget
    })
    const db = world.db()
    return runCritique(
      {
        db,
        model,
        prefs: getWritingPrefs(),
        emit,
        onKeyRejected: providerNotes(model.target.id).onKeyRejected,
        closed: () => world.maybeCurrentWorld()?.db !== db
      },
      input
    )
  },
  getCritique: (target) => {
    const t = cleanTarget(target)
    return t ? savedCritique(world.db(), t) : null
  }
}
