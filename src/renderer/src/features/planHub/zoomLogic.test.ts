import { describe, expect, it } from 'vitest'
import type { Outline } from '@shared/types'
import { chapterMeta, chapterStep, chapterView, sceneStep, sceneView, trailOf, wholeStoryView, zoomOf } from './zoomLogic'
import type { LineChapter } from './hubLogic'

const outline = {
  chapters: [{ id: 'c1' }, { id: 'c2' }],
  scenes: [
    { id: 's1', chapterId: 'c1' },
    { id: 's2', chapterId: 'c2' }
  ]
} as unknown as Pick<Outline, 'chapters' | 'scenes'>

const chapter = (o: Partial<LineChapter> = {}): LineChapter => ({
  id: 'c1',
  no: 14,
  title: 'The ford',
  goal: '',
  actId: null,
  actNo: null,
  scenes: [],
  words: 0,
  ...o
})

describe('zoomOf', () => {
  it('a chapter, a scene (with its chapter), or the whole story', () => {
    expect(zoomOf({ chapterId: 'c1' }, outline)).toEqual({ kind: 'chapter', chapterId: 'c1' })
    expect(zoomOf({ sceneId: 's2' }, outline)).toEqual({ kind: 'scene', chapterId: 'c2', sceneId: 's2' })
    expect(zoomOf({ chapterId: 'c1', sceneId: 's2' }, outline)).toEqual({ kind: 'scene', chapterId: 'c2', sceneId: 's2' })
    expect(zoomOf({}, outline)).toBeNull()
  })
  it('one the story no longer has: its chapter, else the whole story', () => {
    expect(zoomOf({ chapterId: 'c1', sceneId: 'gone' }, outline)).toEqual({ kind: 'chapter', chapterId: 'c1' })
    expect(zoomOf({ chapterId: 'gone' }, outline)).toBeNull()
  })
})

describe('chapterStep', () => {
  it('Plan it with no scenes or an empty card; Write it when every card says something; Open once written', () => {
    expect(chapterStep(chapter(), 0)).toBe('plan')
    const two = [
      { id: 'a', no: 1, title: '', words: 0 },
      { id: 'b', no: 2, title: '', words: 0 }
    ]
    expect(chapterStep(chapter({ scenes: two }), 1)).toBe('plan')
    expect(chapterStep(chapter({ scenes: two }), 0)).toBe('write')
    expect(chapterStep(chapter({ scenes: two, words: 30 }), 2)).toBe('open')
  })
})

describe('sceneStep', () => {
  it('Open once written, Fill the card while it is empty, else Write it', () => {
    expect(sceneStep({ words: 12 }, true)).toBe('open')
    expect(sceneStep({ words: 0 }, true)).toBe('fill')
    expect(sceneStep({ words: 0 }, false)).toBe('write')
  })
})

describe('chapterMeta', () => {
  it('says how the chapter stands in a line', () => {
    expect(chapterMeta(chapter())).toBe('Planned · no scenes yet')
    expect(chapterMeta(chapter({ scenes: [{ id: 'a', no: 1, title: '', words: 0 }] }))).toBe('Planned · 1 scene')
    expect(
      chapterMeta(
        chapter({
          words: 2400,
          scenes: [
            { id: 'a', no: 1, title: '', words: 2400 },
            { id: 'b', no: 2, title: '', words: 0 }
          ]
        })
      )
    ).toBe('Being written · 1 of 2 scenes written · 2,400 words')
    expect(chapterMeta(chapter({ words: 1, scenes: [{ id: 'a', no: 1, title: '', words: 1 }] }))).toBe('Written · 1 scene · 1 word')
  })
})

describe('the views and the trail', () => {
  const back = { view: { kind: 'write' } as const, label: 'Back to writing' }
  it('keep the page Build with AI was opened from', () => {
    expect(chapterView('st', 'c1', { open: 'write', back })).toEqual({ kind: 'planHub', storyId: 'st', section: 'line', chapterId: 'c1', open: 'write', back })
    expect(sceneView('st', 's1', { tool: 'ideas' })).toEqual({ kind: 'planHub', storyId: 'st', section: 'line', sceneId: 's1', tool: 'ideas' })
    expect(wholeStoryView('st', 'c1', back)).toEqual({ kind: 'planHub', storyId: 'st', section: 'line', near: 'c1', back })
  })
  it('Whole story › Ch 14 · The ford, or Whole story › Ch 14 › Sc 2', () => {
    const c = chapter({ scenes: [{ id: 's1', no: 2, title: 'Crossing', words: 0 }] })
    expect(trailOf('st', c, null).map((t) => [t.label, !!t.view])).toEqual([
      ['Whole story', true],
      ['Ch 14 · The ford', false]
    ])
    const t = trailOf('st', c, c.scenes[0])
    expect(t.map((x) => x.label)).toEqual(['Whole story', 'Ch 14', 'Sc 2'])
    expect(t[1].view).toEqual({ kind: 'planHub', storyId: 'st', section: 'line', chapterId: 'c1' })
    expect(t[0].view).toEqual({ kind: 'planHub', storyId: 'st', section: 'line', near: 'c1' })
  })
})
