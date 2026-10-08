// Chapter cards' rules (2026-10-08): which scene card parts follow the chapter card, and what a write does to them.
import { describe, expect, it } from 'vitest'
import type { ChapterCard, SceneCard } from './types'
import { cardLength, emptySceneCard } from './defaults'
import {
  adoptChapter,
  carryOf,
  chapterCardEmpty,
  cleanChapterCard,
  emptyChapterCard,
  followChapterPart,
  follows,
  resolveCardWrite,
  withCarry
} from './chapterCard'

const chapter = (more: Partial<ChapterCard> = {}): ChapterCard => ({
  ...emptyChapterCard(),
  povId: 'wren',
  presentIds: ['wren', 'odo'],
  locationId: 'lighthouse',
  when: 'Day 4, dawn',
  mood: 'Salt-stung and hushed',
  notes: 'Keep the foghorn in the background.',
  ...more
})

describe('a new scene', () => {
  it('starts with every part of its chapter card, following each', () => {
    const c = adoptChapter(emptySceneCard(), chapter({ targetWords: 2500, lengthSet: true }), 'new')
    expect(c.povId).toBe('wren')
    expect(c.presentIds).toEqual(['wren', 'odo'])
    expect(c.locationId).toBe('lighthouse')
    expect(c.when).toBe('Day 4, dawn')
    expect(c.mood).toBe('Salt-stung and hushed')
    expect(c.notes).toBe('Keep the foghorn in the background.')
    expect(cardLength(c)).toBe(2500)
    expect(c.inherits).toEqual({ pov: true, present: true, location: true, when: true, mood: true, length: true, notes: true })
  })

  it('follows an empty chapter card too, so a card set later reaches it; Auto stays an old-style Auto', () => {
    const c = adoptChapter(emptySceneCard(), emptyChapterCard(), 'new')
    expect({ ...c, inherits: undefined }).toEqual({ ...emptySceneCard(), inherits: undefined })
    expect(follows(c, 'when')).toBe(true)
    // A writer that sets only a word count (as cards made before Auto did) still sets the length.
    expect(cardLength({ ...c, targetWords: 600 })).toBe(600)
  })
})

describe('a chapter card change reaching its scenes', () => {
  it('changes the parts a scene follows, and never the parts it has as its own', () => {
    const scene: SceneCard = { ...adoptChapter(emptySceneCard(), chapter(), 'new'), mood: 'Giddy', goal: 'Light the lamp' }
    const own = { ...scene, inherits: { ...scene.inherits, mood: false } }
    const next = adoptChapter(own, chapter({ locationId: 'harbour', mood: 'Grey' }), 'follow')
    expect(next.locationId).toBe('harbour')
    expect(next.mood).toBe('Giddy')
    expect(next.goal).toBe('Light the lamp')
  })

  it('fills only the empty parts of a scene that never settled them (a card made before chapter cards)', () => {
    const old: SceneCard = { ...emptySceneCard(), povId: 'odo', when: 'Day 9, noon' }
    const next = adoptChapter(old, chapter(), 'follow')
    expect(next.povId).toBe('odo')
    expect(next.when).toBe('Day 9, noon')
    expect(next.locationId).toBe('lighthouse')
    expect(next.mood).toBe('Salt-stung and hushed')
    expect(next.inherits).toEqual({ present: true, location: true, mood: true, notes: true })
    // Nothing to take: an empty chapter card leaves it as it was.
    expect(adoptChapter(old, emptyChapterCard(), 'follow')).toEqual(old)
  })
})

describe('writing a scene card', () => {
  const ch = chapter()
  const stored = adoptChapter(emptySceneCard(), ch, 'new')

  it('keeps a part following when the write leaves it as it was', () => {
    const out = resolveCardWrite(stored, { ...stored, goal: 'Find the keeper' }, ch)
    expect(out.inherits).toEqual(stored.inherits)
    expect(out.goal).toBe('Find the keeper')
  })

  it('makes a part the scene’s own once it changes to something that isn’t the chapter’s', () => {
    const out = resolveCardWrite(stored, { ...stored, when: 'Day 4, dusk' }, ch)
    expect(out.when).toBe('Day 4, dusk')
    expect(out.inherits?.when).toBe(false)
    expect(out.inherits?.pov).toBe(true)
  })

  it('treats the characters present in another order as the same', () => {
    const out = resolveCardWrite(stored, { ...stored, presentIds: ['odo', 'wren'] }, ch)
    expect(out.inherits?.present).toBe(true)
  })

  it('keeps the stored marks for a writer that gives none (the interview, ideas, Ask, an old card)', () => {
    const { inherits: _gone, ...bare } = stored
    const out = resolveCardWrite(stored, { ...bare, mood: 'Furious' } as SceneCard, ch)
    expect(out.inherits?.mood).toBe(false)
    expect(out.inherits?.location).toBe(true)
  })

  it('a stale write of an old chapter value becomes the scene’s own (the window reloads before it can happen)', () => {
    const moved = adoptChapter(stored, chapter({ when: 'Day 5, dawn' }), 'follow')
    const out = resolveCardWrite(moved, { ...stored }, chapter({ when: 'Day 5, dawn' }))
    expect(out.when).toBe('Day 4, dawn')
    expect(out.inherits?.when).toBe(false)
  })

  it('“Use chapter’s” follows the chapter again, with its value', () => {
    const own = resolveCardWrite(stored, { ...stored, locationId: 'cellar' }, ch)
    const back = followChapterPart(own, ch, 'location')
    expect(back.locationId).toBe('lighthouse')
    const saved = resolveCardWrite(own, back, ch)
    expect(saved.inherits?.location).toBe(true)
    expect(saved.locationId).toBe('lighthouse')
  })
})

describe('the chapter card itself', () => {
  it('reads anything damaged as empty, and a length as cardLength does', () => {
    expect(cleanChapterCard('nonsense')).toEqual(emptyChapterCard())
    expect(chapterCardEmpty(cleanChapterCard({ povId: 7, presentIds: 'x', when: 3 }))).toBe(true)
    expect(cleanChapterCard({ targetWords: 600 }).lengthSet).toBe(true)
    expect(cleanChapterCard({ targetWords: 1500 }).lengthSet).toBe(false)
    expect(chapterCardEmpty(chapter())).toBe(false)
  })

  it('carries a scene’s parts and marks back for an Undo, leaving its other parts alone', () => {
    const before = adoptChapter({ ...emptySceneCard(), goal: 'Climb' }, chapter(), 'new')
    const after = { ...adoptChapter(before, chapter({ mood: 'Bright' }), 'follow'), goal: 'Climb higher' }
    const back = withCarry(after, carryOf(before))
    expect(back.mood).toBe('Salt-stung and hushed')
    expect(back.goal).toBe('Climb higher')
    expect(back.inherits).toEqual(before.inherits)
  })
})
