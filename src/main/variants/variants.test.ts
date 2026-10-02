import Database from 'better-sqlite3'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppEvents } from '@shared/api'
import type { DraftOptions, ModelChoice } from '@shared/types'
import { migrate } from '../db/migrations'
import * as repo from '../db/repo'
import * as gens from '../db/generations'
import { keeperScene } from '../db/keeper'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import { assembleContext, sentEntryVersions } from '../ai/context'
import { isDrafting, startDraftJob, stopDraft, type Emit } from '../ai/drafts'
import type { DraftBriefing } from '../ai/draftFlow'
import { catchUpBeforeDraft, gatherContextInput, setBeforeDraft } from '../ai/gather'
import { countRaw } from '../ai/tokens'
import { variantRows } from '../db/variants'
import {
  DRAFT_BUSY,
  latestVariantSet,
  resetVariantsForTests,
  SET_BUSY,
  startVariantSet,
  stopVariantSet,
  variantsBusy,
  type VariantsDeps
} from '.'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 2, words: 80, slowWords: 4000, slowDelayMs: 4 })
})
afterAll(() => fake.close())
beforeEach(() => {
  resetVariantsForTests()
  setBeforeDraft(null)
})

type Ev = { name: keyof AppEvents; payload: AppEvents[keyof AppEvents] }
type Done = AppEvents['generation:done']

const OLD_TEXT = 'Mara waited by the door, counting the knocks.'

function setup() {
  const db = new Database(':memory:')
  migrate(db)
  repo.initWorld(db, 'w1', 'Test world')
  const story = repo.listStories(db)[0]
  const outline = repo.getOutline(db, story.id)
  const first = outline.scenes[0]
  const second = repo.createScene(db, outline.chapters[0].id, { title: 'The knock' })
  const third = repo.createScene(db, outline.chapters[0].id, { title: 'After' })
  repo.saveSceneText(db, first.id, null, 'She left the docks at dusk, the rain at her back.')
  repo.saveSceneText(db, second.id, null, OLD_TEXT)
  const mara = repo.createEntry(db, 'character', { name: 'Mara', summary: 'A smuggler.' })
  repo.updateSceneCard(db, second.id, {
    ...repo.getScene(db, second.id).card,
    povId: mara.id,
    beats: ['Mara meets Tobin', 'Someone knocks'],
    targetWords: 600
  })
  return { db, first, second, third }
}

const model = (modelId = 'fake/writer'): ModelChoice => ({
  providerId: 'p1',
  modelId,
  label: modelId,
  contextLength: 32000,
  promptPrice: 0.000003,
  completionPrice: 0.000015
})

const OPTIONS: DraftOptions = { direction: 'End on the knock.', targetWords: 600, creativity: 'balanced' }

/** What the app's draftBriefing does, against this test's database: the memory catches up, then the briefing is made. */
function deps(db: Database.Database, events: Ev[], o: { modelId?: string; calls?: { n: number }; wait?: boolean } = {}): VariantsDeps {
  const emit: Emit = (name, payload) => void events.push({ name, payload })
  return {
    db,
    emit,
    retryDelays: [5, 5],
    briefing: async (sceneId, options, signal): Promise<DraftBriefing> => {
      if (o.calls) o.calls.n++
      await catchUpBeforeDraft(db, sceneId, undefined, signal)
      if (o.wait) await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
      if (signal.aborted) throw Object.assign(new Error('The draft was stopped before it began.'), { code: 'cancelled' })
      const input = gatherContextInput(db, sceneId, options, {
        prefs: { spelling: 'UK', pov: '', tense: '', voiceNotes: '', avoidWords: [] },
        contextLength: 32000,
        creativity: 'steady'
      })
      const preview = assembleContext(input, countRaw)
      return {
        input,
        preview,
        choice: model(o.modelId),
        target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: 'k' },
        thinking: 'off',
        entryVersions: sentEntryVersions(input.memory, preview.blocks)
      }
    }
  }
}

/** Resolves with each draft's 'generation:done', once they have all ended. */
function allDone(events: Ev[], ids: string[]): Promise<Done[]> {
  return new Promise((resolve) => {
    const check = (): void => {
      const done = ids.map(
        (id) => events.find((e) => e.name === 'generation:done' && (e.payload as Done).generationId === id)?.payload as Done | undefined
      )
      if (done.every(Boolean)) resolve(done as Done[])
      else setTimeout(check, 5)
    }
    check()
  })
}

