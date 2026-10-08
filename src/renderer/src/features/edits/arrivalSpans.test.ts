import { describe, expect, it } from 'vitest'
import { ARRIVE_MS, ArrivalSpans, runsOf } from './arrivalSpans'

describe('Continue’s words fading in', () => {
  it('the newest words fade; words still fading carry on from where they had got to', () => {
    const a = new ArrivalSpans()
    expect(a.note('c1', 0, 1000)).toEqual([])
    expect(a.note('c1', 10, 1000)).toEqual([{ from: 0, to: 10, delay: 0 }])
    // Drawn again 50 ms later with more words: the first ten are 50 ms into their fade.
    expect(a.note('c1', 18, 1050)).toEqual([
      { from: 0, to: 10, delay: -50 },
      { from: 10, to: 18, delay: 0 }
    ])
  })

  it('words whose fade has played out show in full', () => {
    const a = new ArrivalSpans()
    a.note('c1', 10, 1000)
    a.note('c1', 18, 1100)
    expect(a.note('c1', 25, 1000 + ARRIVE_MS + 20)).toEqual([
      { from: 10, to: 18, delay: -80 },
      { from: 18, to: 25, delay: 0 }
    ])
    expect(a.note('c1', 25, 2000)).toEqual([])
  })

  it('drawn again with nothing new: the same stretches, further along', () => {
    const a = new ArrivalSpans()
    a.note('c1', 10, 1000)
    expect(a.note('c1', 10, 1040)).toEqual([{ from: 0, to: 10, delay: -40 }])
  })

  it('asterisks turned into italics (fewer characters): what showed before is cut to fit', () => {
    const a = new ArrivalSpans()
    a.note('c1', 10, 1000)
    a.note('c1', 20, 1030)
    expect(a.note('c1', 19, 1060)).toEqual([
      { from: 0, to: 10, delay: -60 },
      { from: 10, to: 19, delay: -30 }
    ])
  })

  it('not being written (a ready-made change, or once it is ready): new words show at once', () => {
    const a = new ArrivalSpans()
    expect(a.note('r1', 40, 1000, false)).toEqual([])
    const b = new ArrivalSpans()
    b.note('c1', 10, 1000)
    // Ready 60 ms later: the words still fading carry on; anything new shows in full.
    expect(b.note('c1', 12, 1060, false)).toEqual([{ from: 0, to: 10, delay: -60 }])
  })

  it('another change starts afresh', () => {
    const a = new ArrivalSpans()
    a.note('c1', 10, 1000)
    expect(a.note('c2', 4, 1010)).toEqual([{ from: 0, to: 4, delay: 0 }])
    a.forget()
    expect(a.note('c2', 6, 1020)).toEqual([{ from: 0, to: 6, delay: 0 }])
  })
})

describe('splitting words into fading runs', () => {
  const spans = [
    { from: 5, to: 9, delay: -40 },
    { from: 9, to: 14, delay: 0 }
  ]

  it('splits a piece at the spans’ edges', () => {
    expect(runsOf('Hello there you', 0, spans)).toEqual([
      { text: 'Hello', delay: null },
      { text: ' the', delay: -40 },
      { text: 're yo', delay: 0 },
      { text: 'u', delay: null }
    ])
  })

  it('a piece further into the words (after an italic one, say) uses its own offset', () => {
    expect(runsOf('abc', 7, spans)).toEqual([
      { text: 'ab', delay: -40 },
      { text: 'c', delay: 0 }
    ])
    expect(runsOf('xyz', 20, spans)).toEqual([{ text: 'xyz', delay: null }])
    expect(runsOf('', 3, spans)).toEqual([])
  })
})
