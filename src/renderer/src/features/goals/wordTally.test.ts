import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state'
import { closeHistory, history, undo, redo } from '@tiptap/pm/history'
import { sceneExtensions } from '@/features/editor/extensions'
import { appendStream, commitStream, docFromText, startStream, streamPlugin } from '@/features/editor/streamDoc'
import { acceptSuggestion, showSuggestion, suggestionsPluginForTests, updateSuggestion } from '@/features/edits/suggestions'
import { changedWords, changeKind, Tally } from './wordTally'
import { WORDS_META } from './wordsMeta'

const schema = getSchema(sceneExtensions())
const TODAY = '2026-10-03'

const stateFrom = (text: string): EditorState => EditorState.create({ schema, doc: docFromText(schema, text), plugins: [history(), streamPlugin] })

/** Applies a transaction and counts it as the editor's tally would. */
function run(t: Tally, s: EditorState, tr: Transaction): { state: EditorState; typed: number; ai: number } {
  const next = s.apply(tr)
  const stream = tr.getMeta(streamPlugin.spec.key!) as { type?: string } | undefined
  const d = t.take(changeKind(tr), s.doc, next.doc, TODAY, { streamStart: stream?.type === 'start', stream: !!stream, recorded: tr.getMeta('addToHistory') !== false })
  return { state: next, typed: d.typed, ai: d.ai }
}

const typeAt = (s: EditorState, text: string, at: number): Transaction => s.tr.setSelection(TextSelection.create(s.doc, at)).insertText(text)

/** Ctrl+Z and Ctrl+Y as the history plugin makes them. */
function undoTr(s: EditorState): Transaction {
  let out: Transaction | null = null
  undo(s, (tr) => (out = tr))
  if (!out) throw new Error('nothing to undo')
  return out
}
function redoTr(s: EditorState): Transaction {
  let out: Transaction | null = null
  redo(s, (tr) => (out = tr))
  if (!out) throw new Error('nothing to redo')
  return out
}

describe('words a change adds', () => {
  it('counts whole words once, before and after', () => {
    const a = docFromText(schema, 'The cat sat.')
    const b = docFromText(schema, 'The caat sat.')
    // Same paragraph rebuilt: the words that differ are compared.
    expect(changedWords(a, b)).toEqual({ removed: 1, added: 1 })
    const s = stateFrom('The cat sat.')
    const after = s.apply(typeAt(s, ' down', 12)).doc
    const { removed, added } = changedWords(s.doc, after)
    expect(added - removed).toBe(1)
    const split = s.apply(typeAt(s, ' ', 6)).doc // "The ca t sat."
    const c = changedWords(s.doc, split)
    expect(c.added - c.removed).toBe(1)
  })
})

