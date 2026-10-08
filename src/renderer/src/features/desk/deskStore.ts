// The desk's own passing state (the New look's desk layout): whether the story's flyout is open over the page (beside
// the slim spine), and whether the last change of the spine's shape came from the keyboard. Whether the spine is full
// or slim is saved (layout.deskStory), and the scene drawer's state is the scene panel's (inspectorOpen), so everything
// that opens the scene panel on a tab opens the drawer there.
import { create } from 'zustand'
import { useApp } from '@/lib/store'
import { keyboardDriven } from '@/features/look/motion'

interface DeskState {
  /** The flyout is open over the page, beside the slim spine. */
  flyoutOpen: boolean
  /** The last open or close came from the keyboard: it then happens at once, with no slide. */
  instant: boolean
  /** The last time the spine opened out or collapsed, it was from the keyboard: at once. */
  spineInstant: boolean
}

export const useDeskStore = create<DeskState>(() => ({ flyoutOpen: false, instant: false, spineInstant: false }))

/** Opens or closes the story's flyout over the page. */
export function setFlyout(open: boolean): void {
  if (useDeskStore.getState().flyoutOpen === open) return
  useDeskStore.setState({ flyoutOpen: open, instant: keyboardDriven() })
}

export const toggleFlyout = (): void => setFlyout(!useDeskStore.getState().flyoutOpen)

/** Opens the spine out to the whole story beside the page, or collapses it to its rings; kept for next time. */
export function setSpineFull(full: boolean): void {
  const a = useApp.getState()
  if (!a.settings) return
  const deskStory = full ? 'full' : 'slim'
  useDeskStore.setState({ flyoutOpen: false, spineInstant: keyboardDriven() })
  // At once on screen (the saved settings follow a moment later).
  useApp.setState({ settings: { ...a.settings, layout: { ...a.settings.layout, deskStory } } })
  void a.updateSettings({ layout: { deskStory } })
}
