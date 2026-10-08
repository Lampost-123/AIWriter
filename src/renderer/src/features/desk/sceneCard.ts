// The open scene's card as the desk shows it (UI overhaul, phase 3): its place and point of view by name, its beats, and
// how many of them are on the page already (shared/beats.ts), worked out again as the words change (at most about twice
// a second). Kept in one small store, so the next-beat chip over the dock
// and the scene card in the margin read the same thing; useSceneCardWatch (mounted once by the desk's page) fills it.
import type { Editor } from '@tiptap/core'
import { useEffect } from 'react'
import { create } from 'zustand'
import type { ID, SceneCard } from '@shared/types'
import { beatsOnPage, cardBeatsOf } from '@shared/beats'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { cardIsEmpty } from '@/features/outline/ideasLogic'

export interface DeskCard {
  sceneId: ID
  card: SceneCard
  /** The card has nothing on it yet: the margin offers ideas and an interview instead. */
  empty: boolean
  beats: string[]
  pov: { id: ID; name: string } | null
  place: { id: ID; name: string } | null
}

interface DeskCardState {
  /** The open scene's card, once loaded. */
  card: DeskCard | null
  /** How many of its beats, from the first, are on the page. */
  beatsDone: number
}

export const useDeskCard = create<DeskCardState>(() => ({ card: null, beatsDone: 0 }))

/** The open scene's card, or null while it loads (or for another scene). */
export const useSceneCard = (sceneId: ID): DeskCard | null => useDeskCard((s) => (s.card?.sceneId === sceneId ? s.card : null))

async function nameOf(id: ID | null): Promise<{ id: ID; name: string } | null> {
  if (!id) return null
  const e = await api.getEntry(id).catch(() => null)
  return e ? { id, name: e.name } : null
}

/** How soon after the words change the beats on the page are counted again. */
const SETTLE_MS = 400

/** Loads the scene's card (again when it, or the world's entries, change) and follows its beats on the page. */
export function useSceneCardWatch(editor: Editor, sceneId: ID | null): void {
  const rev = useApp((s) => s.briefingRev)
  const entriesRev = useApp((s) => s.entriesRev)

  useEffect(() => {
    if (!sceneId) {
      useDeskCard.setState({ card: null, beatsDone: 0 })
      return
    }
    let live = true
    void (async () => {
      try {
        const scene = await api.getScene(sceneId)
        const [pov, place] = await Promise.all([nameOf(scene.card.povId), nameOf(scene.card.locationId)])
        if (!live) return
        const beats = cardBeatsOf(scene.card.beats)
        const text = editor.isDestroyed ? '' : editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n', '\n')
        useDeskCard.setState({
          card: { sceneId, card: scene.card, empty: cardIsEmpty(scene.card), beats, pov, place },
          beatsDone: beatsOnPage(beats, text)
        })
      } catch {
        // The scene went (deleted, another world): nothing to show.
        if (live) useDeskCard.setState({ card: null, beatsDone: 0 })
      }
    })()
    return () => {
      live = false
    }
  }, [editor, sceneId, rev, entriesRev])

  // The beats on the page, counted again a moment after the words change.
  useEffect(() => {
    if (!sceneId) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const count = (): void => {
      timer = undefined
      const c = useDeskCard.getState().card
      if (!c || c.sceneId !== sceneId || editor.isDestroyed) return
      const doc = editor.state.doc
      const done = beatsOnPage(c.beats, doc.textBetween(0, doc.content.size, '\n', '\n'))
      if (done !== useDeskCard.getState().beatsDone) useDeskCard.setState({ beatsDone: done })
    }
    const onUpdate = ({ transaction }: { transaction: { docChanged: boolean } }): void => {
      // Counted a moment after the first change, then again after the next: while a draft streams, about twice a second.
      if (!transaction.docChanged || timer) return
      timer = setTimeout(count, SETTLE_MS)
    }
    editor.on('transaction', onUpdate)
    return () => {
      editor.off('transaction', onUpdate)
      clearTimeout(timer)
    }
  }, [editor, sceneId])
}
