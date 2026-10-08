import { describe, expect, it } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state'
import { caretToKeep } from './pageCaret'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*', toDOM: () => ['p', 0] },
    rule: { group: 'block', atom: true, selectable: true, toDOM: () => ['hr'] },
    text: {}
  }
})
const doc = schema.node('doc', null, [
  schema.node('paragraph', null, [schema.text('The ferry was late again. Mara counted the lamps.')]),
  schema.node('rule')
])
/** A state with the caret at `at` (inside the first paragraph: positions 1 to 50). */
const at = (anchor: number, head = anchor) => EditorState.create({ doc, selection: TextSelection.create(doc, anchor, head) })

describe('caretToKeep: the page’s caret, kept through a transaction that only changes what shows', () => {
  it('keeps the page’s caret when a timer’s transaction comes before ProseMirror has heard of it', () => {
    const state = at(20)
    const marks = state.tr.setMeta('aiwriteLiveChecks', { set: null })
    expect(caretToKeep([marks], state, { anchor: 27, head: 31 })).toEqual({ anchor: 27, head: 31 })
  })
  it('leaves things be when the page and ProseMirror agree, or the page has no caret in this editor', () => {
    const state = at(27, 31)
    expect(caretToKeep([state.tr.setMeta('x', 1)], state, { anchor: 27, head: 31 })).toBeNull()
    expect(caretToKeep([state.tr.setMeta('x', 1)], state, null)).toBeNull()
  })
  it('never overrides new text or a caret a transaction sets on purpose', () => {
    const state = at(20)
    expect(caretToKeep([state.tr.insertText('x', 20)], state, { anchor: 5, head: 5 })).toBeNull()
    expect(caretToKeep([state.tr.setSelection(TextSelection.create(doc, 3))], state, { anchor: 5, head: 5 })).toBeNull()
  })
  it('leaves a selected block, and a page caret outside the document, to ProseMirror', () => {
    const picked = EditorState.create({ doc, selection: NodeSelection.create(doc, doc.child(0).nodeSize) })
    expect(caretToKeep([picked.tr.setMeta('x', 1)], picked, { anchor: 5, head: 5 })).toBeNull()
    const state = at(20)
    expect(caretToKeep([state.tr.setMeta('x', 1)], state, { anchor: 5, head: 9999 })).toBeNull()
    expect(caretToKeep([state.tr.setMeta('x', 1)], state, { anchor: -1, head: 5 })).toBeNull()
  })
})
