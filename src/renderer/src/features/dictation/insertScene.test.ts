import { describe, expect, it, vi } from 'vitest'
import { getSchema } from '@tiptap/core'
import { AllSelection, EditorState, TextSelection } from '@tiptap/pm/state'
import { closeHistory, history, undo } from '@tiptap/pm/history'
import { sceneExtensions } from '@/features/editor/extensions'
import { docFromText, sceneText } from '@/features/editor/streamDoc'
import { typeSpoken } from './insertScene'

const schema = getSchema(sceneExtensions())

const stateFrom = (text: string): EditorState => EditorState.create({ schema, doc: docFromText(schema, text), plugins: [history()] })

/** Types text at the cursor (or at `at`) as Adam would. */
function type(s: EditorState, text: string, at?: number): EditorState {
  let tr = s.tr
  if (at != null) tr = tr.setSelection(TextSelection.create(s.doc, at))
  return s.apply(tr.insertText(text))
}

/** Dictates, as the editor does: the words, then a closed step so typing after is a step of its own. */
function dictate(s: EditorState, spoken: string): EditorState {
  const tr = s.tr
  expect(typeSpoken(tr, spoken)).toBe(true)
  const next = s.apply(tr)
  return next.apply(closeHistory(next.tr))
}

function select(s: EditorState, from: number, to: number): EditorState {
  return s.apply(s.tr.setSelection(TextSelection.create(s.doc, from, to)))
}

function runUndo(s: EditorState): EditorState {
  let out = s
  undo(s, (tr) => (out = s.apply(tr)))
  return out
}

const end = (s: EditorState): number => s.doc.content.size - 1

describe('dictating into the scene', () => {
  it('types the words at the cursor with a space in front, and one undo takes out just them', () => {
    let s = stateFrom('')
    s = type(s, 'She lit the lamp.', 1)
    s = dictate(s, 'The lantern flickered twice.')
    expect(sceneText(s.doc)).toBe('She lit the lamp. The lantern flickered twice.')
    // The cursor is after the words.
    expect(s.selection.from).toBe(end(s))
    s = runUndo(s)
    expect(sceneText(s.doc)).toBe('She lit the lamp.')
  })

  it('keeps typing straight after the words a step of its own', () => {
    let s = stateFrom('')
    s = type(s, 'She lit the lamp.', 1)
    s = dictate(s, 'It flickered.')
    s = type(s, ' Then it went out.')
    expect(sceneText(s.doc)).toBe('She lit the lamp. It flickered. Then it went out.')
    s = runUndo(s)
    expect(sceneText(s.doc)).toBe('She lit the lamp. It flickered.')
    s = runUndo(s)
    expect(sceneText(s.doc)).toBe('She lit the lamp.')
  })

  it('replaces a selection, with the spaces either side it needs', () => {
    let s = stateFrom('a big dog')
    s = select(s, 3, 6)
    s = dictate(s, 'small')
    expect(sceneText(s.doc)).toBe('a small dog')
    expect(s.selection.from).toBe(8)
    s = runUndo(s)
    expect(sceneText(s.doc)).toBe('a big dog')
  })

  it('adds a space after the words before a word that follows', () => {
    let s = stateFrom('Then left.')
    s = select(s, 5, 5)
    s = dictate(s, 'she')
    expect(sceneText(s.doc)).toBe('Then she left.')
  })

  it('starts a paragraph without a space', () => {
    let s = stateFrom('First.\n\nlater, the second.')
    const second = s.doc.child(0).nodeSize + 1
    s = select(s, second, second)
    s = dictate(s, 'Much')
    expect(sceneText(s.doc)).toBe('First.\n\nMuch later, the second.')
  })

  it('types in place of the whole scene (Ctrl+A), with the cursor just after the words in their paragraph', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let s = stateFrom('First para.\n\nSecond para.')
    s = s.apply(s.tr.setSelection(new AllSelection(s.doc)))
    s = dictate(s, 'All new words.')
    expect(sceneText(s.doc)).toBe('All new words.')
    expect(s.selection.empty).toBe(true)
    expect(s.selection.$from.parent.type.name).toBe('paragraph')
    expect(s.selection.from).toBe(end(s))
    // Typing straight after carries on in the same paragraph.
    s = type(s, ' More.')
    expect(sceneText(s.doc)).toBe('All new words. More.')
    s = runUndo(runUndo(s))
    expect(sceneText(s.doc)).toBe('First para.\n\nSecond para.')
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('types nothing when nothing was said', () => {
    const s = stateFrom('Same.')
    expect(typeSpoken(s.tr, '   ')).toBe(false)
  })
})
