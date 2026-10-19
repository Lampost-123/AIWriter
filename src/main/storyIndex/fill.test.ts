// Filling in the story index's physical details (Adam, 2026-10-19): the last two chapters with words of each story being
// written (only scenes not read for their words as they are now), an older scene the first time a look-up needs it, and
// a whole story when Adam asks, with an estimate first, progress, Stop, and always giving way to the memory and drafts.
// Against the fake provider (tests/fake-provider/server.mjs answers where things stand: everyone the cast list names in
// the scene is "in the scene", and one "in her grey cloak" wears it). Invented words.
import type Database from 'better-sqlite3'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import type { StoryFillDone, StoryFillProgress } from '@shared/contracts/storyIndex'
import { memoryWorld } from '../../../tests/unit/helpers'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import * as repo from '../db/repo'
import * as sidx from '../db/storyIndex'
import type { MemoryModel } from '../keeper/model'
import { keptStates, storedState } from '../continuity/tracker'
import { buildStoryIndex, stateOf } from '.'
import {
  STAGE_EXTRA_TOKENS,
  STAGE_REPLY_TOKENS,
  StageFiller,
  WORD_TOKENS,
  estimateFill,
  fillSceneForLookup,
  guessFill,
  recentScenesToFill,
  scenesToFill,
  stageFilled
} from './fill'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0 })
})
afterAll(() => fake.close())
beforeEach(() => fake.reset())

const model = (): MemoryModel => ({
  target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: 'test' },
  choice: { providerId: 'p1', modelId: 'fake/writer', label: 'fake', contextLength: 32000, promptPrice: null, completionPrice: null }
})

/** How many where-things-stand requests the fake provider has had. */
const asked = (): number => Object.values(fake.requestCounts()).reduce((n, k) => n + k, 0)

const words = (n: number, lead: string): string => `${lead} ${Array.from({ length: n }, (_, i) => `word${i}`).join(' ')}.`

/**
 * Book 1 of four chapters: Ch 1 (two scenes), Ch 2 (one), Ch 3 (two), Ch 4 (one planned scene, no words yet). Mara is
 * in every scene, in her grey cloak from Ch 2 on. Book 0, written long ago, has one chapter.
 */
function world() {
  const db = memoryWorld()
  const book = repo.listStories(db)[0]
  const o = repo.getOutline(db, book.id)
  const ch1 = o.chapters[0].id
  const ch2 = repo.createChapter(db, book.id, { title: 'Two' }).id
  const ch3 = repo.createChapter(db, book.id, { title: 'Three' }).id
  const ch4 = repo.createChapter(db, book.id, { title: 'Four' }).id
  const s1 = o.scenes[0].id
  const s2 = repo.createScene(db, ch1, { title: 'Quay' }).id
  const s3 = repo.createScene(db, ch2, { title: 'Ferry' }).id
  const s4 = repo.createScene(db, ch3, { title: 'Mill' }).id
  const s5 = repo.createScene(db, ch3, { title: 'Bridge' }).id
  const s6 = repo.createScene(db, ch4, { title: 'Planned' }).id
  repo.createEntry(db, 'character', { name: 'Mara' })
  repo.saveSceneText(db, s1, null, 'Mara waited on the quay while the river rose.')
  repo.saveSceneText(db, s2, null, 'Mara counted the boats twice and still came up one short.')
  repo.saveSceneText(db, s3, null, 'Mara stood at the rail in her grey cloak, watching the far bank.')
  repo.saveSceneText(db, s4, null, words(120, 'Mara climbed to the mill in her grey cloak'))
  repo.saveSceneText(db, s5, null, 'Mara crossed the bridge in her grey cloak at dusk.')
  const old = repo.createStory(db, { title: 'Book 0' })
  const oldCh = repo.createChapter(db, old.id, { title: 'Long ago' }).id
  const o1 = repo.createScene(db, oldCh, { title: 'Before' }).id
  repo.saveSceneText(db, o1, null, 'Mara was a girl then, and the mill still turned.')
  db.prepare("UPDATE scenes SET updated_at = '2025-01-01T00:00:00.000Z' WHERE id = ?").run(o1)
  return { db, book: book.id, old: old.id, s1, s2, s3, s4, s5, s6, o1 }
}

const opts = (db: Database.Database) => ({ closed: () => !db.open, retryDelays: [0] })

