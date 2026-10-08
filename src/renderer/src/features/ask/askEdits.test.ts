// The editor chat's changes to a scene's words, on documents alone: found with or without *…* markers, italics kept
// both ways, a rewrite never across a scene break, and Undo putting back exactly what a change made (only where it
// still stands as it was made; never a paragraph that merely reads the same). Invented text only.
import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Transform } from '@tiptap/pm/transform'
import { sceneExtensions } from '@/features/editor/extensions'
import {
  NOT_FOUND,
  NOT_PLAIN,
  beatNumber,
  changeOf,
  continueAt,
  findEditAt,
  findPassageAt,
  findQuote,
  paragraphAt,
  planPassage,
  planRevert,
  planText,
  revertDoc,
  type PlannedEdit
} from './askEdits'

const schema = getSchema(sceneExtensions())
const italic = schema.marks.italic.create()

type Piece = string | { em: string }
const para = (pid: string, ...pieces: Piece[]): PMNode =>
  schema.nodes.paragraph.create(
    { pid },
    pieces.map((p) => (typeof p === 'string' ? schema.text(p) : schema.text(p.em, [italic])))
  )
const page = (...blocks: PMNode[]): PMNode => schema.topNodeType.create(null, blocks)
const brk = (): PMNode => schema.nodes.horizontalRule.create()

/** Makes a planned edit through a transform, the way the page's transaction does. */
function apply(doc: PMNode, plan: PlannedEdit): PMNode {
  const tr = new Transform(doc)
  // As Transaction.insertText: the words take the marks of those they replace.
  const $from = doc.resolve(plan.from)
  const marks = (plan.to > plan.from && $from.marksAcross(doc.resolve(plan.to))) || $from.marks()
  if (typeof plan.content === 'string') tr.replaceWith(plan.from, plan.to, schema.text(plan.content, marks))
  else tr.replaceWith(plan.from, plan.to, plan.content)
  return tr.doc
}

const texts = (doc: PMNode): string[] => {
  const out: string[] = []
  doc.forEach((n) => out.push(n.type.name === 'horizontalRule' ? '* * *' : n.textContent))
  return out
}
const planned = (p: ReturnType<typeof planText>): PlannedEdit => {
  if ('why' in p) throw new Error(p.why)
  return p
}

describe('finding the words', () => {
  it('finds words quoted with *…* markers in a page that shows them as italics', () => {
    const doc = page(para('a', 'She was ', { em: 'very' }, ' tired.'))
    expect(findQuote(doc, 'She was *very* tired.')).toEqual({ from: 1, to: 1 + 'She was very tired.'.length })
    expect(findQuote(doc, 'not here')).toBeNull()
  })
})

describe('an edit of words', () => {
  it('replaces the words with plain words that keep the marks of those they replace', () => {
    const doc = page(para('a', 'The tide came in.'), para('b', 'The gulls went ', { em: 'quiet' }, '.'))
    const plan = planned(planText(doc, 'quiet', 'still'))
    expect(plan.content).toBe('still')
    const after = apply(doc, plan)
    expect(texts(after)).toEqual(['The tide came in.', 'The gulls went still.'])
    const marked: string[] = []
    after.child(1).forEach((n) => n.marks.some((m) => m.type.name === 'italic') && marked.push(n.text ?? ''))
    expect(marked).toEqual(['still'])
  })

  it('says plainly when the words are gone', () => {
    expect(planText(page(para('a', 'Rain.')), 'Snow', 'Sleet')).toEqual({ why: NOT_FOUND })
  })
})

