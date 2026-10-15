import { describe, expect, it } from 'vitest'
import { howWords, learnedWords, sinceWords } from './knowWords'

const names: Record<string, string> = { ash: 'Ash Penrose', mara: 'Mara' }
const nameOf = (id: string): string | null => names[id] ?? null

describe('how someone learned something, in plain words', () => {
  it('says each way, with who told them when it is known', () => {
    expect(howWords({ how: 'saw' }, nameOf)).toBe('saw it')
    expect(howWords({ how: 'told', from: 'ash' }, nameOf)).toBe('heard it from Ash Penrose')
    expect(howWords({ how: 'told' }, nameOf)).toBe('was told')
    expect(howWords({ how: 'told', from: 'gone' }, nameOf)).toBe('was told')
    expect(howWords({ how: 'overheard', from: 'mara' }, nameOf)).toBe('overheard Mara')
    expect(howWords({ how: 'overheard' }, nameOf)).toBe('overheard it')
    expect(howWords({ how: 'read' }, nameOf)).toBe('read it')
    expect(howWords({ how: 'guessed' }, nameOf)).toBe('guessed it')
    expect(howWords({ how: 'said' }, nameOf)).toBe('said it')
  })

  it('says nothing when the words never said how', () => {
    expect(howWords({}, nameOf)).toBe('')
    expect(howWords(null, nameOf)).toBe('')
  })
})

describe('since when', () => {
  it('names the place, shortened when asked, or says from the start', () => {
    expect(sinceWords({ at: 4, where: 'Book 1, Ch 2, Sc 3' })).toBe('since Book 1, Ch 2, Sc 3')
    expect(sinceWords({ at: 4, where: 'Book 1, Ch 2, Sc 3' }, (w) => w.replace('Book 1, ', ''))).toBe('since Ch 2, Sc 3')
    expect(sinceWords({ at: 1, where: 'the start of Book 2' })).toBe('since the start of Book 2')
    expect(sinceWords({ at: -1, where: '' })).toBe('from the start')
    expect(sinceWords(null)).toBe('')
  })

  it('both together, for a line of the briefing or a row on the page', () => {
    expect(learnedWords({ at: 4, where: 'Ch 2, Sc 3', how: 'told', from: 'ash' }, nameOf)).toBe('since Ch 2, Sc 3; heard it from Ash Penrose')
    expect(learnedWords({ at: -1, where: '' }, nameOf)).toBe('from the start')
    expect(learnedWords({ at: 4, where: 'Ch 2, Sc 3', how: 'saw' }, nameOf, undefined, ' · ')).toBe('since Ch 2, Sc 3 · saw it')
    expect(learnedWords(null, nameOf)).toBe('')
  })
})
