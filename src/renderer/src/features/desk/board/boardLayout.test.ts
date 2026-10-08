import { describe, expect, it } from 'vitest'
import { boardLayout, CARD_H, CARD_W, COL_GAP, dropTarget, HEAD_H, makeRoom, PAD_TOP, PAD_X, ROW_GAP } from './boardLayout'

// The sample world's shape: two chapters of two and three scenes.
const columns = [
  { id: 'c1', sceneIds: ['s1', 's2'] },
  { id: 'c2', sceneIds: ['s3', 's4', 's5'] }
]
const step = CARD_H + ROW_GAP

describe('the board’s cards', () => {
  it('puts a column for each chapter, its cards down it in order, with a pin at each card’s top', () => {
    const l = boardLayout(columns)
    expect(l.columns.map((c) => c.x)).toEqual([PAD_X, PAD_X + CARD_W + COL_GAP])
    const s4 = l.cards.get('s4')!
    expect(s4).toMatchObject({ chapterId: 'c2', index: 1, x: PAD_X + CARD_W + COL_GAP, y: PAD_TOP + HEAD_H + step, w: CARD_W, h: CARD_H })
    expect(l.pins.get('s4')).toEqual({ x: s4.x + CARD_W / 2, y: s4.y + 13 })
    // Each card tilts a little, never the same as the one before.
    const tilts = ['s1', 's2', 's3', 's4', 's5'].map((id) => l.cards.get(id)!.tilt)
    tilts.forEach((t, i) => i && expect(t).not.toBe(tilts[i - 1]))
    tilts.forEach((t) => expect(Math.abs(t)).toBeLessThanOrEqual(0.6))
  })

  it('leaves a ghost slot under each column and a column for the next chapter, and is as big as all of it', () => {
    const l = boardLayout(columns)
    expect(l.columns[0].ghost.y).toBe(PAD_TOP + HEAD_H + 2 * step)
    expect(l.columns[1].ghost.y).toBe(PAD_TOP + HEAD_H + 3 * step)
    expect(l.next.x).toBe(PAD_X + 2 * (CARD_W + COL_GAP))
    expect(l.width).toBe(l.next.x + CARD_W + PAD_X)
    expect(l.height).toBeGreaterThan(l.columns[1].ghost.y + l.columns[1].ghost.h)
  })

  it('lays out a story with no chapters as the next chapter’s column alone', () => {
    const l = boardLayout([])
    expect(l.cards.size).toBe(0)
    expect(l.next.x).toBe(PAD_X)
  })
})

describe('the strings', () => {
  it('run pin to pin in reading order, with a knot where a thread is paid off and an open end where it runs on', () => {
    const l = boardLayout(columns, [
      { id: 'letter', sceneIds: ['s3', 's2'], paidOffSceneId: 's3', open: false },
      { id: 'midwinter', sceneIds: ['s5', 's3', 's4'], paidOffSceneId: null, open: true },
      { id: 'unseen', sceneIds: ['elsewhere'], paidOffSceneId: null, open: true }
    ])
    // A thread on no scene of the board has no string.
    expect(l.strings.map((s) => s.id)).toEqual(['letter', 'midwinter'])
    const [letter, midwinter] = l.strings
    expect(letter.sceneIds).toEqual(['s2', 's3'])
    const p2 = l.pins.get('s2')!
    const p3 = l.pins.get('s3')!
    expect(letter.d.startsWith(`M${p2.x} ${p2.y} C`)).toBe(true)
    expect(letter.d.endsWith(`${p3.x} ${p3.y}`)).toBe(true)
    expect(letter.knot).toEqual({ x: p3.x - 14, y: p3.y })
    expect(letter.end).toBeNull()
    // Down a column it loops out to the right of the cards, then runs on past the last to its open end.
    expect(midwinter.sceneIds).toEqual(['s3', 's4', 's5'])
    expect(midwinter.knot).toBeNull()
    expect(midwinter.end!.x).toBeGreaterThan(l.cards.get('s5')!.x + CARD_W)
    expect(midwinter.end!.x).toBeLessThan(l.next.x)
    // Inks by the threads' order.
    expect([letter.ink, midwinter.ink]).toEqual([1, 2])
  })
})

describe('dragging a card', () => {
  const l = boardLayout(columns)

  it('lands in the column under the pointer, before the first card whose middle is below it', () => {
    const c2 = l.columns[1]
    expect(dropTarget(l, { x: c2.x + 20, y: l.cards.get('s3')!.y + 10 }, 's1')).toEqual({ chapterId: 'c2', index: 0 })
    expect(dropTarget(l, { x: c2.x + 200, y: l.cards.get('s4')!.y + CARD_H }, 's1')).toEqual({ chapterId: 'c2', index: 2 })
    expect(dropTarget(l, { x: c2.x, y: 9999 }, 's1')).toEqual({ chapterId: 'c2', index: 3 })
    // Within its own chapter, its own place doesn't count.
    expect(dropTarget(l, { x: PAD_X + 10, y: l.cards.get('s2')!.y + CARD_H }, 's1')).toEqual({ chapterId: 'c1', index: 1 })
    // Past the last column: the nearest.
    expect(dropTarget(l, { x: 99999, y: 0 }, 's1')).toEqual({ chapterId: 'c2', index: 0 })
  })

  it('makes room: later cards in its chapter step up, cards from the landing place step down', () => {
    expect(makeRoom(l, 's1', { chapterId: 'c2', index: 1 })).toEqual(
      new Map([
        ['s2', -step],
        ['s4', step],
        ['s5', step]
      ])
    )
    // Back where it was: nothing moves.
    expect(makeRoom(l, 's3', { chapterId: 'c2', index: 0 }).size).toBe(0)
    // Down its own column, past s4.
    expect(makeRoom(l, 's3', { chapterId: 'c2', index: 1 })).toEqual(new Map([['s4', -step]]))
  })
})
