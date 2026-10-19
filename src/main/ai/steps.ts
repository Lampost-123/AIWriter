// The steps a draft goes through before its first word (the calm overhaul, 2026-10-19: Adam saw only "Getting ready…"
// for a minute and more). draftFlow.ts says each as it begins (the memory catching up, gathering what the scene needs,
// planning it), the look-ups say how many things they look up (ai/lookups), and the draft says "writing" once its
// request is out. ipc/calm.ts passes them to the window as 'draft:step'; the window names each one in the status line.
// No Electron imports.
import type { DraftStep, DraftStepKind } from '@shared/contracts/calm'
import type { ID } from '@shared/types'

const listeners = new Set<(s: DraftStep) => void>()

/** Says that the draft of a scene is now on this step. Never throws. */
export function draftStep(sceneId: ID, step: DraftStepKind, count?: number): void {
  if (!sceneId) return
  const s: DraftStep = { sceneId, step, ...(count !== undefined ? { count } : {}) }
  for (const fn of listeners) {
    try {
      fn(s)
    } catch (e) {
      console.warn('Could not pass on a draft step', e)
    }
  }
}

/** Told each step as a draft takes it. Returns a function that stops it. */
export function onDraftStep(fn: (s: DraftStep) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
