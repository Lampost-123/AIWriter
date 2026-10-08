// The editor chat's changes to a scene's words, on documents alone: found with or without *…* markers, italics kept
// both ways, a rewrite never across a scene break, and Undo putting back exactly what a change made (only where it
// still stands as it was made; never a paragraph that merely reads the same). Invented text only.
import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Transform } from '@tiptap/pm/transform'
import { sceneExtensions } from '@/features/editor/extensions'
import { withParagraphIds } from '@/features/editor/paragraphIds'
import {
  CUT_ALL,
  CUT_CHANGED,
  CUT_PLAIN,
  INSERT_GONE,
  NOT_FOUND,
  NOT_PLAIN,
  beatNumber,
  changeOf,
  continueAt,
  planCut,
  planInsert,
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

describe('inserts and cuts (TEXTTOOLS)', () => {
  const at = (paragraph: number, pid: string | null) => ({ paragraph, pid, offset: 0 })
  /** As the page's paragraph-id plugin does after each step: new paragraphs get ids. */
  const ids = (doc: PMNode): PMNode => withParagraphIds(doc).doc
  /** Adam typing words at a place. */
  const typeAt = (doc: PMNode, pos: number, words: string): PMNode => new Transform(doc).insert(pos, schema.text(words)).doc
  const scene = (): PMNode => page(para('a', 'The tide came in.'), para('b', 'The gulls went quiet.'), brk(), para('c', 'Mara waited.'))

  it('puts new paragraphs after or before the one named, with their italics, each with no id of its own yet', () => {
    const doc = scene()
    const after = planned(planInsert(doc, { where: 'after', at: at(1, 'a'), near: 'The tide came in.', text: 'She *almost* spoke.\n\nShe did not.' }))
    const done = apply(doc, after)
    expect(texts(done)).toEqual(['The tide came in.', 'She almost spoke.', 'She did not.', 'The gulls went quiet.', '* * *', 'Mara waited.'])
    expect(done.child(1).child(1).marks.map((m) => m.type.name)).toEqual(['italic'])
    expect(done.child(1).attrs.pid).toBeNull()
    const before = planned(planInsert(doc, { where: 'before', at: at(3, 'c'), near: 'Mara waited.', text: 'Dawn.' }))
    expect(texts(apply(doc, before))).toEqual(['The tide came in.', 'The gulls went quiet.', '* * *', 'Dawn.', 'Mara waited.'])
  })

  it('finds the paragraph by its id though its number changed; with no id, by its words; gone, says so', () => {
    const moved = page(para('z', 'New first.'), ...scene().content.content)
    const p = planned(planInsert(moved, { where: 'after', at: at(1, 'a'), near: 'The tide came in.', text: 'X.' }))
    expect(texts(apply(moved, p)).slice(0, 3)).toEqual(['New first.', 'The tide came in.', 'X.'])
    const noIds = page(para('', 'Other.'), para('', 'The tide came in.'))
    expect(texts(apply(noIds, planned(planInsert(noIds, { where: 'after', at: at(1, null), near: 'The tide came in.', text: 'X.' }))))).toEqual([
      'Other.',
      'The tide came in.',
      'X.'
    ])
    expect(planInsert(page(para('q', 'Something else.')), { where: 'after', at: at(1, 'a'), near: 'The tide came in.', text: 'X.' })).toEqual({ why: INSERT_GONE })
  })

  it('cuts whole paragraphs only while they read as the chat read them, never across a break nor all of them', () => {
    const doc = scene()
    const cut = planned(planCut(doc, { from: at(1, 'a'), to: at(2, 'b'), paragraphs: ['The tide came in.', 'The gulls went quiet.'] }))
    expect(texts(apply(doc, cut))).toEqual(['* * *', 'Mara waited.'])
    expect(planCut(doc, { from: at(2, 'b'), to: at(2, 'b'), paragraphs: ['The gulls went *quite* quiet.'] })).toEqual({ why: CUT_CHANGED })
    expect(planCut(doc, { from: at(2, 'b'), to: at(3, 'c'), paragraphs: ['The gulls went quiet.', 'Mara waited.'] })).toEqual({ why: CUT_PLAIN })
    const two = page(para('a', 'One.'), para('b', 'Two.'))
    expect(planCut(two, { from: at(1, 'a'), to: at(2, 'b'), paragraphs: ['One.', 'Two.'] })).toEqual({ why: CUT_ALL })
  })

  it('undoes an insert: only its paragraphs go, Adam’s typing elsewhere stays; changed since, it stays', () => {
    const doc = scene()
    const plan = planned(planInsert(doc, { where: 'after', at: at(1, 'a'), near: 'The tide came in.', text: 'She paused.\n\nThen spoke.' }))
    const after = ids(apply(doc, plan))
    const change = changeOf(doc, after, plan)
    expect(change.before).toEqual([])
    expect(change.after.map((n) => n.textContent)).toEqual(['She paused.', 'Then spoke.'])
    // Adam types in the paragraph before it: Undo takes out only the new paragraphs.
    const typed = typeAt(after, 1, 'Slowly, ')
    const back = revertDoc(typed, change)
    expect('why' in back ? back : texts(back)).toEqual(['Slowly, The tide came in.', 'The gulls went quiet.', '* * *', 'Mara waited.'])
    // Undone already (Ctrl+Z): nothing to do. One of its paragraphs changed since: left as it is.
    expect(revertDoc(doc, change)).toEqual({ why: 'already' })
    const pos = after.child(0).nodeSize + 1
    expect(revertDoc(typeAt(after, pos, 'Oh. '), change)).toEqual({ why: 'changed' })
  })

  it('undoes a cut: its paragraphs go back after the one before them, whatever Adam typed there since', () => {
    const doc = scene()
    const plan = planned(planCut(doc, { from: at(2, 'b'), to: at(2, 'b'), paragraphs: ['The gulls went quiet.'] }))
    const after = apply(doc, plan)
    const change = changeOf(doc, after, plan)
    expect(change.after).toEqual([])
    expect(change.prev?.attrs.pid).toBe('a')
    const typed = typeAt(after, 1, 'Slowly, ')
    const back = revertDoc(typed, change)
    expect('why' in back ? back : texts(back)).toEqual(['Slowly, The tide came in.', 'The gulls went quiet.', '* * *', 'Mara waited.'])
    if (!('why' in back)) expect(back.child(1).attrs.pid).toBe('b')
    expect(revertDoc(doc, change)).toEqual({ why: 'already' })
    // The paragraph before it gone: back before the one after it. Both gone: left as it is.
    const noPrev = new Transform(after).delete(0, after.child(0).nodeSize).doc
    const back2 = revertDoc(noPrev, change)
    expect('why' in back2 ? back2 : texts(back2)).toEqual(['The gulls went quiet.', '* * *', 'Mara waited.'])
    expect(revertDoc(page(para('q', 'Elsewhere.')), change)).toEqual({ why: 'changed' })
  })
})
