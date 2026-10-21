import { describe, expect, it } from 'vitest'
import { sameData } from './savedLogic'

describe('sameData (the Settings "Saved" note)', () => {
  it('counts an equal copy as no change, whatever the key order', () => {
    expect(sameData({ a: 1, b: { c: [1, 2], d: null } }, { b: { d: null, c: [1, 2] }, a: 1 })).toBe(true)
    expect(sameData({ a: 1, gone: undefined }, { a: 1 })).toBe(true)
  })
  it('sees a real change anywhere', () => {
    expect(sameData({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [1, 3] } })).toBe(false)
    expect(sameData({ a: 'x' }, { a: 'x', b: false })).toBe(false)
    expect(sameData([1], { 0: 1 })).toBe(false)
    expect(sameData(null, {})).toBe(false)
  })
})
