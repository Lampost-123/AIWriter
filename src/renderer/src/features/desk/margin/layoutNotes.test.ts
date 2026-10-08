import { describe, expect, it } from 'vitest'
import { layoutNotes } from './layoutNotes'

const tops = (m: Map<string, number>): Record<string, number> => Object.fromEntries(m)

describe('placing the margin notes down the page', () => {
  it('puts each note level with its line when there is room', () => {
    expect(tops(layoutNotes([{ id: 'a', want: 100, height: 60 }, { id: 'b', want: 300, height: 80 }]))).toEqual({ a: 100, b: 300 })
  })

  it('pushes a note down below the one above it, with a gap, never up', () => {
    expect(tops(layoutNotes([{ id: 'a', want: 100, height: 60 }, { id: 'b', want: 120, height: 40 }, { id: 'c', want: 150, height: 40 }]))).toEqual({
      a: 100,
      b: 168,
      c: 216
    })
    expect(tops(layoutNotes([{ id: 'a', want: 0, height: 50 }, { id: 'b', want: 10, height: 50 }], 12))).toEqual({ a: 0, b: 62 })
  })

  it('goes by where they want to be, whatever order they come in', () => {
    expect(tops(layoutNotes([{ id: 'late', want: 400, height: 50 }, { id: 'early', want: 20, height: 50 }]))).toEqual({ early: 20, late: 400 })
  })

  it('keeps a pinned note (the scene card) where it is; the others make way for it', () => {
    const m = layoutNotes([
      { id: 'card', want: 56, height: 200, pinned: true },
      { id: 'edric', want: 120, height: 90 },
      { id: 'lore', want: 600, height: 70 }
    ])
    expect(tops(m)).toEqual({ card: 56, edric: 264, lore: 600 })
  })

  it('lets a note sit above a pinned one when it fits there', () => {
    const m = layoutNotes([
      { id: 'pin', want: 300, height: 100, pinned: true },
      { id: 'top', want: 100, height: 60 },
      { id: 'squeezed', want: 250, height: 60 }
    ])
    expect(tops(m)).toEqual({ pin: 300, top: 100, squeezed: 408 })
  })

  it('puts notes that want the same line in reading order, whatever their ids', () => {
    const m = layoutNotes([
      { id: 'z', want: 100, height: 50, order: 10 },
      { id: 'a', want: 100, height: 50, order: 40 }
    ])
    expect(tops(m)).toEqual({ z: 100, a: 158 })
  })

  it('places nothing when there is nothing', () => {
    expect(layoutNotes([]).size).toBe(0)
  })
})
