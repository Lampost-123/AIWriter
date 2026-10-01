import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state'
import { history, redo, undo } from '@tiptap/pm/history'
import { sceneExtensions } from './extensions'
import {
  activeStream,
  appendStream,
  commitStream,
  docFromStored,
  docFromText,
  finishStreamText,
  isDocEmpty,
  sceneText,
  startStream,
  streamPlugin
} from './streamDoc'
import { newSplitState, splitChunk, type SplitState } from './streamText'

const schema = getSchema(sceneExtensions())

function stateFrom(text: string): EditorState {
  return EditorState.create({ schema, doc: docFromText(schema, text), plugins: [history(), streamPlugin] })
}

const apply = (s: EditorState, tr: Transaction | null): EditorState => (tr ? s.apply(tr) : s)

/** Types text at the cursor as Adam would (recorded in history). */
function type(s: EditorState, text: string, at?: number): EditorState {
  let tr = s.tr
  if (at != null) tr = tr.setSelection(TextSelection.create(s.doc, at))
  return s.apply(tr.insertText(text))
}

function runUndo(s: EditorState): EditorState {
  let out = s
  undo(s, (tr) => (out = s.apply(tr)))
  return out
}

function runRedo(s: EditorState): EditorState {
  let out = s
  redo(s, (tr) => (out = s.apply(tr)))
  return out
}

/** Streams chunks the way the editor does. */
function stream(s: EditorState, chunks: string[], id = 'g1'): EditorState {
  let state = apply(s, startStream(s, id))
  let split: SplitState = newSplitState()
  for (const c of chunks) {
    const r = splitChunk(split, c)
    split = r.state
    state = apply(state, appendStream(state, r.ops))
  }
  return state
}

const finish = (s: EditorState): EditorState => commitStream(apply(s, finishStreamText(s)))

describe('loading and plain text', () => {
  it('builds paragraphs and scene breaks from text', () => {
    const doc = docFromText(schema, 'One.\n\n***\n\nTwo.')
    expect(doc.childCount).toBe(3)
    expect(doc.child(1).type.name).toBe('horizontalRule')
    expect(sceneText(doc)).toBe('One.\n\n* * *\n\nTwo.')
  })

  it('falls back to the text when the stored document is unreadable', () => {
    expect(sceneText(docFromStored(schema, { type: 'nonsense' }, 'Kept.'))).toBe('Kept.')
    expect(isDocEmpty(docFromStored(schema, null, ''))).toBe(true)
  })

  it('loads a stored document', () => {
    const stored = docFromText(schema, 'A.\n\nB.').toJSON()
    expect(sceneText(docFromStored(schema, stored, 'ignored'))).toBe('A.\n\nB.')
  })

  it('separates paragraphs with blank lines and skips empty ones', () => {
    const doc = schema.nodeFromJSON({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'A.' }] },
        { type: 'paragraph' },
        { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Quoted.' }] }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'B.' }] }
      ]
    })
    expect(sceneText(doc)).toBe('A.\n\nQuoted.\n\nB.')
  })
})

