import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state'
import { closeHistory, history, redo, undo, undoDepth } from '@tiptap/pm/history'
import { sceneExtensions } from '@/features/editor/extensions'
import { paragraphIdsPlugin, withParagraphIds } from '@/features/editor/paragraphIds'
import { docFromText, sceneText, startStream, streamPlugin } from '@/features/editor/streamDoc'
import {
  acceptSuggestion,
  activeSuggestion,
  clearSuggestion,
  mapRange,
  markTarget,
  rejectSuggestion,
  restoreSuggestion,
  showSuggestion,
  shownParagraphs,
  suggestionsOf,
  suggestionsPluginForTests,
  suggestionUndo,
  updateSuggestion,
  type NewSuggestion
} from './suggestions'

const schema = getSchema(sceneExtensions())

const TEXT = 'The rain had not let up since noon.\n\nMara pushed the door open. The tavern was warm and loud.\n\nNobody looked up.'

function stateFrom(text: string): EditorState {
  const doc = withParagraphIds(docFromText(schema, text)).doc
  return EditorState.create({ schema, doc, plugins: [history(), streamPlugin, paragraphIdsPlugin, suggestionsPluginForTests] })
}

const apply = (s: EditorState, tr: Transaction | null): EditorState => (tr ? s.apply(tr) : s)

/** Where some words are in the page. */
function rangeOf(doc: PMNode, words: string): { from: number; to: number } {
  let found: { from: number; to: number } | null = null
  doc.descendants((node, pos) => {
    if (found) return false
    if (!node.isTextblock) return true
    const i = node.textContent.indexOf(words)
    if (i >= 0) found = { from: pos + 1 + i, to: pos + 1 + i + words.length }
    return false
  })
  if (!found) throw new Error(`Not in the page: ${words}`)
  return found
}

/** Types at a position, as Adam would (a step of its own in the undo history). */
const typeAt = (s: EditorState, pos: number, text: string): EditorState => s.apply(closeHistory(s.tr.insertText(text, pos)))

const paragraphs = (doc: PMNode): { text: string; pid: string | null }[] => {
  const out: { text: string; pid: string | null }[] = []
  doc.descendants((node) => {
    if (node.type.name !== 'paragraph') return true
    out.push({ text: node.textContent, pid: node.attrs.pid as string | null })
    return false
  })
  return out
}

function suggest(s: EditorState, words: string, o: Partial<NewSuggestion> = {}): EditorState {
  const r = rangeOf(s.doc, words)
  return apply(s, showSuggestion(s, { id: 't1', sceneId: 's1', tool: 'condense', direction: '', mode: 'replace', ...r, ...o }))
}

const ready = (s: EditorState, text: string): EditorState => apply(s, updateSuggestion(s, 't1', { text, status: 'ready' }))

