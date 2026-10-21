// Old AI prompts let go when a world opens (review #22): the newest few records of each scene and job keep what was
// sent; older ones keep their reply, cost, tokens and settings, and only their prompt (messages and parts) is blanked.
import { describe, expect, it } from 'vitest'
import type { GenerationJob } from '@shared/types'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from './repo'
import * as gens from './generations'

function add(db: ReturnType<typeof memoryWorld>, id: string, sceneId: string, job: GenerationJob, minute: number, finished = true): void {
  gens.insertGeneration(db, {
    id,
    sceneId,
    job,
    providerId: 'p',
    providerName: 'Fake',
    modelId: 'fake/writer',
    params: { temperature: 0.8, top_p: 0.95, max_tokens: 1500 },
    direction: '',
    blocks: [{ id: 'brief', priority: 1, title: 'Brief', text: `brief ${id}`, tokens: 3, entryIds: [], dropped: false }],
    messages: [{ role: 'user', content: `prompt ${id}` }],
    budget: { contextLength: 8000, reserved: 1500, available: 6500, used: 100 },
    entries: [],
    createdAt: new Date(Date.UTC(2026, 9, 1, 8, minute)).toISOString()
  })
  if (finished)
    gens.finishGeneration(db, id, {
      status: 'complete',
      error: null,
      response: `reply ${id}`,
      promptTokens: 100,
      completionTokens: 20,
      cost: 0.01,
      finishedAt: new Date(Date.UTC(2026, 9, 1, 8, minute, 30)).toISOString()
    })
}

describe('letting go of old prompts', () => {
  it('keeps the newest few whole for each scene and job, and only blanks the prompts of older finished records', () => {
    const db = memoryWorld()
    const story = repo.listStories(db)[0]
    const [a] = repo.getOutline(db, story.id).scenes.map((s) => s.id)
    const b = repo.createScene(db, repo.getOutline(db, story.id).chapters[0].id, { title: 'B' }).id
    for (let i = 0; i < 25; i++) add(db, `d${i}`, a, 'draft', i)
    for (let i = 0; i < 14; i++) add(db, `m${i}`, a, 'memory', 30 + i)
    add(db, 'live', a, 'memory', 1, false)
    for (let i = 0; i < 3; i++) add(db, `b${i}`, b, 'memory', i)

    expect(gens.trimOldPrompts(db)).toBe(5 + 4)

    // Drafts: the newest KEEP_DRAFT_PROMPTS whole (the Context tab looks through that many for the last brief).
    for (let i = 0; i < 25; i++) {
      const r = gens.getGeneration(db, `d${i}`)
      expect(r.response).toBe(`reply d${i}`)
      expect(r.cost).toBe(0.01)
      expect(r.promptTokens).toBe(100)
      expect(r.params.max_tokens).toBe(1500)
      expect(r.messages.length).toBe(i >= 25 - gens.KEEP_DRAFT_PROMPTS ? 1 : 0)
      expect(r.blocks.length).toBe(i >= 25 - gens.KEEP_DRAFT_PROMPTS ? 1 : 0)
    }
    // Other jobs: the newest KEEP_PROMPTS whole.
    for (let i = 0; i < 14; i++) expect(gens.getGeneration(db, `m${i}`).messages.length).toBe(i >= 14 - gens.KEEP_PROMPTS ? 1 : 0)
    // One still being written is never touched; nor another scene's few.
    expect(gens.getGeneration(db, 'live').messages).toHaveLength(1)
    for (let i = 0; i < 3; i++) expect(gens.getGeneration(db, `b${i}`).messages).toHaveLength(1)
    expect(gens.lastSentBlock(db, a, 'brief')).toBe('brief d24')

    // Nothing more to do the next time.
    expect(gens.trimOldPrompts(db)).toBe(0)
  })
})
