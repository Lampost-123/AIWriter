// The desk's own passing state (the New look's desk layout): whether the story's flyout is open over the page (beside
// the slim spine), whether the last change of the spine's shape came from the keyboard, and what is typed in the AI
// dock's steer box for each scene. Whether the spine is full or slim is saved (layout.deskStory), and the scene drawer's
// state is the scene panel's (inspectorOpen), so everything that opens the scene panel on a tab opens the drawer there.
import { create } from 'zustand'
import type { ID } from '@shared/types'
import type { DirectionSource } from '@shared/contracts/direction'
import { useApp } from '@/lib/store'
import { keyboardDriven } from '@/features/look/motion'
import { noteUsed } from '@/features/direction/store'

interface DeskState {
  /** The flyout is open over the page, beside the slim spine. */
  flyoutOpen: boolean
  /** The last open or close came from the keyboard: it then happens at once, with no slide. */
  instant: boolean
  /** The last time the spine opened out or collapsed, it was from the keyboard: at once. */
  spineInstant: boolean
  /**
   * The dock's steer box, by scene: what should happen next, for the next Continue or Add below only. It empties once
   * the AI starts writing with it and stays empty (so nothing used is shown or used again); ↑ in the box and its
   * recent directions bring it back (features/direction).
   */
  steer: Record<ID, string>
}

export const useDeskStore = create<DeskState>(() => ({ flyoutOpen: false, instant: false, spineInstant: false, steer: {} }))

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

/** What the steer box says for a scene. */
export const steerOf = (sceneId: ID): string => useDeskStore.getState().steer[sceneId] ?? ''

export function setSteer(sceneId: ID, text: string): void {
  useDeskStore.setState((s) => ({ steer: { ...s.steer, [sceneId]: text } }))
}

/**
 * The AI has started writing with the steer box's words: they are used, so the box empties and stays empty, however the
 * writing ends (a fast writer's draft could end before the dock saw a word of it, and gave them back: stale). They are
 * offered back at once in the box's recent directions and by ↑ in it. `source`: Continue, a draft (Add below), Variants.
 */
export function steerTaken(sceneId: ID, source: DirectionSource = 'continue'): void {
  const text = useDeskStore.getState().steer[sceneId] ?? ''
  if (!text.trim()) return
  noteUsed(text, source)
  useDeskStore.setState((s) => ({ steer: { ...s.steer, [sceneId]: '' } }))
}
