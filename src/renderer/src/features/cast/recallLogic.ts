// What Recall says about a state it couldn't read from the scene's own words (2026-10-16): carried on from the scene
// before, because the memory model turned the scene down (some models won't read explicit scenes) or hasn't read it yet.
// Pure, so it is unit-tested.
import type { RecallView } from '@shared/contracts/recall'

/** The note over a state carried on from the scene before, with its next step; null for a state read from the scene. */
export function uncheckedNote(view: Pick<RecallView, 'unchecked' | 'refused'> | null): { lead: string; text: string } | null {
  if (!view?.unchecked) return null
  if (view.refused) {
    return {
      lead: 'Turned down:',
      text: 'the memory model wouldn’t read this scene (some models won’t read explicit scenes), so this is carried on from the scene before and doesn’t show what this scene changed. Put right what changed here, or pick another memory model in Settings › Models and press Read again.'
    }
  }
  return {
    lead: 'Not read yet:',
    text: 'this is carried on from the scene before, so it doesn’t show what this scene changed. Put right what changed here; the memory reads the scene when it can, or press Read again.'
  }
}
