// The direction composer's query (db/directions.ts): the directions Adam gave before, read back from the generation
// records with no migration. Made-up records only.
import { describe, expect, it } from 'vitest'
import type { GenerationJob, GenerationRecord, ID } from '@shared/types'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as gens from './generations'
import * as repo from './repo'
import { recentDirections } from './directions'

type DB = ReturnType<typeof memoryWorld>

let n = 0
/** A record as the draft runner or the task runner makes it, `at` minutes into the day. */
function record(db: DB, o: { sceneId: ID; job: GenerationJob; direction: string; at: number; params?: Partial<GenerationRecord['params']> }): ID {
  const id = `g${++n}`
  gens.insertGeneration(db, {
    id,
    sceneId: o.sceneId,
    job: o.job,
    providerId: 'p',
    providerName: 'Fake',
    modelId: 'fake/writer',
    params: { temperature: 0.8, top_p: 0.95, max_tokens: 1500, ...o.params },
    direction: o.direction,
    blocks: [],
    messages: [],
    budget: { contextLength: 8000, reserved: 1500, available: 6500, used: 100 },
    entries: [],
    createdAt: new Date(Date.parse('2026-10-19T08:00:00.000Z') + o.at * 60_000).toISOString()
  })
  return id
}

/** A world with two stories, a scene in each. */
function world(): { db: DB; storyA: ID; sceneA: ID; storyB: ID; sceneB: ID } {
  const db = memoryWorld()
  const [storyA] = repo.listStories(db)
  const sceneA = repo.getOutline(db, storyA.id).scenes[0].id
  const storyB = repo.createStory(db, { title: 'Book 2' })
  const chapterB = repo.createChapter(db, storyB.id, { title: 'Chapter 1' })
  const sceneB = repo.createScene(db, chapterB.id, { title: 'Scene 1' }).id
  return { db, storyA: storyA.id, sceneA, storyB: storyB.id, sceneB }
}

