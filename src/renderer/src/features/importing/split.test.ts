import { describe, expect, it } from 'vitest'
import type { ManuscriptBlock } from '@shared/contracts/importing'
import {
  OPENING,
  buildOutline,
  mergeBack,
  noEdits,
  outlineCounts,
  proposeRoles,
  setRole,
  setTitle,
  splitAt,
  titleKey,
  toPlan,
  type SplitEdits
} from './split'

const para = (text: string, extra: Partial<ManuscriptBlock> = {}): ManuscriptBlock => ({ kind: 'para', text, runs: [{ text }], ...extra })
const h = (text: string, level: number | null, hint: ManuscriptBlock['hint'] = null): ManuscriptBlock => ({ kind: 'heading', text, level, hint })
const brk = (text = '* * *'): ManuscriptBlock => ({ kind: 'break', text })
const words = (n: number, w = 'word'): string => Array.from({ length: n }, () => w).join(' ')

function outline(blocks: ManuscriptBlock[], edits: SplitEdits = noEdits()) {
  const proposed = proposeRoles(blocks)
  return { proposed, o: buildOutline({ blocks }, proposed, edits) }
}

/** The outline as chapter titles with their scenes' titles and word counts. */
const shape = (o: ReturnType<typeof outline>['o']) =>
  o.chapters.map((c) => ({ chapter: c.title, act: c.act, scenes: c.scenes.map((s) => `${s.title} (${s.words})`) }))

describe('the proposed split', () => {
  it('splits at chapter headings and at scene breaks, with an opening chapter for text before the first heading', () => {
    const { o } = outline([
      { kind: 'title', text: 'The Ferry' },
      para('By someone.'),
      h('Chapter 1', 1, 'chapter'),
      para('One two three.'),
      brk(),
      para('Four five.'),
      h('Chapter 2', 1, 'chapter'),
      para('Six.')
    ])
    expect(shape(o)).toEqual([
      { chapter: 'Opening', act: null, scenes: ['Scene 1 (2)'] },
      { chapter: 'Chapter 1', act: null, scenes: ['Scene 1 (3)', 'Scene 2 (2)'] },
      { chapter: 'Chapter 2', act: null, scenes: ['Scene 1 (1)'] }
    ])
    expect(o.words).toBe(8)
    expect(o.scenes).toBe(4)
    expect(o.chapters[1].scenes[0].opening).toBe('One two three.')
  })

  it('calls a prologue a prologue, and uses the level below chapters for scenes', () => {
    const { o } = outline([h('Prologue', 1, 'chapter'), para('Before.'), h('Chapter One', 1, 'chapter'), h('Dawn', 2), para('Up.'), h('Dusk', 2), para('Down.')])
    expect(shape(o)).toEqual([
      { chapter: 'Prologue', act: null, scenes: ['Scene 1 (1)'] },
      { chapter: 'Chapter One', act: null, scenes: ['Dawn (1)', 'Dusk (1)'] }
    ])
  })

  it('makes a level above the chapters into acts', () => {
    const { o } = outline([h('Part One', 1, 'part'), h('Chapter 1', 2, 'chapter'), para('a'), h('Chapter 2', 2, 'chapter'), para('b'), h('Part Two', 1, 'part'), h('Chapter 3', 2, 'chapter'), para('c')])
    expect(o.acts.map((a) => a.title)).toEqual(['Part One', 'Part Two'])
    expect(shape(o).map((c) => [c.chapter, c.act])).toEqual([
      ['Chapter 1', 0],
      ['Chapter 2', 0],
      ['Chapter 3', 1]
    ])
  })

  it('reads two plain levels as parts over chapters when the top sections are long, else chapters over scenes', () => {
    const long = [h('Beginnings', 1), h('A', 2), para(words(9000)), h('B', 2), para(words(9000)), h('Endings', 1), h('C', 2), para(words(9000)), h('D', 2), para(words(9000))]
    expect(outline(long).o.acts.map((a) => a.title)).toEqual(['Beginnings', 'Endings'])
    const short = [h('A', 1), h('a1', 2), para(words(500)), h('a2', 2), para(words(500)), h('B', 1), h('b1', 2), para(words(500))]
    const s = outline(short).o
    expect(s.acts).toEqual([])
    expect(shape(s).map((c) => [c.chapter, c.scenes.length])).toEqual([
      ['A', 2],
      ['B', 1]
    ])
  })

  it('makes headings deeper than scenes ordinary text, keeping their words', () => {
    const blocks = [h('Chapter 1', 1, 'chapter'), h('Scene', 2), para('a b'), h('A note', 3), para('c')]
    const { o } = outline(blocks)
    expect(shape(o)).toEqual([{ chapter: 'Chapter 1', act: null, scenes: ['Scene (5)'] }])
    const plan = toPlan({ blocks }, o, 'T')
    expect(plan.chapters[0].scenes[0].paragraphs).toEqual([[{ text: 'a b' }], [{ text: 'A note' }], [{ text: 'c' }]])
  })

  it('splits a Word file with no headings at its page breaks', () => {
    const { o } = outline([para('One.'), para('Two.', { pageBreak: true }), para('Three.'), para('Four.', { pageBreak: true })])
    expect(shape(o).map((c) => c.chapter)).toEqual(['Opening', 'Chapter 2', 'Chapter 3'])
    expect(o.chapters[1].scenes[0].words).toBe(2)
  })

  it('keeps everything in one chapter when nothing splits it', () => {
    const { o } = outline([para('Just'), para('words.')])
    expect(shape(o)).toEqual([{ chapter: 'Opening', act: null, scenes: ['Scene 1 (2)'] }])
  })

  it('drops scenes with no words from break marks in a row, but keeps an empty chapter', () => {
    const { o } = outline([h('Chapter 1', null, 'chapter'), brk(), para('a'), brk(), brk(), para('b'), h('Chapter 2', null, 'chapter')])
    expect(shape(o)).toEqual([
      { chapter: 'Chapter 1', act: null, scenes: ['Scene 1 (1)', 'Scene 2 (1)'] },
      { chapter: 'Chapter 2', act: null, scenes: ['Scene 1 (0)'] }
    ])
  })
})

