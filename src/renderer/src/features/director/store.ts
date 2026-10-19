// Directed writing in the window (Adam's spec, "Directed writing (an option)"; src/main/director): what each scene's
// directed draft is doing (the director's line, 'director:progress'), Adam's notes on their way to the next pause, and the
// draft options' choice for one draft ("Directed writing" on or off for this scene's next draft, else Settings' switch).
import { create } from 'zustand'
import type { DraftOptions, ID } from '@shared/types'
import type { DirectorProgress } from '@shared/contracts/director'
import { toast } from '@/components/ui'
import { api, onEvent } from '@/lib/api'
import { useApp } from '@/lib/store'

/** How long the director's last line stays once the draft has ended. */
export const LINGER_MS = 4000

interface DirectorState {
  /** The latest from each scene's directed draft, while it writes (and a moment after: `ended`). */
  byScene: Record<ID, DirectorProgress & { ended?: boolean }>
  /** Adam's notes on their way, by draft: shown as waiting until they go in. */
  sent: Record<ID, string[]>
  /** The notes that went in at the last pause, by draft, for a moment. */
  taken: Record<ID, string[]>
  /** The draft options' choice for one draft, by scene: on or off; left out, as Settings › Models says. */
  once: Record<ID, boolean>
}

export const useDirector = create<DirectorState>(() => ({ byScene: {}, sent: {}, taken: {}, once: {} }))

const without = <T>(r: Record<ID, T>, id: ID): Record<ID, T> => {
  if (!(id in r)) return r
  const out = { ...r }
  delete out[id]
  return out
}

let listening = false

/** Hears the director's progress and the drafts' ends, once, for as long as the window is open. */
export function listenForDirector(): void {
  if (listening) return
  listening = true
  onEvent('director:progress', (p) => {
    useDirector.setState((s) => {
      const sent = s.sent[p.generationId] ?? []
      const took = p.taken ?? []
      // The notes that went in leave the waiting list, oldest first.
      const left = took.length ? sent.slice(Math.min(sent.length, took.length)) : sent
      return {
        byScene: { ...s.byScene, [p.sceneId]: p },
        sent: { ...s.sent, [p.generationId]: left },
        taken: took.length ? { ...s.taken, [p.generationId]: took } : s.taken
      }
    })
  })
  onEvent('generation:done', (p) => {
    const shown = useDirector.getState().byScene[p.sceneId]
    if (!shown || shown.generationId !== p.generationId) return
    useDirector.setState((s) => ({
      byScene: { ...s.byScene, [p.sceneId]: { ...shown, ended: true, phase: 'done' } },
      sent: without(s.sent, p.generationId),
      taken: without(s.taken, p.generationId)
    }))
    // The last line stays a moment, then goes (unless a new directed draft of the scene has begun since).
    setTimeout(() => {
      const now = useDirector.getState().byScene[p.sceneId]
      if (now?.generationId === p.generationId) useDirector.setState((s) => ({ byScene: without(s.byScene, p.sceneId) }))
    }, LINGER_MS)
  })
  // Another world: its drafts were stopped as it closed, so nothing of theirs is shown again.
  useApp.subscribe((a, prev) => {
    if (a.world?.id !== prev.world?.id) useDirector.setState({ byScene: {}, sent: {}, taken: {} })
  })
}

/** Sends Adam's note to the draft: it goes in at the next pause. False when the draft has ended (he is told). */
export async function sendNote(generationId: ID, note: string): Promise<boolean> {
  const text = note.trim()
  if (!text) return false
  try {
    const ok = await api.directorNote(generationId, text)
    if (!ok) {
      toast('The draft has finished, so the note wasn’t needed.')
      return false
    }
    useDirector.setState((s) => ({ sent: { ...s.sent, [generationId]: [...(s.sent[generationId] ?? []), text] } }))
    return true
  } catch (e) {
    toast((e as Error).message, { tone: 'danger' })
    return false
  }
}

/** The draft options' choice for this scene's next draft: on, off, or as Settings say (undefined). */
export function setOnce(sceneId: ID, on: boolean | undefined): void {
  useDirector.setState((s) => ({ once: on === undefined ? without(s.once, sceneId) : { ...s.once, [sceneId]: on } }))
}

/**
 * A draft's options with the draft options' one-draft choice in them (DraftOptions.directed), which is then used up: the
 * next draft follows Settings again. Unchanged when there is no choice.
 */
export function withDirected(options: DraftOptions, sceneId: ID): DraftOptions {
  const once = useDirector.getState().once[sceneId]
  if (once === undefined) return options
  setOnce(sceneId, undefined)
  return { ...options, directed: once }
}
