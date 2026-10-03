import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { sceneExtensions } from '@/features/editor/extensions'
import { looksLikeRefusalReply } from '@shared/refusal'
import { cleanReply } from '@/features/edits/text'
import { blockIndexAt, draftPlace, findDraft, polishable, polishedScene, withPolish } from './polish'

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

  it('polishes a draft meant to replace the scene only if it did', () => {
    expect(polishable(false, false)).toBe(true)
    expect(polishable(true, true)).toBe(true)
    // Only a lead-in arrived, so the old text was put back: that is Adam's, not the draft.
    expect(polishable(true, false)).toBe(false)
  })
})

describe('the polished version', () => {
  const draft =
    'Mara set the lantern down on the jetty and listened. The river kept its own counsel, slow and brown.\n\n"Again," said the ferryman, and held out his hand.'
  const revised = 'Mara set the lantern on the jetty and listened. The river kept its counsel, slow and brown.\n\n"Again," the ferryman said, and held out his hand.'
  const polished = (reply: string) => polishedScene(cleanReply(reply, true), draft, looksLikeRefusalReply)

  it('is offered as it came, without a lead-in or the notes after it', () => {
    expect(polished(revised)).toEqual({ text: revised })
    expect(polished(`Here's the revised scene:\n\n${revised}`)).toEqual({ text: revised })
    expect(polished(`${revised}\n\nChanges made:\n- Cut "own".\n- Moved the tag.`)).toEqual({ text: revised })
    expect(polished(`${revised}\n\n---\n**Notes:** tightened the opening.`)).toEqual({ text: revised })
    expect(polished(`${revised}\n\n## Changes\n- Fewer words.`)).toEqual({ text: revised })
  })

  it('keeps the draft when the reply is a refusal, much shorter, or empty', () => {
    expect(polished("I'm sorry, but I can't help with this request.")).toEqual({ problem: 'refused' })
    expect(polished('Mara set the lantern down.')).toEqual({ problem: 'short' })
    expect(polished('Changes made: none.')).toEqual({ problem: 'short' })
    expect(polished('')).toEqual({ problem: 'empty' })
  })
})
