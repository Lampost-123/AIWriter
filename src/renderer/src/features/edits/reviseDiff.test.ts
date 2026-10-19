import { describe, expect, it } from 'vitest'
import { encode, movedWords, revisionParas, type DiffPara } from './reviseDiff'

/** A change as plain text: [-cut-] {+added+} (…pending…), paragraphs on lines of their own. */
function show(paras: DiffPara[]): string {
  return paras
    .map((p) =>
      p === 'break'
        ? '* * *'
        : p
            .map((x) => {
              const t = x.italic ? `*${x.text}*` : x.text
              return x.kind === 'del' ? `[-${t}-]` : x.kind === 'ins' ? `{+${t}+}` : x.kind === 'pending' ? `(…${t}…)` : t
            })
            .join('')
    )
    .join('\n')
}

describe('Change it… as a tracked change of only what moved', () => {
  it('marks only the words that changed, paragraph by paragraph', () => {
    const old = 'Rain hammered the shutters. Mara pushed through the crowd.\n\nTobin waited by the fire.'
    const now = 'Rain hammered the shutters. Mara shoved through.\n\nTobin waited by the fire.'
    const paras = revisionParas(old, now, true)
    // "through" and "through." are different words: the stretch is cut, then added.
    expect(show(paras)).toBe('Rain hammered the shutters. Mara [-pushed through the crowd.-] {+shoved through.+}\nTobin waited by the fire.')
    expect(movedWords(paras)).toEqual({ cut: 4, added: 2 })
  })

  it('a paragraph cut whole shows struck through in its place; one added shows marked', () => {
    const paras = revisionParas('One.\n\nTwo goes.\n\nThree.', 'One.\n\nThree.\n\nFour comes.', true)
    expect(show(paras)).toBe('One.\n[-Two goes.-]\nThree.\n{+Four comes.+}')
  })

  it('words cut from the end of a paragraph stay at its end, never a paragraph of their own', () => {
    const old = 'One here. Two goes.\n\nThree stays. Four goes.\n\nFive.'
    const now = 'One here.\n\nThree stays.\n\nNow five.'
    // "Five." was a paragraph of its own: it stays one.
    expect(show(revisionParas(old, now, true))).toBe('One here. [-Two goes.-]\nThree stays. [-Four goes.-]\n[-Five.-] {+Now five.+}')
  })

  it('keeps italics apart from the same words in roman', () => {
    expect(encode('She said *no* twice.')).not.toBe(encode('She said no twice.'))
    const paras = revisionParas('She said *no* twice.', 'She said no twice.', true)
    expect(show(paras)).toBe('She said [-*no*-] {+no+} twice.')
  })

  it('shows a scene break kept, and none for one cut', () => {
    expect(show(revisionParas('A.\n\n* * *\n\nB.', 'A.\n\n* * *\n\nB.', true))).toBe('A.\n* * *\nB.')
    expect(show(revisionParas('A.\n\n* * *\n\nB.', 'A.\n\nB.', true))).toBe('A.\nB.')
  })

  it('while it is written, the old words it hasn’t reached are pending, not cut', () => {
    const old = 'Rain hammered the shutters. Mara pushed through the crowd. Tobin waited.'
    const paras = revisionParas(old, 'Rain hammered the', false)
    const pending = paras.flatMap((p) => (p === 'break' ? [] : p.filter((x) => x.kind === 'pending')))
    expect(pending.map((x) => x.text).join('')).toContain('Tobin waited.')
    expect(paras.flatMap((p) => (p === 'break' ? [] : p.filter((x) => x.kind === 'del')))).toEqual([])
    // Nothing yet: all of it pending.
    expect(show(revisionParas('One two.', '', false))).toBe('(…One two.…)')
  })

  it('stays quick on a long passage while it is written: only the start is compared', () => {
    const old = Array.from({ length: 2000 }, (_, i) => `word${i}`).join(' ')
    const t = performance.now()
    const paras = revisionParas(old, 'word0 word1 word2', false)
    expect(performance.now() - t).toBeLessThan(200)
    expect(show(paras).startsWith('word0 word1 word2 (…')).toBe(true)
  })
})
