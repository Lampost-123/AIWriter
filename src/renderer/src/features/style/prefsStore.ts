import { create } from 'zustand'
import type { WritingPrefs } from '@shared/types'
import { api } from '@/lib/api'

/**
 * Adam's own writing preferences (Settings › My writing preferences), shared by
 * every world. The style guide shows them underneath the world's choices.
 */
interface PrefsState {
  prefs: WritingPrefs | null
  error: string | null
  load(): Promise<void>
  /** Records preferences that were just saved, so every screen shows them at once. */
  saved(prefs: WritingPrefs): void
}

export const usePrefs = create<PrefsState>((set) => ({
  prefs: null,
  error: null,
  async load() {
    try {
      set({ prefs: await api.getWritingPrefs(), error: null })
    } catch (e) {
      set({ error: (e as Error).message })
    }
  },
  saved(prefs) {
    set({ prefs, error: null })
  }
}))