describe('where words come from', () => {
  it('counts typing, pasting and deleting as typed, and nothing for changes outside the history', () => {
    const t = new Tally()
    let s = stateFrom('Rain fell.')
    let r = run(t, s, typeAt(s, ' on the roofs', 10))
    expect(r).toMatchObject({ typed: 3, ai: 0 })
    s = r.state
    r = run(t, s, s.tr.setMeta('uiEvent', 'paste').insertText(' It was late and cold.', s.doc.content.size - 1))
    expect(r.typed).toBe(5)
    s = r.state
    r = run(t, s, s.tr.delete(1, 6))
    expect(r.typed).toBe(-1)
    s = r.state
    r = run(t, s, s.tr.insertText('Quiet ', 1).setMeta('addToHistory', false))
    expect(r).toMatchObject({ typed: 0, ai: 0 })
  })

  it('never counts a restored version or find and replace as typed, nor undoing them', () => {
    const t = new Tally()
    let s = stateFrom('One two.')
    const restored = docFromText(schema, 'An older version of the scene with more words.')
    let r = run(t, s, closeHistory(s.tr.replaceWith(0, s.doc.content.size, restored.content).setMeta(WORDS_META, 'none')))
    expect(r).toMatchObject({ typed: 0, ai: 0 })
    s = r.state
    r = run(t, s, undoTr(s))
    expect(r).toMatchObject({ typed: 0, ai: 0 })
    expect(r.state.doc.textContent).toBe('One two.')
    s = r.state
    r = run(t, s, redoTr(s))
    expect(r).toMatchObject({ typed: 0, ai: 0 })
  })

  it('gives typed words back on undo, and counts them again on redo', () => {
    const t = new Tally()
    let s = stateFrom('One two.')
    let total = 0
    const step = (tr: Transaction): void => {
      const r = run(t, s, tr)
      total += r.typed
      s = r.state
    }
    // Type a sentence, Ctrl+Z, type it again: counted once.
    step(closeHistory(typeAt(s, ' The ferry left at dawn.', 9)))
    expect(total).toBe(5)
    step(undoTr(s))
    expect(total).toBe(0)
    step(closeHistory(typeAt(s, ' The ferry left at dawn.', 9)))
    expect(total).toBe(5)
    // Redo after undo counts it again, once.
    step(undoTr(s))
    step(redoTr(s))
    expect(total).toBe(5)
  })

  it('a big delete undone straight away gives back exactly what it took', () => {
    const t = new Tally()
    const long = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} has five words.`).join('\n\n')
    let s = stateFrom(long)
    let total = 0
    const step = (tr: Transaction): void => {
      const r = run(t, s, tr)
      total += r.typed
      s = r.state
    }
    // Ctrl+A, Backspace.
    step(closeHistory(s.tr.delete(0, s.doc.content.size)))
    expect(total).toBe(-200)
    step(undoTr(s))
    expect(total).toBe(0)
  })

  it('counts a draft streaming in as AI words, and takes them back when it is undone', () => {
    const t = new Tally()
    let s = stateFrom('Adam wrote this.')
    s = run(t, s, startStream(s, 'g1')).state
    let ai = 0
    for (const text of ['The storm came ', 'in off the sea.']) {
      const tr = appendStream(s, [{ kind: 'text', text }])!
      const r = run(t, s, tr)
      ai += r.ai
      expect(r.typed).toBe(0)
      s = r.state
    }
    expect(ai).toBe(7)
    // The draft becomes one undo step (as the editor does, without a dispatched change).
    s = commitStream(s)
    let out: Transaction | null = null
    undo(s, (tr) => (out = tr))
    const r = run(t, s, out!)
    expect(r).toMatchObject({ typed: 0, ai: -7 })
    out = null
    redo(r.state, (tr) => (out = tr))
    expect(run(t, r.state, out!)).toMatchObject({ typed: 0, ai: 7 })
  })

  it('counts a draft replacing the scene by the words it brings', () => {
    const t = new Tally()
    let s = stateFrom('Five words of old text.')
    s = run(t, s, startStream(s, 'g2', { replace: true })).state
    const r = run(t, s, appendStream(s, [{ kind: 'text', text: 'New words.' }])!)
    expect(r).toMatchObject({ typed: 0, ai: 2 })
  })

  it('counts an accepted AI change and a picked variant as AI words', () => {
    const t = new Tally()
    let s = EditorState.create({ schema, doc: docFromText(schema, 'He walked home slowly.'), plugins: [history(), streamPlugin, suggestionsPluginForTests] })
    // "walked home slowly" rewritten by an AI tool, then accepted.
    s = s.apply(showSuggestion(s, { id: 't1', sceneId: 's1', tool: 'rewrite', direction: '', mode: 'replace', from: 4, to: 22 }))
    s = s.apply(updateSuggestion(s, 't1', { text: 'trudged back to the farm', status: 'ready' }))
    const accepted = run(t, s, acceptSuggestion(s, 't1')!)
    expect(accepted).toMatchObject({ typed: 0, ai: 5 })
    s = accepted.state
    const variant = docFromText(schema, 'A whole new scene from a variant.')
    const r = run(t, s, s.tr.replaceWith(0, s.doc.content.size, variant.content).setMeta(WORDS_META, 'ai'))
    expect(r).toMatchObject({ typed: 0, ai: 7 })
    // The variant's message Undo puts the page back as it was: its words come off again.
    const back = run(t, r.state, r.state.tr.replaceWith(0, r.state.doc.content.size, s.doc.content).setMeta(WORDS_META, 'none'))
    expect(back).toMatchObject({ typed: 0, ai: -7 })
    expect(changeKind(s.tr.setMeta(WORDS_META, 'ai-net'))).toBe('ai')
  })
})
