// What find and replace is doing (Writing by hand): the bar over the open scene (Ctrl+F) and the story-wide
// list (Ctrl+Shift+F) share the words being found, the replacement and the two switches, so moving from one
// to the other keeps them.
import { create } from 'zustand'
import type { ID } from '@shared/types'

export interface FindStore {
  /** The bar over the open scene shows. */
  sceneOpen: boolean
  /** Find and replace across the story shows. */
  storyOpen: boolean
  query: string
  replacement: string
  matchCase: boolean
  wholeWord: boolean
  /** Goes up whenever the bar should take the keyboard (Ctrl+F again while it shows). */
  focusTick: number
  /** Opening a scene from the story's list: once that scene shows, its match `index` is the current one. */
  goTo: { sceneId: ID; index: number } | null
  set(patch: Partial<Omit<FindStore, 'set'>>): void
}

export const useFind = create<FindStore>((set) => ({
  sceneOpen: false,
  storyOpen: false,
  query: '',
  replacement: '',
  matchCase: false,
  wholeWord: false,
  focusTick: 0,
  goTo: null,
  set: (patch) => set(patch)
}))
