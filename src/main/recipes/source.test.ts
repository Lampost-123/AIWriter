import { describe, expect, it } from 'vitest'
import type { ImportPlan } from '@shared/contracts/importing'
import { guessRecipe, pieceChars, recipeCost } from './estimate'
import { chapterSpans, chapterStats, chapterText, pacingTable, piecesOf, sourceFromPlan, sourceWords } from './source'

const run = (text: string): { text: string }[] => [{ text }]
// A made-up story, written for these tests.
const PLAN: ImportPlan = {
  title: 'The Ferry at Varn',
  acts: [],
  chapters: [
    {
      title: 'Chapter One',
      act: null,
      scenes: [
        { title: 'Scene 1', paragraphs: [run('Mara waited on the quay.'), [{ text: '“You are late,” ' }, { text: 'said Tobin.', italic: true }]] },
        { title: 'Scene 2', paragraphs: [run('The ferry came in at dusk.')] }
      ]
    },
    { title: 'Empty', act: null, scenes: [{ title: 'Scene 1', paragraphs: [] }] },
    { title: 'Chapter Two', act: null, scenes: [{ title: 'Scene 1', paragraphs: [run('They crossed the bay together at last, slowly.')] }] }
  ]
}

describe('the story kept with a recipe', () => {
  const src = sourceFromPlan(PLAN)

  it('keeps the plain words of each scene, and leaves out empty chapters', () => {
    expect(src.title).toBe('The Ferry at Varn')
    expect(src.chapters.map((c) => c.title)).toEqual(['Chapter One', 'Chapter Two'])
    expect(src.chapters[0].scenes[0]).toEqual(['Mara waited on the quay.', '“You are late,” said Tobin.'])
    expect(chapterText(src.chapters[0])).toBe('Mara waited on the quay.\n\n“You are late,” said Tobin.\n\n* * *\n\nThe ferry came in at dusk.')
  })

  it('counts words, scenes and how much is dialogue', () => {
    const st = chapterStats(src.chapters[0])
    expect(st).toMatchObject({ words: 16, scenes: 2 })
    expect(st.dialogue).toBeCloseTo(3 / 16)
    expect(sourceWords(src)).toBe(24)
  })

  it('says how far through the story each chapter runs, for the pacing', () => {
    expect(chapterSpans(src)).toEqual([
      { from: 0, to: 67 },
      { from: 67, to: 100 }
    ])
    expect(pacingTable(src).split('\n')[1]).toBe('Chapter 2 (67%–100%): 8 words, 1 scene, about 0% dialogue')
  })

  it('cuts a long chapter between paragraphs, then sentences', () => {
    const para = 'One sentence here. Another one there. '.repeat(20).trim()
    const text = [para, para, 'Short.'].join('\n\n')
    const pieces = piecesOf(text, 300)
    expect(pieces.every((p) => p.length <= 300)).toBe(true)
    expect(pieces.join(' ').replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' '))
    expect(piecesOf('Short chapter.', 300)).toEqual(['Short chapter.'])
  })
})

describe('what making a recipe costs', () => {
  it('reads more pieces for a smaller model, and says nothing without prices', () => {
    const small = guessRecipe([40_000, 40_000], { contextLength: 8000 }, 'off')
    const big = guessRecipe([40_000, 40_000], { contextLength: 200_000 }, 'off')
    expect(pieceChars({ contextLength: 8000 })).toBeLessThan(pieceChars({ contextLength: 200_000 }))
    expect(small.input).toBeGreaterThan(big.input)
    expect(guessRecipe([40_000], { contextLength: 32_000 }, 'high').output).toBeGreaterThan(guessRecipe([40_000], { contextLength: 32_000 }, 'off').output)
    expect(recipeCost(big, { promptPrice: null, completionPrice: 0.00001 })).toBeNull()
    expect(recipeCost({ input: 1000, output: 100 }, { promptPrice: 0.000001, completionPrice: 0.00001 })).toBeCloseTo(0.002)
  })
})
