import { describe, expect, it } from 'vitest'
import { chapterShare, chapterTarget, cleanPrefsTargets, cleanTarget, MAX_SHARE, MIN_SHARE, sceneAim, SCENE_LENGTH_LIMITS } from './lengths'
import { cleanChapterCard, chapterCardEmpty, emptyChapterCard } from './chapterCard'

describe('word targets', () => {
  it('tidies a typed or stored word count', () => {
    expect(cleanTarget('2000', SCENE_LENGTH_LIMITS)).toBe(2000)
    expect(cleanTarget(1999.6, SCENE_LENGTH_LIMITS)).toBe(2000)
    expect(cleanTarget('', SCENE_LENGTH_LIMITS)).toBeNull()
    expect(cleanTarget(null, SCENE_LENGTH_LIMITS)).toBeNull()
    expect(cleanTarget(50, SCENE_LENGTH_LIMITS)).toBeNull()
    expect(cleanTarget('lots', SCENE_LENGTH_LIMITS)).toBeNull()
    expect(cleanPrefsTargets({ sceneLength: 2500, chapterLength: 'x' as unknown as number })).toEqual({ sceneLength: 2500, chapterLength: null })
  })

  it("takes the chapter card's target before the default in Settings", () => {
    expect(chapterTarget({ totalWords: 6000 }, { chapterLength: 9000 })).toBe(6000)
    expect(chapterTarget({}, { chapterLength: 9000 })).toBe(9000)
    expect(chapterTarget(null, { chapterLength: null })).toBeNull()
  })

  it('shares what the scenes with their own length leave between the scenes on Auto', () => {
    // Four scenes: this one, one set to 1,000, two on Auto: (6,000 - 1,000) / 3.
    expect(chapterShare(6000, [1000, null, null])).toBe(1667)
    expect(chapterShare(6000, [])).toBe(6000)
    expect(chapterShare(2000, [2500])).toBeNull()
    expect(chapterShare(1000, [null, null, null, null, null])).toBe(MIN_SHARE)
    expect(chapterShare(100_000, [])).toBe(MAX_SHARE)
  })

  it("aims for the card's length, then the chapter's share, then the default, else Auto", () => {
    const prefs = { sceneLength: 2500 }
    expect(sceneAim({ cardWords: 900, chapterTotal: 6000, others: [null], prefs })).toBe(900)
    expect(sceneAim({ cardWords: null, chapterTotal: 6000, others: [null], prefs })).toBe(3000)
    expect(sceneAim({ cardWords: null, chapterTotal: null, others: [], prefs })).toBe(2500)
    expect(sceneAim({ cardWords: null, chapterTotal: 1000, others: [4000], prefs })).toBe(2500)
    expect(sceneAim({ cardWords: null, chapterTotal: null, others: [], prefs: { sceneLength: null } })).toBeNull()
  })

  it("keeps a chapter card's target, and a card with only a target is not empty", () => {
    expect(cleanChapterCard({ totalWords: 8000 }).totalWords).toBe(8000)
    expect('totalWords' in cleanChapterCard({ totalWords: 5 })).toBe(false)
    expect('totalWords' in cleanChapterCard({})).toBe(false)
    expect(chapterCardEmpty(emptyChapterCard())).toBe(true)
    expect(chapterCardEmpty({ ...emptyChapterCard(), totalWords: 8000 })).toBe(false)
  })
})
