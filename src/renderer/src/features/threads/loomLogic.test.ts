import { describe, expect, it } from 'vitest'
import type { BoardThread } from '@shared/contracts/worldViews'
import { loomRuler, matchesWords, openMarks, sceneWords, strandOf, touchesChapter } from './loomLogic'

// The sample world's shape (invented ids): two chapters, two scenes each.
const outline = {
  chapters: [
    { id: 'c2', position: 1, title: 'The Drowned Steps' },
    { id: 'c1', position: 0, title: 'The Night Ferry' }
  ],
  scenes: [
    { id: 's1', chapterId: 'c1', position: 0 },
    { id: 's2', chapterId: 'c1', position: 1 },
    { id: 's4', chapterId: 'c2', position: 1 },
    { id: 's3', chapterId: 'c2', position: 0 }
  ]
} as unknown as Parameters<typeof loomRuler>[0]

const place = (sceneId: string | null, planned = false): BoardThread['setUp'] => ({ label: sceneId ? 'Ch' : '', storyId: 'st', sceneId, planned })
const thread = (t: Partial<BoardThread>): BoardThread => ({
  id: 't',
  name: 'What is in the sealed letter?',
  promise: 'The clerk carries it sealed.',
  column: 'open',
  setUp: null,
  paidOff: null,
  openChapters: null,
  longOpen: false,
  ...t
})

describe('the loom', () => {
  const ruler = loomRuler(outline, 100, 900)

  it('lays the chapters along the ruler in order, each as wide as its scenes, a scene in the middle of its share', () => {
    expect(ruler.chapters.map((c) => [c.n, c.title, c.x, c.w])).toEqual([
      [1, 'The Night Ferry', 100, 400],
      [2, 'The Drowned Steps', 500, 400]
    ])
    expect(ruler.sceneX.get('s1')).toBe(200)
    expect(ruler.sceneX.get('s3')).toBe(600)
    expect(sceneWords(ruler, 's4')).toBe('Ch 2, Sc 2')
    expect(sceneWords(ruler, 'elsewhere')).toBeNull()
  })

  it('has nothing to lay out without a story', () => {
    expect(loomRuler(null, 0, 100).chapters).toEqual([])
  })

  it('draws a resolved thread from its set-up to its pay-off, with the scenes between as beads', () => {
    const s = strandOf(thread({ column: 'resolved', setUp: place('s2'), paidOff: place('s4') }), ruler, ['s3'])
    expect(s).toMatchObject({ from: 400, to: 800, open: false, beads: [600], tension: 0 })
  })

  it('runs an open thread on, its glow growing the longer it is open', () => {
    const young = strandOf(thread({ setUp: place('s3'), openChapters: 1 }), ruler)
    const old = strandOf(thread({ setUp: place('s1'), openChapters: 9, longOpen: true }), ruler)
    expect(young).toMatchObject({ from: 600, to: null, open: true })
    expect(young.tension).toBeLessThan(old.tension)
    expect(old.tension).toBe(1)
  })

  it('draws a thread only planned on scene cards dashed', () => {
    expect(strandOf(thread({ column: 'planned', setUp: place('s2', true) }), ruler).planned).toBe(true)
  })

  it('filters by chapter and by words', () => {
    const t = thread({ setUp: place('s2'), paidOff: place('s3') })
    expect(touchesChapter(t, ruler.chapters[0])).toBe(true)
    expect(touchesChapter(thread({ setUp: place('s4') }), ruler.chapters[0])).toBe(false)
    expect(touchesChapter(thread({}), ruler.chapters[0], ['s1'])).toBe(true)
    expect(matchesWords(t, 'SEALED clerk')).toBe(true)
    expect(matchesWords(t, 'midwinter')).toBe(false)
    expect(matchesWords(t, '  ')).toBe(true)
    expect(openMarks(12)).toBe(8)
    expect(openMarks(null)).toBe(0)
  })
})
