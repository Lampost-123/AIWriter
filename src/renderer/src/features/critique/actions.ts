// What the Critique tab's notes do: show their words in the page (opening the scene they are in, for a chapter's
// note), and "Rewrite this", which hands the words and the note to the AI tools' Rewrite, so the rewrite waits in the
// page as a tracked change to accept or reject like any other (features/edits/session.ts). Nothing changes until then.
// Accepted, the note is marked done (with the words the rewrite put in, so a later critique never reverses it), and the
// new words are checked as a draft's are when it lands (check and repair, features/repair), so a rewrite that breaks
// continuity is caught.
import type { CritiqueNote, CritiqueTarget } from '@shared/contracts/critique'
import type { ID } from '@shared/types'
import { toast } from '@/components/ui'
import { editorBridge } from '@/lib/editorBridge'
import { findTextRange } from '@/features/editor/findText'
import { startTool } from '@/features/edits/session'
import { textOf, wordsIn } from '@/features/edits/text'
import { showWords } from '@/features/memory/openScene'
import { placesInPage } from '@/features/issues/actions'
import { pickOccurrence, sentenceAround } from '@/features/issues/issuesLogic'
import { repairLanded } from '@/features/repair/repairRun'
import { rewriteDirection } from './critiqueLogic'
import { settleNote } from './critiqueStore'

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

/** The most of the new words kept with a note marked done. */
const MOST_NEW_WORDS = 1200

/**
 * Rewrite this: the AI tools' Rewrite on the note's words, told what the note says. Words inside one paragraph are
 * widened to the whole sentences they are in; a passage across paragraphs is rewritten as it is. For a chapter's note,
 * its scene opens first. `target` and `at` say which critique the note is in (it is marked done there on Accept).
 */
export async function rewriteThis(note: CritiqueNote, target: CritiqueTarget, at: string): Promise<void> {
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
  let words = range
  if (one) {
    // The whole sentences the words are in, within their paragraph.
    const $from = doc.resolve(one.from)
    const start = $from.start()
    const para = $from.parent
    const text = para.textBetween(0, para.content.size, undefined, ' ')
    const s = sentenceAround(text, one.from - start, Math.min(one.to, $from.end()) - start)
    words = wordsIn(doc, start + s.from, start + s.to) ?? one
  }
  const sceneId = note.sceneId
  void startTool('rewrite', {
    direction: rewriteDirection(note),
    range: words,
    onAccepted: (put, recordId) => {
      const ed = editorBridge()?.editor
      const newWords = ed && !ed.isDestroyed ? textOf(ed.state.doc, put.from, Math.min(put.to, ed.state.doc.content.size)).slice(0, MOST_NEW_WORDS) : ''
      void settleNote(target, note, 'done', { newWords, at })
      // Checked as a draft's words are when it lands: a slip is mended in amber or asked in the Issues tab.
      if (recordId) repairLanded({ sceneId, recordId, ...put })
    },
    mustChange: {
      again: 'Your last answer was identical to the selected words, so nothing changed. Rewrite them so they act on the note.',
      giveUp: 'The writer model sent those words back as they were. Try Rewrite this again, or change them yourself.'
    }
  })
}