describe('a rewrite across paragraphs', () => {
  it('keeps the words around the passage, and its italics', () => {
    const doc = page(para('a', 'Before. The tide came in.'), para('b', 'The gulls went quiet. After.'))
    const p = planPassage(doc, 'The tide came in.', 'The gulls went quiet.', 'The tide *roared* in.\n\nThe gulls screamed.')
    if ('why' in p) throw new Error(p.why)
    const after = apply(doc, p)
    expect(texts(after)).toEqual(['Before. The tide roared in.', 'The gulls screamed. After.'])
    expect(after.child(0).attrs.pid).toBe('a')
  })

  it('finds its end words after its start words, even when they are also inside the start words', () => {
    const doc = page(para('a', 'The sea was grey. The sky was grey.'), para('b', 'Then rain. The sky was grey.'))
    // "was grey." is in the start words too; the passage ends at the next one after them.
    const p = planPassage(doc, 'The sea was grey.', 'was grey.', 'All of it, new.')
    if ('why' in p) throw new Error(p.why)
    expect(texts(apply(doc, p))).toEqual(['All of it, new.', 'Then rain. The sky was grey.'])
    // A passage no longer than its start words: its end words are their last ones.
    const q = planPassage(doc, 'Then rain.', 'rain.', 'Then snow.')
    if ('why' in q) throw new Error(q.why)
    expect(texts(apply(doc, q))).toEqual(['The sea was grey. The sky was grey.', 'Then snow. The sky was grey.'])
    // End words found only inside the start words (not at their end) are no end.
    expect(planPassage(page(para('a', 'The sea was grey.')), 'The sea was grey.', 'sea was', 'New.')).toEqual({ why: NOT_FOUND })
  })

  it('is refused across a scene break', () => {
    const doc = page(para('a', 'The tide came in.'), brk(), para('b', 'The gulls went quiet.'))
    expect(planPassage(doc, 'The tide came in.', 'The gulls went quiet.', 'All of it, new.')).toEqual({ why: NOT_PLAIN })
  })

  it('keeps the words around it in one paragraph when the passage is cut', () => {
    const doc = page(para('a', 'Keep this. Cut from here.'), para('b', 'To here. And this.'))
    const p = planPassage(doc, 'Cut from here.', 'To here.', '')
    if ('why' in p) throw new Error(p.why)
    expect(texts(apply(doc, p))).toEqual(['Keep this.  And this.'])
  })
})

describe('Undo', () => {
  const start = (): PMNode => page(para('a', 'The tide came in.'), para('b', 'The gulls went quiet.'), para('c', 'Night fell.'))

  it('puts back exactly what the change made, and keeps typing elsewhere', () => {
    const doc = start()
    const plan = planned(planText(doc, 'went quiet', 'fell silent'))
    const after = apply(doc, plan)
    const change = changeOf(doc, after, plan)
    // Adam types in another paragraph afterwards.
    const typed = apply(after, { from: 1, to: 1, content: 'Slowly, ', first: 0, count: 1 })
    const back = revertDoc(typed, change)
    if ('why' in back) throw new Error(back.why)
    expect(texts(back)).toEqual(['Slowly, The tide came in.', 'The gulls went quiet.', 'Night fell.'])
  })

  it('leaves the words alone when they were changed since', () => {
    const doc = start()
    const plan = planned(planText(doc, 'went quiet', 'fell silent'))
    const after = apply(doc, plan)
    const change = changeOf(doc, after, plan)
    const edited = apply(after, { from: after.child(0).nodeSize + 1, to: after.child(0).nodeSize + 1, content: 'All ', first: 1, count: 1 })
    expect(planRevert(edited, change)).toEqual({ why: 'changed' })
  })

  it('never takes a paragraph that only reads the same for the one the change made', () => {
    const doc = page(para('a', 'Rain.'), para('b', 'Snow.'))
    const plan = planned(planText(doc, 'Snow.', 'Rain.'))
    const after = apply(doc, plan)
    const change = changeOf(doc, after, plan)
    // Adam rewrites the changed paragraph; the first still reads "Rain." but isn't it.
    const edited = apply(after, { from: after.child(0).nodeSize + 1, to: after.nodeSize - 3, content: 'Hail.', first: 1, count: 1 })
    expect(texts(edited)).toEqual(['Rain.', 'Hail.'])
    expect(planRevert(edited, change)).toEqual({ why: 'changed' })
  })

  it('says it is back already after Ctrl+Z', () => {
    const doc = start()
    const plan = planned(planText(doc, 'went quiet', 'fell silent'))
    const change = changeOf(doc, apply(doc, plan), plan)
    expect(planRevert(doc, change)).toEqual({ why: 'already' })
  })

  it('takes back a rewrite across paragraphs, paragraph ids and all', () => {
    const doc = start()
    const p = planPassage(doc, 'The tide came in.', 'The gulls went quiet.', 'One.\n\nTwo.\n\nThree.')
    if ('why' in p) throw new Error(p.why)
    const after = apply(doc, p)
    expect(texts(after)).toEqual(['One.', 'Two.', 'Three.', 'Night fell.'])
    const back = revertDoc(after, changeOf(doc, after, p))
    if ('why' in back) throw new Error(back.why)
    expect(back.eq(doc)).toBe(true)
  })

  it('undoes two changes to one paragraph only latest first', () => {
    const doc = start()
    const p1 = planned(planText(doc, 'went quiet', 'fell silent'))
    const a1 = apply(doc, p1)
    const p2 = planned(planText(a1, 'The gulls', 'The terns'))
    const a2 = apply(a1, p2)
    const c1 = changeOf(doc, a1, p1)
    const c2 = changeOf(a1, a2, p2)
    // The first change's words were changed since by the second: undone first, it is left alone.
    expect(planRevert(a2, c1)).toEqual({ why: 'changed' })
    const back2 = revertDoc(a2, c2)
    if ('why' in back2) throw new Error(back2.why)
    const back1 = revertDoc(back2, c1)
    if ('why' in back1) throw new Error(back1.why)
    expect(back1.eq(doc)).toBe(true)
  })
})

