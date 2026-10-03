import { describe, expect, it } from 'vitest'
import type { CatchUpProgress } from '@shared/contracts/importing'
import { catchUpWords, costWords, dollars } from './importLogic'

describe('the words about the import catch-up', () => {
  it('says what it would cost', () => {
    expect(dollars(1.403)).toBe('About $1.40')
    expect(dollars(0.004)).toBe('Less than a cent')
    expect(dollars(1234.5)).toBe('About $1,235')
    expect(dollars(null)).toBeNull()
    const e = { storyId: 's', scenes: 96, chapters: 24, words: 150000, cost: 1.4, model: 'Claude Haiku', problem: null }
    expect(costWords(e)).toBe('About $1.40 with Claude Haiku, for 96 scenes in 24 chapters.')
    expect(costWords({ ...e, cost: null, scenes: 1, chapters: 1 })).toBe('The cost isn’t known for Claude Haiku. It reads 1 scene in 1 chapter.')
  })

  it('says how far it has got', () => {
    const run: CatchUpProgress = { storyId: 's', storyTitle: 'T', chapter: 3, chapters: 24, read: 9, scenes: 96, status: 'reading', error: null, waiting: 0 }
    expect(catchUpWords(run)).toBe('Reading chapter 3 of 24')
    expect(catchUpWords({ ...run, status: 'stopping' })).toBe('Stopping…')
    expect(catchUpWords({ ...run, status: 'paused' })).toBe('Building the memory has paused')
  })
})
