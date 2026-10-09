import { describe, expect, it } from 'vitest'
import { CRITIQUE_CATEGORIES } from '@shared/contracts/critique'
import {
  CATEGORY_WORDS,
  askWords,
  changedWords,
  critiqueHeadline,
  quoted,
  readingWords,
  rewriteDirection,
  shortenedWords
} from './critiqueLogic'

describe('the Critique tab’s words', () => {
  const at = '2026-10-09T10:00:00.000Z'
  const now = Date.parse(at) + 5 * 60_000

  it('says when it was critiqued and how many notes', () => {
    expect(critiqueHeadline({ at, notes: [] }, now)).toBe('Critiqued 5 minutes ago · no notes')
    expect(critiqueHeadline({ at, notes: [{}] as never }, now)).toBe('Critiqued 5 minutes ago · 1 note')
    expect(critiqueHeadline({ at, notes: [{}, {}, {}] as never }, now)).toBe('Critiqued 5 minutes ago · 3 notes')
  })

  it('names the scene or the chapter in its buttons and lines', () => {
    expect(askWords('scene', false)).toBe('Critique scene')
    expect(askWords('chapter', false)).toBe('Critique chapter')
    expect(askWords('scene', true)).toBe('Critique again')
    expect(changedWords('scene')).toBe('The scene changed since this critique.')
    expect(changedWords('chapter')).toBe('The chapter changed since this critique.')
    expect(readingWords('chapter')).toBe('Reading the chapter…')
    expect(shortenedWords('scene')).toMatch(/^This scene was too long/)
    expect(shortenedWords('chapter')).toMatch(/^This chapter was too long/)
  })

  it('has words for every category', () => {
    for (const c of CRITIQUE_CATEGORIES) expect(CATEGORY_WORDS[c]).toBeTruthy()
  })

  it('tells Rewrite what the note says, and to keep what happens', () => {
    const d = rewriteDirection({ category: 'show-tell', title: 'Telling the fear', suggestion: 'Show it in what she does with her hands.' })
    expect(d).toBe(
      "An editor's note on these words (show and tell): Telling the fear. Show it in what she does with her hands. Rewrite them so they act on the note. Keep what happens, who is there and what they say the same, in the scene's own voice."
    )
    // Never so long that the AI tools cut it short.
    expect(rewriteDirection({ category: 'prose', title: 'Long', suggestion: 'x '.repeat(2000) }).length).toBeLessThanOrEqual(1800)
    // A note's own words never say they "must change" (that asks the fake writer for a first answer unchanged).
    expect(d).not.toMatch(/must change/)
  })

  it('puts the words in quotation marks unless they bring their own', () => {
    expect(quoted('She left.')).toBe('“She left.”')
    expect(quoted('“Go,” he said.')).toBe('“Go,” he said.')
  })
})
