import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state'
import { closeHistory, history, redo, undo } from '@tiptap/pm/history'
import { Plugin } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { sceneExtensions } from './extensions'
import { paragraphIdsPlugin, withParagraphIds } from './paragraphIds'
import {
  activeStream,
  appendStream,
  commitStream,
  docFromStored,
  docFromText,
  finishStreamText,
  holding,
  isDocEmpty,
  releaseHold,
  replacedIn,
  sceneText,
  startStream,
  streamPlugin,
  undoAsked,
  undoVerdict
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

  it('starts the draft below a scene break when the scene has text, and one undo takes both away', () => {
    const s0 = stateFrom('Adam wrote this.')
    const s = finish(stream(s0, ['Then the draft.']))
    expect(sceneText(s.doc)).toBe('Adam wrote this.\n\n* * *\n\nThen the draft.')
    expect(s.doc.childCount).toBe(3)
    expect(runUndo(s).doc.eq(s0.doc)).toBe(true)
  })

  it('writes into a trailing empty paragraph instead of adding another', () => {
    let s = stateFrom('Adam wrote this.')
    s = s.apply(s.tr.insert(s.doc.content.size, schema.nodes.paragraph.create()))
    const s0 = s
    s = finish(stream(s, ['Draft.']))
    expect(s.doc.childCount).toBe(3)
    expect(sceneText(s.doc)).toBe('Adam wrote this.\n\n* * *\n\nDraft.')
    expect(runUndo(s).doc.eq(s0.doc)).toBe(true)
  })

  it('adds no second break when the scene already ends with one', () => {
    const s = finish(stream(stateFrom('A.\n\n***'), ['Draft.']))
    expect(sceneText(s.doc)).toBe('A.\n\n* * *\n\nDraft.')
  })

  it('adds no scene break to a scene with only spaces in it (it has no words, so Generate drafts straight away)', () => {
    const doc = schema.nodes.doc.create(null, [schema.nodes.paragraph.create(null, schema.text('   '))])
    const s = finish(stream(EditorState.create({ schema, doc, plugins: [history(), streamPlugin] }), ['Mara waited.']))
    expect(sceneText(s.doc)).toBe('Mara waited.')
    expect(s.doc.content.content.some((n) => n.type.name === 'horizontalRule')).toBe(false)
  })

  it('turns the model’s asterisks into italics and bold, even when a marker is split between chunks', () => {
    const s = finish(stream(stateFrom(''), ['He *kno', 'ws*. snake_case stays, 5 * 3 stays.\n\nShe *', '*stops**. *Unpaired stays.']))
    expect(sceneText(s.doc)).toBe('He knows. snake_case stays, 5 * 3 stays.\n\nShe stops. *Unpaired stays.')
    const marked: string[] = []
    s.doc.descendants((n) => {
      if (n.isText && n.marks.length) marked.push(`${n.marks.map((m) => m.type.name).join('+')}:${n.text}`)
    })
    expect(marked).toEqual(['italic:knows', 'bold:stops'])
    // Still one undo step for the whole draft.
    expect(isDocEmpty(runUndo(s).doc)).toBe(true)
  })

  it('leaves out a heading or lead-in the model puts before the scene', () => {
    const a = finish(stream(stateFrom(''), ['# The Gil', 'ded Eel\n\nMara ', 'waited.']))
    expect(sceneText(a.doc)).toBe('Mara waited.')
    expect(a.doc.childCount).toBe(1)
    const b = finish(stream(stateFrom('Adam wrote this.'), ["Here's the scene:\n", '\nMara waited.\n\n# Kept, as it is not first']))
    expect(sceneText(b.doc)).toBe('Adam wrote this.\n\n* * *\n\nMara waited.\n\n# Kept, as it is not first')
    expect(sceneText(runUndo(b).doc)).toBe('Adam wrote this.')
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
    expect(sceneText(s.doc)).toBe('Adam typed this.\n\n* * *\n\nFirst chunk.\n\nSecond paragraph.\n\nThird.')
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
    expect(sceneText(s.doc)).toBe('Opening line Edited.\n\n* * *\n\nDraft one.\n\nDraft two.')

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

// ---------- Replacing the scene's text ----------

/** A scene as the editor holds it: paragraph ids, an italic word and a scene break. */
function sceneWithIds(): EditorState {
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create({ pid: 'old00001' }, [
      schema.text('Adam wrote '),
      schema.text('this', [schema.marks.italic.create()]),
      schema.text('.')
    ]),
    schema.nodes.horizontalRule.create(),
    schema.nodes.paragraph.create({ pid: 'old00002' }, schema.text('And then this.'))
  ])
  return EditorState.create({ schema, doc, plugins: [history(), streamPlugin, paragraphIdsPlugin] })
}

const pids = (doc: PMNode): string[] => {
  const out: string[] = []
  doc.forEach((n) => {
    if (n.type.name === 'paragraph') out.push(n.attrs.pid as string)
  })
  return out
}

/** Starts a draft that replaces the scene's text, then streams chunks into it. */
function replace(s: EditorState, chunks: string[], id = 'g1'): EditorState {
  let state = apply(s, startStream(s, id, { replace: true }))
  let split: SplitState = newSplitState()
  for (const c of chunks) {
    const r = splitChunk(split, c)
    split = r.state
    state = apply(state, appendStream(state, r.ops))
  }
  return state
}

describe('replacing the scene’s text', () => {
  it('keeps the old text on the page until the first words arrive', () => {
    const s0 = sceneWithIds()
    let s = apply(s0, startStream(s0, 'g1', { replace: true }))
    expect(s.doc.eq(s0.doc)).toBe(true)
    // Line breaks before the first word change nothing.
    expect(appendStream(s, splitChunk(newSplitState(), '\n\n').ops)).toBeNull()
    expect(appendStream(s, [{ kind: 'paragraph' }])).toBeNull()
    s = apply(s, appendStream(s, []))
    expect(s.doc.eq(s0.doc)).toBe(true)
    expect(activeStream(s)?.wrote).toBe(false)
  })

  it('takes the old text away in the same step as the first words, and writes from the top', () => {
    const s0 = sceneWithIds()
    const s1 = apply(s0, startStream(s0, 'g1', { replace: true }))
    const tr = appendStream(s1, splitChunk(newSplitState(), 'Mara ').ops)!
    expect(replacedIn(tr)).toBe(true)
    const s2 = s1.apply(tr)
    expect(s2.doc.textContent).toBe('Mara ')
    expect(s2.doc.childCount).toBe(1)
    // The cursor waits at the start of the scene while the draft is written below it.
    expect(s2.selection.from).toBe(1)
    const more = splitChunk({ started: true, pendingBreak: false, lineStart: false }, 'waited.\n\nThe door opened.')
    const s3 = finish(apply(s2, appendStream(s2, more.ops)))
    expect(sceneText(s3.doc)).toBe('Mara waited.\n\nThe door opened.')
    expect(s3.selection.from).toBe(1)
    // The draft's paragraphs have ids of their own, none of the old text's.
    expect(pids(s3.doc)).toHaveLength(2)
    expect(pids(s3.doc).every((id) => id && !id.startsWith('old'))).toBe(true)
    expect(activeStream(s3)).toBeNull()
  })

  it('puts the old text back exactly with one undo (formatting, scene break and paragraph ids), and redo brings the draft back', () => {
    const s0 = sceneWithIds()
    const s = finish(replace(s0, ['First ', 'chunk.\n\nSecond ', '*paragraph*.\n\nThird.']))
    expect(sceneText(s.doc)).toBe('First chunk.\n\nSecond paragraph.\n\nThird.')
    const undone = runUndo(s)
    expect(undone.doc.eq(s0.doc)).toBe(true)
    expect(pids(undone.doc)).toEqual(['old00001', 'old00002'])
    const redone = runRedo(undone)
    expect(redone.doc.eq(s.doc)).toBe(true)
    expect(runUndo(redone).doc.eq(s0.doc)).toBe(true)
  })

  it('keeps the undo steps Adam had before: a second undo goes on to undo his own typing', () => {
    let s = type(sceneWithIds(), ' Typed', 'Adam wrote this'.length + 1)
    s = s.apply(closeTyping(s))
    const before = s.doc
    expect(sceneText(before)).toBe('Adam wrote this Typed.\n\n* * *\n\nAnd then this.')
    s = finish(replace(s, ['The draft.']))
    const once = runUndo(s)
    expect(once.doc.eq(before)).toBe(true)
    expect(sceneText(runUndo(once).doc)).toBe('Adam wrote this.\n\n* * *\n\nAnd then this.')
  })

  it('holds the old text while the draft gets ready: typing, pasting and undo change nothing, and the page shows it', () => {
    let s = type(sceneWithIds(), ' Typed', 'Adam wrote this'.length + 1)
    const before = s.doc
    // Picked Replace it: held from now on, before the draft has an id.
    s = apply(s, startStream(s, '', { replace: true }))
    expect(holding(s)).toBe(true)
    expect(streamPlugin.props.editable?.call(streamPlugin, s)).toBe(false)
    expect(attributesOf(s)).toEqual({ class: 'replace-waiting' })
    expect(type(s, 'x', 3).doc.eq(before)).toBe(true)
    expect(apply(s, s.tr.replaceWith(0, s.doc.content.size, schema.nodes.paragraph.create(null, schema.text('Pasted.')))).doc.eq(before)).toBe(true)
    expect(runUndo(s).doc.eq(before)).toBe(true)
    expect(undoVerdict(s, 'undo')).toBe('blocked')
    expect(undoVerdict(s, 'redo')).toBe('blocked')
    // The draft's id arrives: still held.
    s = apply(s, startStream(s, 'g1', { replace: true }))
    expect(holding(s)).toBe(true)
    expect(activeStream(s)?.generationId).toBe('g1')
    // Its first words take the old text's place, and the page can be typed in again.
    s = apply(s, appendStream(s, splitChunk(newSplitState(), 'The draft.').ops))
    expect(holding(s)).toBe(false)
    expect(streamPlugin.props.editable?.call(streamPlugin, s)).toBe(true)
    expect(attributesOf(s)).toEqual({})
    s = finish(s)
    expect(runUndo(s).doc.eq(before)).toBe(true)
  })

  it('lets go of the held text when the draft never starts', () => {
    const s0 = sceneWithIds()
    let s = apply(s0, startStream(s0, '', { replace: true }))
    s = apply(s, releaseHold(s))
    expect(holding(s)).toBe(false)
    expect(activeStream(s)).toBeNull()
    expect(sceneText(type(s, 'Now ', 1).doc)).toBe('Now Adam wrote this.\n\n* * *\n\nAnd then this.')
    // Nothing held, nothing to let go of.
    expect(releaseHold(s)).toBeNull()
    const adding = apply(s, startStream(s, 'g2'))
    expect(releaseHold(adding)).toBeNull()
  })

  it('never splits Adam’s typing at the moment the first words arrive: typed before Replace is what undo puts back, nothing is glued to the draft', () => {
    let s = sceneWithIds()
    // At the end of the first paragraph, just before picking Replace it.
    s = type(s, ' La', 'Adam wrote this.'.length + 1)
    const typedBefore = s.doc
    s = apply(s, startStream(s, '', { replace: true }))
    // Typing on while it waits goes nowhere (the page is held, and has let go of the keyboard).
    s = type(s, 'te edit.')
    expect(s.doc.eq(typedBefore)).toBe(true)
    s = apply(s, startStream(s, 'g1', { replace: true }))
    s = finish(apply(s, appendStream(s, splitChunk(newSplitState(), 'Mara waited.').ops)))
    expect(sceneText(s.doc)).toBe('Mara waited.')
    const undone = runUndo(s)
    expect(undone.doc.eq(typedBefore)).toBe(true)
    expect(sceneText(undone.doc)).toBe('Adam wrote this. La\n\n* * *\n\nAnd then this.')
  })

  it('keeps Adam’s typing in the draft while it streams, and one undo still puts the old text back', () => {
    const s0 = sceneWithIds()
    let s = replace(s0, ['Draft one.'])
    s = type(s, ' Edited', 'Draft one'.length + 1)
    const r = splitChunk({ started: true, pendingBreak: false, lineStart: false }, '\n\nDraft two.')
    s = finish(apply(s, appendStream(s, r.ops)))
    expect(sceneText(s.doc)).toBe('Draft one Edited.\n\nDraft two.')
    const undone = runUndo(s)
    expect(undone.doc.eq(s0.doc)).toBe(true)
    expect(sceneText(runRedo(undone).doc)).toBe('Draft one Edited.\n\nDraft two.')
  })

  it('leaves the old text untouched when nothing arrives (Stop, an error or an empty reply), with no undo step added', () => {
    const s0 = type(sceneWithIds(), '!', 1)
    const s = finish(replace(s0, []))
    expect(s.doc.eq(s0.doc)).toBe(true)
    expect(activeStream(s)).toBeNull()
    // The undo is Adam's own typing, not a draft.
    expect(sceneText(runUndo(s).doc)).toBe('Adam wrote this.\n\n* * *\n\nAnd then this.')
    const whitespace = finish(replace(s0, ['\n\n', '  ']))
    expect(whitespace.doc.eq(s0.doc)).toBe(true)
  })

  it('keeps the text so far when stopped part-way, and one undo still puts the old text back', () => {
    const s0 = sceneWithIds()
    const s = finish(replace(s0, ['The rain had not ', 'let up']))
    expect(sceneText(s.doc)).toBe('The rain had not let up')
    expect(runUndo(s).doc.eq(s0.doc)).toBe(true)
  })

  it('puts the old text back when the draft brought no words (only a scene break)', () => {
    const s0 = sceneWithIds()
    const mid = replace(s0, ['* * *'])
    expect(mid.doc.eq(s0.doc)).toBe(false)
    const s = finish(mid)
    expect(s.doc.eq(s0.doc)).toBe(true)
    expect(runUndo(s).doc.eq(s0.doc)).toBe(true)
  })

  it('leaves out a heading the model puts before the scene', () => {
    const s = finish(replace(sceneWithIds(), ['# The Gil', 'ded Eel\n\nMara ', 'waited.']))
    expect(sceneText(s.doc)).toBe('Mara waited.')
    expect(s.doc.childCount).toBe(1)
  })

  it('still makes one undo step if the editor was set up again during the draft', () => {
    const s0 = sceneWithIds()
    let s = replace(s0, ['Draft.'])
    s = s.reconfigure({ plugins: [...s.plugins, new Plugin({})] })
    s = finish(s)
    expect(sceneText(s.doc)).toBe('Draft.')
    expect(runUndo(s).doc.eq(s0.doc)).toBe(true)
  })

  it('adds no scene break and leaves an empty scene as a plain draft', () => {
    const empty = withParagraphIds(docFromText(schema, '')).doc
    const s0 = EditorState.create({ schema, doc: empty, plugins: [history(), streamPlugin, paragraphIdsPlugin] })
    const s = finish(replace(s0, ['Mara waited.']))
    expect(sceneText(s.doc)).toBe('Mara waited.')
    expect(isDocEmpty(runUndo(s).doc)).toBe(true)
  })
})

describe('undo and redo while a draft replaces the scene’s text', () => {
  it('undoes Adam’s own edits since the first words as usual, and past them asks for the draft to be taken out', () => {
    // A step of Adam's own from before the draft, which mustn't be undone part-way while it writes.
    let s = type(sceneWithIds(), '!', 1)
    s = s.apply(closeTyping(s))
    const before = s.doc
    s = replace(s, ['Draft one.'])
    expect(undoVerdict(s, 'undo')).toBe('undo-replace')
    expect(undoVerdict(s, 'redo')).toBe('blocked')

    s = type(s, ' Edited', 'Draft one'.length + 1)
    expect(activeStream(s)?.typed).toBe(true)
    expect(undoVerdict(s, 'undo')).toBe('normal')
    s = runUndo(s)
    expect(sceneText(s.doc)).toBe('Draft one.')
    expect(undoVerdict(s, 'undo')).toBe('undo-replace')
    expect(undoVerdict(s, 'redo')).toBe('normal')
    s = runRedo(s)
    expect(sceneText(s.doc)).toBe('Draft one Edited.')

    // More words keep coming; once it ends, undo is the editor's own again and puts the old text back.
    s = apply(s, appendStream(s, splitChunk({ started: true, pendingBreak: false, lineStart: false }, '\n\nDraft two.').ops))
    s = finish(s)
    expect(undoVerdict(s, 'undo')).toBe('normal')
    expect(runUndo(s).doc.eq(before)).toBe(true)
  })

  it('keeps Adam’s typing straight after the first words a step of its own, never joined to his typing before', () => {
    let s = type(sceneWithIds(), 'X', 1)
    s = replace(s, ['Draft.'])
    s = type(s, 'Y', 1)
    expect(sceneText(runUndo(s).doc)).toBe('Draft.')
  })

  it('takes Ctrl+Z (and an undo from the browser) to ask for the draft to be taken out, and blocks steps from before it', () => {
    const s = replace(type(sceneWithIds(), '!', 1), ['Draft one.'])
    const undoKey = keyDown(s, 'z')
    expect(undoKey.handled).toBe(true)
    expect(undoKey.dispatched).toHaveLength(1)
    expect(undoAsked(undoKey.dispatched[0])).toBe(true)
    expect(undoKey.dispatched[0].docChanged).toBe(false)
    // Redo has nothing of Adam's to redo: nothing happens.
    expect(keyDown(s, 'z', true)).toEqual({ handled: true, dispatched: [] })
    expect(keyDown(s, 'y')).toEqual({ handled: true, dispatched: [] })
    const browserUndo = beforeInput(s, 'historyUndo')
    expect(browserUndo.handled).toBe(true)
    expect(undoAsked(browserUndo.dispatched[0])).toBe(true)
    expect(beforeInput(s, 'insertText')).toEqual({ handled: false, dispatched: [] })
    // Other keys, and undo of Adam's own typing since, are the editor's as usual.
    expect(keyDown(s, 'a')).toEqual({ handled: false, dispatched: [] })
    expect(keyDown(type(s, '?', 1), 'z')).toEqual({ handled: false, dispatched: [] })
  })

  it('leaves undo alone for a draft added below, and holds every key and input while the old text waits', () => {
    const adding = stream(type(sceneWithIds(), '!', 1), ['Draft.'])
    expect(undoVerdict(adding, 'undo')).toBe('normal')
    expect(keyDown(adding, 'z')).toEqual({ handled: false, dispatched: [] })
    const s0 = sceneWithIds()
    const held = apply(s0, startStream(s0, '', { replace: true }))
    expect(keyDown(held, 'z')).toEqual({ handled: true, dispatched: [] })
    expect(beforeInput(held, 'insertText')).toEqual({ handled: true, dispatched: [] })
    expect(beforeInput(held, 'historyUndo')).toEqual({ handled: true, dispatched: [] })
  })
})

/** Ends the current undo group, so the next change is a step of its own. */
function closeTyping(s: EditorState): Transaction {
  return closeHistory(s.tr)
}

/** The page's attributes while in this state (the plugin's own). */
function attributesOf(s: EditorState): Record<string, string> {
  const attrs = streamPlugin.props.attributes
  return typeof attrs === 'function' ? (attrs.call(streamPlugin, s) ?? {}) : (attrs ?? {})
}

/** A view stand-in that collects what the plugin dispatches. */
function fakeView(s: EditorState): { view: EditorView; dispatched: Transaction[] } {
  const dispatched: Transaction[] = []
  const view = { state: s, dispatch: (tr: Transaction) => dispatched.push(tr) } as unknown as EditorView
  return { view, dispatched }
}

const isMacLike = /Mac|iP(hone|[oa]d)/.test(globalThis.navigator?.platform ?? '')

/** Ctrl (Cmd on a Mac) with a key, through the plugin's key handling. */
function keyDown(s: EditorState, key: string, shiftKey = false): { handled: boolean; dispatched: Transaction[] } {
  const { view, dispatched } = fakeView(s)
  const event = { key, shiftKey, altKey: false, ctrlKey: !isMacLike, metaKey: isMacLike } as KeyboardEvent
  const handled = !!streamPlugin.props.handleKeyDown?.call(streamPlugin, view, event)
  return { handled, dispatched }
}

/** An input event the browser sends the page (an undo from its own menu, say). */
function beforeInput(s: EditorState, inputType: string): { handled: boolean; dispatched: Transaction[] } {
  const { view, dispatched } = fakeView(s)
  const event = { inputType, preventDefault: () => undefined } as unknown as InputEvent
  const handler = streamPlugin.props.handleDOMEvents?.beforeinput as ((v: EditorView, e: InputEvent) => boolean) | undefined
  const handled = !!handler?.call(streamPlugin, view, event)
  return { handled, dispatched }
}