describe('streaming a draft', () => {
  it('writes into an empty scene', () => {
    const s = finish(stream(stateFrom(''), ['Mara ', 'waited.\n\nThe door ', 'opened.']))
    expect(sceneText(s.doc)).toBe('Mara waited.\n\nThe door opened.')
    expect(s.doc.childCount).toBe(2)
  })

  it('appends after a paragraph break when the scene has text', () => {
    const s = finish(stream(stateFrom('Adam wrote this.'), ['Then the draft.']))
    expect(sceneText(s.doc)).toBe('Adam wrote this.\n\nThen the draft.')
    expect(s.doc.childCount).toBe(2)
  })

  it('writes into a trailing empty paragraph instead of adding another', () => {
    let s = stateFrom('Adam wrote this.')
    s = s.apply(s.tr.insert(s.doc.content.size, schema.nodes.paragraph.create()))
    s = finish(stream(s, ['Draft.']))
    expect(s.doc.childCount).toBe(2)
    expect(sceneText(s.doc)).toBe('Adam wrote this.\n\nDraft.')
  })

  it('does not move the cursor, even when it sits where the draft is written', () => {
    let s = stateFrom('')
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 1)))
    s = stream(s, ['Hello there.\n\nMore.'])
    expect(s.selection.from).toBe(1)
    let t = stateFrom('First paragraph.')
    t = t.apply(t.tr.setSelection(TextSelection.create(t.doc, 6)))
    t = stream(t, ['Draft.'])
    expect(t.selection.from).toBe(6)
    expect(t.selection.empty).toBe(true)
  })

  it('turns "***" lines into scene breaks', () => {
    const s = finish(stream(stateFrom(''), ['One.\n\n**', '*\n\nTwo.\n\n* * *']))
    const names: string[] = []
    s.doc.forEach((n) => names.push(n.type.name))
    expect(names).toEqual(['paragraph', 'horizontalRule', 'paragraph', 'horizontalRule'])
  })

  it('ignores chunks when no stream is active', () => {
    const s = stateFrom('Hello.')
    expect(appendStream(s, [{ kind: 'text', text: 'x' }])).toBeNull()
    expect(commitStream(s)).toBe(s)
  })
})

describe('undo after a stream', () => {
  it('removes the whole draft with one undo, then redo brings it back', () => {
    let s = type(stateFrom(''), 'Adam typed this.', 1)
    s = s.apply(s.tr.setMeta('addToHistory', true)) // no-op transaction
    const before = s.doc
    s = finish(stream(s, ['First ', 'chunk.\n\nSecond ', 'paragraph.\n\nThird.']))
    expect(sceneText(s.doc)).toBe('Adam typed this.\n\nFirst chunk.\n\nSecond paragraph.\n\nThird.')
    expect(activeStream(s)).toBeNull()

    const undone = runUndo(s)
    expect(undone.doc.eq(before)).toBe(true)
    const redone = runRedo(undone)
    expect(sceneText(redone.doc)).toBe(sceneText(s.doc))
    // A second undo then removes Adam's own typing.
    expect(sceneText(runUndo(undone).doc)).toBe('')
  })

  it('restores an empty scene with one undo', () => {
    const s = finish(stream(stateFrom(''), ['A.\n\nB.\n\nC.']))
    const undone = runUndo(s)
    expect(isDocEmpty(undone.doc)).toBe(true)
  })

  it("keeps Adam's edits made while the draft was streaming", () => {
    let s = stateFrom('Opening line.')
    s = stream(s, ['Draft one.'])
    // Adam edits his own paragraph mid-stream (recorded in history).
    s = type(s, ' Edited', 'Opening line'.length + 1)
    const r = splitChunk({ started: true, pendingBreak: false, lineStart: false }, '\n\nDraft two.')
    s = apply(s, appendStream(s, r.ops))
    s = finish(s)
    expect(sceneText(s.doc)).toBe('Opening line Edited.\n\nDraft one.\n\nDraft two.')

    const undone = runUndo(s)
    expect(sceneText(undone.doc)).toBe('Opening line Edited.')
    expect(sceneText(runUndo(undone).doc)).toBe('Opening line.')
  })

  it("keeps Adam's next typing as a separate undo step", () => {
    let s = finish(stream(stateFrom(''), ['Draft.']))
    s = type(s, ' More.', s.doc.content.size - 1)
    expect(sceneText(s.doc)).toBe('Draft. More.')
    const once = runUndo(s)
    expect(sceneText(once.doc)).toBe('Draft.')
    expect(isDocEmpty(runUndo(once).doc)).toBe(true)
  })

  it('records nothing when no text arrived', () => {
    const s0 = type(stateFrom(''), 'Hi.', 1)
    const s = finish(stream(s0, []))
    expect(s.doc.eq(s0.doc)).toBe(true)
    expect(isDocEmpty(runUndo(s).doc)).toBe(true)
  })
})
