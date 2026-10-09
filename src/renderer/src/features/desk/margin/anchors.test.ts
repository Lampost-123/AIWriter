import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { sceneExtensions } from '@/features/editor/extensions'
import { anchorAt, blockOf, changesBlocks, posOfAnchor, tetherPath } from './anchors'

const schema = getSchema(sceneExtensions())
const para = (pid: string, text: string): PMNode => schema.nodes.paragraph.create({ pid }, text ? schema.text(text) : undefined)
const docOf = (...blocks: PMNode[]): PMNode => schema.nodes.doc.create(null, blocks)

describe('anchoring margin notes to the page', () => {
  const doc = docOf(para('p1', 'The wind came round.'), para('p2', 'Edric Halloway stood by the glass.'))

  it('finds a paragraph by its id, and a word in it', () => {
    expect(blockOf(doc, 'p2')?.pos).toBe(22)
    expect(blockOf(doc, 'gone')).toBeNull()
    const at = posOfAnchor(doc, { pid: 'p2', offset: 6 })!
    expect(doc.textBetween(at, at + 8)).toBe('Halloway')
    // Past the paragraph's end: kept within it.
    expect(posOfAnchor(doc, { pid: 'p1', offset: 999 })).toBe(1 + 'The wind came round.'.length)
    expect(posOfAnchor(doc, { pid: 'gone', offset: 0 })).toBeNull()
  })

  it('turns a position back into an anchor', () => {
    expect(anchorAt(doc, 28)).toEqual({ pid: 'p2', offset: 5 })
    expect(anchorAt(doc, posOfAnchor(doc, { pid: 'p1', offset: 4 })!)).toEqual({ pid: 'p1', offset: 4 })
  })

  it('tells a change that moves paragraphs about from typing inside one', () => {
    const state = EditorState.create({ schema, doc })
    // Typing inside a paragraph: no.
    expect(changesBlocks(state.tr.insertText('x', 5))).toBe(false)
    // A new paragraph (Enter): yes.
    const split = state.tr.setSelection(TextSelection.create(doc, 5)).split(5)
    expect(changesBlocks(split)).toBe(true)
    // Deleting across two paragraphs: yes.
    expect(changesBlocks(state.tr.delete(10, 30))).toBe(true)
    // Nothing changed: no.
    expect(changesBlocks(state.tr.setSelection(TextSelection.create(doc, 3)))).toBe(false)
  })

  it('draws a tether level at both ends', () => {
    expect(tetherPath(0, 10, 40, 30)).toBe('M0 10C20 10 20 30 40 30')
    expect(tetherPath(0.04, 10.26, 40, 10.26)).toBe('M0 10.3C20 10.3 20 10.3 40 10.3')
  })
})
