// Opening a character's read-aloud voice from elsewhere (a speaker's name on the page or in the reading bar, the Cast
// list, the palette's "Set <name>'s voice"): their page opens and brings its Read-aloud voice box into view
// (EntryVoice.tsx), with the caret in How they sound. Owned by the Read aloud part.
import { create } from 'zustand'
import type { ID } from '@shared/types'
import { useApp } from '@/lib/store'

interface VoiceReveal {
  /** The character whose voice box should show itself once their page is open; null when none is asked for. */
  id: ID | null
  /** Counts the asks, so asking again for the page already open still brings the box into view. */
  n: number
}

/** The id of the Cast section in Settings › Read aloud and dictation (CastSettings.tsx). */
export const CAST_SECTION = 'read-aloud-cast'

export const useVoiceReveal = create<VoiceReveal>(() => ({ id: null, n: 0 }))

/** Opens a character's page at their Read-aloud voice. */
export function openEntryVoice(entryId: ID): void {
  useVoiceReveal.setState((s) => ({ id: entryId, n: s.n + 1 }))
  const a = useApp.getState()
  if (a.home) a.leaveHome()
  a.navigate({ kind: 'entries', entryKind: 'character', entryId })
}

/** True once for the character whose voice box was asked for (it then forgets the ask). */
export function takeVoiceReveal(entryId: ID): boolean {
  if (useVoiceReveal.getState().id !== entryId) return false
  useVoiceReveal.setState({ id: null })
  return true
}
