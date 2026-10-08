// The desk's own passing state (the New look's desk layout): whether the story's flyout is open over the page. Its
// pinned state is the saved layout's binderOpen (pinned, it stays open beside the page while there is room), and the
// scene drawer's is inspectorOpen, so everything that opens the binder or the scene panel today opens them here too.
import { create } from 'zustand'
import { keyboardDriven } from '@/features/look/motion'

interface DeskState {
  /** The flyout is open over the page (not pinned). */
  flyoutOpen: boolean
  /** The last open or close came from the keyboard: it then happens at once, with no slide. */
  instant: boolean
}

export const useDeskStore = create<DeskState>(() => ({ flyoutOpen: false, instant: false }))

/** Opens or closes the story's flyout over the page. */
export function setFlyout(open: boolean): void {
  if (useDeskStore.getState().flyoutOpen === open) return
  useDeskStore.setState({ flyoutOpen: open, instant: keyboardDriven() })
}

export const toggleFlyout = (): void => setFlyout(!useDeskStore.getState().flyoutOpen)
