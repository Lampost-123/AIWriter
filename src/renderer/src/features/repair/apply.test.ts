// Check and repair in the page: where new AI words are as they land, and the mending itself. A fix changes only the
// AI's own words, only while their paragraph is as it landed, never where Adam's cursor or selection is, all in one
// step; Undo puts the AI's words back. Invented text throughout.
import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { history, undo } from '@tiptap/pm/history'
import { sceneExtensions } from '@/features/editor/extensions'
import { paragraphIdsPlugin, withParagraphIds } from '@/features/editor/paragraphIds'
import { docFromText } from '@/features/editor/streamDoc'
import type { RepairFix } from '@shared/contracts/repair'
import { fixesTr, landedParts, paragraphText, undoFixesTr } from './apply'

const schema = getSchema(sceneExtensions())

const ADAMS = 'Mara took off her hood and shook the rain from it.'
const AI_ONE = 'Mara kept her hood low and watched the door.'
const AI_TWO = 'Tobin turned his cup a slow quarter turn.'

function stateFrom(text: string): EditorState {
  const doc = withParagraphIds(docFromText(schema, text)).doc
  return EditorState.create({ schema, doc, plugins: [history(), paragraphIdsPlugin] })
}

/** Where the paragraph holding these words starts (a block boundary). */
function paragraphAt(doc: PMNode, words: string): number {
  let at = -1
  doc.forEach((node, pos) => {
    if (at < 0 && node.textContent.includes(words)) at = pos
  })
  if (at < 0) throw new Error(`Not in the page: ${words}`)
  return at
}

const fix = (para: number, text: string, was: string, now: string, id = 'f1'): RepairFix => {
  const start = text.indexOf(was)
  return { id, para, start, end: start + was.length, was, now, why: 'Mara took her hood off earlier.' }
}

describe('where new words are as they land', () => {
  it('lists the paragraphs from where the draft begins, each whole, with its id', () => {
    const s = stateFrom(`${ADAMS}\n\n${AI_ONE}\n\n${AI_TWO}`)
    const parts = landedParts(s.doc, paragraphAt(s.doc, AI_ONE), s.doc.content.size)
    expect(parts.map((p) => p.text)).toEqual([AI_ONE, AI_TWO])
    expect(parts.every((p) => p.pid && p.from === 0 && p.to === p.text.length)).toBe(true)
  })

  it("marks only the AI's part of a paragraph Continue carried on", () => {
    const s = stateFrom(`${ADAMS} ${AI_ONE}`)
    const from = 1 + ADAMS.length + 1
    const [part] = landedParts(s.doc, from, s.doc.content.size - 1)
    expect(part.text.slice(part.from, part.to)).toBe(AI_ONE)
    expect(part.from).toBe(ADAMS.length + 1)
  })

  it('reads a line break inside a paragraph as one character', () => {
    const s = stateFrom('One line')
    const tr = s.tr.insert(4, schema.nodes.hardBreak.create())
    expect(paragraphText(tr.doc.firstChild!)).toBe('One\n line')
    expect(paragraphText(tr.doc.firstChild!)).toHaveLength(tr.doc.firstChild!.content.size)
  })
})

