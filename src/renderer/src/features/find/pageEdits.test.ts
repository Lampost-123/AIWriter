import { afterEach, describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { EditorState } from '@tiptap/pm/state'
import { closeHistory, history, undo } from '@tiptap/pm/history'
import type { Node as PMNode } from '@tiptap/pm/model'
import { blocksOfDoc, findInBlocks, replaceInDoc } from '@shared/findReplace'
import { sceneExtensions } from '@/features/editor/extensions'
import { paragraphIdsPlugin, withParagraphIds } from '@/features/editor/paragraphIds'
import { docFromText } from '@/features/editor/streamDoc'
import { showSuggestion, suggestionsPluginForTests } from '@/features/edits/suggestions'
import { anchorAfter, blocksOfPage, findPlugin, findStateOf, setCurrentTr, setFindInputs } from './highlights'
import { pageChangeTr, replaceMatchesTr, WORDS_META } from './pageEdits'

const schema = getSchema(sceneExtensions())
const { paragraph, blockquote, horizontalRule, hardBreak } = schema.nodes
const { bold, italic } = schema.marks

function stateOf(doc: PMNode): EditorState {
  return EditorState.create({ schema, doc: withParagraphIds(doc).doc, plugins: [history(), paragraphIdsPlugin, suggestionsPluginForTests, findPlugin] })
}
const fromText = (text: string): EditorState => stateOf(docFromText(schema, text))
const pids = (doc: PMNode): string[] => {
  const out: string[] = []
  doc.descendants((n) => {
    if (n.type.name === 'paragraph') out.push(n.attrs.pid as string)
    return true
  })
  return out
}

/** A page with bold and italic across a name, a scene break, an empty paragraph and a quoted passage with a line break. */
function richPage(): EditorState {
  return stateOf(
    schema.topNodeType.create(null, [
      paragraph.create(null, [schema.text('The '), schema.text('Ma', [bold.create()]), schema.text('ra', [italic.create()]), schema.text(' rode on.')]),
      horizontalRule.create(),
      paragraph.create(),
      blockquote.create(null, [paragraph.create(null, [schema.text('Mara'), hardBreak.create(), schema.text('Mara wept.')])])
    ])
  )
}

afterEach(() => setFindInputs({ active: false, query: '', opts: {} }))

describe('finding in the page', () => {
  it('reads the page exactly as a stored scene is read, so positions agree', () => {
    const s = richPage()
    expect(blocksOfPage(s.doc)).toEqual(blocksOfDoc(s.doc.toJSON()))
  })

  it('marks every match while find shows, and keeps the current one as the page changes', () => {
    let s = fromText('Mara ran. Then mara stopped.\n\nMARA waited.')
    expect(findStateOf(s).matches).toHaveLength(0)
    setFindInputs({ active: true, query: 'mara', opts: {} }, { state: s, dispatch: (tr) => (s = s.apply(tr)) }, 0)
    expect(findStateOf(s).matches).toHaveLength(3)
    expect(findStateOf(s).current).toBe(0)
    s = s.apply(setCurrentTr(s, 1))
    expect(findStateOf(s).current).toBe(1)
    // Typing before it keeps the same match current.
    s = s.apply(s.tr.insertText('So. ', 1))
    expect(findStateOf(s).current).toBe(1)
    // Wraps round.
    s = s.apply(setCurrentTr(s, 3))
    expect(findStateOf(s).current).toBe(0)
    // Match case.
    setFindInputs({ active: true, query: 'Mara', opts: { matchCase: true } }, { state: s, dispatch: (tr) => (s = s.apply(tr)) }, 0)
    expect(findStateOf(s).matches).toHaveLength(1)
    // Closing takes the marks away.
    setFindInputs({ active: false, query: '', opts: {} }, { state: s, dispatch: (tr) => (s = s.apply(tr)) })
    expect(findStateOf(s).matches).toHaveLength(0)
  })

  it('marks a newly opened scene straight away', () => {
    setFindInputs({ active: true, query: 'rain', opts: { wholeWord: true } })
    const s = fromText('The rain and the brain. Rain again.')
    expect(findStateOf(s).matches).toHaveLength(2)
  })
})

describe('replacing in the page', () => {
  it('replaces across bold and italic with the first letter’s formatting, keeping paragraph ids, as one Ctrl+Z', () => {
    let s = richPage()
    const before = s.doc
    const idsBefore = pids(before)
    const found = findInBlocks(blocksOfPage(s.doc), 'mara')
    const r = replaceMatchesTr(s, found, 'Maren')!
    expect(r.count).toBe(3)
    expect(r.tr.getMeta(WORDS_META)).toBe('none')
    s = s.apply(r.tr)
    expect(s.doc.child(0).textContent).toBe('The Maren rode on.')
    expect(s.doc.rangeHasMark(5, 10, bold)).toBe(true)
    expect(s.doc.rangeHasMark(5, 10, italic)).toBe(false)
    expect(s.doc.child(3).textContent).toBe('MarenMaren wept.')
    expect(pids(s.doc)).toEqual(idsBefore)
    // The same as the main process makes of the stored scene.
    const stored = replaceInDoc(before.toJSON(), found.map((m) => ({ ...m, text: 'Maren' }))).doc
    expect(s.doc.toJSON()).toEqual(stored)
    // One Ctrl+Z puts every one back.
    let back: EditorState | null = null
    undo(s, (tr) => (back = s.apply(tr)))
    expect(back!.doc.eq(before)).toBe(true)
  })

  it('a Replace is its own undo step, after typing', () => {
    let s = fromText('Mara and Mara.')
    s = s.apply(s.tr.insertText('Oh, ', 1))
    const [m] = findInBlocks(blocksOfPage(s.doc), 'mara')
    const r = replaceMatchesTr(s, [m], 'Tobin')!
    s = s.apply(anchorAfter(r.tr, r.end))
    s = s.apply(closeHistory(s.tr))
    expect(s.doc.textContent).toBe('Oh, Tobin and Mara.')
    let back: EditorState | null = null
    undo(s, (tr) => (back = s.apply(tr)))
    expect(back!.doc.textContent).toBe('Oh, Mara and Mara.')
  })

  it('moves to the next match after the new words, even when they hold the words found', () => {
    setFindInputs({ active: true, query: 'a', opts: { wholeWord: true } })
    let s = fromText('a b a c a')
    expect(findStateOf(s).matches).toHaveLength(3)
    const m = findStateOf(s).matches[0]
    const r = replaceMatchesTr(s, [m], 'a a')!
    s = s.apply(anchorAfter(r.tr, r.end))
    expect(s.doc.textContent).toBe('a a b a c a')
    // The current match is the one after the new words, not one of them.
    expect(findStateOf(s).matches[findStateOf(s).current].from).toBe(s.doc.textContent.indexOf('b a') + 1 + 2)
  })

  it('follows the quote style of the words replaced', () => {
    let s = fromText('She didn’t wait.')
    const found = findInBlocks(blocksOfPage(s.doc), "didn't")
    s = s.apply(replaceMatchesTr(s, found, "wouldn't")!.tr)
    expect(s.doc.textContent).toBe('She wouldn’t wait.')
  })

  it('never changes words inside an AI suggestion waiting in the page', () => {
    let s = fromText('Mara ran. Mara hid. Mara slept.')
    const second = findInBlocks(blocksOfPage(s.doc), 'mara')[1]
    s = s.apply(showSuggestion(s, { id: 's1', sceneId: 'x', tool: 'rewrite', direction: '', from: second.from, to: second.to + 4, mode: 'replace' }))
    const r = replaceMatchesTr(s, findInBlocks(blocksOfPage(s.doc), 'mara'), 'Tobin')!
    expect(r.count).toBe(2)
    expect(r.kept).toBe(1)
    s = s.apply(r.tr)
    expect(s.doc.textContent).toBe('Tobin ran. Mara hid. Tobin slept.')
  })

  it('makes a change worked out from the stored scene in the page, and back again', () => {
    let s = richPage()
    const before = s.doc
    const found = findInBlocks(blocksOfPage(s.doc), 'mara')
    const { doc, ranges } = replaceInDoc(s.doc.toJSON(), found.map((m) => ({ ...m, text: 'Maren' })))
    s = s.apply(pageChangeTr(s, { sceneId: 'x', doc, ranges })!)
    expect(s.doc.toJSON()).toEqual(doc)
    const back = ranges.map((r) => ({ from: r.newFrom, to: r.newTo, newFrom: r.from, newTo: r.to }))
    s = s.apply(pageChangeTr(s, { sceneId: 'x', doc: before.toJSON(), ranges: back })!)
    expect(s.doc.eq(before)).toBe(true)
    // Ranges that don't fit the page change nothing.
    expect(pageChangeTr(s, { sceneId: 'x', doc, ranges: [{ from: 1, to: 9999, newFrom: 1, newTo: 2 }] })).toBeNull()
  })
})