describe('a suggestion in the page', () => {
  it('changes nothing in the scene’s text until it is accepted', () => {
    const s0 = stateFrom(TEXT)
    const s1 = ready(suggest(s0, 'The tavern was warm and loud.'), 'The tavern was warm.')
    expect(s1.doc.eq(s0.doc)).toBe(true)
    expect(sceneText(s1.doc)).toBe(sceneText(s0.doc))
    expect(activeSuggestion(s1)).toMatchObject({ text: 'The tavern was warm.', status: 'ready', mode: 'replace' })
    // The caret waits after the change.
    expect(s1.selection.head).toBe(rangeOf(s0.doc, 'The tavern was warm and loud.').to)
  })

  it('moves with typing before it, and keeps what is typed at its edges outside it', () => {
    const s1 = ready(suggest(stateFrom(TEXT), 'The tavern was warm and loud.'), 'The tavern was warm.')
    const { from, to } = activeSuggestion(s1)!
    const before = typeAt(s1, 1, 'Grey. ')
    expect(activeSuggestion(before)).toMatchObject({ from: from + 6, to: to + 6 })
    const atStart = typeAt(s1, from, 'Inside, ')
    expect(activeSuggestion(atStart)).toMatchObject({ from: from + 8, to: to + 8 })
    const atEnd = typeAt(s1, to, ' Smoke hung low.')
    expect(activeSuggestion(atEnd)).toMatchObject({ from, to })
    const after = typeAt(s1, rangeOf(s1.doc, 'Nobody').from, 'Still, ')
    expect(activeSuggestion(after)).toMatchObject({ from, to })
  })

  it('goes when the words under it change, the scene is replaced, or a draft starts', () => {
    const s1 = ready(suggest(stateFrom(TEXT), 'The tavern was warm and loud.'), 'The tavern was warm.')
    const { from, to } = activeSuggestion(s1)!
    const edited = typeAt(s1, from + 4, 'old ')
    expect(activeSuggestion(edited)).toBeNull()
    expect(suggestionsOf(edited).gone).toMatchObject({ id: 't1', reason: 'edited' })
    const cut = apply(s1, s1.tr.delete(from - 5, from + 3))
    expect(suggestionsOf(cut).gone?.reason).toBe('edited')
    const replaced = apply(s1, s1.tr.replaceWith(0, s1.doc.content.size, schema.nodes.paragraph.create(null, schema.text('New.'))))
    expect(suggestionsOf(replaced).gone?.reason).toBe('replaced')
    const draft = apply(s1, startStream(s1, 'g1'))
    expect(activeSuggestion(draft)).toBeNull()
    expect(suggestionsOf(draft).gone?.reason).toBe('draft')
    // Deleting right up to its edges leaves it be.
    const trimmed = apply(s1, s1.tr.delete(to, to + 0).delete(from - 1, from))
    expect(activeSuggestion(trimmed)).toMatchObject({ from: from - 1, to: to - 1 })
  })

  it('keeps a Continue point before what is typed at it, and drops it when the words across it go', () => {
    const s0 = stateFrom('Mara pushed the door and stepped in.')
    const at = rangeOf(s0.doc, 'Mara pushed the door').to
    const s1 = apply(s0, showSuggestion(s0, { id: 't1', sceneId: 's1', tool: 'continue', direction: '', from: at, to: at, mode: 'inline' }))
    const typed = typeAt(s1, at, ' slowly')
    expect(activeSuggestion(typed)).toMatchObject({ from: at, to: at })
    // Words just before it went, but nothing across it: it stays, where they ended.
    const shorter = apply(s1, s1.tr.delete(at - 5, at))
    expect(activeSuggestion(shorter)).toMatchObject({ from: at - 5, to: at - 5 })
    const across = apply(s1, s1.tr.delete(at - 2, at + 2))
    expect(activeSuggestion(across)).toBeNull()
    expect(suggestionsOf(across).gone?.reason).toBe('edited')
  })

  it('maps a range through each step in turn', () => {
    const s0 = stateFrom(TEXT)
    const r = rangeOf(s0.doc, 'warm and loud')
    const tr = s0.tr.insertText('XX', 1).insertText('YY', r.to + 2)
    expect(mapRange(r, tr)).toEqual({ from: r.from + 2, to: r.to + 2 })
    expect(mapRange(r, s0.tr.insertText('ZZ', r.from + 3))).toBe('edited')
  })

  it('marks the words a tool is about to work on, and forgets them when they change', () => {
    const s0 = stateFrom(TEXT)
    const r = rangeOf(s0.doc, 'warm and loud')
    const s1 = apply(s0, markTarget(s0, r))
    expect(suggestionsOf(s1).target).toEqual(r)
    expect(suggestionsOf(typeAt(s1, r.from + 1, 'x')).target).toBeNull()
    expect(suggestionsOf(apply(s1, markTarget(s1, null))).target).toBeNull()
  })
})

