// The story board's passing state (the desk's Plan room): Cards or Outline, the card just added (shown and lit for a
// moment), and a count bumped when the board's AI-idea marks change.
import { create } from 'zustand'
import type { ID } from '@shared/types'

interface BoardState {
  view: 'cards' | 'outline'
  fresh: ID | null
  marksRev: number
}

export const useBoardStore = create<BoardState>(() => ({ view: 'cards', fresh: null, marksRev: 0 }))

export const bumpMarks = (): void => useBoardStore.setState((s) => ({ marksRev: s.marksRev + 1 }))
