// "Show speakers and tone" on the page (SceneView): while it is on, asks for the labels of the open scene's
// paragraphs whose marks are in, and shows them (speakerLabels.ts). Asks again when the AI finishes marking some of
// the scene ('readAloud:marked', as a draft lands or while reading) and a moment after Adam stops typing. Paragraphs
// with no marks yet (his own words, older scenes, an edit) are marked in the background: as the scene opens, and a
// few seconds after he stops typing, so a pause mid-sentence doesn't ask the AI. Renders nothing itself. Owned by
// the Read aloud part.
import type { Editor } from '@tiptap/core'
import { useEffect } from 'react'
import type { ID } from '@shared/types'
import { api, onEvent } from '@/lib/api'
import { useApp } from '@/lib/store'
import { forPlan, hasWords, pageParagraphs } from './pageText'
import { setSpeakerLabels, type ShownLabel } from './speakerLabels'
import './speakerLabels.css'

/** After typing stops, labels are asked for again this much later. */
const AFTER_TYPING_MS = 1500
/** After the AI's marks come in. */
const AFTER_MARKS_MS = 250
/** After typing stops, the paragraphs it left without marks are marked this much later. */
const MARK_AFTER_TYPING_MS = 6000

export function SpeakerLabelsLayer({ editor, sceneId }: { editor: Editor; sceneId: ID | null }): null {
  const on = useApp((s) => !!s.settings?.speech.showSpeakers)
  // With or without each line's tone, the labels say different things: asked for again when it changes.
  const tone = useApp((s) => !!s.settings?.speech.markSpeakers)

  useEffect(() => {
    if (!on || !sceneId) {
      if (!editor.isDestroyed) setSpeakerLabels(editor.view, null)
      return
    }
    let token = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let markTimer: ReturnType<typeof setTimeout> | undefined
    const refresh = async (mark: boolean): Promise<void> => {
      const mine = ++token
      const paragraphs = pageParagraphs(editor.state.doc).filter(hasWords).map(forPlan)
      try {
        const got = await api.speakerLabels({ sceneId, paragraphs, mark })
        // A newer request, another scene, or the option turned off since: this answer is dropped.
        if (mine !== token || editor.isDestroyed) return
        const sent = new Map(paragraphs.map((p) => [p.pid, p.text]))
        const labels = new Map<string, ShownLabel>()
        for (const l of got) {
          const text = sent.get(l.pid)
          if (text !== undefined) labels.set(l.pid, { text, label: l.label })
        }
        setSpeakerLabels(editor.view, labels)
      } catch (e) {
        // Labels are a convenience: the page goes on without them.
        console.warn('Could not get the speakers and tone for the page', e)
      }
    }
    const soon = (ms: number, mark: boolean): void => {
      clearTimeout(timer)
      timer = setTimeout(() => void refresh(mark), ms)
    }
    soon(0, true)
    const offMarked = onEvent('readAloud:marked', (e) => {
      if (e.sceneId === sceneId) soon(AFTER_MARKS_MS, true)
    })
    const onChange = ({ transaction }: { transaction: { docChanged: boolean } }): void => {
      if (!transaction.docChanged) return
      soon(AFTER_TYPING_MS, false)
      clearTimeout(markTimer)
      markTimer = setTimeout(() => soon(0, true), MARK_AFTER_TYPING_MS)
    }
    editor.on('transaction', onChange)
    return () => {
      token++
      clearTimeout(timer)
      clearTimeout(markTimer)
      offMarked()
      editor.off('transaction', onChange)
    }
  }, [editor, sceneId, on, tone])

  return null
}