describe('the recent chapters, when a world opens', () => {
  it('are the scenes with words of the last two chapters with words, of the story being written, not yet read', () => {
    const w = world()
    // Ch 4 has no words yet, so the last two chapters with words are Ch 2 and Ch 3. Book 0 hasn't been written in for long.
    expect(recentScenesToFill(w.db)).toEqual([w.s3, w.s4, w.s5])
    expect(recentScenesToFill(w.db, { chapters: 1 })).toEqual([w.s4, w.s5])
  })

  it('leave out a scene already read for its words as they are now, and take it again once its words change', async () => {
    const w = world()
    await fillSceneForLookup(w.db, w.s4, model(), opts(w.db))
    expect(recentScenesToFill(w.db)).toEqual([w.s5])
    repo.saveSceneText(w.db, w.s4, null, 'Mara left the mill in a hurry.')
    expect(recentScenesToFill(w.db)).toEqual([w.s4, w.s5])
  })

  it('are worked out in the background at low priority: nothing while something comes first, then in reading order', async () => {
    const w = world()
    let busy = true
    const filled: ID[] = []
    const f = new StageFiller({
      db: w.db,
      model,
      busy: () => busy,
      closed: () => false,
      waitMs: 5,
      retryDelays: [0],
      onSceneFilled: (id) => filled.push(id)
    })
    f.queueRecent(recentScenesToFill(w.db))
    await new Promise((resolve) => setTimeout(resolve, 60))
    // A draft waiting for the memory (or the memory reading) comes first: nothing asked yet.
    expect(asked()).toBe(0)
    expect(f.waiting()).toEqual([w.s3, w.s4, w.s5])
    busy = false
    await f.whenIdle()
    expect(filled).toEqual([w.s3, w.s4, w.s5])
    expect([w.s1, w.s2, w.s3, w.s4, w.s5].map((id) => stageFilled(w.db, id))).toEqual([false, false, true, true, true])
  })
})

describe('a look-up that needs an older scene’s details', () => {
  it('has them worked out (with the scenes it builds on), and the index takes them in', async () => {
    const w = world()
    buildStoryIndex(w.db, w.book)
    const mara = repo.listEntries(w.db, 'character')[0].id
    expect(stateOf(w.db, w.book, mara, w.s3)?.wearing).toEqual([])
    const got = await fillSceneForLookup(w.db, w.s3, model(), opts(w.db))
    expect(got).toEqual({ filled: true, asked: true })
    // The scenes before it were brought up to date as a draft would (stateBefore), then the scene itself.
    expect([w.s1, w.s2, w.s3].every((id) => stageFilled(w.db, id))).toBe(true)
    expect(stageFilled(w.db, w.s4)).toBe(false)
    const wearing = stateOf(w.db, w.book, mara, w.s3)?.wearing ?? []
    expect(wearing).toHaveLength(1)
    expect(wearing[0].value).toContain('grey cloak')
    expect(wearing[0].origin).toBe('tracker')
    expect(sidx.indexScene(w.db, w.s3)?.filled).toBe('ai')
    // Asked again: nothing more is asked of the model.
    const before = asked()
    expect(await fillSceneForLookup(w.db, w.s3, model(), opts(w.db))).toEqual({ filled: true, asked: false })
    expect(asked()).toBe(before)
  })

  it('asks nothing for a scene with no words', async () => {
    const w = world()
    expect(await fillSceneForLookup(w.db, w.s6, model(), opts(w.db))).toEqual({ filled: false, asked: false })
    expect(asked()).toBe(0)
  })
})

