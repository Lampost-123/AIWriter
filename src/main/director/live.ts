// The directed drafts being written now, by their record's id, with Adam's notes waiting for the next pause ("slower",
// "she wouldn't say that"; Adam's spec, "Directed writing (an option)", 5). A note typed or dictated while a stretch is
// being written goes in when it ends. In memory only: a note for a draft that has ended goes nowhere (directorNote says
// so). No Electron imports.

import type { ID } from '@shared/types'

/** The longest note kept, in characters. */
export const NOTE_MOST = 400
/** The most notes waiting at once (the oldest go first). */
export const NOTES_MOST = 6

interface Live {
  sceneId: ID
  notes: string[]
}

const live = new Map<ID, Live>()

export function openLive(generationId: ID, sceneId: ID): void {
  live.set(generationId, { sceneId, notes: [] })
}

export function closeLive(generationId: ID): void {
  live.delete(generationId)
}

/** True while this draft is being directed. */
export const isDirected = (generationId: ID): boolean => live.has(generationId)

/** Adam's note for the draft's next pause. False when the draft isn't being directed (it ended) or the note is empty. */
export function addNote(generationId: ID, note: string): boolean {
  const run = live.get(generationId)
  const text = note.replace(/\s+/g, ' ').trim().slice(0, NOTE_MOST)
  if (!run || !text) return false
  run.notes.push(text)
  if (run.notes.length > NOTES_MOST) run.notes.splice(0, run.notes.length - NOTES_MOST)
  return true
}

/** The notes waiting, taken: they go in now. */
export function takeNotes(generationId: ID): string[] {
  const run = live.get(generationId)
  if (!run) return []
  const out = run.notes
  run.notes = []
  return out
}

/** How many notes are waiting. */
export const waitingNotes = (generationId: ID): number => live.get(generationId)?.notes.length ?? 0