describe('Accept', () => {
  it('puts the new words in place of the old as one undo step; redo puts them back', () => {
    const s0 = stateFrom(TEXT)
    const s1 = ready(suggest(s0, 'The tavern was warm and loud.'), 'The tavern was *warm*.')
    let s2 = apply(s1, acceptSuggestion(s1, 't1'))
    s2 = s2.apply(closeHistory(s2.tr))
    expect(sceneText(s2.doc)).toBe(
      'The rain had not let up since noon.\n\nMara pushed the door open. The tavern was warm.\n\nNobody looked up.'
    )
    expect(activeSuggestion(s2)).toBeNull()
    expect(suggestionsOf(s2).gone?.reason).toBe('accepted')
    // The AI's asterisks are italics.
    const warm = rangeOf(s2.doc, 'warm.')
    expect(s2.doc.rangeHasMark(warm.from, warm.from + 4, schema.marks.italic)).toBe(true)
    // The caret is at the end of the new words.
    expect(s2.selection.head).toBe(rangeOf(s2.doc, 'The tavern was warm.').to)
    let back: EditorState = s2
    undo(s2, (tr) => (back = s2.apply(tr)))
    expect(back.doc.eq(s0.doc)).toBe(true)
    let again: EditorState = back
    redo(back, (tr) => (again = back.apply(tr)))
    expect(again.doc.eq(s2.doc)).toBe(true)
  })

  it('keeps paragraph ids where the new words take the place of several paragraphs', () => {
    const s0 = stateFrom('One two three.\n\nFour five six.\n\nSeven eight nine.\n\nTen.')
    const before = paragraphs(s0.doc)
    const r = { from: rangeOf(s0.doc, 'two three.').from, to: rangeOf(s0.doc, 'Seven eight').to }
    const s1 = apply(s0, showSuggestion(s0, { id: 't1', sceneId: 's1', tool: 'rewrite', direction: 'x', mode: 'replace', ...r }))
    const s2 = ready(s1, 'A.\n\nB.\n\nC')
    const out = apply(s2, acceptSuggestion(s2, 't1'))
    expect(paragraphs(out.doc)).toEqual([
      { text: 'One A.', pid: before[0].pid },
      { text: 'B.', pid: before[1].pid },
      { text: 'C nine.', pid: before[2].pid },
      { text: 'Ten.', pid: before[3].pid }
    ])
    const s3 = ready(s1, 'and')
    const one = apply(s3, acceptSuggestion(s3, 't1'))
    expect(paragraphs(one.doc)).toEqual([
      { text: 'One and nine.', pid: before[0].pid },
      { text: 'Ten.', pid: before[3].pid }
    ])
  })

  it('splits a paragraph when the new words have more paragraphs, giving the second half its own id', () => {
    const s0 = stateFrom(TEXT)
    const s1 = ready(suggest(s0, 'The tavern was warm and loud.'), 'The tavern was warm.\n\nIt was loud.')
    const s2 = apply(s1, acceptSuggestion(s1, 't1'))
    const ps = paragraphs(s2.doc)
    expect(ps.map((p) => p.text)).toEqual([
      'The rain had not let up since noon.',
      'Mara pushed the door open. The tavern was warm.',
      'It was loud.',
      'Nobody looked up.'
    ])
    expect(ps[1].pid).toBe(paragraphs(s0.doc)[1].pid)
    expect(new Set(ps.map((p) => p.pid)).size).toBe(4)
    expect(ps.every((p) => !!p.pid)).toBe(true)
  })

  it('carries on a paragraph from where it stops, joining it with a space', () => {
    const s0 = stateFrom('Mara pushed the door and')
    const at = s0.doc.content.size - 1
    let s1 = apply(s0, showSuggestion(s0, { id: 't1', sceneId: 's1', tool: 'continue', direction: '', from: at, to: at, mode: 'inline' }))
    s1 = apply(s1, updateSuggestion(s1, 't1', { text: 'stepped inside.', status: 'ready' }))
    expect(shownParagraphs(s1.doc, activeSuggestion(s1)!).paras).toEqual([' stepped inside.'])
    const s2 = apply(s1, acceptSuggestion(s1, 't1'))
    expect(sceneText(s2.doc)).toBe('Mara pushed the door and stepped inside.')
    let back: EditorState = s2
    undo(s2, (tr) => (back = s2.apply(tr)))
    expect(back.doc.eq(s0.doc)).toBe(true)
  })

  it('adds the next paragraphs after a finished one, each with its own id', () => {
    const s0 = stateFrom('Mara pushed the door open.\n\nNobody looked up.')
    const at = rangeOf(s0.doc, 'open.').to
    let s1 = apply(
      s0,
      showSuggestion(s0, { id: 't1', sceneId: 's1', tool: 'continue', direction: '', from: at, to: at, mode: 'paragraph' })
    )
    s1 = apply(s1, updateSuggestion(s1, 't1', { text: 'Smoke hung low.\n\nTobin waited.', status: 'ready' }))
    expect(shownParagraphs(s1.doc, activeSuggestion(s1)!)).toEqual({ paras: ['Smoke hung low.', 'Tobin waited.'], firstInline: false })
    const s2 = apply(s1, acceptSuggestion(s1, 't1'))
    const ps = paragraphs(s2.doc)
    expect(ps.map((p) => p.text)).toEqual(['Mara pushed the door open.', 'Smoke hung low.', 'Tobin waited.', 'Nobody looked up.'])
    expect(ps[0].pid).toBe(paragraphs(s0.doc)[0].pid)
    expect(new Set(ps.map((p) => p.pid)).size).toBe(4)
    expect(ps.every((p) => !!p.pid)).toBe(true)
  })

  it('puts nothing in when there are no new words', () => {
    const s1 = ready(suggest(stateFrom(TEXT), 'The tavern was warm and loud.'), '  ')
    expect(acceptSuggestion(s1, 't1')).toBeNull()
    expect(acceptSuggestion(s1, 'another')).toBeNull()
  })
})