describe('Fill in the whole story', () => {
  it('says first roughly what it takes: the scenes not yet filled in, their words, tokens and cost', async () => {
    const w = world()
    await fillSceneForLookup(w.db, w.s1, model(), opts(w.db))
    const priced: MemoryModel = {
      target: { id: 'p2', name: 'Hosted', kind: 'custom', baseUrl: 'https://api.example.com/v1', apiKey: 'test' },
      choice: {
        providerId: 'p2',
        modelId: 'flash',
        label: 'DeepSeek Flash',
        contextLength: 64000,
        promptPrice: 0.0000003,
        completionPrice: 0.0000012
      }
    }
    const left = scenesToFill(w.db, w.book)
    expect(left.map((s) => s.id)).toEqual([w.s2, w.s3, w.s4, w.s5])
    const e = estimateFill(w.db, w.book, priced)
    const wordCount = left.reduce((n, s) => n + s.words, 0)
    const g = guessFill(left)
    expect(g.input).toBe(Math.round(4 * STAGE_EXTRA_TOKENS + wordCount * WORD_TOKENS))
    expect(g.output).toBe(4 * STAGE_REPLY_TOKENS)
    expect(e).toMatchObject({
      storyId: w.book,
      total: 5,
      scenes: 4,
      words: wordCount,
      tokens: g.input + g.output,
      free: false,
      model: 'DeepSeek Flash',
      problem: null
    })
    expect(e.cost).toBeCloseTo(g.input * 0.0000003 + g.output * 0.0000012, 10)
    // Its price not known: no cost (the screen says how many AI calls); on this computer: free; no model: why.
    expect(
      estimateFill(w.db, w.book, { ...priced, choice: { ...priced.choice, promptPrice: null, completionPrice: null } }).cost
    ).toBeNull()
    expect(estimateFill(w.db, w.book, model())).toMatchObject({ free: true, cost: 0 })
    expect(estimateFill(w.db, w.book, { error: 'Choose a writer model.' })).toMatchObject({
      scenes: 4,
      problem: 'Choose a writer model.',
      model: null
    })
  })

  it('goes scene by scene with its progress, and says how it went', async () => {
    const w = world()
    const progress: (StoryFillProgress | null)[] = []
    const done: StoryFillDone[] = []
    const f = new StageFiller({
      db: w.db,
      model,
      closed: () => false,
      retryDelays: [0],
      onProgress: (p) => progress.push(p),
      onDone: (d) => done.push(d)
    })
    f.fillStory(
      w.book,
      'Book 1',
      scenesToFill(w.db, w.book).map((s) => s.id)
    )
    await f.whenIdle()
    expect(progress.map((p) => p && `${p.done}/${p.total}`)).toEqual(['0/5', '1/5', '2/5', '3/5', '4/5', '5/5', null])
    expect(done).toEqual([{ storyId: w.book, title: 'Book 1', total: 5, filled: 5, failed: 0, stopped: false, problem: null }])
    expect(scenesToFill(w.db, w.book)).toEqual([])
    expect(f.current()).toBeNull()
  })

  it('stops when Adam says, keeping what was filled in, and goes before the recent chapters', async () => {
    const w = world()
    let busy = false
    const done: StoryFillDone[] = []
    const filled: ID[] = []
    const f = new StageFiller({
      db: w.db,
      model,
      busy: () => busy,
      closed: () => false,
      waitMs: 5,
      retryDelays: [0],
      onDone: (d) => done.push(d),
      onSceneFilled: (id) => {
        filled.push(id)
        // After the first scene, something comes first: the fill waits, and Adam stops it meanwhile.
        busy = true
      }
    })
    f.fillStory(
      w.book,
      'Book 1',
      scenesToFill(w.db, w.book).map((s) => s.id)
    )
    f.queueRecent([w.s5])
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(filled).toEqual([w.s1])
    expect(f.current()).toMatchObject({ done: 1, total: 5 })
    f.stopStory()
    expect(done).toEqual([{ storyId: w.book, title: 'Book 1', total: 5, filled: 1, failed: 0, stopped: true, problem: null }])
    busy = false
    await f.whenIdle()
    // The recent chapters' scene still gets its turn; the rest of Adam's fill doesn't.
    expect(filled).toEqual([w.s1, w.s5])
    expect(stageFilled(w.db, w.s2)).toBe(false)
  })

  it('with no model to work with, says why and asks nothing', async () => {
    const w = world()
    const done: StoryFillDone[] = []
    const f = new StageFiller({
      db: w.db,
      model: () => ({ error: 'This month’s AI spending has reached your limit.' }),
      closed: () => false,
      onDone: (d) => done.push(d)
    })
    f.fillStory(w.book, 'Book 1', [w.s1, w.s2])
    await f.whenIdle()
    expect(done[0]).toMatchObject({ filled: 0, stopped: false, problem: 'This month’s AI spending has reached your limit.' })
    expect(asked()).toBe(0)
  })

  it('counts a scene the model turns down as not filled in, and doesn’t ask for it again', async () => {
    const w = world()
    repo.saveSceneText(w.db, w.s2, null, 'Mara read the EXPLICIT letter twice.')
    const prude: MemoryModel = { ...model(), choice: { ...model().choice, modelId: 'fake/prude' } }
    const done: StoryFillDone[] = []
    const f = new StageFiller({ db: w.db, model: () => prude, closed: () => false, retryDelays: [0], onDone: (d) => done.push(d) })
    f.fillStory(w.book, 'Book 1', [w.s1, w.s2, w.s3])
    await f.whenIdle()
    expect(done[0]).toMatchObject({ total: 3, filled: 2, failed: 1 })
    expect(storedState(w.db, w.s2)?.refused).toBe(true)
    // Turned down for these words: it counts as done, so a fill doesn't ask again (Recall's Read again can).
    expect(scenesToFill(w.db, w.book).map((s) => s.id)).toEqual([w.s4, w.s5])
    expect(keptStates(w.db, [w.s2]).get(w.s2)?.fresh).toBe(true)
  })
})
