// The desk's own passing state (the New look's desk layout): whether the story's flyout is open over the page (beside
// the slim spine), whether the last change of the spine's shape came from the keyboard, and what is typed in the AI
// dock's steer box for each scene. Whether the spine is full or slim is saved (layout.deskStory), and the scene drawer's
// state is the scene panel's (inspectorOpen), so everything that opens the scene panel on a tab opens the drawer there.
import { create } from 'zustand'
import type { ID } from '@shared/types'
import { useApp } from '@/lib/store'
import { keyboardDriven } from '@/features/look/motion'

interface DeskState {
  /** The flyout is open over the page, beside the slim spine. */
  flyoutOpen: boolean
  /** The last open or close came from the keyboard: it then happens at once, with no slide. */
  instant: boolean
  /** The last time the spine opened out or collapsed, it was from the keyboard: at once. */
  spineInstant: boolean
  /**
   * The dock's steer box, by scene: what should happen next, for the next Continue or Add below only. It empties once
   * the AI starts writing with it, and comes back if that writing is stopped before any words arrive.
   */
  steer: Record<ID, string>
  /** The words a run took from the steer box, by scene, until it ends (to give them back if no words came). */
  steerSent: Record<ID, string>
}

export const useDeskStore = create<DeskState>(() => ({ flyoutOpen: false, instant: false, spineInstant: false, steer: {}, steerSent: {} }))

/** Opens or closes the story's flyout over the page. */
export function setFlyout(open: boolean): void {
  if (useDeskStore.getState().flyoutOpen === open) return
  useDeskStore.setState({ flyoutOpen: open, instant: keyboardDriven() })
}

export const toggleFlyout = (): void => setFlyout(!useDeskStore.getState().flyoutOpen)

let moving: ReturnType<typeof setTimeout> | undefined

/** Opens the spine out to the whole story beside the page, or collapses it to its rings; kept for next time. */
export function setSpineFull(full: boolean): void {
  const a = useApp.getState()
  if (!a.settings) return
  const deskStory = full ? 'full' : 'slim'
  const instant = keyboardDriven()
  useDeskStore.setState({ flyoutOpen: false, spineInstant: instant })
  // The sheet glides across with the spine (desk.css, :root[data-spine-moving]). The mark goes up before anything
  // changes, so the sheet's move is a transition however soon the page is measured.
  const root = document.documentElement
  clearTimeout(moving)
  if (instant) delete root.dataset.spineMoving
  else {
    root.dataset.spineMoving = full ? 'out' : 'in'
    moving = setTimeout(() => delete root.dataset.spineMoving, 320)
  }
  // At once on screen (the saved settings follow a moment later).
  useApp.setState({ settings: { ...a.settings, layout: { ...a.settings.layout, deskStory } } })
  void a.updateSettings({ layout: { deskStory } })
}

/** What the steer box says for a scene. */
export const steerOf = (sceneId: ID): string => useDeskStore.getState().steer[sceneId] ?? ''

export function setSteer(sceneId: ID, text: string): void {
  useDeskStore.setState((s) => ({ steer: { ...s.steer, [sceneId]: text } }))
}

/** The AI has started writing with the steer box's words: the box empties, and keeps them in case nothing arrives. */
export function steerTaken(sceneId: ID): void {
  useDeskStore.setState((s) => {
    const text = s.steer[sceneId] ?? ''
    if (!text.trim()) return s
    return { steer: { ...s.steer, [sceneId]: '' }, steerSent: { ...s.steerSent, [sceneId]: text } }
  })
}

/**
 * The writing that took the steer box's words has ended. With no words written (stopped or failed before any came), they
 * come back to the box, unless something new has been typed there since; either way they are let go.
 */
export function steerSettled(sceneId: ID, wrote: boolean): void {
  useDeskStore.setState((s) => {
    const sent = s.steerSent[sceneId]
    if (sent === undefined) return s
    const steerSent = { ...s.steerSent }
    delete steerSent[sceneId]
    const back = !wrote && !(s.steer[sceneId] ?? '').trim()
    return back ? { steerSent, steer: { ...s.steer, [sceneId]: sent } } : { steerSent }
  })
}
