import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AppEvents } from '@shared/api'
import type { CheckDone, CheckProgress } from '@shared/contracts/checks'
import { DONE_CHECKS } from '@shared/contracts/checks'
import type { ID } from '@shared/types'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as cdb from '../db/checks'
import * as gens from '../db/generations'
import { memoryWorld } from '../../../tests/unit/helpers'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import type { JobModel } from '../ai/jobModel'
import { UserError } from '../util'
import { checkScene, type CheckOptions } from './run'
import { checkWhenDone, resetRunsForTests, setRunDeps, startCheck, stopCheck, type RunDeps } from './runs'
import { Keeper } from '../keeper/engine'
import * as kdb from '../db/keeper'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 1, slowWords: 4000, slowDelayMs: 5 })
})
afterAll(() => fake.close())
afterEach(() => {
  setRunDeps(null)
  resetRunsForTests()
})

const PREFS = { spelling: 'UK' as const, pov: '', tense: '', voiceNotes: '', avoidWords: [] }

const model = (modelId = 'fake/writer'): JobModel => ({
  job: 'check',
  target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' },
  choice: { providerId: 'p1', modelId, label: modelId, contextLength: 32000, promptPrice: null, completionPrice: null },
  thinking: 'off'
})

const SCENE_2 = `Mara pushed the door open. Mara's eyes were green in the firelight.

"You took your time," said Tobin.`

/** Two scenes: Tobin dies in the first; in the second Mara's eyes are the wrong colour and Tobin speaks. */
function world() {
  const db = memoryWorld()
  const [story] = repo.listStories(db)
  const outline = repo.getOutline(db, story.id)
  const s1 = outline.scenes[0].id
  const s2 = repo.createScene(db, outline.chapters[0].id, { title: 'The tavern' }).id
  const mara = repo.createEntry(db, 'character', { name: 'Mara', fields: { eyes: 'blue' } })
  const tobin = repo.createEntry(db, 'character', { name: 'Tobin', summary: 'A ferryman.' })
  repo.saveSceneText(db, s1, null, 'The mill burned. Tobin died in the fire.')
  mem.insertChange(db, { kind: 'update', payload: { note: 'died in the fire' }, entryId: tobin.id, anchor: 'scene', sceneId: s1, storyId: story.id, origin: 'adam' })
  repo.saveSceneText(db, s2, null, SCENE_2)
  return { db, storyId: story.id, chapterId: outline.chapters[0].id, s1, s2, maraId: mara.id, tobinId: tobin.id }
}

/** A scene's 'check' records (the Drafts tab lists drafts only). */
const checkRecords = (db: CheckOptions['db'], sceneId: ID): ID[] =>
  (db.prepare("SELECT id FROM generations WHERE scene_id = ? AND job = 'check' ORDER BY created_at").all(sceneId) as { id: ID }[]).map((r) => r.id)

const options = (db: CheckOptions['db'], m = model()): CheckOptions => ({ db, model: m, prefs: PREFS, stopped: () => false, retryDelays: [5] })

