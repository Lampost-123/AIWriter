// Variants' own directions ("Draft three: tense / tender / funny"), by scene, kept while the app is open (as the draft
// options are) until a set is started with them.
import { create } from 'zustand'
import type { ID } from '@shared/types'

interface VariantNotesState {
  /** Each variant's own direction, variant 1 first. */
  notes: Record<ID, string[]>
  /** The scene's variants get one each (else they all share the set's). */
  on: Record<ID, boolean>
}

export const useVariantNotes = create<VariantNotesState>(() => ({ notes: {}, on: {} }))

const NONE: string[] = []
export const notesOf = (s: VariantNotesState, sceneId: ID): string[] => s.notes[sceneId] ?? NONE

export function setVariantNote(sceneId: ID, index: number, text: string): void {
  useVariantNotes.setState((s) => {
    const list = [...notesOf(s, sceneId)]
    while (list.length <= index) list.push('')
    list[index] = text
    return { notes: { ...s.notes, [sceneId]: list } }
  })
}

export function setVariantNotesOn(sceneId: ID, on: boolean): void {
  useVariantNotes.setState((s) => ({ on: { ...s.on, [sceneId]: on } }))
}

/** A set has started with them: they are used, and the boxes empty (each variant's column shows its own). */
export function clearVariantNotes(sceneId: ID): void {
  useVariantNotes.setState((s) => ({ notes: { ...s.notes, [sceneId]: [] } }))
}
