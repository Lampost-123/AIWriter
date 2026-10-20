// The Plan hub's facts (2026-10-20): where the story has got to, what happens in its last scene (with no AI call), the
// plot threads open there, and the planned scenes the story has moved on from (the free card check), never a clash only
// between planned scenes. Worlds made in memory with invented words.
import { describe, expect, it } from 'vitest'
import { memoryWorld } from '../../../tests/unit/helpers'
import { setCard } from '../../../tests/unit/storyIndexWorld'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { aboutWhatIsWritten, cardSaysSomething, chapterOf, lastWrittenAt, planHubFacts, sceneOrder } from './facts'
import { planUpdateScenes } from './update'

/**
 * Ch 1: two scenes written (Day 3, morning and evening), the first setting up the plot thread "Who cut the bell rope";
 * Ch 2: one planned scene with nothing written, its card on Day 1 (before what was written) or as given.
 */
function world(planned: Parameters<typeof setCard>[2] = { when: 'Day 1, morning', goal: 'Wren climbs the tower.' }) {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const o = repo.getOutline(db, story.id)
  const ch1 = o.chapters[0].id
  const s1 = o.scenes[0].id
  const s2 = repo.createScene(db, ch1, { title: 'The ferry' }).id
  const ch2 = repo.createChapter(db, story.id, { title: 'The tower' }).id
  const s3 = repo.createScene(db, ch2, { title: 'Up the steps' }).id
  const wren = repo.createEntry(db, 'character', { name: 'Wren' }).id
  const rope = repo.createEntry(db, 'thread', { name: 'Who cut the bell rope' }).id
  repo.saveSceneText(db, s1, null, 'Wren found the bell rope cut clean, not rotted, and said nothing to anyone.')
  repo.saveSceneText(db, s2, null, 'Wren and Iska crossed on the late ferry, and the fog came down behind them.')
  setCard(db, s1, { povId: wren, when: 'Day 3, morning', setsUpIds: [rope] })
  setCard(db, s2, { povId: wren, when: 'Day 3, evening' })
  setCard(db, s3, { povId: wren, ...planned })
  return { db, storyId: story.id, ch1, ch2, s1, s2, s3, wren, rope }
}

describe('where the story has got to', () => {
  it('counts the scenes as the story index does, and finds the last one with words', () => {
    const w = world()
    const order = sceneOrder(w.db, w.storyId)
    expect(order.map((s) => s.label)).toEqual(['Ch 1, Sc 1', 'Ch 1, Sc 2', 'Ch 2, Sc 1'])
    expect(order[lastWrittenAt(order)].id).toBe(w.s2)
    expect(lastWrittenAt([{ words: 0 }, { words: 0 }])).toBe(-1)
    expect(chapterOf('Ch 12, Sc 3')).toBe('Ch 12')
    expect(chapterOf('the start')).toBe('')
  })

  it('says what happens in the last scene written from its summary, with no AI call', () => {
    const w = world()
    mem.putSummary(w.db, { level: 'scene', targetId: w.s2, text: 'Wren and Iska cross on the late ferry.', origin: 'ai' })
    const facts = planHubFacts(w.db, w.storyId)
    expect(facts.lastSceneId).toBe(w.s2)
    expect(facts.lastGist).toBe('Wren and Iska cross on the late ferry.')
  })

  it('offers the plot threads still open there, with the chapter each was opened in', () => {
    const w = world()
    const facts = planHubFacts(w.db, w.storyId)
    expect(facts.threads).toEqual([expect.objectContaining({ id: w.rope, name: 'Who cut the bell rope', since: 'Ch 1' })])
  })

  it('has no last scene, no gist and no drift for a story with nothing written', () => {
    const db = memoryWorld()
    const story = repo.listStories(db)[0]
    const facts = planHubFacts(db, story.id)
    expect(facts).toMatchObject({ lastSceneId: null, lastGist: '', drift: [] })
  })
})

describe('where the plan has drifted from what is written', () => {
  it('names a planned scene whose When is earlier than what was written, in the card check’s own words', () => {
    const w = world()
    const facts = planHubFacts(w.db, w.storyId)
    expect(facts.drift).toHaveLength(1)
    expect(facts.drift[0]).toMatchObject({ sceneId: w.s3, chapterId: w.ch2, label: 'Ch 2, Sc 1', title: 'Up the steps' })
    expect(facts.drift[0].text).toMatch(/^This card’s When \(“Day 1, morning”\) is earlier than Ch 1, Sc 2/)
  })

  it('says nothing when the plan still fits, or the card says nothing', () => {
    const fits = world({ when: 'Day 4, morning', goal: 'Wren climbs the tower.' })
    expect(planHubFacts(fits.db, fits.storyId).drift).toEqual([])
    const w = world({ when: 'Day 4, morning' })
    expect(planHubFacts(w.db, w.storyId).drift).toEqual([])
    expect(cardSaysSomething({})).toBe(false)
    expect(cardSaysSomething({ beats: ['', ' '] })).toBe(false)
    expect(cardSaysSomething({ goal: 'Wren climbs.' })).toBe(true)
  })

  it('counts a finding only when it names a written scene, or none', () => {
    const written = new Set(['Ch 1, Sc 1', 'Ch 1, Sc 2'])
    expect(aboutWhatIsWritten('This card’s When is earlier than Ch 1, Sc 2 (Day 3).', written)).toBe(true)
    expect(aboutWhatIsWritten('This card’s When is earlier than Ch 2, Sc 1 (Day 3).', written)).toBe(false)
    expect(aboutWhatIsWritten('This card says Wren is 40, but Wren’s entry says 19.', written)).toBe(true)
  })

  it('shows each card as it is before an update', () => {
    const w = world()
    expect(planUpdateScenes(w.db, [w.s3, 'gone'])).toEqual([
      { sceneId: w.s3, label: 'Ch 2, Sc 1', title: 'Up the steps', goal: 'Wren climbs the tower.', when: 'Day 1, morning', beats: [] }
    ])
  })
})