describe('recentDirections', () => {
  it('offers back drafts, beats’ notes and Continue for writing on, newest first, the same words once', () => {
    const { db, sceneA } = world()
    record(db, { sceneId: sceneA, job: 'draft', direction: 'Make it tense', at: 1 })
    record(db, { sceneId: sceneA, job: 'beat', direction: 'For this beat: She opens the door', at: 2, params: { beat: { sessionId: 's1', index: 1, of: 2 } } })
    record(db, { sceneId: sceneA, job: 'edit', direction: 'The ferry horn sounds twice', at: 3, params: { tool: 'continue' } })
    record(db, { sceneId: sceneA, job: 'draft', direction: 'make it  tense.', at: 4 })
    record(db, { sceneId: sceneA, job: 'draft', direction: '', at: 5 })
    const out = recentDirections(db)
    // "Make it tense" was given twice: once offered, in its newest words, counted twice.
    expect(out.map((d) => [d.text, d.source, d.uses])).toEqual([
      ['make it tense.', 'draft', 2],
      ['The ferry horn sounds twice', 'continue', 1],
      ['She opens the door', 'beat', 1]
    ])
    expect(out[0].at).toBe('2026-10-19T08:04:00.000Z')
  })

  it('keeps Rewrite’s ways apart, and never offers Change tone’s tone, the other edits or the app’s own directions', () => {
    const { db, sceneA } = world()
    record(db, { sceneId: sceneA, job: 'edit', direction: 'Start with the rain', at: 1, params: { tool: 'rewrite' } })
    record(db, { sceneId: sceneA, job: 'edit', direction: 'Darker', at: 2, params: { tool: 'tone' } })
    record(db, { sceneId: sceneA, job: 'edit', direction: '', at: 3, params: { tool: 'expand' } })
    record(db, { sceneId: sceneA, job: 'draft', direction: 'Fixing Ch 1, Sc 1: the knife', at: 4, params: { chapterWriter: { runId: 'r1' } } })
    record(db, { sceneId: sceneA, job: 'chapter', direction: 'Planning Chapter 1', at: 5 })
    record(db, { sceneId: sceneA, job: 'memory', direction: 'Read the scene', at: 6 })
    record(db, { sceneId: sceneA, job: 'draft', direction: 'End on the knock', at: 7 })
    expect(recentDirections(db).map((d) => d.text)).toEqual(['End on the knock'])
    expect(recentDirections(db, { kind: 'rewrite' }).map((d) => [d.text, d.source])).toEqual([['Start with the rain', 'rewrite']])
    expect(recentDirections(db, { kind: 'all' }).map((d) => d.text)).toEqual(['End on the knock', 'Start with the rain'])
  })

  it("reads a beat's record as the session's direction (once a session) and the beat's own note", () => {
    const { db, sceneA } = world()
    const beat = (index: number, direction: string, at: number): ID =>
      record(db, { sceneId: sceneA, job: 'beat', direction, at, params: { beat: { sessionId: 's1', index, of: 3 } } })
    beat(1, 'Make it tense. For this beat: She opens the door', 1)
    beat(2, 'Make it tense', 2)
    beat(3, 'Make it tense. For this beat: A storm comes in', 3)
    expect(recentDirections(db).map((d) => [d.text, d.uses])).toEqual([
      ['Make it tense.', 1],
      ['A storm comes in', 1],
      ['She opens the door', 1]
    ])
  })

  it("offers a set of variants' direction once, and each variant's own beside it", () => {
    const { db, sceneA } = world()
    const variant = (index: number, note: string | undefined, at: number): ID =>
      record(db, {
        sceneId: sceneA,
        job: 'draft',
        direction: 'End on the knock.',
        at,
        params: { variant: { setId: 'set1', index, of: 3, ...(note ? { note } : {}) } }
      })
    variant(1, 'Tense', 1)
    variant(2, 'Tender', 1)
    variant(3, undefined, 1)
    const out = recentDirections(db)
    expect(out.find((d) => d.text === 'End on the knock.')).toMatchObject({ source: 'variants', uses: 1 })
    expect(out.map((d) => d.text).sort()).toEqual(['End on the knock.', 'Tender', 'Tense'])
    // A variant with only its own direction (the set had none) is still offered.
    record(db, { sceneId: sceneA, job: 'draft', direction: '', at: 2, params: { variant: { setId: 'set2', index: 1, of: 2, note: 'Funny' } } })
    expect(recentDirections(db)[0]).toMatchObject({ text: 'Funny', source: 'variants' })
  })

  it("keeps to one story's scenes when asked, and to as many as asked for", () => {
    const { db, sceneA, sceneB, storyA, storyB } = world()
    record(db, { sceneId: sceneA, job: 'draft', direction: 'In book one', at: 1 })
    record(db, { sceneId: sceneB, job: 'draft', direction: 'In book two', at: 2 })
    record(db, { sceneId: sceneB, job: 'draft', direction: 'Also in book two', at: 3 })
    expect(recentDirections(db, { storyId: storyA }).map((d) => d.text)).toEqual(['In book one'])
    expect(recentDirections(db, { storyId: storyB }).map((d) => d.text)).toEqual(['Also in book two', 'In book two'])
    expect(recentDirections(db).map((d) => d.text)).toEqual(['Also in book two', 'In book two', 'In book one'])
    expect(recentDirections(db, { limit: 2 }).map((d) => d.text)).toEqual(['Also in book two', 'In book two'])
    expect(recentDirections(db, { storyId: 'no-such-story' })).toEqual([])
  })

  it('reads a record whose settings were damaged as best it can, and changes nothing', () => {
    const { db, sceneA } = world()
    const id = record(db, { sceneId: sceneA, job: 'draft', direction: 'Still offered', at: 1 })
    db.prepare("UPDATE generations SET params_json = 'not json' WHERE id = ?").run(id)
    const before = db.prepare('SELECT COUNT(*) AS n FROM generations').get()
    expect(recentDirections(db).map((d) => d.text)).toEqual(['Still offered'])
    expect(db.prepare('SELECT COUNT(*) AS n FROM generations').get()).toEqual(before)
  })
})
