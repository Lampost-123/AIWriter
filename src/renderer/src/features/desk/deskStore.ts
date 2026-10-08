// The desk's own passing state (the New look's desk layout): whether the story's flyout is open over the page, and what
// is typed in the AI dock's steer box for each scene. The flyout's pinned state is the saved layout's binderOpen (pinned,
// it stays open beside the page while there is room), and the scene drawer's is inspectorOpen, so everything that opens
// the binder or the scene panel today opens them here too.
import { create } from 'zustand'
import type { ID } from '@shared/types'
import { keyboardDriven } from '@/features/look/motion'

interface DeskState {
  /** The flyout is open over the page (not pinned). */
  flyoutOpen: boolean
  /** The last open or close came from the keyboard: it then happens at once, with no slide. */
  instant: boolean
  /**
   * The dock's steer box, by scene: what should happen next, for the next Continue or Add below only. It empties once
   * the AI starts writing with it, and comes back if that writing is stopped before any words arrive.
   */
  steer: Record<ID, string>
  /** The words a run took from the steer box, by scene, until it ends (to give them back if no words came). */
  steerSent: Record<ID, string>
}

export const useDeskStore = create<DeskState>(() => ({ flyoutOpen: false, instant: false, steer: {}, steerSent: {} }))

/** Opens or closes the story's flyout over the page. */
export function setFlyout(open: boolean): void {
  if (useDeskStore.getState().flyoutOpen === open) return
  useDeskStore.setState({ flyoutOpen: open, instant: keyboardDriven() })
}

export const toggleFlyout = (): void => setFlyout(!useDeskStore.getState().flyoutOpen)

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
