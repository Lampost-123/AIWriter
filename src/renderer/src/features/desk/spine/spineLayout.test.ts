import { describe, expect, it } from 'vitest'
import type { SceneStatus } from '@shared/types'
import { chapterNumeral, FOOT, FOOT_WITH_TITLE, PITCH_MAX, PITCH_MIN, RING, spineLayout, TOP, type SpineChapter, type SpineRow } from './spineLayout'

const story = (sizes: number[]): SpineChapter[] =>
  sizes.map((n, c) => ({
    id: `c${c}`,
    title: `Chapter ${c + 1}`,
    scenes: Array.from({ length: n }, (_, s) => ({ id: `c${c}s${s}`, title: `Scene ${s + 1}`, status: 'drafted' as SceneStatus }))
  }))

const scenes = (rows: SpineRow[]) => rows.filter((r): r is Extract<SpineRow, { type: 'scene' }> => r.type === 'scene')
const chapters = (rows: SpineRow[]) => rows.filter((r): r is Extract<SpineRow, { type: 'chapter' }> => r.type === 'chapter')

describe('the story’s spine', () => {
  it('numbers chapters in Roman numerals, then plainly once they get too long for the spine', () => {
    expect([1, 2, 3, 4, 9, 14, 19, 39].map(chapterNumeral)).toEqual(['I', 'II', 'III', 'IV', 'IX', 'XIV', 'XIX', 'XXXIX'])
    expect(chapterNumeral(40)).toBe('40')
    expect(chapterNumeral(120)).toBe('120')
  })

  it('lays out a short story as the mockup does: rings 30px apart, the title down the foot', () => {
    const l = spineLayout(story([2, 3]), 'c0s0', 804)
    expect(l.pitch).toBe(PITCH_MAX)
    expect(l.showTitle).toBe(true)
    expect(l.scrolls).toBe(false)
    const ch = chapters(l.rows)
    expect(ch.map((c) => [c.numeral, c.top, c.folded])).toEqual([
      ['I', TOP, false],
      ['II', 116, false]
    ])
    expect(scenes(l.rows).map((s) => s.top)).toEqual([46, 76, 144, 174, 204])
    expect(scenes(l.rows).filter((s) => s.current).map((s) => s.id)).toEqual(['c0s0'])
    // A line joins each chapter's rings, from the first ring's middle to the last's.
    expect(l.rows.filter((r) => r.type === 'line')).toEqual([
      { type: 'line', id: 'c0', top: 46 + RING / 2, height: 30 },
      { type: 'line', id: 'c1', top: 144 + RING / 2, height: 60 }
    ])
  })

  it('brings the rings closer as the story grows, never under 14px apart, and keeps everything above the foot', () => {
    const l = spineLayout(story([8, 8, 8]), 'c1s3', 804)
    expect(l.pitch).toBeLessThan(PITCH_MAX)
    expect(l.pitch).toBeGreaterThanOrEqual(PITCH_MIN)
    expect(l.scrolls).toBe(false)
    const foot = l.showTitle ? FOOT_WITH_TITLE : FOOT
    expect(l.contentHeight).toBeLessThanOrEqual(804 - foot)
    expect(scenes(l.rows)).toHaveLength(24)
  })

  it('drops the title before the rings get too close', () => {
    const l = spineLayout(story([12, 12, 10]), 'c0s0', 804)
    expect(l.showTitle).toBe(false)
    expect(chapters(l.rows).every((c) => !c.folded)).toBe(true)
    expect(l.pitch).toBeGreaterThanOrEqual(PITCH_MIN)
  })

  it('folds every chapter but the open one in a long story: 200 scenes in 40 chapters', () => {
    const l = spineLayout(story(Array(40).fill(5)), 'c17s2', 804)
    const ch = chapters(l.rows)
    expect(ch).toHaveLength(40)
    expect(ch.filter((c) => !c.folded).map((c) => c.id)).toEqual(['c17'])
    // Only the open chapter's rings show, the open scene lit among them.
    expect(scenes(l.rows).map((s) => s.id)).toEqual(['c17s0', 'c17s1', 'c17s2', 'c17s3', 'c17s4'])
    expect(scenes(l.rows).find((s) => s.current)?.id).toBe('c17s2')
    expect(ch[39].numeral).toBe('40')
    // Rows never overlap, top to bottom.
    const tops = l.rows.filter((r) => r.type !== 'line').map((r) => r.top)
    expect(tops).toEqual([...tops].sort((a, b) => a - b))
    expect(new Set(tops).size).toBe(tops.length)
  })

  it('scrolls when even folded chapters don’t fit, at the closest spacing', () => {
    const l = spineLayout(story(Array(90).fill(3)), 'c80s1', 600)
    expect(l.scrolls).toBe(true)
    expect(l.pitch).toBe(PITCH_MIN)
    expect(l.contentHeight).toBeGreaterThan(600)
    expect(scenes(l.rows).map((s) => s.id)).toEqual(['c80s0', 'c80s1', 'c80s2'])
  })

  it('opens the first chapter when no scene is open, and an empty chapter is its numeral alone', () => {
    const l = spineLayout(story([0, 2]), null, 804)
    expect(chapters(l.rows).map((c) => c.top)).toEqual([TOP, TOP + 26])
    expect(scenes(l.rows).every((s) => !s.current)).toBe(true)
    expect(spineLayout([], null, 804).rows).toEqual([])
  })
})
