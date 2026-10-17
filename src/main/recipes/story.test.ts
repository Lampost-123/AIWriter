// "Lay it out again" on a story planned from a recipe (2026-10-17): the AI is told what the story already has, so it
// carries it on rather than starting over on Day 1 with chapters it already has.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AppEvents } from '@shared/api'
import * as repo from '../db/repo'
import * as gens from '../db/generations'
import type { JobModel } from '../ai/jobModel'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import { memoryWorld } from '../../../tests/unit/helpers'
import { emptyParts } from './parse'
import { startRecipeStoryJob } from './story'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0 })
})
afterAll(() => fake.close())

const model = (): JobModel => ({
  job: 'chat',
  target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: 'k' },
  choice: { providerId: 'p1', modelId: 'fake/writer', label: 'Fake', contextLength: 32000, promptPrice: null, completionPrice: null },
  thinking: 'off'
})

const recipe = { name: 'A quiet coastal mystery', parts: { ...emptyParts(), shape: '- Act one: the outsider arrives.', tone: 'Quiet' } }

async function plan(db: ReturnType<typeof memoryWorld>, storyId: string, taskId: string) {
  let done = false
  const { generationId } = startRecipeStoryJob(
    { db, model: model(), emit: (name: keyof AppEvents) => void (done ||= name === 'task:done') },
    recipe,
    { taskId, storyId, recipeId: 'r1', guidance: '', size: { acts: 0, chapters: 2, scenes: 2 } }
  )
  const t0 = Date.now()
  while (!done) {
    if (Date.now() - t0 > 10_000) throw new Error('The job never finished')
    await new Promise((r) => setTimeout(r, 10))
  }
  return gens.getGeneration(db, generationId)
}

describe('laying out a story from a recipe again', () => {
  it('tells the AI the kept premise and chapters, and carries the days on', async () => {
    const db = memoryWorld()
    const story = repo.createStory(db, { title: 'Saltmarsh' })
    repo.updateStory(db, story.id, { premise: 'Ila Marsh keeps the last ferry across the Wend.' })
    for (const [title, scene, when] of [
      ['Grey Water', 'The first crossing', 'Day 1, morning'],
      ['The Toll House', 'A lamp left on', 'Day 3, dusk']
    ]) {
      const chapter = repo.createChapter(db, story.id, { title })
      const s = repo.createScene(db, chapter.id, { title: scene })
      repo.updateSceneCard(db, s.id, { ...repo.getScene(db, s.id).card, when })
    }
    const record = await plan(db, story.id, 't1')
    const user = record.messages[1].content
    expect(user).toContain('Ila Marsh keeps the last ferry across the Wend.')
    expect(user).toContain('## What the story has so far')
    expect(user).toContain('Chapter: Grey Water')
    expect(user).toContain('The first crossing')
    expect(user).toContain('Chapter: The Toll House')
    expect(user).toContain('Its last scene with a When is set at “Day 3, dusk”')
    expect(user).not.toContain('opens on Day 1')
    expect(record.response).toContain('Sets up: ')
  })

  it('opens a story with nothing in it yet on Day 1', async () => {
    const db = memoryWorld()
    const story = repo.createStory(db, { title: 'Saltmarsh' })
    const record = await plan(db, story.id, 't2')
    expect(record.messages[1].content).toContain('It opens on Day 1.')
    expect(record.messages[1].content).not.toContain('## What the story has so far')
    expect(record.response).toContain('Sets up: Who keeps the lamp lit')
    expect(record.response).toContain('Pays off: Who keeps the lamp lit')
  })
})
