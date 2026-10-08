// The story board's passing state (the desk's Plan room): Cards or Outline, the card just added (shown and lit for a
// moment), a count bumped when the board's AI-idea marks change, and the ideas drawer: the planned scene it is for,
// whether it opened from the keyboard (at once), and where a used idea's card flies from.
import { create } from 'zustand'
import type { ID } from '@shared/types'

interface BoardState {
  view: 'cards' | 'outline'
  fresh: ID | null
  marksRev: number
  ideasFor: ID | null
  ideasInstant: boolean
  flyFrom: { sceneId: ID; rect: DOMRect } | null
}

export const useBoardStore = create<BoardState>(() => ({ view: 'cards', fresh: null, marksRev: 0, ideasFor: null, ideasInstant: false, flyFrom: null }))

export const bumpMarks = (): void => useBoardStore.setState((s) => ({ marksRev: s.marksRev + 1 }))
