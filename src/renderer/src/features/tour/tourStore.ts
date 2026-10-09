// Whether the guided tour is showing, and on which step. Starting it again (the command bar) always shows it from the
// first step; closing it (Skip, Finish, Esc) is remembered once in Settings (`tourSeen`) by the tour itself.
import { create } from 'zustand'

interface TourStore {
  open: boolean
  index: number
  start(): void
  go(index: number): void
  close(): void
}

export const useTour = create<TourStore>((set) => ({
  open: false,
  index: 0,
  start: () => set({ open: true, index: 0 }),
  go: (index) => set({ index }),
  close: () => set({ open: false })
}))

/** Shows the tour from its first step (the command bar's Show the tour). */
export function startTour(): void {
  useTour.getState().start()
}