describe('checking a scene', () => {
  it('catches a planted contradiction against the memory as of the scene’s start, once, with a rewrite and a memory fix', async () => {
    const w = world()
    const out = await checkScene(options(w.db), w.s2, DONE_CHECKS)
    expect(out).toEqual({ status: 'done', found: 2 })
    const rows = cdb.sortIssues(cdb.sceneIssueRows(w.db, w.s2), () => SCENE_2)
    const [dead, eyes] = rows.map((r) => ({ ...r, message: r.message as string, p: cdb.payloadOf(r) }))
    expect(dead).toMatchObject({ kind: 'fact', severity: 'must-fix', quote: '"You took your time," said Tobin.' })
    expect(dead.message as string).toBe('Tobin is dead by this point in the story, but speaks here.')
    expect(dead.p.sources).toEqual([{ kind: 'entry', entryId: w.tobinId, name: 'Tobin', field: null }])
    expect(eyes).toMatchObject({ kind: 'fact', severity: 'warning', quote: "Mara's eyes were green in the firelight." })
    expect(eyes.p.fix).toBe("Mara's eyes were blue in the firelight.")
    // Mara's eyes are Adam's own note: "Update the memory" is offered.
    expect(eyes.p.memoryFix).toEqual({ entryId: w.maraId, field: 'eyes', value: 'green' })

    // Each request is a 'check' record of the scene, so "What the AI saw" shows it.
    const rec = gens.getGeneration(w.db, checkRecords(w.db, w.s2)[0])
    expect(rec.messages[0].content.startsWith('[AIWRITE-CHECK v1] facts, knowledge, timeline')).toBe(true)
    expect(rec.blocks.map((b) => b.id)).toContain('memory')

    // Checked again: nothing new.
    expect(await checkScene(options(w.db), w.s2, DONE_CHECKS)).toEqual({ status: 'done', found: 0 })
    expect(cdb.sceneIssueRows(w.db, w.s2)).toHaveLength(2)
  })

  it('never raises an ignored issue again, and drops issues whose words have gone', async () => {
    const w = world()
    await checkScene(options(w.db), w.s2, DONE_CHECKS)
    const dead = cdb.sceneIssueRows(w.db, w.s2).find((r) => r.severity === 'must-fix')!
    cdb.setIssueStatus(w.db, dead.id as ID, 'ignored')
    expect(await checkScene(options(w.db), w.s2, DONE_CHECKS)).toEqual({ status: 'done', found: 0 })
    expect(cdb.sceneIssueRows(w.db, w.s2).map((r) => r.status).sort()).toEqual(['ignored', 'open'])
    // The eye colour is fixed in the text: that issue goes, and a re-run finds nothing new.
    repo.saveSceneText(w.db, w.s2, null, SCENE_2.replace('green', 'blue'))
    cdb.sweepGone(w.db, { sceneId: w.s2 })
    expect(cdb.sceneIssueRows(w.db, w.s2).map((r) => r.status)).toEqual(['ignored'])
    expect(await checkScene(options(w.db), w.s2, DONE_CHECKS)).toEqual({ status: 'done', found: 0 })
  })

  it('finds nothing in the scene where the change happens (Tobin is alive at its start), and nothing in an empty scene', async () => {
    const w = world()
    expect(await checkScene(options(w.db), w.s1, DONE_CHECKS)).toEqual({ status: 'done', found: 0 })
    const empty = repo.createScene(w.db, w.chapterId, { title: 'Empty' }).id
    expect(await checkScene(options(w.db), empty, DONE_CHECKS)).toEqual({ status: 'empty' })
  })

  it('asks once more when the reply can’t be read, and says so in plain words when the model fails', async () => {
    const w = world()
    expect(await checkScene(options(w.db, model('fake/check-bad-json')), w.s2, DONE_CHECKS)).toEqual({ status: 'done', found: 2 })
    const failed = await checkScene(options(w.db, model('fake/credit')), w.s2, ['voice'])
    expect(failed.status).toBe('error')
    expect(failed.status === 'error' && failed.error).toMatch(/credit/i)
  })
})

