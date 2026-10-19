// What the planner gets at no cost (overhaul, "Plan before writing, done properly", step 1): everyone in the scene as the
// story index has them, what happened in the scenes of the last two chapters, the open threads; the index brought up to
// date first; nothing Adam kept out. A world made in memory with invented words.
import { describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import { defaultWritingPrefs } from '@shared/defaults'
import { memoryWorld } from '../../../tests/unit/helpers'
import { keepStages, person, setCard, stage } from '../../../tests/unit/storyIndexWorld'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { gatherContextInput } from '../ai/gather'
import { planCore } from './core'

function world() {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const o = repo.getOutline(db, story.id)
  const ch2 = repo.createChapter(db, story.id, { title: 'Two' }).id
  const ch3 = repo.createChapter(db, story.id, { title: 'Three' }).id
  const s1 = o.scenes[0].id
  const s2 = repo.createScene(db, ch2, { title: 'Market' }).id
  const s3 = repo.createScene(db, ch3, { title: 'Seal' }).id
  const s4 = repo.createScene(db, ch3, { title: 'Now' }).id
  const mara = repo.createEntry(db, 'character', { name: 'Mara Venn' }).id
  const tobin = repo.createEntry(db, 'character', { name: 'Tobin' }).id
  const gale = repo.createEntry(db, 'character', { name: 'Gale' }).id
  const seal = repo.createEntry(db, 'thread', { name: 'The stolen seal' }).id
  repo.saveSceneText(db, s1, null, 'Mara set the lantern on the table.')
  repo.saveSceneText(db, s2, null, 'Mara bought bread. Gale watched her from the stall.')
  repo.saveSceneText(db, s3, null, 'Mara found the strongbox empty. Tobin swore.')
  setCard(db, s1, { povId: mara, presentIds: [], when: 'Day 1' })
  setCard(db, s2, { povId: mara, presentIds: [gale], when: 'Day 2' })
  setCard(db, s3, { povId: mara, presentIds: [tobin], when: 'Day 3', setsUpIds: [seal] })
  setCard(db, s4, { povId: mara, presentIds: [tobin], when: 'Day 3, later', beats: ['Mara asks Tobin about the seal'] })
  mem.putSummary(db, { level: 'scene', targetId: s1, text: 'Mara waits at the Swan.', origin: 'text' })
  mem.putSummary(db, { level: 'scene', targetId: s2, text: 'Gale watches Mara at the market.', origin: 'text' })
  mem.putSummary(db, { level: 'scene', targetId: s3, text: 'The seal is gone from the strongbox.', origin: 'text' })
  mem.insertChange(db, { entryId: seal, anchor: 'scene', sceneId: s3, kind: 'thread', payload: { status: 'open', note: 'The seal is missing' }, origin: 'text' })
  keepStages(db, {
    [s3]: stage(s3, [person('Mara Venn', { where: 'by the strongbox', clothes: [{ name: 'grey coat', state: 'on' }] })], {
      'mara venn|where': 'found the strongbox',
      'mara venn|clothes:grey coat': 'found the strongbox empty'
    })
  })
  const input = gatherContextInput(db, s4, { direction: '', targetWords: 400, creativity: 'balanced' }, { prefs: defaultWritingPrefs(), contextLength: 64_000, creativity: 'balanced' })
  return { db, input, s4, mara, tobin, gale, storyId: story.id }
}

describe('the core the planner gets at no cost', () => {
  it('everyone in the scene as things stand, what happened in the last two chapters, and the open threads', () => {
    const w = world()
    const core = planCore(w.db, w.input, w.s4, { carryingOn: false, hidden: new Set<ID>() })!
    expect(core).toMatchObject({ storyId: w.storyId, asItBegins: true })
    expect(core.people).toContain('Mara Venn: by the strongbox (since Ch 3, Sc 1)')
    expect(core.people).toContain('Mara Venn: wearing grey coat (since Ch 3, Sc 1)')
    expect(core.known['mara venn']).toEqual({ where: ['by the strongbox'], wearing: ['grey coat'] })
    // Chapter 1 is three chapters back: only chapters 2 and 3.
    expect(core.recent).toEqual(['Ch 2, Sc 1: Gale watches Mara at the market.', 'Ch 3, Sc 1: The seal is gone from the strongbox.'])
    expect(core.threads[0]).toMatch(/^The stolen seal \(open since Ch 3, Sc 1/)
  })

  it('never names what Adam kept out of the scene', () => {
    const w = world()
    const core = planCore(w.db, w.input, w.s4, { carryingOn: false, hidden: new Set([w.gale]) })!
    expect(core.recent).toEqual(['Ch 3, Sc 1: The seal is gone from the strongbox.'])
  })
})