describe('anchors (where the chat says the words stand)', () => {
  // The same words twice: the chat's anchor says which (paragraphs numbered as read_scene numbers them).
  const empty = (): PMNode => schema.nodes.paragraph.create({ pid: 'e' })
  const doc = page(
    para('a', 'The lamp went out.'),
    empty(),
    brk(),
    para('b', 'Hesper waited. The lamp went out. Then dark.'),
    para('c', 'The lamp went out.')
  )
  const posOfPara = (i: number): number => {
    let at = 0
    for (let k = 0; k < i; k++) at += doc.child(k).nodeSize
    return at + 1
  }

  it('names a paragraph by its id, else by its number (empty paragraphs and scene breaks not counted)', () => {
    expect(paragraphAt(doc, { paragraph: 2, pid: null, offset: 0 })?.start).toBe(posOfPara(3))
    expect(paragraphAt(doc, { paragraph: 1, pid: 'c', offset: 0 })?.start).toBe(posOfPara(4))
    // An id no longer in the scene: its number counts.
    expect(paragraphAt(doc, { paragraph: 3, pid: 'gone', offset: 0 })?.start).toBe(posOfPara(4))
    expect(paragraphAt(doc, { paragraph: 9, pid: null, offset: 0 })).toBeNull()
  })

  it('finds the words where the anchor says, not the first place they are', () => {
    const at = { paragraph: 2, pid: 'b', offset: 'Hesper waited. '.length }
    const r = findEditAt(doc, 'The lamp went out.', at)
    expect(r).toEqual({ from: posOfPara(3) + at.offset, to: posOfPara(3) + at.offset + 'The lamp went out.'.length })
    const after = apply(doc, planned(planText(doc, 'The lamp went out.', 'The lamp guttered.', at)))
    expect(texts(after)).toEqual(['The lamp went out.', '', '* * *', 'Hesper waited. The lamp guttered. Then dark.', 'The lamp went out.'])
    // In the paragraph it names, an offset gone stale (typing before it) still finds the words there.
    expect(findEditAt(doc, 'The lamp went out.', { paragraph: 3, pid: 'c', offset: 4 })?.from).toBe(posOfPara(4))
  })

  it('falls back to the first place the words are when the anchor no longer holds', () => {
    expect(findEditAt(doc, 'The lamp went out.', { paragraph: 9, pid: 'gone', offset: 0 })?.from).toBe(posOfPara(0))
    expect(findEditAt(doc, 'The lamp went out.')?.from).toBe(posOfPara(0))
  })

  it('finds a passage by its start and end anchors', () => {
    const at = { start: { paragraph: 2, pid: 'b', offset: 'Hesper waited. '.length }, end: { paragraph: 3, pid: 'c', offset: 'The lamp went out.'.length } }
    expect(findPassageAt(doc, 'The lamp', 'went out.', at)).toEqual({ from: posOfPara(3) + at.start.offset, to: posOfPara(4) + 'The lamp went out.'.length })
    // Without anchors: as before, from the first start words to the end words after them.
    expect(findPassageAt(doc, 'The lamp', 'went out.')).toEqual({ from: posOfPara(0), to: posOfPara(0) + 'The lamp went out.'.length })
  })
})

describe('a proposed draft', () => {
  it('carries on from the end of the paragraph named, else the end of the scene’s words', () => {
    const doc = page(para('a', 'One.'), para('b', 'Two.'), schema.nodes.paragraph.create({ pid: 'e' }))
    expect(continueAt(doc, { paragraph: 1, pid: 'a', offset: 4 })).toBe(1 + 'One.'.length)
    expect(continueAt(doc)).toBe(doc.child(0).nodeSize + 1 + 'Two.'.length)
    expect(continueAt(page(schema.nodes.paragraph.create({ pid: 'e' })))).toBeNull()
  })

  it('names a card’s beat as Beat by beat counts them (blank beats left out), by its words first', () => {
    const beats = ['Arrive at the lighthouse', '', 'The lamp fails', 'Climb the stair']
    expect(beatNumber(beats, { index: 3, text: 'The lamp fails' })).toBe(2)
    // Moved on the card since: found by its words.
    expect(beatNumber(['The lamp fails', 'Arrive'], { index: 3, text: 'The lamp fails' })).toBe(1)
    // Reworded: its place on the card.
    expect(beatNumber(beats, { index: 4, text: 'Climb the stairs slowly' })).toBe(3)
    expect(beatNumber(beats, { index: 2, text: 'Gone' })).toBeNull()
  })
})
