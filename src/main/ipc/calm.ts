// The calm overhaul (2026-10-19): the steps a draft takes before its first word go to the window ('draft:step'), Issues ›
// Memory asks whether the memory model turned a scene down, and a check waiting on the memory can go ahead now.
import type { Handlers } from './index'
import { emit } from '../events'
import { onDraftStep } from '../ai/steps'
import { memoryRefusalOf } from '../keeper'
import { checkWithoutWaiting } from './checksIssues'

onDraftStep((s) => emit('draft:step', s))

export const calmHandlers: Handlers<'memoryRefusal' | 'checkWithoutWaiting'> = {
  memoryRefusal: (sceneId) => memoryRefusalOf(sceneId),
  checkWithoutWaiting: (runId) => checkWithoutWaiting(runId)
}
