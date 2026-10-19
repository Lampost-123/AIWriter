import { describe, expect, it } from 'vitest'
import { hasSentence, keepKey, keepsIn, likeness, missingKeeps, restoreKeeps, sentencesOf } from './revise'

const PASSAGE = [
  'Rain hammered the shutters. Mr. Hale wiped the bar. “Go!” she said, and he went.',
  '* * *',
  'Mara counted the coins… Then she counted them again. *Not enough,* she thought.'
].join('\n\n')

describe('the sentences of a passage', () => {
  it('splits paragraphs into sentences, word for word, leaving out scene breaks', () => {
    const paras = sentencesOf(PASSAGE)
    expect(paras.map((p) => p.map((s) => s.text))).toEqual([
      ['Rain hammered the shutters.', 'Mr. Hale wiped the bar.', '“Go!” she said, and he went.'],
      ['Mara counted the coins…', 'Then she counted them again.', '*Not enough,* she thought.']
    ])
    // Each sentence is where it says it is.
    for (const s of paras.flat()) expect(PASSAGE.slice(s.start, s.end)).toBe(s.text)
  })

  it('reads a paragraph with no full stop as one sentence', () => {
    expect(sentencesOf('She waited').flat().map((s) => s.text)).toEqual(['She waited'])
    expect(sentencesOf('   ')).toEqual([])
  })
})

describe('word for word', () => {
  it('lets spacing and the shapes of quotation marks go', () => {
    expect(keepKey('  “Go!”   she said. ')).toBe('"Go!" she said.')
    expect(hasSentence('He said: "Go!"\nshe said. Then.', '“Go!” she said.')).toBe(true)
    expect(hasSentence('He said: Go! she said.', '“Go!” she said.')).toBe(false)
  })

  it('keeps only the kept sentences a passage has, once each, in its order', () => {
    expect(keepsIn(PASSAGE, ['*Not enough,* she thought.', 'Rain hammered the shutters.', 'Gone now.', 'Rain hammered the shutters.'])).toEqual([
      'Rain hammered the shutters.',
      '*Not enough,* she thought.'
    ])
  })

  it('says which kept sentences a revision changed', () => {
    expect(missingKeeps('Rain hammered the shutters. Then quiet.', ['Rain hammered the shutters.', 'Mr. Hale wiped the bar.'])).toEqual([
      'Mr. Hale wiped the bar.'
    ])
  })
})

describe('putting kept sentences back', () => {
  const keeps = ['Rain hammered the shutters.', '“Go!” she said, and he went.']

  it('leaves a revision that kept them all as it is', () => {
    const revised = 'Rain hammered the shutters. Hale wiped. “Go!” she said, and he went.'
    expect(restoreKeeps(revised, keeps)).toEqual({ text: revised, restored: 0, missing: [] })
  })

  it('puts a reworded kept sentence back in place of the sentence most like it', () => {
    const revised = 'Rain beat at the shutters. Hale wiped the bar. “Go!” she said, and he went.'
    const out = restoreKeeps(revised, keeps)
    expect(out.text).toBe('Rain hammered the shutters. Hale wiped the bar. “Go!” she said, and he went.')
    expect(out).toMatchObject({ restored: 1, missing: [] })
    expect(likeness('Rain beat at the shutters.', 'Rain hammered the shutters.')).toBeGreaterThan(0.5)
  })

  it('puts one left out back after the kept sentence before it, or before the one after it', () => {
    const after = restoreKeeps('Rain hammered the shutters. Something else entirely happened here.', keeps)
    expect(after.text).toBe('Rain hammered the shutters. “Go!” she said, and he went. Something else entirely happened here.')
    const before = restoreKeeps('Nothing alike at all, truly. “Go!” she said, and he went.', keeps)
    expect(before.text).toBe('Nothing alike at all, truly. Rain hammered the shutters. “Go!” she said, and he went.')
    expect(before.restored).toBe(1)
  })

  it('says a kept sentence is missing when there is nowhere it can sensibly go', () => {
    const out = restoreKeeps('Entirely different words now.', ['Rain hammered the shutters.'])
    expect(out).toEqual({ text: 'Entirely different words now.', restored: 0, missing: ['Rain hammered the shutters.'] })
  })

  it('never takes one kept sentence for another', () => {
    const out = restoreKeeps('Rain hammered the shutters.', ['Rain hammered the shutters.', 'Rain hammered the shutters hard.'])
    expect(out.text).toBe('Rain hammered the shutters. Rain hammered the shutters hard.')
    expect(out.missing).toEqual([])
  })
})
