// "Update the plan" (the Plan hub, 2026-10-20): the drifting cards written again, each with what no longer fits, after how
// the last scene written ends; only scenes still planned after it; one card each from the fake provider, nothing changed.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AppEvents } from '@shared/api'
import type { ModelChoice } from '@shared/types'
import * as repo from '../db/repo'
import * as gens from '../db/generations'
import type { JobModel } from '../ai/jobModel'
import type { Emit } from '../ai/tasks'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import { memoryWorld } from '../../../tests/unit/helpers'
import { setCard } from '../../../tests/unit/storyIndexWorld'
import { MARKER } from '../outline/prompts'
import { startPlanUpdate } from './update'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0 })
})
afterAll(() => fake.close())

const model = (o: Partial<ModelChoice> = {}): JobModel => ({
  job: 'chat',
  target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: 'k' },
  choice: { providerId: 'p1', modelId: 'fake/writer', label: 'Fake', contextLength: 32000, promptPrice: null, completionPrice: null, ...o },
  thinking: 'off'
})

describe('Update the plan', () => {
  it('writes the drifting cards again, told what no longer fits; nothing on the cards changes', async () => {
    const db = memoryWorld()
    const story = repo.listStories(db)[0]
    const o = repo.getOutline(db, story.id)
    const s1 = o.scenes[0].id
    const ch2 = repo.createChapter(db, story.id, { title: 'The tower' }).id
    const s2 = repo.createScene(db, ch2, { title: 'Up the steps' }).id
    repo.saveSceneText(db, s1, null, 'Wren crossed on the late ferry, and the fog came down behind her.')
    setCard(db, s1, { when: 'Day 3, evening' })
    setCard(db, s2, { when: 'Day 1, morning', goal: 'Wren climbs the tower.', beats: ['She counts the steps'] })
    const events: { name: keyof AppEvents }[] = []
    const emit: Emit = (name) => void events.push({ name })
    const { generationId } = startPlanUpdate({ db, model: model(), emit }, { taskId: 'u1', storyId: story.id, sceneIds: [s2, s1] })
    const t0 = Date.now()
    while (!events.some((e) => e.name === 'task:done')) {
      if (Date.now() - t0 > 10_000) throw new Error('The job never finished')
      await new Promise((r) => setTimeout(r, 10))
    }
    const record = gens.getGeneration(db, generationId)
    expect(record.messages[0].content.startsWith(`${MARKER} update`)).toBe(true)
    const user = record.messages[1].content
    // Only the planned scene after the last one written; the written one is left out.
    expect(user).toContain('Scene 1 of 1: Ch 2, Sc 1\n### Scene: Up the steps\nWhen: Day 1, morning\nSummary: Wren climbs the tower.\n- She counts the steps')
    expect(user).toMatch(/What no longer fits: This card’s When \(“Day 1, morning”\) is earlier than Ch 1, Sc 1/)
    expect(user).toContain('## How the last scene written ends (Ch 1, Sc 1)\nWren crossed on the late ferry')
    expect(record.direction).toBe('Update the plan: Ch 2, Sc 1')
    expect(record.response).toContain('### Scene: Up the steps\nWhen: Day 4, morning')
    // Nothing changes until Adam keeps it (the window does that).
    expect(repo.getScene(db, s2).card.when).toBe('Day 1, morning')
  })

  it('says so in plain words when nothing asked for is still planned', () => {
    const db = memoryWorld()
    const story = repo.listStories(db)[0]
    expect(() => startPlanUpdate({ db, model: model(), emit: () => undefined }, { taskId: 'u2', storyId: story.id, sceneIds: ['gone'] })).toThrow(
      'Those scenes aren’t planned any more'
    )
  })
})

describe('Fill in the empty cards (2026-10-20)', () => {
  it('plans only the cards still empty, wherever they are, with Adam’s words; nothing changes by itself', async () => {
    const db = memoryWorld()
    const story = repo.listStories(db)[0]
    const o = repo.getOutline(db, story.id)
    const s1 = o.scenes[0].id
    const s2 = repo.createScene(db, o.chapters[0].id, { title: 'The keeper’s vigil' }).id
    const s3 = repo.createScene(db, o.chapters[0].id, { title: 'Planned already' }).id
    repo.saveSceneText(db, s1, null, 'Wren crossed on the late ferry, and the fog came down behind her.')
    setCard(db, s1, { goal: 'Wren crosses.' })
    setCard(db, s2, { when: 'Day 5, dusk' })
    setCard(db, s3, { goal: 'Already has a goal.' })
    const events: { name: keyof AppEvents }[] = []
    const { generationId } = startPlanUpdate(
      { db, model: model(), emit: (name) => void events.push({ name }) },
      { taskId: 'f1', storyId: story.id, sceneIds: [s3, s2, s1], mode: 'fill', direction: 'Wren keeps watch alone.' }
    )
    const t0 = Date.now()
    while (!events.some((e) => e.name === 'task:done')) {
      if (Date.now() - t0 > 10_000) throw new Error('The job never finished')
      await new Promise((r) => setTimeout(r, 10))
    }
    const record = gens.getGeneration(db, generationId)
    expect(record.messages[0].content.startsWith(`${MARKER} update fill`)).toBe(true)
    expect(record.messages[0].content).toContain('What the author wants comes first')
    const user = record.messages[1].content
    expect(user).toContain('## The scenes to plan\nScene 1 of 1: Ch 1, Sc 2\n### Scene: The keeper’s vigil\nWhen: Day 5, dusk\nWhat its card needs:')
    expect(user).toContain('## What the author wants (make it happen)\nWren keeps watch alone.')
    expect(user).not.toContain('Planned already\nWhen')
    expect(record.direction).toBe('Wren keeps watch alone.')
    expect(record.response).toContain('### Scene: The keeper’s vigil')
    expect(repo.getScene(db, s2).card.goal).toBe('')
    expect(() => startPlanUpdate({ db, model: model(), emit: () => undefined }, { taskId: 'f2', storyId: story.id, sceneIds: [s3], mode: 'fill' })).toThrow(
      'Those scene cards aren’t empty any more'
    )
  })
})
