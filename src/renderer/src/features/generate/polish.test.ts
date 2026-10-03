import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { sceneExtensions } from '@/features/editor/extensions'
import { blockIndexAt, draftPlace, findDraft, withPolish } from './polish'

const schema = getSchema(sceneExtensions())
const { paragraph: p, horizontalRule: hr } = schema.nodes
const para = (text: string, italic = false) => p.create(null, text ? schema.text(text, italic ? [schema.marks.italic.create()] : []) : null)
const docOf = (...blocks: PMNode[]): PMNode => schema.nodes.doc.create(null, blocks)

/** Where top-level block `i` starts. */
const boundary = (doc: PMNode, i: number): number => {
  let at = 0
  for (let k = 0; k < i; k++) at += doc.child(k).nodeSize
  return at
}

describe('the polish pass in the page', () => {
  it('costs about twice as much with polish on', () => {
    expect(withPolish(0.04, false)).toBe(0.04)
    expect(withPolish(0.04, true)).toBe(0.08)
    expect(withPolish(0, true)).toBe(0)
  })

  it('finds a draft added below the scene, after the scene break put in for it', () => {
    const doc = docOf(para('Adam’s own words.'), hr.create(), para('The draft begins.'), para('It ends', true))
    const start = blockIndexAt(doc, boundary(doc, 1))
    expect(start).toBe(1)
    const place = draftPlace(doc, start, true)!
    expect(place).toEqual({ index: 2, blocks: 2, text: 'The draft begins.\n\n*It ends*' })
    const range = findDraft(doc, place)
    expect(range).toEqual({ from: boundary(doc, 2) + 1, to: doc.content.size - 1 })
  })

  it('finds a draft that is the whole scene', () => {
    const doc = docOf(para('One.'), hr.create(), para('Two.'))
    const place = draftPlace(doc, 0, false)!
    expect(place.blocks).toBe(3)
    expect(place.text).toBe('One.\n\n* * *\n\nTwo.')
    expect(findDraft(doc, place)).toEqual({ from: 1, to: doc.content.size - 1 })
  })

  it('still finds it after Adam edits above it, but not once the draft itself has changed', () => {
    const doc = docOf(para('Mine.'), hr.create(), para('Draft words.'))
    const place = draftPlace(doc, 1, true)!
    const above = docOf(para('Mine, and more.'), para('A new line.'), hr.create(), para('Draft words.'))
    expect(findDraft(above, place)).toEqual({ from: boundary(above, 3) + 1, to: above.content.size - 1 })
    expect(findDraft(docOf(para('Mine.'), hr.create(), para('Draft words, edited.')), place)).toBe('changed')
    expect(findDraft(docOf(para('Mine.'), hr.create(), para('Draft words.'), para('Added after.')), place)).toBe('changed')
    expect(findDraft(docOf(para('Draft words.')), { ...place, blocks: 3 })).toBe('gone')
  })

  it('has nothing to polish when no words arrived', () => {
    expect(draftPlace(docOf(para('Mine.'), hr.create()), 1, true)).toBeNull()
    expect(draftPlace(docOf(para('')), 0, false)).toBeNull()
  })
})