describe("Adam's changes", () => {
  const blocks: ManuscriptBlock[] = [
    h('Chapter 1', 1, 'chapter'),
    para('a'),
    para('b'),
    brk(),
    para('c'),
    h('Chapter 2', 1, 'chapter'),
    para('d'),
    h('Interlude', 1),
    para('e')
  ]

  it('renames chapters, scenes and the opening chapter', () => {
    let e = setTitle(noEdits(), titleKey('chapter', 0), 'The Ferry')
    e = setTitle(e, titleKey('scene', 3), 'Night')
    const { o } = outline(blocks, e)
    expect(o.chapters[0].title).toBe('The Ferry')
    expect(o.chapters[0].proposed).toBe('Chapter 1')
    expect(o.chapters[0].scenes[1].title).toBe('Night')
    const opening = outline([para('x'), ...blocks], setTitle(noEdits(), titleKey('chapter', OPENING), 'Front'))
    expect(opening.o.chapters[0].title).toBe('Front')
  })

  it('changes what a heading is: a chapter becomes a scene, a heading becomes ordinary text', () => {
    const asScene = outline(blocks, setRole(noEdits(), 5, 'scene')).o
    expect(shape(asScene).map((c) => [c.chapter, c.scenes.length])).toEqual([
      ['Chapter 1', 3],
      ['Interlude', 1]
    ])
    expect(asScene.chapters[0].scenes[2].title).toBe('Chapter 2')
    const asText = outline(blocks, setRole(noEdits(), 7, 'text'))
    expect(shape(asText.o).map((c) => c.chapter)).toEqual(['Chapter 1', 'Chapter 2'])
    expect(asText.o.chapters[1].scenes[0].words).toBe(3)
  })

  it('merges with the one before: a chapter into the chapter before, a scene into the scene before', () => {
    const p = proposeRoles(blocks)
    const chapterMerged = mergeBack(noEdits(), blocks, p, 5)
    expect(chapterMerged.roles[5]).toBe('scene')
    const sceneMerged = mergeBack(noEdits(), blocks, p, 3)
    const o = buildOutline({ blocks }, p, sceneMerged)
    expect(o.chapters[0].scenes).toHaveLength(1)
    expect(o.chapters[0].scenes[0].words).toBe(3)
    // The break mark stays as a line across the page inside the scene.
    expect(toPlan({ blocks }, o, 'T').chapters[0].scenes[0].paragraphs).toEqual([[{ text: 'a' }], [{ text: 'b' }], [], [{ text: 'c' }]])
  })

  it('splits a scene at a paragraph, and merging takes the split away', () => {
    const p = proposeRoles(blocks)
    const split = splitAt(noEdits(), 2)
    const o = buildOutline({ blocks }, p, split)
    expect(o.chapters[0].scenes.map((s) => s.words)).toEqual([1, 1, 1])
    expect(o.chapters[0].scenes[1]).toMatchObject({ at: 2, own: true, opening: 'b' })
    const back = mergeBack(split, blocks, p, 2)
    expect(back.roles[2]).toBeUndefined()
    expect(buildOutline({ blocks }, p, back).chapters[0].scenes).toHaveLength(2)
  })

  it('makes a scene a chapter of its own', () => {
    const o = outline(blocks, setRole(noEdits(), 3, 'chapter')).o
    expect(shape(o).map((c) => c.chapter)).toEqual(['Chapter 1', 'New chapter', 'Chapter 2', 'Interlude'])
  })
})

