// Some models won't read explicit scenes, and Adam writes them (2026-10-16): a memory job the model turns down is never
// kept as what was asked for (a summary, a reading, where things stand), says so in plain words, isn't sent and paid for
// again and again, and leaves the chain of where things stand whole. The fake provider's fake/prude turns down anything
// with the word EXPLICIT in it, in so many words, as such models do; all text is invented.
import type Database from 'better-sqlite3'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import { PRUDE_REFUSAL, startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import { fakeModel, saveParas, testWorld } from '../../../tests/unit/keeperRead'
import * as repo from '../db/repo'
import * as kdb from '../db/keeper'
import * as gens from '../db/generations'
import { callModel, contentNoteFor, setContentNote, type MemoryModel } from './model'
import { Keeper } from './engine'
import { runScene } from './run'
import { sceneSummaryDue, writeSceneSummary } from './summaries'
import { hashText } from './text'
import { dismissRefusals, modelKeyOf, noteRefusal, refusalNote, refusalsOf, wasRefused } from './refusals'
import { editState, keptStateBefore, stateAfter, stateBefore, storedState } from '../continuity/tracker'
import { CHECK_REFUSED, checkScene } from '../checks/run'
import type { JobModel } from '../ai/jobModel'

type DB = Database.Database

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0 })
})
afterAll(() => fake.close())
afterEach(() => setContentNote(null))

const prude = (): MemoryModel => fakeModel(fake, 'fake/prude')
const PRUDE_KEY = 'p1:fake/prude'

/** A fetch that counts the requests it passes on to the fake provider. */
function counting(): typeof fetch & { calls: number } {
  const f = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    f.calls++
    return fetch(input, init)
  }) as typeof fetch & { calls: number }
  f.calls = 0
  return f
}

const LONG = 'The river ran high under the bridge, and the lamps along the quay burned low while the ferry came in slowly.'
/** A scene's words, long enough for a summary; `explicit` puts the word the fake model turns down in them. */
const words = (who: string, explicit = false): string =>
  `${explicit ? 'EXPLICIT. ' : ''}${who} stood by the door in her grey cloak. ${LONG} ${LONG} ${LONG} ${LONG} ${LONG}`

const ask = (db: DB, sceneId: ID, model: MemoryModel, user: string, task?: 'summary' | 'read') =>
  callModel({
    db,
    model,
    targetId: sceneId,
    job: 'summary',
    ...(task ? { task } : {}),
    messages: [
      { role: 'system', content: 'You sum up scenes.' },
      { role: 'user', content: user }
    ],
    blocks: [],
    maxTokens: 300,
    signal: new AbortController().signal,
    closed: () => false,
    retryDelays: [0]
  })

describe('telling a refusal apart, once, for every memory job', () => {
  it('turns a reply that is plainly a refusal into a refused failure, says so in plain words, and notes what it was for', async () => {
    const w = testWorld(0)
    const got = await ask(w.db, w.scenes[0], prude(), 'Sum this up: EXPLICIT words.', 'summary')
    expect(got.status).toBe('error')
    expect(got.failure).toEqual({ type: 'refused' })
    expect(got.text).toBe(PRUDE_REFUSAL)
    expect(got.error).toBe(
      "The memory model turned the scene down. Some models won't read explicit scenes, so pick another memory model in Settings › Models."
    )
    // "What the AI saw" shows the call as turned down, not as a summary.
    const rec = gens.getGeneration(w.db, got.generationId)
    expect(rec.status).toBe('error')
    expect(rec.error).toBe(got.error)
    expect(refusalsOf(w.db)).toMatchObject([{ task: 'summary', model: 'memory', modelKey: PRUDE_KEY, sceneId: w.scenes[0] }])
  })

  it('leaves a reply that answers alone, and notes nothing for a reading (it has its own note) or a call that says nothing of what it is for', async () => {
    const w = testWorld(0)
    const fine = await ask(w.db, w.scenes[0], prude(), 'Sum this up: the ferry came in.', 'summary')
    expect(fine.status).toBe('complete')
    expect(fine.failure).toBeNull()
    expect((await ask(w.db, w.scenes[0], prude(), 'EXPLICIT', 'read')).failure).toEqual({ type: 'refused' })
    expect((await ask(w.db, w.scenes[0], prude(), 'EXPLICIT')).failure).toEqual({ type: 'refused' })
    expect(refusalsOf(w.db)).toEqual([])
  })

  it('counts a content filter as a refusal too', async () => {
    const w = testWorld(0)
    const got = await ask(w.db, w.scenes[0], fakeModel(fake, 'fake/refuse'), 'Anything.', 'summary')
    expect(got.status).toBe('error')
    expect(got.failure).toEqual({ type: 'refused' })
    expect(refusalsOf(w.db)).toHaveLength(1)
  })

  it('tells every memory job that the story means its strong content, when the style guide sets it', async () => {
    expect(contentNoteFor({ romance: 2, violence: 2 })).toBeNull()
    expect(contentNoteFor(undefined)).toBeNull()
    expect(contentNoteFor({ romance: 4, violence: 3 })).toBe(
      "About this story: it is fiction for adult readers, and its author means it to include explicit sex and graphic violence. Read and record what the words say plainly and accurately, as you would any other scene: don't tone it down, leave it out or add a warning."
    )
    const w = testWorld(0)
    setContentNote(() => contentNoteFor({ romance: 4 }))
    const got = await ask(w.db, w.scenes[0], prude(), 'Sum this up: the ferry came in.', 'summary')
    const sent = fake.lastRequest()!.body.messages
    expect(sent[0].content).toMatch(/^You sum up scenes\.\n\nAbout this story: .*explicit sex\./)
    // The record keeps what was sent.
    expect(gens.getGeneration(w.db, got.generationId).messages[0].content).toBe(sent[0].content)
  })
})

