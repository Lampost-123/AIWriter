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
  /** A plot thread to pick out when the board opens ("Open on the story board", from the plot threads board). */
  focusThread: ID | null
  /** What Adam has in mind for the next ideas the drawer asks for ("Plan its pay-off", from the plot threads board). */
  ideasWish: string | null
  /** Open the drawer for what comes next as soon as the board has the story ("Plan its pay-off"). */
  ideasNext: boolean
}

export const useBoardStore = create<BoardState>(() => ({
  view: 'cards',
  fresh: null,
  marksRev: 0,
  ideasFor: null,
  ideasInstant: false,
  flyFrom: null,
  focusThread: null,
  ideasWish: null,
  ideasNext: false
}))

export const bumpMarks = (): void => useBoardStore.setState((s) => ({ marksRev: s.marksRev + 1 }))
