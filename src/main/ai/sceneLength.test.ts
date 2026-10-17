// A scene's aim when a draft doesn't say (shared/lengths.ts): its card's length, else its share of its chapter's
// target, else the default scene length in Settings › Writing, else Auto.
import { describe, expect, it } from 'vitest'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import { gatherContextInput, sceneLengthFor } from './gather'

const PREFS = { spelling: 'UK' as const, pov: '', tense: '', voiceNotes: '', avoidWords: [] }

function chapter() {
  const db = memoryWorld()
  const [story] = repo.listStories(db)
  const outline = repo.getOutline(db, story.id)
  const chapterId = outline.chapters[0].id
  const s1 = outline.scenes[0].id
  const s2 = repo.createScene(db, chapterId, { title: 'Two' }).id
  const s3 = repo.createScene(db, chapterId, { title: 'Three' }).id
  return { db, chapterId, s1, s2, s3 }
}

describe("a scene's length when the draft doesn't say", () => {
  it('is Auto with nothing set anywhere', () => {
    const { db, s1 } = chapter()
    expect(sceneLengthFor(db, s1, PREFS)).toBeNull()
  })

  it('takes the default scene length from Settings', () => {
    const { db, s1 } = chapter()
    expect(sceneLengthFor(db, s1, { ...PREFS, sceneLength: 2500 })).toBe(2500)
  })

  it("shares out the chapter's target before the default, leaving what scenes with their own length take", () => {
    const { db, chapterId, s1, s2 } = chapter()
    repo.saveChapterCard(db, chapterId, { ...repo.getChapterCard(db, chapterId), totalWords: 7000 })
    repo.updateSceneCard(db, s2, { ...repo.getScene(db, s2).card, targetWords: 1000, lengthSet: true })
    expect(sceneLengthFor(db, s1, { ...PREFS, sceneLength: 2500 })).toBe(3000)
    expect(sceneLengthFor(db, s2, PREFS)).toBe(1000)
  })

  it("uses the default chapter length in Settings when the chapter card has none", () => {
    const { db, s1 } = chapter()
    expect(sceneLengthFor(db, s1, { ...PREFS, chapterLength: 9000 })).toBe(3000)
  })

  it("goes into the briefing for a draft on Auto, but never over a draft's own length", () => {
    const { db, s1 } = chapter()
    const prefs = { ...PREFS, sceneLength: 2200 }
    const opts = (o: { targetWords: number | null } | undefined) => gatherContextInput(db, s1, o, { prefs, contextLength: null, creativity: 'balanced' }).options
    expect(opts(undefined).targetWords).toBe(2200)
    expect(opts({ targetWords: null }).targetWords).toBe(2200)
    expect(opts({ targetWords: 900 }).targetWords).toBe(900)
  })

  it("passes over the card's own length for a draft on Auto by choice, to the chapter's share or the default", () => {
    const { db, s1 } = chapter()
    repo.updateSceneCard(db, s1, { ...repo.getScene(db, s1).card, targetWords: 4000, lengthSet: true })
    const opts = (prefs: typeof PREFS & { sceneLength?: number }) => gatherContextInput(db, s1, { targetWords: null }, { prefs, contextLength: null, creativity: 'balanced' }).options
    expect(opts(PREFS).targetWords).toBeNull()
    expect(opts({ ...PREFS, sceneLength: 1800 }).targetWords).toBe(1800)
    expect(gatherContextInput(db, s1, undefined, { prefs: PREFS, contextLength: null, creativity: 'balanced' }).options.targetWords).toBe(4000)
  })
})