describe('summaries the memory model turns down', () => {
  it('are never saved, say why in the run, and are not asked for again with the same words and model', async () => {
    const w = testWorld(0)
    const scene = w.scenes[0]
    saveParas(w.db, scene, [['p1', words('Mara', true)]])
    const f = counting()
    const o = { db: w.db, model: prude(), signal: new AbortController().signal, closed: () => false, fetchImpl: f, retryDelays: [0] }
    expect(await writeSceneSummary(o, scene, null, 'Scene 1')).toBe(false)
    expect(f.calls).toBe(1)
    // The refusal is never kept as the scene's summary (it would be told to every later scene).
    expect(kdb.summaryRow(w.db, 'scene', scene)).toBeNull()
    expect(refusalsOf(w.db).map((r) => r.task)).toEqual(['summary'])
    // Not due again for this model with these words; due for another model, or once the words change.
    expect(sceneSummaryDue(w.db, scene, true, PRUDE_KEY)).toBe(false)
    expect(sceneSummaryDue(w.db, scene, true, 'p1:fake/writer')).toBe(true)
    saveParas(w.db, scene, [['p1', words('Mara')]])
    expect(sceneSummaryDue(w.db, scene, true, PRUDE_KEY)).toBe(true)
    expect(await writeSceneSummary(o, scene, null, 'Scene 1')).toBe(true)
    expect(kdb.summaryRow(w.db, 'scene', scene)?.text).not.toMatch(/sorry/i)
  })
})

describe('a scene the memory model won’t read', () => {
  it('shows "Memory not updated" with the reason, and is not read again before every draft until its words change or Adam tries again', async () => {
    const w = testWorld(2)
    const [one, two, three] = w.scenes
    saveParas(w.db, one, [['p1', 'Mara crossed the quay.']])
    saveParas(w.db, two, [['p2', 'EXPLICIT. Mara and Tobin, upstairs.']])
    saveParas(w.db, three, [['p3', 'Mara went down to the boats.']])
    const f = counting()
    const k = new Keeper({
      db: w.db,
      model: prude,
      emitStatus: () => {},
      emitChanged: () => {},
      quietMs: 60_000,
      summaries: false,
      retryDelays: [0],
      fetchImpl: f
    })
    k.start()
    await k.whenIdle()
    const read = f.calls
    expect(kdb.keeperScene(w.db, two)?.memoryState).toBe('failed')
    expect(kdb.keeperScene(w.db, one)?.memoryState).toBe('current')
    expect(k.status().error).toMatch(
      /^The memory couldn't read .+: the memory model turned the scene down; some models won't read explicit scenes, so pick another memory model in Settings › Models\.$/
    )
    expect(wasRefused(w.db, 'read', two, hashText(kdb.keeperScene(w.db, two)!.text), PRUDE_KEY)).toBe(true)

    // Before a draft of the next scene (and on leaving the scene): not asked again, so not paid for again.
    await k.catchUpBefore(three)
    await k.beforeDraft(two, 50, 50)
    k.sceneLeft(two)
    await k.whenIdle()
    expect(f.calls).toBe(read)

    // Try again: asked once more (and turned down once more).
    k.updateNow(two)
    await k.whenIdle()
    expect(f.calls).toBe(read + 1)
    await k.catchUpBefore(three)
    expect(f.calls).toBe(read + 1)

    // New words are read.
    saveParas(w.db, two, [['p2', 'Mara and Tobin talked upstairs till dawn.']])
    k.sceneLeft(two)
    await k.whenIdle()
    expect(kdb.keeperScene(w.db, two)?.memoryState).toBe('current')
    k.stop()
  })

  it('is read again with another memory model', async () => {
    const w = testWorld(0)
    const scene = w.scenes[0]
    saveParas(w.db, scene, [['p1', 'EXPLICIT. Mara crossed the quay.']])
    const out = await runScene(
      { db: w.db, model: prude(), signal: new AbortController().signal, closed: () => false, retryDelays: [0] },
      scene
    )
    expect(out.status).toBe('failed')
    let model: MemoryModel = prude()
    const k = new Keeper({
      db: w.db,
      model: () => model,
      emitStatus: () => {},
      emitChanged: () => {},
      quietMs: 60_000,
      summaries: false,
      retryDelays: [0]
    })
    await k.catchUpBefore(scene)
    expect(kdb.keeperScene(w.db, scene)?.memoryState).toBe('failed')
    model = fakeModel(fake, 'fake/writer')
    k.updateNow()
    await k.whenIdle()
    expect(kdb.keeperScene(w.db, scene)?.memoryState).toBe('current')
    k.stop()
  })
})

