// What an option card's buttons do (chat overhaul Phase 2): "Use as beat" adds the idea to the end of the open scene's
// card beats, through the same call the card itself saves with, and Undo takes that beat out again; "Save to entry"
// keeps the idea in the memory as Adam's own note (the same saving as an answer's, with Undo); "More like this" asks for
// more ideas like it, as the chat's next question.
import type { ID } from '@shared/types'
import { toast } from '@/components/ui'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { ask, type AskPlace } from './askStore'
import { plainAnswer } from './citations'
import { savedMessage } from './askWords'
import { openEntry } from './CiteChip'
import { setOption } from './askPrefs'
import { optionWords, withBeat, withoutBeat } from './answerView'

/** Use as beat: the idea goes at the end of the scene card's beats; the toast's Undo takes it out again. */
export async function addAsBeat(sceneId: ID, key: string, title: string, why: string): Promise<void> {
  const beat = optionWords(title, why)
  try {
    const card = (await api.getScene(sceneId)).card
    const { beats, index } = withBeat(card.beats, beat)
    await api.updateSceneCard(sceneId, { ...card, beats })
    useApp.getState().bumpBriefing()
    setOption(key, { usedAsBeat: index, aside: false })
    let undone = false
    toast(`Added as beat ${index} on the scene card.`, {
      tone: 'success',
      action: {
        label: 'Undo',
        run: () => {
          if (undone) return
          undone = true
          void (async () => {
            try {
              const now = (await api.getScene(sceneId)).card
              await api.updateSceneCard(sceneId, { ...now, beats: withoutBeat(now.beats, beat, index) })
              useApp.getState().bumpBriefing()
              setOption(key, { usedAsBeat: undefined })
            } catch (e) {
              toast(`Couldn’t undo that. ${(e as Error).message}`, { tone: 'danger' })
            }
          })()
        }
      }
    })
  } catch (e) {
    toast(`Couldn’t add that beat. ${(e as Error).message}`, { tone: 'danger' })
  }
}

/** Save to entry: the idea goes into the memory as Adam's own note, on `entryId` (null: a new page in Lore). */
export async function saveOption(o: { title: string; why: string; entryId: ID | null; question: string; place: AskPlace }): Promise<void> {
  try {
    const note = await api.saveAskNote({
      text: optionWords(o.title, o.why),
      entryId: o.entryId,
      question: o.question,
      storyId: o.place.storyId,
      sceneId: o.place.sceneId
    })
    toast(savedMessage(note), {
      tone: 'success',
      action: {
        label: 'Undo',
        run: () => void api.undoAskNote(note.undo).catch((e: Error) => toast(`Couldn’t undo that. ${e.message}`, { tone: 'danger' }))
      },
      secondary: { label: 'Open', run: () => openEntry(note.entryId, note.kind) }
    })
  } catch (e) {
    toast(`Couldn’t save that. ${(e as Error).message}`, { tone: 'danger' })
  }
}

/** More like this: asks for more ideas like this one, as the chat's next question. */
export function moreLike(title: string, place: AskPlace): void {
  void ask(`More ideas like “${plainAnswer(title).replace(/[.:]\s*$/, '')}”`, place)
}