describe('the plan', () => {
  it('carries titles, acts, paragraphs with their bold and italic, and leaves out empty acts', () => {
    const blocks: ManuscriptBlock[] = [
      h('Part One', 1, 'part'),
      h('Part Two', 1, 'part'),
      h('Chapter 1', 2, 'chapter'),
      { kind: 'para', text: 'Hi there.', runs: [{ text: 'Hi', bold: true }, { text: ' there.' }] },
      brk(),
      brk(),
      para('Next.')
    ]
    const { o } = outline(blocks)
    const plan = toPlan({ blocks }, o, '  The Ferry ', true)
    expect(plan).toEqual({
      title: 'The Ferry',
      acts: [{ title: 'Part Two' }],
      chapters: [
        {
          title: 'Chapter 1',
          act: 0,
          scenes: [
            { title: 'Scene 1', paragraphs: [[{ text: 'Hi', bold: true }, { text: ' there.' }]] },
            { title: 'Scene 2', paragraphs: [[{ text: 'Next.' }]] }
          ]
        }
      ],
      newWorld: true
    })
    expect(outlineCounts(o)).toBe('2 acts, 1 chapter, 2 scenes')
  })

  it('splits a 150,000-word book quickly', () => {
    const blocks: ManuscriptBlock[] = []
    for (let c = 1; c <= 60; c++) {
      blocks.push(h(`Chapter ${c}`, 1, 'chapter'))
      for (let s = 0; s < 4; s++) {
        if (s) blocks.push(brk())
        for (let i = 0; i < 25; i++) blocks.push(para(words(25, 'rain')))
      }
    }
    const t = performance.now()
    const proposed = proposeRoles(blocks)
    const o = buildOutline({ blocks }, proposed, noEdits())
    buildOutline({ blocks }, proposed, setRole(noEdits(), 1, 'chapter'))
    const ms = performance.now() - t
    expect(o.words).toBe(150_000)
    expect(o.scenes).toBe(240)
    expect(ms).toBeLessThan(500)
  })
})
