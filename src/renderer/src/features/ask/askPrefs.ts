// The Ask panel's small choices (chat overhaul Phase 2): how dense it is (Comfortable or Compact, from the ⋯ menu in
// its head, remembered on this computer like Generate's "Polish after drafting"), and what Adam made of each option
// card this session (kept ★, used as a beat, set aside). Option states aren't kept after a restart.
import { create } from 'zustand'
import type { ID } from '@shared/types'

export type Density = 'comfortable' | 'compact'

const DENSITY_KEY = 'aiwrite.ask.density'

export function lastDensity(): Density {
  try {
    return localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable'
  } catch {
    return 'comfortable'
  }
}

/** What Adam made of one option card. */
export interface OptionState {
  kept?: boolean
  /** Used as beat N of the open scene's card (1 = the first). */
  usedAsBeat?: number
  aside?: boolean
}

interface PrefsState {
  density: Density
  options: Record<string, OptionState>
}

export const useAskPrefs = create<PrefsState>(() => ({ density: lastDensity(), options: {} }))

export function setDensity(density: Density): void {
  useAskPrefs.setState({ density })
  try {
    localStorage.setItem(DENSITY_KEY, density)
  } catch {
    // Remembering it is only a convenience.
  }
}

/** An option card's key: its answer's record and its place in the answer. */
export const optionKey = (generationId: ID, index: number): string => `${generationId}:${index}`

export function setOption(key: string, patch: Partial<OptionState>): void {
  const options = useAskPrefs.getState().options
  useAskPrefs.setState({ options: { ...options, [key]: { ...options[key], ...patch } } })
}
