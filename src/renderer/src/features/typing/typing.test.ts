import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { closeHistory, history, undo } from '@tiptap/pm/history'
import { sceneExtensions } from '@/features/editor/extensions'
import { docFromText, sceneText, startStream, streamPlugin } from '@/features/editor/streamDoc'
import { showSuggestion, suggestionsPluginForTests } from '@/features/edits/suggestions'
import { mayChange, smartKey, typingPlugin } from './extension'
import { isPastePlainKey, plainPaste, plainTextSlice } from './plainPaste'
import { typewriterTarget } from './typewriter'

const schema = getSchema(sceneExtensions())

function stateFrom(text: string, caret?: number): EditorState {
  const doc = docFromText(schema, text)
  const state = EditorState.create({ schema, doc, plugins: [history(), streamPlugin, suggestionsPluginForTests, typingPlugin()] })
  return caret === undefined ? state : state.apply(state.tr.setSelection(TextSelection.create(doc, caret)))
}

/** Where some words end in the page. */
const after = (s: EditorState, words: string): number => {
  let at = -1
  s.doc.descendants((node, pos) => {
    const i = node.isTextblock ? node.textContent.indexOf(words) : -1
    if (i >= 0 && at < 0) at = pos + 1 + i + words.length
    return at < 0
  })
  return at
}

const doUndo = (s: EditorState): EditorState => {
  let next = s
  undo(s, (tr) => (next = s.apply(tr)))
  return next
}

describe('undoing smart punctuation', () => {
  it('takes back the typing after a swap first, then the swap, as the page does', () => {
    let s = stateFrom('She said:', 10)
    // What the input rule does: the quote typed, then the swap as its own step.
    s = s.apply(s.tr.insertText('"', 10))
    s = s.apply(closeHistory(s.tr.insertText('“', 10, 11).setMeta(smartKey, true)))
    // Typing on, straight after.
    s = s.apply(s.tr.insertText('H', 11))
    s = s.apply(s.tr.insertText('i', 12))
    expect(sceneText(s.doc)).toBe('She said:“Hi')
    s = doUndo(s)
    expect(sceneText(s.doc)).toBe('She said:“')
    s = doUndo(s)
    expect(sceneText(s.doc)).toBe('She said:"')
  })
})

describe('where smart punctuation may act', () => {
  it('anywhere in Adam’s own words', () => {
    const s = stateFrom('One morning.\n\nThe ferry left.')
    expect(mayChange(s, 3, 4)).toBe(true)
  })

  it('not where a draft is being written in, nor while the page waits for one to replace it', () => {
    // A draft writes into the empty paragraph at the end of the page.
    const base = stateFrom('One morning.\n\nThe ferry left.')
    const s0 = base.apply(base.tr.insert(base.doc.content.size, schema.nodes.paragraph.create()))
    const writing = s0.apply(startStream(s0, 'g1'))
    expect(mayChange(writing, 3, 4)).toBe(true)
    expect(mayChange(writing, writing.doc.content.size - 1, writing.doc.content.size - 1)).toBe(false)
    const held = s0.apply(startStream(s0, 'g2', { replace: true }))
    expect(mayChange(held, 3, 4)).toBe(false)
  })

  it('not in the words under an AI change waiting in the page', () => {
    const s0 = stateFrom('One morning the ferry left early.')
    const from = after(s0, 'One ')
    const to = after(s0, 'One morning the ferry')
    const s = s0.apply(showSuggestion(s0, { id: 't1', sceneId: 's1', tool: 'condense', direction: '', mode: 'replace', from, to }))
    expect(mayChange(s, from + 2, from + 3)).toBe(false)
    expect(mayChange(s, to - 1, to)).toBe(false)
    expect(mayChange(s, 1, 2)).toBe(true)
    expect(mayChange(s, to + 3, to + 4)).toBe(true)
  })
})

describe('paste as plain text', () => {
  it('knows Ctrl+Shift+V (and ⌘+Shift+V)', () => {
    const k = { key: 'V', code: 'KeyV', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false }
    expect(isPastePlainKey(k)).toBe(true)
    expect(isPastePlainKey({ ...k, ctrlKey: false, metaKey: true })).toBe(true)
    expect(isPastePlainKey({ ...k, shiftKey: false })).toBe(false)
    expect(isPastePlainKey({ ...k, altKey: true })).toBe(false)
  })

  it('makes each line a paragraph, with no formatting from elsewhere', () => {
    const slice = plainTextSlice(schema, 'First line\r\nSecond **line**\n\n\nThird')
    expect(slice.content.childCount).toBe(3)
    const texts: string[] = []
    slice.content.forEach((p) => {
      texts.push(p.textContent)
      p.forEach((t) => expect(t.marks).toEqual([]))
    })
    expect(texts).toEqual(['First line', 'Second **line**', 'Third'])
  })

  it('puts the words at the caret, carrying on the paragraph it lands in', () => {
    const s0 = stateFrom('The boat came in.', after(stateFrom('The boat came in.'), 'The boat'))
    const s1 = s0.apply(plainPaste(s0, ' slowly')!)
    expect(sceneText(s1.doc)).toBe('The boat slowly came in.')
    const s2 = s0.apply(plainPaste(s0, ' rocked.\nThen it')!)
    expect(sceneText(s2.doc)).toBe('The boat rocked.\n\nThen it came in.')
    expect(plainPaste(s0, '')).toBeNull()
  })

  it('takes on the style where it lands (bold words stay bold)', () => {
    const s0 = stateFrom('Loud', 3)
    const bold = s0.apply(s0.tr.addMark(1, 5, schema.marks.bold.create()))
    const s1 = bold.apply(plainPaste(bold, 'xx')!)
    const marks: string[] = []
    s1.doc.descendants((n) => {
      if (n.isText) marks.push(n.marks.map((m) => m.type.name).join(','))
    })
    expect(marks).toEqual(['bold'])
  })
})

describe('typewriter scrolling', () => {
  const page = { boxTop: 100, clientHeight: 500, scrollTop: 300, scrollHeight: 3000 }
  it('moves the page so the line being typed sits 40% of the way down', () => {
    // 40% of 500 is 200 below the page's top (100): the line belongs at 300 on screen.
    expect(typewriterTarget({ ...page, caretTop: 340 })).toBe(340)
    expect(typewriterTarget({ ...page, caretTop: 250 })).toBe(250)
  })
  it('leaves it be when the line is already there, and never scrolls past either end', () => {
    expect(typewriterTarget({ ...page, caretTop: 301 })).toBeNull()
    expect(typewriterTarget({ ...page, scrollTop: 10, caretTop: 120 })).toBe(0)
    expect(typewriterTarget({ ...page, scrollTop: 2400, caretTop: 2000 })).toBe(2500)
  })
})
