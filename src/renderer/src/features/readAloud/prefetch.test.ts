import { describe, expect, it } from 'vitest'
import { AHEAD, toFetch } from './prefetch'

const clips = (...keys: string[]): { key: string; waits: boolean }[] =>
  keys.map((k) => ({ key: k.replace('*', ''), waits: k.endsWith('*') }))
const none = (): boolean => false

describe('preparing clips ahead', () => {
  it('gets the clip about to play first, then the three after it', () => {
    expect(AHEAD).toBe(3)
    expect(toFetch(clips('a', 'b', 'c', 'd', 'e', 'f'), 0, none)).toEqual(['a', 'b', 'c', 'd'])
    expect(toFetch(clips('a', 'b', 'c', 'd', 'e', 'f'), 2, none)).toEqual(['c', 'd', 'e', 'f'])
  })

  it('skips what it has, and stops at the end of the reading', () => {
    const have = (k: string): boolean => k === 'b' || k === 'c'
    expect(toFetch(clips('a', 'b', 'c', 'd', 'e'), 1, have)).toEqual(['d', 'e'])
    expect(toFetch(clips('a', 'b'), 5, none)).toEqual([])
  })

  it('leaves clips waiting for the AI’s marks until they are marked', () => {
    expect(toFetch(clips('a', 'b*', 'c', 'd*', 'e'), 0, none)).toEqual(['a', 'c'])
  })

  it('gets a clip that comes twice only once', () => {
    expect(toFetch(clips('a', 'b', 'a', 'c'), 0, none)).toEqual(['a', 'b', 'c'])
  })
})