describe('Reject, undo and redo', () => {
  it('rejects with Ctrl+Z while nothing was typed since it showed; after typing, Ctrl+Z undoes the typing first', () => {
    const s0 = typeAt(stateFrom(TEXT), 1, 'Grey. ')
    const s1 = ready(suggest(s0, 'The tavern was warm and loud.'), 'The tavern was warm.')
    expect(suggestionUndo(s1, 'undo')).toBe('reject')
    const typed = typeAt(s1, 1, 'Cold. ')
    expect(suggestionUndo(typed, 'undo')).toBe('none')
    let undone: EditorState = typed
    undo(typed, (tr) => (undone = typed.apply(tr)))
    expect(activeSuggestion(undone)).not.toBeNull()
    expect(suggestionUndo(undone, 'undo')).toBe('reject')
  })

  it('changes nothing on Reject, and Ctrl+Y brings it back while nothing else happened', () => {
    const s0 = stateFrom(TEXT)
    const s1 = ready(suggest(s0, 'The tavern was warm and loud.'), 'The tavern was warm.')
    const s2 = apply(s1, rejectSuggestion(s1, 't1'))
    expect(activeSuggestion(s2)).toBeNull()
    expect(s2.doc.eq(s0.doc)).toBe(true)
    expect(suggestionsOf(s2).gone?.reason).toBe('rejected')
    expect(suggestionUndo(s2, 'redo')).toBe('restore')
    const s3 = apply(s2, restoreSuggestion(s2))
    expect(activeSuggestion(s3)).toMatchObject({ text: 'The tavern was warm.', status: 'ready' })
    // Typing after the reject is the last thing done: Ctrl+Y doesn't reach back past it.
    const typed = typeAt(s2, 1, 'Grey. ')
    expect(suggestionUndo(typed, 'redo')).toBe('none')
    // The toast's Undo still brings it back (moved with the typing).
    const fromToast = apply(typed, restoreSuggestion(typed))
    expect(activeSuggestion(fromToast)).toMatchObject({ from: activeSuggestion(s1)!.from + 6 })
  })

  it('brings back what had come of a change rejected while it was written, ready to accept, and nothing when no words had come', () => {
    const s0 = stateFrom(TEXT)
    const writing = (s: EditorState, p: Parameters<typeof updateSuggestion>[2]): EditorState =>
      apply(s, updateSuggestion(s, 't1', { status: 'writing', ...p }))
    const part = writing(suggest(s0, 'The tavern was warm and loud.'), { text: 'The tavern' })
    const back = apply(part, rejectSuggestion(part, 't1'))
    const restored = apply(back, restoreSuggestion(back))
    expect(activeSuggestion(restored)).toMatchObject({ text: 'The tavern', status: 'ready' })
    // Three versions, the last cut short: all that came can be picked.
    const versions = writing(suggest(s0, 'The tavern was warm and loud.', { tool: 'alternatives' }), {
      versions: ['One.', 'Tw'],
      versionsDone: 1
    })
    const v2 = apply(versions, rejectSuggestion(versions, 't1'))
    expect(activeSuggestion(apply(v2, restoreSuggestion(v2)))).toMatchObject({ versionsDone: 2, status: 'ready' })
    // Nothing had come: nothing to bring back.
    const empty = writing(suggest(s0, 'The tavern was warm and loud.'), {})
    const gone = apply(empty, rejectSuggestion(empty, 't1'))
    expect(activeSuggestion(gone)).toBeNull()
    expect(restoreSuggestion(gone)).toBeNull()
    expect(suggestionUndo(gone, 'redo')).toBe('none')
  })

  it('can’t be brought back once its words have changed', () => {
    const s1 = ready(suggest(stateFrom(TEXT), 'The tavern was warm and loud.'), 'The tavern was warm.')
    const s2 = apply(s1, rejectSuggestion(s1, 't1'))
    const edited = typeAt(s2, activeSuggestion(s1)!.from + 4, 'old ')
    expect(restoreSuggestion(edited)).toBeNull()
  })

  it('clears without keeping it, and only the suggestion asked for', () => {
    const s1 = ready(suggest(stateFrom(TEXT), 'The tavern was warm and loud.'), 'The tavern was warm.')
    expect(activeSuggestion(apply(s1, clearSuggestion(s1, 'other')))).not.toBeNull()
    const s2 = apply(s1, clearSuggestion(s1, 't1'))
    expect(activeSuggestion(s2)).toBeNull()
    expect(restoreSuggestion(s2)).toBeNull()
  })

  it('takes Ctrl+Z as a normal undo while there is no suggestion', () => {
    const s0 = typeAt(stateFrom(TEXT), 1, 'Grey. ')
    expect(undoDepth(s0)).toBe(1)
    expect(suggestionUndo(s0, 'undo')).toBe('none')
    expect(suggestionUndo(s0, 'redo')).toBe('none')
  })
})

describe('what shows', () => {
  it('shows new paragraphs below old ones that were whole paragraphs, and inline after words inside one', () => {
    const s0 = stateFrom(TEXT)
    const whole = ready(suggest(s0, 'Nobody looked up.'), 'No one looked up.')
    expect(shownParagraphs(whole.doc, activeSuggestion(whole)!).firstInline).toBe(false)
    const part = ready(suggest(s0, 'The tavern was warm and loud.'), 'Warm.')
    expect(shownParagraphs(part.doc, activeSuggestion(part)!).firstInline).toBe(true)
  })

  it('keeps the caret where Adam put it when he accepts while typing elsewhere', () => {
    const s1 = ready(suggest(stateFrom(TEXT), 'The tavern was warm and loud.'), 'Warm.')
    const elsewhere = s1.apply(s1.tr.setSelection(TextSelection.create(s1.doc, 3)))
    const s2 = apply(elsewhere, acceptSuggestion(elsewhere, 't1'))
    expect(s2.selection.head).toBe(3)
  })
})