const chunksOf = (events: Ev[], id: string): string =>
  events
    .filter((e) => e.name === 'generation:chunk' && (e.payload as AppEvents['generation:chunk']).generationId === id)
    .map((e) => (e.payload as AppEvents['generation:chunk']).text)
    .join('')

describe('a set of variants', () => {
  it('makes the briefing once, then writes one draft per variant side by side, each recorded as part of the set', async () => {
    const w = setup()
    const events: Ev[] = []
    const calls = { n: 0 }
    let caughtUp = 0
    setBeforeDraft(async () => void caughtUp++)
    const started = await startVariantSet(
      { setId: 'set-1', sceneId: w.second.id, count: 3, options: OPTIONS },
      deps(w.db, events, { calls })
    )
    expect(started.setId).toBe('set-1')
    expect(started.generationIds).toHaveLength(3)
    expect(new Set(started.generationIds).size).toBe(3)
    // Briefed once: the memory caught up once, for the whole set.
    expect(calls.n).toBe(1)
    expect(caughtUp).toBe(1)
    // All three write at once.
    expect(variantsBusy(w.second.id)).toBe(true)
    expect(isDrafting(w.second.id)).toBe(true)

    const done = await allDone(events, started.generationIds)
    expect(done.map((d) => d.status)).toEqual(['complete', 'complete', 'complete'])
    expect(variantsBusy(w.second.id)).toBe(false)

    const records = started.generationIds.map((id) => gens.getGeneration(w.db, id))
    records.forEach((r, i) => {
      expect(r.job).toBe('draft')
      expect(r.sceneId).toBe(w.second.id)
      expect(r.params.variant).toEqual({ setId: 'set-1', index: i + 1, of: 3 })
      expect(r.direction).toBe('End on the knock.')
      expect(r.params.targetWords).toBe(600)
      expect(r.params.creativity).toBe('balanced')
      expect(r.response).toContain('The rain had not let up')
      // Each streamed its own text, by its own id.
      expect(chunksOf(events, r.id)).toBe(r.response)
    })
    // The same briefing went to every variant.
    expect(records[1].messages).toEqual(records[0].messages)
    expect(records[2].messages).toEqual(records[0].messages)
    expect(records[1].blocks).toEqual(records[0].blocks)
    // They are drafts of the scene, listed with its other drafts.
    expect(
      gens
        .listGenerations(w.db, w.second.id)
        .map((g) => g.id)
        .sort()
    ).toEqual([...started.generationIds].sort())
  })

  it('never touches the scene or the memory: the scene keeps its text, and later briefings and the memory keeper read only that', async () => {
    const w = setup()
    const events: Ev[] = []
    const before = repo.getScene(w.db, w.second.id)
    const keeperBefore = keeperScene(w.db, w.second.id)!
    const { generationIds } = await startVariantSet(
      { setId: 'set-2', sceneId: w.second.id, count: 2, options: OPTIONS },
      deps(w.db, events)
    )
    await allDone(events, generationIds)

    const after = repo.getScene(w.db, w.second.id)
    expect(after.text).toBe(OLD_TEXT)
    expect(after.updatedAt).toBe(before.updatedAt)
    // What the memory keeper reads is the scene's own text, at the same version: it has nothing new to read.
    const keeper = keeperScene(w.db, w.second.id)!
    expect(keeper.text).toBe(OLD_TEXT)
    expect(keeper.textVersion).toBe(keeperBefore.textVersion)
    // The next scene's briefing hands over from the scene's text, never from a variant.
    const next = gatherContextInput(w.db, w.third.id, undefined, {
      prefs: { spelling: 'UK', pov: '', tense: '', voiceNotes: '', avoidWords: [] },
      contextLength: null,
      creativity: 'steady'
    })
    expect(next.memory.previous?.text).toContain('counting the knocks')
    expect(next.memory.previous?.text).not.toContain('The rain had not let up')
  })

  it('takes two variants as well, and refuses any other number', async () => {
    const w = setup()
    const events: Ev[] = []
    const { generationIds } = await startVariantSet({ setId: 'two', sceneId: w.second.id, count: 2, options: OPTIONS }, deps(w.db, events))
    expect(generationIds).toHaveLength(2)
    await allDone(events, generationIds)
    expect(gens.getGeneration(w.db, generationIds[1]).params.variant).toEqual({ setId: 'two', index: 2, of: 2 })
    await expect(
      startVariantSet({ setId: 'four', sceneId: w.second.id, count: 4 as 3, options: OPTIONS }, deps(w.db, events))
    ).rejects.toThrow('Variants are written two or three at a time.')
    await expect(startVariantSet({ setId: '', sceneId: w.second.id, count: 2, options: OPTIONS }, deps(w.db, events))).rejects.toThrow(
      /Try again/
    )
  })

  it('stops one variant on its own, keeping what arrived, while the others write on', async () => {
    const w = setup()
    const events: Ev[] = []
    const { generationIds } = await startVariantSet(
      { setId: 'slow', sceneId: w.second.id, count: 3, options: OPTIONS },
      deps(w.db, events, { modelId: 'fake/slow' })
    )
    await new Promise<void>((resolve) => {
      const check = (): void => (chunksOf(events, generationIds[1]) ? resolve() : void setTimeout(check, 5))
      check()
    })
    await stopDraft(generationIds[1])
    const stopped = gens.getGeneration(w.db, generationIds[1])
    expect(stopped.status).toBe('stopped')
    expect(stopped.response.length).toBeGreaterThan(0)
    expect(variantsBusy(w.second.id)).toBe(true)
    expect(gens.getGeneration(w.db, generationIds[0]).status).toBe('streaming')

    // Stop all stops the rest, keeping their text too.
    await stopVariantSet('slow')
    const all = generationIds.map((id) => gens.getGeneration(w.db, id))
    expect(all.map((r) => r.status)).toEqual(['stopped', 'stopped', 'stopped'])
    expect(all.every((r) => r.response.length > 0)).toBe(true)
    expect(variantsBusy(w.second.id)).toBe(false)
    expect(isDrafting(w.second.id)).toBe(false)
  })

  it('is called off while it gets ready: nothing is sent or recorded', async () => {
    const w = setup()
    const events: Ev[] = []
    fake.reset()
    const starting = startVariantSet({ setId: 'off', sceneId: w.second.id, count: 3, options: OPTIONS }, deps(w.db, events, { wait: true }))
    await new Promise((r) => setTimeout(r, 20))
    expect(variantsBusy(w.second.id)).toBe(true)
    await stopVariantSet('off')
    await expect(starting).rejects.toMatchObject({ code: 'cancelled' })
    expect(gens.listGenerations(w.db, w.second.id)).toEqual([])
    expect(Object.keys(fake.requestCounts())).toEqual([])
    expect(variantsBusy(w.second.id)).toBe(false)
  })

  it('waits its turn: not while another set of the scene, or a draft of it, is being written', async () => {
    const w = setup()
    const events: Ev[] = []
    const first = await startVariantSet(
      { setId: 'a', sceneId: w.second.id, count: 2, options: OPTIONS },
      deps(w.db, events, { modelId: 'fake/slow' })
    )
    await expect(
      startVariantSet({ setId: 'b', sceneId: w.second.id, count: 2, options: OPTIONS }, deps(w.db, events))
    ).rejects.toMatchObject({
      message: SET_BUSY,
      code: 'busy'
    })
    // Another scene can have its own.
    const other = await startVariantSet({ setId: 'c', sceneId: w.third.id, count: 2, options: OPTIONS }, deps(w.db, events))
    await stopVariantSet('a')
    await allDone(events, [...first.generationIds, ...other.generationIds])

    // A draft of the scene being written (Generate), or being started, holds the variants back.
    const b = await deps(w.db, events, { modelId: 'fake/slow' }).briefing(w.second.id, OPTIONS, new AbortController().signal)
    const { generationId } = startDraftJob({
      db: w.db,
      sceneId: w.second.id,
      options: b.input.options,
      preview: b.preview,
      provider: b.target,
      model: b.choice,
      entryVersions: b.entryVersions,
      emit: (name, payload) => void events.push({ name, payload })
    })
    await expect(
      startVariantSet({ setId: 'd', sceneId: w.second.id, count: 2, options: OPTIONS }, deps(w.db, events))
    ).rejects.toMatchObject({
      message: DRAFT_BUSY,
      code: 'busy'
    })
    await stopDraft(generationId)
    const startingElsewhere = { ...deps(w.db, events), startingElsewhere: (id: string) => id === w.second.id }
    await expect(
      startVariantSet({ setId: 'e', sceneId: w.second.id, count: 2, options: OPTIONS }, startingElsewhere)
    ).rejects.toMatchObject({
      code: 'busy'
    })
    // Once it has ended, they can go ahead.
    const fine = await startVariantSet({ setId: 'f', sceneId: w.second.id, count: 2, options: OPTIONS }, deps(w.db, events))
    await allDone(events, fine.generationIds)
  })

  it('gives way to a draft of the scene that began getting ready while the set did: nothing is sent or recorded', async () => {
    const w = setup()
    const events: Ev[] = []
    fake.reset()
    const plain = deps(w.db, events)
    let generateStarting = false
    const starting = startVariantSet(
      { setId: 'late', sceneId: w.second.id, count: 2, options: OPTIONS },
      {
        ...plain,
        startingElsewhere: (id) => generateStarting && id === w.second.id,
        // Generate is pressed (and begins getting ready) while the set's briefing is being made.
        briefing: (sceneId, options, signal) => {
          generateStarting = true
          return plain.briefing(sceneId, options, signal)
        }
      }
    )
    await expect(starting).rejects.toMatchObject({ message: DRAFT_BUSY, code: 'busy' })
    expect(gens.listGenerations(w.db, w.second.id)).toEqual([])
    expect(Object.keys(fake.requestCounts())).toEqual([])
    expect(variantsBusy(w.second.id)).toBe(false)
  })

  it('reads the scene’s latest set back from the records, variant 1 first, ignoring other drafts', async () => {
    const w = setup()
    const events: Ev[] = []
    expect(latestVariantSet(w.db, w.second.id)).toBeNull()

    const older = await startVariantSet({ setId: 'older', sceneId: w.second.id, count: 2, options: OPTIONS }, deps(w.db, events))
    await allDone(events, older.generationIds)
    const newer = await startVariantSet(
      { setId: 'newer', sceneId: w.second.id, count: 3, options: { ...OPTIONS, direction: 'Quieter.', creativity: 'adventurous' } },
      deps(w.db, events, { modelId: 'fake/credit' })
    )
    await allDone(events, newer.generationIds)
    // A plain draft written afterwards isn't a variant.
    const b = await deps(w.db, events).briefing(w.second.id, OPTIONS, new AbortController().signal)
    const plain = startDraftJob({
      db: w.db,
      sceneId: w.second.id,
      options: b.input.options,
      preview: b.preview,
      provider: b.target,
      model: b.choice,
      entryVersions: b.entryVersions,
      emit: (name, payload) => void events.push({ name, payload })
    })
    await allDone(events, [plain.generationId])

    const set = latestVariantSet(w.db, w.second.id)!
    expect(set.setId).toBe('newer')
    expect(set.sceneId).toBe(w.second.id)
    expect(set.of).toBe(3)
    expect(set.direction).toBe('Quieter.')
    expect(set.creativity).toBe('adventurous')
    expect(set.targetWords).toBe(600)
    expect(set.variants.map((v) => v.index)).toEqual([1, 2, 3])
    expect(set.variants.map((v) => v.generationId)).toEqual(newer.generationIds)
    // Out of credit: each says so in plain words, with nothing written and nothing charged.
    for (const v of set.variants) {
      expect(v.status).toBe('error')
      expect(v.error).toMatch(/credit/i)
      expect(v.text).toBe('')
      expect(v.cost).toBeNull()
    }
    // Another scene has none of these.
    expect(latestVariantSet(w.db, w.third.id)).toBeNull()

    // The older set is still there, complete, with its words and cost.
    const olderRows = variantRows(w.db, w.second.id, 'older')
    expect(olderRows).toHaveLength(2)
    expect(olderRows.map((r) => r.index)).toEqual([1, 2])
    expect(olderRows.map((r) => r.id)).toEqual(older.generationIds)
    for (const r of olderRows) {
      expect(r.setId).toBe('older')
      expect(r.of).toBe(2)
      expect(r.status).toBe('complete')
      expect(r.response).toContain('The rain had not let up')
      expect(r.cost).toBeGreaterThan(0)
      expect(r.direction).toBe('End on the knock.')
    }
  })

  it('says what each variant cost, and marks the cost estimated when the provider didn’t report it', async () => {
    const w = setup()
    const events: Ev[] = []
    const { generationIds } = await startVariantSet({ setId: 'cost', sceneId: w.second.id, count: 2, options: OPTIONS }, deps(w.db, events))
    await allDone(events, generationIds)
    const set = latestVariantSet(w.db, w.second.id)!
    for (const v of set.variants) {
      expect(v.status).toBe('complete')
      expect(v.text).toContain('The rain had not let up')
      expect(v.cost).toBeGreaterThan(0)
      expect(v.costEstimated).toBe(false)
      expect(v.cutOff).toBe(false)
      expect(v.modelId).toBe('fake/writer')
    }
  })
})