describe('check runs', () => {
  function deps(m: () => JobModel = () => model(), beforeScene?: RunDeps['beforeScene']) {
    const events: { name: keyof AppEvents; payload: unknown }[] = []
    const done = new Map<ID, (d: CheckDone) => void>()
    const ended = (runId: ID): Promise<CheckDone> => new Promise((r) => done.set(runId, r))
    setRunDeps({
      model: m,
      prefs: () => PREFS,
      emit: (name, payload) => {
        events.push({ name, payload })
        if (name === 'checks:done') done.get((payload as CheckDone).runId)?.(payload as CheckDone)
      },
      retryDelays: [5],
      beforeScene
    })
    return { events, ended }
  }

  it('checks a story’s scenes in order, saying how it goes, and refuses a second check of Adam’s while it runs', async () => {
    const w = world()
    const { events, ended } = deps()
    const end = ended('r1')
    startCheck(w.db, { runId: 'r1', target: { scope: 'story', id: w.storyId }, checks: ['facts'] })
    expect(() => startCheck(w.db, { runId: 'r2', target: { scope: 'scene', id: w.s1 }, checks: ['facts'] })).toThrow(/being checked already/)
    const d = await end
    expect(d).toMatchObject({ runId: 'r1', status: 'complete', found: 2, error: null, background: false })
    const progress = events.filter((e) => e.name === 'checks:progress').map((e) => e.payload as CheckProgress)
    expect(progress[0]).toMatchObject({ done: 0, total: 2, sceneIds: [w.s1, w.s2] })
    expect(progress.some((p) => p.currentSceneId === w.s2 && p.done === 1)).toBe(true)
  })

  it('refuses in plain words when there is no model or nothing to check; marking done then does nothing at all', () => {
    const w = world()
    deps(() => {
      throw new UserError('Choose a writer model first, in Settings › Models.', 'no-writer-model')
    })
    expect(() => startCheck(w.db, { runId: 'r1', target: { scope: 'scene', id: w.s1 }, checks: ['facts'] })).toThrow('Choose a writer model first')
    expect(checkWhenDone(w.db, w.s2)).toBeNull()
    deps()
    const empty = repo.createScene(w.db, w.chapterId, { title: 'Empty' }).id
    expect(() => startCheck(w.db, { runId: 'r2', target: { scope: 'scene', id: empty }, checks: ['facts'] })).toThrow('This scene has no words to check yet.')
  })

  it('marking a scene done checks facts, knowledge and timeline in the background, once while it waits', async () => {
    const w = world()
    const { events } = deps()
    const first = checkWhenDone(w.db, w.s1)!
    const second = checkWhenDone(w.db, w.s2)!
    expect(checkWhenDone(w.db, w.s2)).toBeNull()
    await new Promise<void>((resolve) => {
      const t = setInterval(() => {
        if (events.some((e) => e.name === 'checks:done' && (e.payload as CheckDone).runId === second)) {
          clearInterval(t)
          resolve()
        }
      }, 10)
    })
    const done = events.filter((e) => e.name === 'checks:done').map((e) => e.payload as CheckDone)
    expect(done.map((d) => d.runId)).toEqual([first, second])
    expect(done[1]).toMatchObject({ status: 'complete', found: 2, background: true })
    expect(gens.getGeneration(w.db, checkRecords(w.db, w.s2)[0]).messages[0].content.split('\n')[0]).toBe(
      '[AIWRITE-CHECK v1] facts, knowledge, timeline'
    )
  })

  it('stops on request, keeping what was found', async () => {
    const w = world()
    const { ended } = deps(() => model('fake/slow'))
    const end = ended('r1')
    startCheck(w.db, { runId: 'r1', target: { scope: 'story', id: w.storyId }, checks: ['facts'] })
    await new Promise((r) => setTimeout(r, 150))
    await stopCheck('r1')
    expect((await end).status).toBe('stopped')
  })

  it('names each scene as "Ch 1, Sc 2: The tavern"', async () => {
    const w = world()
    const { events, ended } = deps()
    const end = ended('r1')
    startCheck(w.db, { runId: 'r1', target: { scope: 'chapter', id: w.chapterId }, checks: ['facts'] })
    await end
    const named = events.filter((e) => e.name === 'checks:progress').map((e) => (e.payload as CheckProgress).current)
    expect(named).toContain('Ch 1, Sc 2: The tavern')
  })

  it('a check Adam asks for takes over a waiting mark-done check of the same scene, and Stop ends a check waiting for the memory at once', async () => {
    const w = world()
    // The memory never catches up by itself here: only Stop ends the wait.
    const { events } = deps(
      () => model(),
      (_db, _scene, signal) => new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
    )
    const first = checkWhenDone(w.db, w.s1)!
    const second = checkWhenDone(w.db, w.s2)!
    startCheck(w.db, { runId: 'r1', target: { scope: 'story', id: w.storyId }, checks: ['facts', 'knowledge', 'timeline'] })
    const done = (): CheckDone[] => events.filter((e) => e.name === 'checks:done').map((e) => e.payload as CheckDone)
    // The waiting one for Scene 2 is dropped (said as stopped); the one already going isn't.
    expect(done()).toEqual([expect.objectContaining({ runId: second, status: 'stopped', background: true })])
    // Marking Scene 2 done again while Adam's check will get to it adds nothing.
    expect(checkWhenDone(w.db, w.s2)).toBeNull()
    const t = Date.now()
    await stopCheck(first)
    expect(Date.now() - t).toBeLessThan(1000)
    expect(done().find((d) => d.runId === first)).toMatchObject({ status: 'stopped' })
    await stopCheck('r1')
    expect(done().find((d) => d.runId === 'r1')).toMatchObject({ status: 'stopped' })
  })
})

describe('the memory keeper before a check', () => {
  it('reads a scene still waiting out its quiet time after a save, and resolves once it has', async () => {
    const w = world()
    const keeper = new Keeper({
      db: w.db,
      model: () => ({ target: model().target, choice: model().choice }),
      emitStatus: () => {},
      emitChanged: () => {},
      quietMs: 600_000,
      summaries: false,
      retryDelays: [0]
    })
    repo.saveSceneText(w.db, w.s2, null, 'Mara lost her left hand.')
    keeper.sceneSaved(w.s2)
    expect(kdb.needsReading(w.db, w.s2)).toBe(true)
    await keeper.whenRead(w.s2)
    expect(kdb.needsReading(w.db, w.s2)).toBe(false)
    keeper.stop()
  })
})
