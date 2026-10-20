// "Suggest beats" (2026-10-19, no dead ends): Beat by beat on a scene whose card has no beats used to say only "Add the
// beats first". Now it can ask for them: the scene card's own fill (fillSceneCard, Interview me's last step, with no
// answers: from the card, the outline around it and the story so far), of which only the beats are used, put on the
// card while it still has none, with Undo. Then Beat by beat can start straight away. One at a time, kept while the app
// is open, never saved.
import { create } from 'zustand'
import type { ID } from '@shared/types'
import { toast } from '@/components/ui'
import { api } from '@/lib/api'
import { cardNow, patchCard } from './planInterviewStore'
import { unfill } from './planInterviewLogic'

export interface BeatSuggest {
  sceneId: ID | null
  taskId: ID | null
  status: 'idle' | 'running' | 'done' | 'error'
  /** How many beats went on the card. */
  count: number
  error: string | null
}

const idle: BeatSuggest = { sceneId: null, taskId: null, status: 'idle', count: 0, error: null }
export const useBeatSuggest = create<BeatSuggest>(() => idle)

/** Asks for the scene's beats and puts them on its card (only while it still has none). */
export async function suggestBeats(sceneId: ID): Promise<void> {
  if (useBeatSuggest.getState().status === 'running') return
  const taskId = crypto.randomUUID()
  useBeatSuggest.setState({ sceneId, taskId, status: 'running', count: 0, error: null })
  const mine = (): boolean => useBeatSuggest.getState().taskId === taskId
  const fail = (error: string): void => void (mine() && useBeatSuggest.setState({ status: 'error', error }))
  try {
    const card = await cardNow(sceneId)
    const out = await api.fillSceneCard({ taskId, sceneId, card, answers: [] })
    if (!mine()) return
    if (out.status === 'stopped') return useBeatSuggest.setState(idle)
    if (out.status === 'error') return fail(out.error ?? 'Something went wrong while the beats were suggested. Please try again.')
    const beats = (out.fill.beats ?? []).map((b) => b.replace(/\s+/g, ' ').trim()).filter(Boolean)
    if (!beats.length) return fail('The AI didn’t suggest any beats. Please try again.')
    // As the card is now: beats Adam added meanwhile stay, and nothing is added after them.
    const now = await cardNow(sceneId)
    if (!mine()) return
    if (now.beats.some((b) => b.trim())) return useBeatSuggest.setState({ status: 'done', count: now.beats.length })
    await patchCard(sceneId, { beats })
    useBeatSuggest.setState({ status: 'done', count: beats.length })
    toast(`Added ${beats.length === 1 ? 'a beat' : `${beats.length} beats`} to the scene card.`, {
      action: {
        label: 'Undo',
        run: () =>
          void cardNow(sceneId)
            .then((c) => {
              const back = unfill(c, { beats })
              return Object.keys(back).length ? patchCard(sceneId, back) : undefined
            })
            .catch((e: Error) => void toast(e.message || 'That didn’t work. Please try again.', { tone: 'danger' }))
      }
    })
  } catch (e) {
    fail((e as Error).message || 'That didn’t work. Please try again.')
  }
}

/** Stops asking: nothing goes on the card. */
export function stopSuggestBeats(): void {
  const s = useBeatSuggest.getState()
  if (s.status === 'running' && s.taskId) void api.stopTask(s.taskId).catch(() => undefined)
  useBeatSuggest.setState(idle)
}

/** The question closed or moved to another scene: what it said goes. */
export const resetSuggestBeats = (): void => {
  if (useBeatSuggest.getState().status !== 'running') useBeatSuggest.setState(idle)
}
