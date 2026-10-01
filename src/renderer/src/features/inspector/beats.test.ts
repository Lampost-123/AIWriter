import { describe, expect, it } from 'vitest'
import { beatsToStore, mergeWithPrevious, moveBeat, pasteLines, removeBeat, splitBeat, toBeats, type Beat } from './beats'

const ids = (): (() => string) => {
  let n = 0
  return () => `n${++n}`
}
const make = (...texts: string[]): Beat[] => texts.map((text, i) => ({ id: `b${i}`, text }))
const texts = (b: Beat[]): string[] => b.map((x) => x.text)

describe('toBeats', () => {
  it('always gives at least one row to type into', () => {
    expect(texts(toBeats([], ids()))).toEqual([''])
    expect(texts(toBeats(['a', 'b'], ids()))).toEqual(['a', 'b'])
  })
  it('gives each beat its own id', () => {
    const b = toBeats(['a', 'a'], ids())
    expect(b[0].id).not.toBe(b[1].id)
  })
})

describe('beatsToStore', () => {
  it('drops blank beats and tidies spaces', () => {
    expect(beatsToStore(make('  Mara arrives ', '', '   ', 'She  sees\nthe Duke'))).toEqual(['Mara arrives', 'She sees the Duke'])
  })
})

describe('splitBeat', () => {
  it('Enter at the end starts an empty beat after this one', () => {
    const r = splitBeat(make('Mara arrives', 'Duke'), 0, 12, 12, ids())
    expect(texts(r.beats)).toEqual(['Mara arrives', '', 'Duke'])
    expect(r.focus).toEqual({ index: 1, caret: 0 })
    expect(r.beats[0].id).toBe('b0')
  })
  it('Enter in the middle moves the rest into the next beat', () => {
    const r = splitBeat(make('Mara arrives and the bell rings'), 0, 13, 17, ids())
    expect(texts(r.beats)).toEqual(['Mara arrives ', 'the bell rings'])
  })
})

describe('removeBeat', () => {
  it('removes the beat and puts the cursor at the end of the one before', () => {
    const r = removeBeat(make('one', '', 'three'), 1)
    expect(texts(r.beats)).toEqual(['one', 'three'])
    expect(r.focus).toEqual({ index: 0, caret: 3 })
  })
  it('removing the first beat moves to the new first beat', () => {
    const r = removeBeat(make('', 'two'), 0)
    expect(texts(r.beats)).toEqual(['two'])
    expect(r.focus).toEqual({ index: 0, caret: 0 })
  })
  it('keeps one empty row rather than none', () => {
    const r = removeBeat(make('only'), 0)
    expect(texts(r.beats)).toEqual([''])
  })
})

describe('mergeWithPrevious', () => {
  it('joins a beat onto the one before', () => {
    const r = mergeWithPrevious(make('Mara ', 'arrives', 'x'), 1)!
    expect(texts(r.beats)).toEqual(['Mara arrives', 'x'])
    expect(r.focus).toEqual({ index: 0, caret: 5 })
  })
  it('does nothing on the first beat', () => {
    expect(mergeWithPrevious(make('a'), 0)).toBeNull()
  })
})

describe('moveBeat', () => {
  it('moves a beat up or down', () => {
    expect(texts(moveBeat(make('a', 'b', 'c'), 0, 2))).toEqual(['b', 'c', 'a'])
    expect(texts(moveBeat(make('a', 'b', 'c'), 2, 1))).toEqual(['a', 'c', 'b'])
  })
  it('ignores moves off the ends', () => {
    const b = make('a', 'b')
    expect(moveBeat(b, 0, -1)).toBe(b)
    expect(moveBeat(b, 1, 2)).toBe(b)
  })
})

describe('pasteLines', () => {
  it('turns a pasted list into one beat per line', () => {
    const r = pasteLines(make('', 'end'), 0, 0, 0, '1. Mara arrives\n2. The bell rings\n\n- Tobin hides', ids())!
    expect(texts(r.beats)).toEqual(['Mara arrives', 'The bell rings', 'Tobin hides', 'end'])
    expect(r.focus).toEqual({ index: 2, caret: 'Tobin hides'.length })
  })
  it('keeps the text around the cursor', () => {
    const r = pasteLines(make('Before|After'), 0, 7, 7, 'one\ntwo', ids())!
    expect(texts(r.beats)).toEqual(['Before|one', 'twoAfter'])
  })
  it('leaves a single line to the normal paste', () => {
    expect(pasteLines(make('x'), 0, 0, 0, 'just one line\n', ids())).toBeNull()
  })
})
