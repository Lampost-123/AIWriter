import { describe, expect, it } from 'vitest'
import type { Summary } from '@shared/types'
import { summaryNote } from './summaryText'

const summary = (origin: Summary['origin'], stale: boolean): Summary => ({
  level: 'chapter',
  targetId: 'c1',
  text: 'Tobin takes the ferry north.',
  origin,
  stale,
  updatedAt: '2026-10-02T10:00:00Z'
})

describe('summaryNote', () => {
  it('says nothing when there is no summary', () => {
    expect(summaryNote(null, 'scene')).toBe('')
  })

  it("says when the words are Adam's own, and that they are kept", () => {
    expect(summaryNote(summary('adam', false), 'chapter')).toMatch(/^Your own words\. AI Write won't replace them\.$/)
    expect(summaryNote(summary('adam', true), 'chapter')).toBe('Your own words. The chapter has changed since you wrote them.')
  })

  it('says when AI Write wrote it, and that it keeps up by itself', () => {
    expect(summaryNote(summary('text', false), 'scene')).toBe('Written by AI Write. Edit it to make it your own.')
    expect(summaryNote(summary('text', true), 'story')).toBe(
      "Written by AI Write. It catches up with the story's latest changes by itself."
    )
  })
})