describe('where things stand through a scene the memory model turns down', () => {
  function stage(): { db: DB; one: ID; two: ID; three: ID } {
    const w = testWorld(2)
    repo.createEntry(w.db, 'character', { name: 'Mara' })
    const [one, two, three] = w.scenes
    saveParas(w.db, one, [['p1', 'Mara stood by the door in her grey cloak.']], false)
    saveParas(w.db, two, [['p2', 'EXPLICIT. Mara, upstairs.']], false)
    saveParas(w.db, three, [['p3', 'Mara went down to the boats.']], false)
    return { db: w.db, one, two, three }
  }
  const options = (db: DB, f: typeof fetch, model = prude()) => ({
    db,
    model,
    signal: new AbortController().signal,
    closed: () => false,
    fetchImpl: f,
    retryDelays: [0]
  })
  const cloakOf = (db: DB, sceneId: ID) => storedState(db, sceneId)?.state.characters.find((c) => c.name === 'Mara')?.clothes

  it('carries the state before on, marked unchecked, so the scenes after keep what was worn; and asks no more', async () => {
    const s = stage()
    const f = counting()
    await stateBefore(options(s.db, f), s.three)
    expect(f.calls).toBe(2)
    const two = storedState(s.db, s.two)!
    expect(two).toMatchObject({ current: true, unchecked: true, refused: true })
    // What was worn before the scene carries on through it, to the scene after.
    expect(cloakOf(s.db, s.two)).toEqual([{ name: 'grey cloak', state: 'on' }])
    expect(keptStateBefore(s.db, s.three)?.characters.find((c) => c.name === 'Mara')?.clothes).toEqual([
      { name: 'grey cloak', state: 'on' }
    ])
    expect(refusalsOf(s.db).map((r) => r.task)).toEqual(['stage'])

    // Before the next draft: not asked again (it would be paid for and turned down again).
    await stateBefore(options(s.db, f), s.three)
    expect(f.calls).toBe(2)
    // Read again (Recall) asks once more.
    await stateAfter(options(s.db, f), s.two, true)
    expect(f.calls).toBe(3)
    expect(storedState(s.db, s.two)).toMatchObject({ unchecked: true, refused: true })

    // The scene before changes: it is read again, and what it now says carries on through the scene turned down,
    // which isn't asked again (it is its own words it turns down).
    saveParas(s.db, s.one, [['p1', 'Mara stood by the door in her blue cloak.']], false)
    await stateBefore(options(s.db, f), s.three)
    expect(f.calls).toBe(4)
    expect(cloakOf(s.db, s.two)).toEqual([{ name: 'blue cloak', state: 'on' }])
    expect(keptStateBefore(s.db, s.three)?.characters.find((c) => c.name === 'Mara')?.clothes).toEqual([{ name: 'blue cloak', state: 'on' }])
  })

  it('is read from the scene once another memory model is picked, keeping what Adam put right', async () => {
    const s = stage()
    const f = counting()
    await stateBefore(options(s.db, f), s.three)
    // Adam puts right what the scene changed, in Recall.
    expect(editState(s.db, s.two, (e) => (e.scene = { time: 'night' }))).toBe(true)
    expect(storedState(s.db, s.two)).toMatchObject({ unchecked: true, refused: true, edited: true })
    await stateAfter(options(s.db, f, fakeModel(fake, 'fake/writer')), s.two)
    const two = storedState(s.db, s.two)!
    expect(two.unchecked).toBe(false)
    expect(two.state.time).toBe('night')
  })

  it('lets Recall start from the state before when nothing is kept for the scene', () => {
    const s = stage()
    // Nothing read yet at all: Adam's change starts from the scene before's state (here, nothing known).
    expect(storedState(s.db, s.two)).toBeNull()
    expect(editState(s.db, s.two, (e) => (e.scene = { weather: 'rain' }))).toBe(true)
    expect(storedState(s.db, s.two)).toMatchObject({ unchecked: true, refused: false, edited: true })
    expect(storedState(s.db, s.two)?.state.weather).toBe('rain')
    // A deleted scene still can't be changed.
    repo.deleteScene(s.db, s.three)
    expect(editState(s.db, s.three, (e) => (e.scene = { weather: 'rain' }))).toBe(false)
  })
})

