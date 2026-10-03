// Changing the open scene's words for find and replace, through the editor, so Ctrl+Z undoes it: a Replace is
// one step, and Replace all (in the scene or across the story) is one step too. Plain ProseMirror over an
// EditorState, so it is unit-tested without a window.
//
// Words inside an AI suggestion waiting in the page are never changed (features/edits/suggestions.ts), and
// every transaction here is marked 'aiwriteWords': 'none' so the day's word count doesn't take replaced words
// for words Adam typed.

import type { Node as PMNode } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { PageChange } from '@shared/contracts/find'
import { BREAK_CHAR, curlLike, OBJECT_CHAR, touches, type FoundMatch } from '@shared/findReplace'
import { activeSuggestion } from '@/features/edits/suggestions'

/** The meta the day's word count reads: these changes aren't words Adam typed. */
export const WORDS_META = 'aiwriteWords'

/** Ranges of the page no replacement may touch: an AI suggestion waiting there. */
export function keptRanges(state: EditorState): { from: number; to: number }[] {
  const s = activeSuggestion(state)
  return s ? [{ from: s.from, to: s.to }] : []
}

/** True when this match is inside an AI suggestion waiting in the page. */
export const isKept = (state: EditorState, m: { from: number; to: number }): boolean => keptRanges(state).some((k) => touches(m, k))

/** The words that go in place of a match: the replacement, in the quote style of the words it replaces. */
function wordsFor(doc: PMNode, m: FoundMatch, replacement: string): string {
  const matched = doc.textBetween(m.from, m.to, BREAK_CHAR, OBJECT_CHAR)
  const $from = doc.resolve(m.from)
  const before = $from.parentOffset > 0 ? doc.textBetween(m.from - 1, m.from, BREAK_CHAR, BREAK_CHAR) : ''
  return curlLike(replacement, matched, before)
}

/**
 * A transaction replacing these matches (never touching an AI suggestion) as one undo step of its own. The new
 * words take the formatting of the first letter they replace. Returns null when none could change, and how many
 * did, with where the last new words end (for the next match after them).
 */
export function replaceMatchesTr(
  state: EditorState,
  matches: FoundMatch[],
  replacement: string
): { tr: Transaction; count: number; kept: number; end: number } | null {
  const kept = keptRanges(state)
  const ok = matches.filter((m) => !kept.some((k) => touches(m, k))).sort((a, b) => b.from - a.from)
  if (!ok.length) return null
  const tr = state.tr
  // Last to first, so each change leaves the positions of those still to do as they were.
  for (const m of ok) {
    const text = wordsFor(state.doc, m, replacement)
    const first = state.doc.nodeAt(m.from)
    if (text) tr.replaceWith(m.from, m.to, state.schema.text(text, first?.isText ? first.marks : []))
    else tr.delete(m.from, m.to)
  }
  // Where the new words of the last match (in reading order) end.
  const end = tr.mapping.map(ok[0].to, 1)
  closeHistory(tr)
  tr.setMeta(WORDS_META, 'none')
  return { tr, count: ok.length, kept: matches.length - ok.length, end }
}

/**
 * Makes a change worked out in the main process (find and replace across the story, or its Undo) in the page,
 * as one undo step. Returns null, changing nothing, when the ranges don't fit the page.
 */
export function pageChangeTr(state: EditorState, change: PageChange): Transaction | null {
  let target: PMNode
  try {
    target = state.schema.nodeFromJSON(change.doc)
  } catch {
    return null
  }
  const size = state.doc.content.size
  const tr = state.tr
  try {
    for (const r of [...change.ranges].sort((a, b) => b.from - a.from)) {
      if (r.from < 0 || r.to > size || r.from > r.to || r.newTo > target.content.size) return null
      tr.replace(r.from, r.to, target.slice(r.newFrom, r.newTo))
    }
  } catch {
    return null
  }
  closeHistory(tr)
  tr.setMeta(WORDS_META, 'none')
  return tr
}
