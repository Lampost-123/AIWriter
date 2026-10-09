// What the Critique tab's notes do: show their words in the page (opening the scene they are in, for a chapter's
// note), and "Rewrite this", which hands the words and the note to the AI tools' Rewrite, so the rewrite waits in the
// page as a tracked change to accept or reject like any other (features/edits/session.ts). Nothing changes until then.
import type { CritiqueNote } from '@shared/contracts/critique'
import type { ID } from '@shared/types'
import { toast } from '@/components/ui'
import { editorBridge } from '@/lib/editorBridge'
import { findTextRange } from '@/features/editor/findText'
import { startTool } from '@/features/edits/session'
import { wordsIn } from '@/features/edits/text'
import { showWords } from '@/features/memory/openScene'
import { placesInPage } from '@/features/issues/actions'
import { pickOccurrence, sentenceAround } from '@/features/issues/issuesLogic'
import { rewriteDirection } from './critiqueLogic'

const WORDS_GONE = 'Those words aren’t in the scene any more.'

/** Shows the note's words in the page, selected and scrolled into view (opening their scene first when needed). */
export function showNote(note: CritiqueNote): void {
  if (note.sceneId && note.quote) showWords(note.sceneId, note.quote)
}

/** Waits (a few seconds at most) until the page shows the scene. */
async function sceneShowing(sceneId: ID, ms = 4000): Promise<boolean> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    const b = editorBridge()
    if (b?.sceneId === sceneId && b.editor) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return false
}

/**
 * Rewrite this: the AI tools' Rewrite on the note's words, told what the note says. Words inside one paragraph are
 * widened to the whole sentences they are in; a passage across paragraphs is rewritten as it is. For a chapter's note,
 * its scene opens first.
 */
export async function rewriteThis(note: CritiqueNote): Promise<void> {
  if (!note.sceneId || !note.quote.trim()) return
  if (editorBridge()?.sceneId !== note.sceneId) {
    showWords(note.sceneId, note.quote)
    if (!(await sceneShowing(note.sceneId))) {
      toast('Open the scene to rewrite its words.')
      return
    }
  }
  const editor = editorBridge()?.editor
  if (!editor) return
  const doc = editor.state.doc
  const places = placesInPage(doc, note.quote)
  const one = pickOccurrence(places, note.occurrence) ?? places[0] ?? null
  const range = one ?? findTextRange(doc, note.quote)
  if (!range) {
    toast(WORDS_GONE)
    return
  }
  let target = range
  if (one) {
    // The whole sentences the words are in, within their paragraph.
    const $from = doc.resolve(one.from)
    const start = $from.start()
    const para = $from.parent
    const text = para.textBetween(0, para.content.size, undefined, ' ')
    const s = sentenceAround(text, one.from - start, Math.min(one.to, $from.end()) - start)
    target = wordsIn(doc, start + s.from, start + s.to) ?? one
  }
  void startTool('rewrite', {
    direction: rewriteDirection(note),
    range: target,
    mustChange: {
      again: 'Your last answer was identical to the selected words, so nothing changed. Rewrite them so they act on the note.',
      giveUp: 'The writer model sent those words back as they were. Try Rewrite this again, or change them yourself.'
    }
  })
}