describe('the top bar’s lasting note', () => {
  const where = (): string => 'Chapter 1, Scene 2'
  it('says what was turned down and what went without, in plain words, until dismissed or another model is picked', () => {
    const w = testWorld(1)
    const [one, two] = w.scenes
    noteRefusal(w.db, { task: 'summary', model: 'memory', modelKey: PRUDE_KEY, sceneId: two })
    noteRefusal(w.db, { task: 'stage', model: 'memory', modelKey: PRUDE_KEY, sceneId: two })
    expect(refusalNote(w.db, { memory: PRUDE_KEY, check: null }, where)).toEqual({
      title: 'The memory model turned a scene down',
      message:
        'The memory model turned down Chapter 1, Scene 2, so its summary wasn’t written and where things stand at its end is carried on from the scene before (put it right in Recall). Some models won’t read explicit scenes. Pick another memory model in Settings › Models.'
    })
    // Another scene, and a check: both models are named.
    noteRefusal(w.db, { task: 'plan', model: 'memory', modelKey: PRUDE_KEY, sceneId: one })
    noteRefusal(w.db, { task: 'check', model: 'check', modelKey: 'p1:fake/checker', sceneId: two })
    const both = refusalNote(w.db, { memory: PRUDE_KEY, check: 'p1:fake/checker' }, where)!
    expect(both.title).toBe('Scenes were turned down')
    expect(both.message).toMatch(
      /^The memory model turned down Chapter 1, Scene 2 and 1 other scene, so a summary wasn’t written, where things stand is carried on through one of them \(put it right in Recall\) and a draft was written without a plan\. /
    )
    expect(both.message).toMatch(
      /The consistency check model turned down Chapter 1, Scene 2, so it wasn’t checked for consistency\. Some models won’t read explicit scenes\. Pick other models in Settings › Models\.$/
    )
    // Another memory model picked: only the check's is told; dismissed: nothing.
    expect(refusalNote(w.db, { memory: 'p1:fake/writer', check: 'p1:fake/checker' }, where)?.title).toBe(
      'The consistency check model turned a scene down'
    )
    dismissRefusals(w.db)
    expect(refusalNote(w.db, { memory: PRUDE_KEY, check: 'p1:fake/checker' }, where)).toBeNull()
  })

  it('names a roll-up without a scene', () => {
    const w = testWorld(0)
    noteRefusal(w.db, { task: 'rollup', model: 'memory', modelKey: PRUDE_KEY, sceneId: null })
    expect(refusalNote(w.db, { memory: PRUDE_KEY, check: null }, where)?.message).toBe(
      'The memory model turned down a chapter or story summary, so it wasn’t brought up to date. Some models won’t read explicit scenes. Pick another memory model in Settings › Models.'
    )
  })

  it('keys a model by its provider and id', () => {
    expect(modelKeyOf(prude())).toBe(PRUDE_KEY)
  })
})

describe('a consistency check the model turns down', () => {
  it('stops with a plain-words reason at once, rather than asking again as if the reply were in the wrong format', async () => {
    const w = testWorld(0)
    const scene = w.scenes[0]
    repo.saveSceneText(w.db, scene, null, 'EXPLICIT. Mara and Tobin, upstairs, till dawn.')
    const model: JobModel = {
      job: 'check',
      target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' },
      choice: {
        providerId: 'p1',
        modelId: 'fake/prude',
        label: 'fake/prude',
        contextLength: 32000,
        promptPrice: null,
        completionPrice: null
      },
      thinking: 'off'
    }
    const before = fake.requestCounts()['fake/prude'] ?? 0
    const out = await checkScene(
      {
        db: w.db,
        model,
        prefs: { spelling: 'UK', pov: '', tense: '', voiceNotes: '', avoidWords: [] },
        stopped: () => false,
        retryDelays: [0]
      },
      scene,
      ['facts', 'knowledge']
    )
    expect(out).toEqual({ status: 'error', error: CHECK_REFUSED, found: 0 })
    expect(CHECK_REFUSED).toBe(
      "The consistency check model turned the scene down. Some models won't read explicit scenes, so pick another consistency check model in Settings › Models."
    )
    expect((fake.requestCounts()['fake/prude'] ?? 0) - before).toBe(1)
    expect(refusalsOf(w.db)).toMatchObject([{ task: 'check', model: 'check', modelKey: PRUDE_KEY, sceneId: scene }])
  })
})