describe('mending', () => {
  it("changes the AI's words in one step, keeps Adam's cursor with his words, and Undo puts them back", () => {
    let s = stateFrom(`${ADAMS}\n\n${AI_ONE}`)
    // Adam's cursor at the end of his own paragraph.
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 1 + ADAMS.length)))
    const parts = landedParts(s.doc, paragraphAt(s.doc, AI_ONE), s.doc.content.size)
    const got = fixesTr(s, parts, [fix(0, AI_ONE, 'kept her hood low', 'kept her hood down')])!
    expect(got.made).toHaveLength(1)
    const after = s.apply(got.tr)
    expect(after.doc.textBetween(0, after.doc.content.size, '\n\n')).toBe(`${ADAMS}\n\nMara kept her hood down and watched the door.`)
    expect(after.doc.textBetween(got.made[0].from, got.made[0].to)).toBe('kept her hood down')
    expect(after.selection.head).toBe(1 + ADAMS.length)
    const back = after.apply(undoFixesTr(after, got.made)!)
    expect(back.doc.textBetween(0, back.doc.content.size, '\n\n')).toBe(`${ADAMS}\n\n${AI_ONE}`)
    // Ctrl+Z takes the fix back as one step too.
    let undone = after
    undo(after, (tr) => (undone = after.apply(tr)))
    expect(undone.doc.textBetween(0, undone.doc.content.size, '\n\n')).toBe(`${ADAMS}\n\n${AI_ONE}`)
  })

  it('makes several fixes at once, each in its place', () => {
    const s = stateFrom(`${AI_ONE}\n\n${AI_TWO}`)
    const parts = landedParts(s.doc, 0, s.doc.content.size)
    const got = fixesTr(s, parts, [fix(0, AI_ONE, 'kept her hood low', 'kept her hood down', 'a'), fix(1, AI_TWO, 'turned his cup', 'turned the empty cup', 'b')])!
    const after = s.apply(got.tr)
    expect(got.made.map((m) => after.doc.textBetween(m.from, m.to))).toEqual(['kept her hood down', 'turned the empty cup'])
  })

  it('never changes a paragraph Adam has typed in since the words landed', () => {
    const s = stateFrom(`${ADAMS}\n\n${AI_ONE}`)
    const parts = landedParts(s.doc, paragraphAt(s.doc, AI_ONE), s.doc.content.size)
    const typed = s.apply(s.tr.insertText(' Rain dripped.', s.doc.content.size - 1))
    expect(fixesTr(typed, parts, [fix(0, AI_ONE, 'kept her hood low', 'kept her hood down')])).toBeNull()
  })

  it("never changes Adam's words in a paragraph Continue carried on", () => {
    const s = stateFrom(`${ADAMS} ${AI_ONE}`)
    const [part] = landedParts(s.doc, 1 + ADAMS.length + 1, s.doc.content.size - 1)
    // "took off her hood" is Adam's: outside the AI's part, so never mended.
    const start = part.text.indexOf('took off her hood')
    const bad: RepairFix = { id: 'x', para: 0, start, end: start + 'took off her hood'.length, was: 'took off her hood', now: 'kept on her hood', why: '' }
    expect(fixesTr(s, [part], [bad])).toBeNull()
    expect(fixesTr(s, [part], [fix(0, part.text, 'kept her hood low', 'kept her hood down')])).not.toBeNull()
  })

  it("leaves words alone while Adam's cursor is in them or his selection touches them", () => {
    const s = stateFrom(AI_ONE)
    const parts = landedParts(s.doc, 0, s.doc.content.size)
    const f = fix(0, AI_ONE, 'kept her hood low', 'kept her hood down')
    const inside = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 1 + f.start + 3)))
    expect(fixesTr(inside, parts, [f])).toBeNull()
    const touching = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 1, 1 + f.start + 2)))
    expect(fixesTr(touching, parts, [f])).toBeNull()
    // Right beside them is fine: the cursor stays where it was in the words.
    const beside = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 1 + f.end)))
    const got = fixesTr(beside, parts, [f])!
    const after = beside.apply(got.tr)
    expect(after.doc.textBetween(after.selection.head, after.selection.head + 4)).toBe(' and')
  })

  it("leaves words alone where they don't say what the AI wrote, or where the page says not to", () => {
    const s = stateFrom(AI_ONE)
    const parts = landedParts(s.doc, 0, s.doc.content.size)
    expect(fixesTr(s, parts, [{ ...fix(0, AI_ONE, 'kept her hood low', 'kept her hood down'), was: 'kept his hood low' }])).toBeNull()
    expect(fixesTr(s, parts, [fix(0, AI_ONE, 'kept her hood low', 'kept her hood down')], () => true)).toBeNull()
  })

  it('Undo leaves alone a fix Adam has changed since', () => {
    const s = stateFrom(AI_ONE)
    const parts = landedParts(s.doc, 0, s.doc.content.size)
    const got = fixesTr(s, parts, [fix(0, AI_ONE, 'kept her hood low', 'kept her hood down')])!
    const after = s.apply(got.tr)
    const edited = after.apply(after.tr.insertText('back', got.made[0].to - 'down'.length, got.made[0].to))
    expect(undoFixesTr(edited, got.made)).toBeNull()
  })
})
