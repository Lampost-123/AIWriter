import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AppEvents } from '@shared/api'
import type { CheckDone, CheckKind, CheckProgress } from '@shared/contracts/checks'
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
import { CHECK_SECOND_MARKER, CHECK_SECOND_SYSTEM, checkBudget, checkScene, rankByMeaning, type CheckOptions } from './run'
import { checkSections, gatherSceneCheck } from './context'
import { sceneSystem } from './prompts'
import { estimateTokens } from '../keeper/text'
import { SECOND_MARKER } from '../repair/second'
import { issueFindings } from '../chapterWriter/run'
import type { SceneContract } from '../ai/contract'
import { CHECK_CONTRACT_RULES, contractSection } from '../repair/contract'
import { checkReport, checkReportNow, reportItems } from './report'
import { checkWhenDone, resetRunsForTests, setRunDeps, startCheck, stopCheck, type RunDeps } from './runs'
import { Keeper } from '../keeper/engine'
import * as kdb from '../db/keeper'

// Each check here goes to the stand-in model several times over HTTP (the check, its second opinion, the contract's),
// and some tests run three checks: past 5 s even at a desk (2026-10-16). A real hang still fails.
vi.setConfig({ testTimeout: 20_000 })

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
    // Two focused requests: what is so (facts, timeline, continuity), then who knows what.
    expect(rec.messages[0].content.startsWith('[AIWRITE-CHECK v1] facts, timeline, continuity')).toBe(true)
    expect(gens.getGeneration(w.db, checkRecords(w.db, w.s2)[1]).messages[0].content.startsWith('[AIWRITE-CHECK v1] knowledge')).toBe(true)
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
      '[AIWRITE-CHECK v1] facts, timeline, continuity'
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

describe('the critic’s report', () => {
  it('says what each check looked at, what was good and where there were issues, and keeps the latest', async () => {
    const w = world()
    await checkScene({ ...options(w.db), after: 'draft' }, w.s2, ['facts', 'continuity', 'voice'])
    const report = checkReport(w.db, w.s2)!
    expect(report).toMatchObject({ sceneId: w.s2, after: 'draft', found: 2 })
    expect(report.items).toEqual([
      { check: 'facts', ok: false, note: 'Looked at facts.' },
      { check: 'continuity', ok: true, note: 'Looked at continuity.' },
      { check: 'voice', ok: true, note: 'Looked at voice.' }
    ])
    // The request gave the continuity check where things stood, and the story so far.
    const rec = gens.getGeneration(w.db, checkRecords(w.db, w.s2)[0])
    expect(rec.blocks.map((b) => b.id)).toEqual(expect.arrayContaining(['continuity', 'memory']))
    expect(rec.messages[1].content).toContain('## Where things stood as the previous scene ended')
  })

  it('without what each check looked at, still says whether it found anything', () => {
    const items = reportItems(['facts', 'timeline'], [], new Map([['facts', 2]]))
    expect(items).toEqual([
      { check: 'facts', ok: false, note: 'Found 2 things to look at.' },
      { check: 'timeline', ok: true, note: 'Nothing to report.' }
    ])
  })
})

describe('the scene’s contract in the chapter writer’s checks (long story memory fix 13)', () => {
  const contract = (tobinId: ID): SceneContract => ({
    asks: 'scene',
    items: [
      { code: 'C1', part: 'change', text: 'Mara pushes the door open', check: 'facts', entryIds: [] },
      { code: 'C2', part: 'change', text: 'Mara finds the ledger under the floor', check: 'facts', entryIds: [] },
      { code: 'C3', part: 'keep', text: 'Tobin is dead: died in the fire (since Ch 1, Sc 1)', check: 'facts', entryIds: [tobinId] }
    ]
  })

  it('goes through it in the request about what is so: no more requests; what it goes against and what isn’t shown yet are issues', async () => {
    const w = world()
    const out = await checkScene({ ...options(w.db), contract: contract(w.tobinId) }, w.s2, DONE_CHECKS)
    expect(out).toEqual({ status: 'done', found: 3 })
    // Two requests, as without it; only the first has the contract.
    const recs = checkRecords(w.db, w.s2).map((id) => gens.getGeneration(w.db, id))
    expect(recs).toHaveLength(2)
    expect(recs[0].messages[0].content).toContain(CHECK_CONTRACT_RULES)
    expect(recs[0].messages[1].content).toContain('## The scene’s contract (C ids)\nMust change by the end of the scene:\n- [C1] Mara pushes the door open')
    expect(recs[1].messages[0].content).not.toContain('contract')

    const rows = cdb.sceneIssueRows(w.db, w.s2).map((r) => ({ ...r, p: cdb.payloadOf(r) }))
    const dead = rows.find((r) => r.p.contract?.part === 'keep')!
    expect(dead).toMatchObject({ kind: 'fact', severity: 'warning', quote: '"You took your time," said Tobin.', message: 'Tobin is dead, but speaks here.' })
    expect(dead.p.sources).toEqual([{ kind: 'entry', entryId: w.tobinId, name: 'Tobin', field: null }])
    const notYet = rows.find((r) => r.p.contract?.part === 'change')!
    expect(notYet).toMatchObject({ quote: '', message: 'This scene was planned to show this, but the new words don’t yet: “Mara finds the ledger under the floor.” Write it in, or leave it for later?' })
    expect(checkReport(w.db, w.s2)!.contract!.items.map((i) => i.result)).toEqual(['kept', 'not yet', 'broken'])
  })

  it('only a check through the contract replaces what one found: the critic after a draft leaves those issues be', async () => {
    const w = world()
    await checkScene({ ...options(w.db), contract: contract(w.tobinId) }, w.s2, DONE_CHECKS)
    const fromContract = (): number => cdb.sceneIssueRows(w.db, w.s2).filter((r) => r.status === 'open' && cdb.payloadOf(r).contract).length
    expect(fromContract()).toBe(2)
    await checkScene(options(w.db), w.s2, DONE_CHECKS)
    expect(fromContract()).toBe(2)
    expect(checkReport(w.db, w.s2)!.contract!.items).toHaveLength(3)
    // The scene put right and checked through the contract again: what it found goes.
    repo.saveSceneText(w.db, w.s2, null, 'Mara pushed the door open and found the ledger under the floor.')
    await checkScene({ ...options(w.db), contract: contract(w.tobinId) }, w.s2, DONE_CHECKS)
    expect(fromContract()).toBe(0)
  })
})

describe('findings that stay current (2026-10-16)', () => {
  const contract = (tobinId: ID): SceneContract => ({
    asks: 'scene',
    items: [
      { code: 'C1', part: 'change', text: 'Mara pushes the door open', check: 'facts', entryIds: [] },
      { code: 'C2', part: 'change', text: 'Mara finds the ledger under the floor', check: 'facts', entryIds: [] },
      { code: 'C3', part: 'keep', text: 'Tobin is dead: died in the fire (since Ch 1, Sc 1)', check: 'facts', entryIds: [tobinId] }
    ]
  })
  const runDeps = (contractsOff = false) => {
    const done = new Map<ID, (d: CheckDone) => void>()
    setRunDeps({
      model: () => model(),
      prefs: () => PREFS,
      emit: (name, payload) => {
        if (name === 'checks:done') done.get((payload as CheckDone).runId)?.(payload as CheckDone)
      },
      retryDelays: [5],
      contractsOff: () => contractsOff
    })
    return (runId: ID): Promise<CheckDone> => new Promise((r) => done.set(runId, r))
  }
  const notYet = (db: CheckOptions['db'], sceneId: ID) =>
    cdb
      .sceneIssueRows(db, sceneId)
      .filter((r) => r.status === 'open' && cdb.payloadOf(r).contract?.missing)
      .map((r) => cdb.payloadOf(r).contract!.text)
  const lastFirstRequest = (db: CheckOptions['db'], sceneId: ID): string => {
    const recs = checkRecords(db, sceneId).map((id) => gens.getGeneration(db, id))
    // Each check is two requests; the contract rides in the first (what is so).
    return recs[recs.length - 2].messages[1].content
  }

  it('Check this scene and Mark done go through the scene’s latest contract, so a "not shown yet" question is settled once the words show it', async () => {
    const w = world()
    // The latest draft's contract, as checked (the chapter writer's check here; a draft landing keeps it the same way).
    await checkScene({ ...options(w.db), contract: contract(w.tobinId) }, w.s2, DONE_CHECKS)
    expect(notYet(w.db, w.s2)).toEqual(['Mara finds the ledger under the floor'])
    // Adam writes it in by hand, then asks for a check: the question goes.
    repo.saveSceneText(w.db, w.s2, null, `${SCENE_2} Mara found the ledger under the floor.`)
    const ended = runDeps()
    const end = ended('r1')
    startCheck(w.db, { runId: 'r1', target: { scope: 'scene', id: w.s2 }, checks: [...DONE_CHECKS] })
    expect((await end).status).toBe('complete')
    expect(lastFirstRequest(w.db, w.s2)).toContain('## The scene’s contract (C ids)')
    expect(notYet(w.db, w.s2)).toEqual([])
    expect(checkReport(w.db, w.s2)!.contract!.items.map((i) => i.result)).not.toContain('not yet')
    // Mark done's check goes through it too.
    const runId = checkWhenDone(w.db, w.s2)!
    expect((await ended(runId)).status).toBe('complete')
    expect(lastFirstRequest(w.db, w.s2)).toContain('## The scene’s contract (C ids)')
  })

  it('with contracts switched off, a check Adam asks for doesn’t go through it', async () => {
    const w = world()
    await checkScene({ ...options(w.db), contract: contract(w.tobinId) }, w.s2, DONE_CHECKS)
    const ended = runDeps(true)
    const end = ended('r2')
    startCheck(w.db, { runId: 'r2', target: { scope: 'scene', id: w.s2 }, checks: [...DONE_CHECKS] })
    expect((await end).status).toBe('complete')
    expect(lastFirstRequest(w.db, w.s2)).not.toContain('## The scene’s contract (C ids)')
  })

  it('the report keeps a fingerprint of the words it read, and a check of the scene brings back what Later put off', async () => {
    const w = world()
    await checkScene(options(w.db), w.s2, DONE_CHECKS)
    expect(checkReportNow(w.db, w.s2)!.changed).toBe(false)
    const eyes = cdb.sceneIssueRows(w.db, w.s2).find((r) => r.severity === 'warning')!
    cdb.setLater(w.db, eyes.id as ID)
    expect(cdb.payloadOf(cdb.issueRow(w.db, eyes.id as ID)!).later).toBeDefined()
    repo.saveSceneText(w.db, w.s2, null, `${SCENE_2} More.`)
    expect(checkReportNow(w.db, w.s2)!.changed).toBe(true)
    await checkScene(options(w.db), w.s2, DONE_CHECKS)
    expect(checkReportNow(w.db, w.s2)!.changed).toBe(false)
    expect(cdb.payloadOf(cdb.issueRow(w.db, eyes.id as ID)!).later).toBeUndefined()
  })
})

/** The stand-in model for some requests (`answer` gives the reply), the fake provider for the rest; keeps what was asked. */
function stubbed(answer: (system: string, user: string) => unknown): typeof fetch & { asked: { system: string; user: string }[] } {
  const asked: { system: string; user: string }[] = []
  const f = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { messages: { role: string; content: string }[] }
    const system = body.messages.find((m) => m.role === 'system')?.content ?? ''
    const user = body.messages.find((m) => m.role === 'user')?.content ?? ''
    asked.push({ system, user })
    const a = answer(system, user)
    if (a === null || a === undefined) return fetch(input, init)
    const content = typeof a === 'string' ? a : JSON.stringify(a)
    const chunk = { choices: [{ index: 0, delta: { content }, finish_reason: 'stop' }] }
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  }) as typeof fetch & { asked: { system: string; user: string }[] }
  f.asked = asked
  return f
}

/** The room a check request leaves for the scene, worked out as checkScene does. */
function roomFor(db: CheckOptions['db'], sceneId: ID, checks: CheckKind[], contextLength: number, contract: SceneContract | null): number {
  const ctx = gatherSceneCheck(db, sceneId, PREFS)
  const { available } = checkBudget({ choice: { ...model().choice, contextLength } }, sceneSystem(checks, !!contract))
  const terms = contract ? [contractSection(contract).section] : []
  const size = (s: ReturnType<typeof checkSections>): number => s.reduce((n, x) => n + estimateTokens(x.text) + 8, 0)
  let sections = [...checkSections(ctx, checks), ...terms]
  if (size(sections) > available * 0.6) sections = [...checkSections(ctx, checks, true), ...terms]
  return available - size(sections)
}

/** The smallest context length that leaves `room` for the scene. */
function contextFor(db: CheckOptions['db'], sceneId: ID, checks: CheckKind[], room: number, contract: SceneContract | null): number {
  let n = 1000
  while (roomFor(db, sceneId, checks, n, contract) < room) n += 10
  return n
}

describe('the scene’s contract after the review (fix 13)', () => {
  const contract = (tobinId: ID): SceneContract => ({
    asks: 'scene',
    items: [
      { code: 'C1', part: 'start', text: 'Mara holds the lamp', check: 'continuity', entryIds: [] },
      { code: 'C2', part: 'change', text: 'Mara finds the ledger under the floor', check: 'facts', entryIds: [] },
      { code: 'C3', part: 'keep', text: 'Tobin is dead: died in the fire (since Ch 1, Sc 1)', check: 'facts', entryIds: [tobinId] }
    ]
  })
  const fromContract = (db: CheckOptions['db'], sceneId: ID) => cdb.sceneIssueRows(db, sceneId).filter((r) => r.status === 'open' && cdb.payloadOf(r).contract)
  const sized = (contextLength: number): JobModel => ({ ...model(), choice: { ...model().choice, contextLength } })

  it('a reply with no contract list isn’t a check through it: nothing it found before goes, and the report keeps what it had', async () => {
    const w = world()
    await checkScene({ ...options(w.db), contract: contract(w.tobinId) }, w.s2, DONE_CHECKS)
    expect(fromContract(w.db, w.s2)).toHaveLength(2)
    const had = checkReport(w.db, w.s2)!.contract
    expect(had!.items.map((i) => i.result)).toEqual(['untouched', 'not yet', 'broken'])
    for (const reply of [{ issues: [], checked: [] }, { issues: [], checked: [], contract: [] }, { issues: [], checked: [], contract: [{ item: 'C9', result: 'kept' }] }]) {
      const fetchImpl = stubbed((system) => (system.includes(CHECK_CONTRACT_RULES) ? reply : null))
      expect((await checkScene({ ...options(w.db), contract: contract(w.tobinId), fetchImpl }, w.s2, DONE_CHECKS)).status).toBe('done')
      expect(fromContract(w.db, w.s2)).toHaveLength(2)
      expect(checkReport(w.db, w.s2)!.contract).toEqual(had)
    }
  })

  it('a long scene in parts: what must be true at the start goes with the first part only, and only its answer counts', async () => {
    const w = world()
    const opening = 'Mara pushed the door open with the lamp in her hand.'
    const later = 'Later Mara set the lamp down and found the ledger under the floor.'
    const filler = Array.from({ length: 40 }, (_, i) => `The rain kept on over the roofs of the town and the gutters ran with it, hour after hour, for the ${i + 1}th time.`)
    repo.saveSceneText(w.db, w.s2, null, [opening, ...filler, later].join('\n\n'))
    const c = contract(w.tobinId)
    const fetchImpl = stubbed((system, user) => {
      if (!system.includes(CHECK_CONTRACT_RULES)) return null
      return user.includes('(part 1 of')
        ? { issues: [], checked: [], contract: [{ item: 'C1', result: 'kept', quote: opening }, { item: 'C2', result: 'not yet' }, { item: 'C3', result: 'untouched' }] }
        : { issues: [], checked: [], contract: [{ item: 'C1', result: 'broken', quote: later, why: 'She has put the lamp down.' }, { item: 'C2', result: 'kept', quote: later }] }
    })
    const out = await checkScene({ ...options(w.db, sized(contextFor(w.db, w.s2, ['facts'], 400, c))), contract: c, fetchImpl }, w.s2, ['facts'])
    expect(out.status).toBe('done')
    const parts = fetchImpl.asked.filter((a) => a.system.includes(CHECK_CONTRACT_RULES))
    expect(parts.length).toBeGreaterThan(1)
    expect(parts[0].user).toContain('- [C1] Mara holds the lamp')
    for (const p of parts.slice(1)) {
      expect(p.user).not.toContain('[C1]')
      expect(p.user).toContain('- [C2] Mara finds the ledger under the floor')
    }
    // Putting the lamp down later in the scene doesn't go against how it starts; the ledger is found in a later part.
    expect(fromContract(w.db, w.s2)).toHaveLength(0)
    expect(checkReport(w.db, w.s2)!.contract!.items.map((i) => i.result)).toEqual(['kept', 'kept', 'untouched'])
  })

  it('too little room for the contract: it is left out, never the check', async () => {
    const w = world()
    const c = contract(w.tobinId)
    const contextLength = contextFor(w.db, w.s2, ['facts'], 300, null)
    // With the contract this model couldn't have checked the scene at all.
    expect(roomFor(w.db, w.s2, ['facts'], contextLength, c)).toBeLessThan(250)
    const fetchImpl = stubbed(() => null)
    const out = await checkScene({ ...options(w.db, sized(contextLength)), contract: c, fetchImpl }, w.s2, ['facts'])
    expect(out).toMatchObject({ status: 'done' })
    expect(fetchImpl.asked[0].system).not.toContain(CHECK_CONTRACT_RULES)
    expect(fetchImpl.asked[0].user).not.toContain('contract')
    expect(fromContract(w.db, w.s2)).toHaveLength(0)
  })

  it('contracts switched off: a whole check takes away what one found, and the report’s contract', async () => {
    const w = world()
    await checkScene({ ...options(w.db), contract: contract(w.tobinId) }, w.s2, DONE_CHECKS)
    expect(fromContract(w.db, w.s2)).toHaveLength(2)
    // The critic after a draft, contracts still on: they stay.
    await checkScene(options(w.db), w.s2, DONE_CHECKS)
    expect(fromContract(w.db, w.s2)).toHaveLength(2)
    await checkScene({ ...options(w.db), contractsOff: true }, w.s2, DONE_CHECKS)
    expect(fromContract(w.db, w.s2)).toHaveLength(0)
    expect(checkReport(w.db, w.s2)!.contract).toBeUndefined()
    // The chapter writer's review is never sent them again.
    expect(issueFindings(w.db, w.s2).some((f) => f.kind.includes('scene contract'))).toBe(false)
  })

  it('the chapter writer puts right only what a second opinion agreed goes against it; what isn’t shown yet is Adam’s', async () => {
    const ruled = async (second: unknown) => {
      const w = world()
      const fetchImpl = stubbed((system) => (system.startsWith(SECOND_MARKER) ? second : null))
      await checkScene({ ...options(w.db), contract: contract(w.tobinId), fetchImpl }, w.s2, DONE_CHECKS)
      const asked = fetchImpl.asked.filter((a) => a.system.startsWith(SECOND_MARKER))
      const rows = fromContract(w.db, w.s2).map((r) => ({ quote: r.quote, ...cdb.payloadOf(r).contract! }))
      const review = issueFindings(w.db, w.s2).filter((f) => f.kind.includes('scene contract'))
      return { asked, rows, review }
    }
    // Notes in order: the broken item (Tobin speaks), then what isn't shown (the ledger).
    const agreed = await ruled({ verdicts: [{ n: 1, real: true }, { n: 2, real: true }] })
    expect(agreed.asked).toHaveLength(1)
    expect(agreed.asked[0].user).toContain('1. Quote: ""You took your time," said Tobin."')
    expect(agreed.asked[0].user).toContain('2. Not shown · Line: [C2] Mara finds the ledger under the floor')
    expect(agreed.rows.find((r) => r.part === 'keep')).toMatchObject({ confirmed: true, quote: '"You took your time," said Tobin.' })
    expect(agreed.rows.find((r) => r.part === 'change')).toMatchObject({ missing: true })
    expect(agreed.review.map((f) => f.quote)).toEqual(['"You took your time," said Tobin.'])

    // Ruled not real: nothing to put right, and nothing asked about it.
    const rejected = await ruled({ verdicts: [{ n: 1, real: false }, { n: 2, real: true }] })
    expect(rejected.rows.map((r) => r.part)).toEqual(['change'])
    expect(rejected.review).toEqual([])

    // No ruling (a reply it can't read): asked, but never put right without Adam.
    const unread = await ruled('I would rather not say.')
    expect(unread.rows.find((r) => r.part === 'keep')!.confirmed).toBeUndefined()
    expect(unread.review).toEqual([])
  })
})

describe('a second opinion on what a whole check found (2026-10-16)', () => {
  /** The note number the second opinion's request gives the finding quoting `words`. */
  const noteOf = (user: string, words: string): number => Number(user.split('\n').find((l) => /^\d+\. Quote: /.test(l) && l.includes(words))!.match(/^(\d+)/)![1])
  const ruled = async (answer: (user: string) => unknown, checks: CheckKind[] = DONE_CHECKS, check?: (system: string) => unknown) => {
    const w = world()
    const fetchImpl = stubbed((system, user) => (system.startsWith(CHECK_SECOND_MARKER) ? answer(user) : (check?.(system) ?? null)))
    const out = await checkScene({ ...options(w.db), fetchImpl }, w.s2, checks)
    const asked = fetchImpl.asked.filter((a) => a.system.startsWith(CHECK_SECOND_MARKER))
    const quotes = cdb
      .sceneIssueRows(w.db, w.s2)
      .filter((r) => r.status === 'open')
      .map((r) => r.quote as string)
      .sort()
    return { w, out, asked, quotes }
  }

  it('asks once, each finding citing its entry with what the memory and the scene say, and drops what it rules not real', async () => {
    const r = await ruled((user) => ({ verdicts: [{ n: noteOf(user, 'eyes were green'), reason: 'Firelight can make blue eyes look green.', real: false }] }))
    expect(r.asked).toHaveLength(1)
    expect(r.asked[0].system).toBe(CHECK_SECOND_SYSTEM)
    expect(r.asked[0].user).toMatch(/Quote: "Mara's eyes were green in the firelight\." · Line: \[E\d+\] Mara \(character; named in the scene\) \(its entry is above\) · The note: .*\(The memory says: blue\. The scene says: green\.\)/)
    // What the checks were given, and the scene.
    expect(r.asked[0].user).toContain('## What the check was given\n## The scene card')
    expect(r.asked[0].user).toContain('"""\nMara pushed the door open.')
    expect(r.out).toEqual({ status: 'done', found: 1 })
    expect(r.quotes).toEqual(['"You took your time," said Tobin.'])
  })

  it('keeps every finding when the reply can’t be read or the call fails: never loses a real one', async () => {
    const both = ['"You took your time," said Tobin.', "Mara's eyes were green in the firelight."]
    expect((await ruled(() => 'I would rather not say.')).quotes).toEqual(both)
    const w = world()
    const failing = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { messages: { role: string; content: string }[] }
      if (body.messages[0]?.content.startsWith(CHECK_SECOND_MARKER)) return new Response('down', { status: 500 })
      return fetch(input, init)
    }) as typeof fetch
    expect(await checkScene({ ...options(w.db), fetchImpl: failing }, w.s2, DONE_CHECKS)).toEqual({ status: 'done', found: 2 })
  })

  it('keeps what it rules real, and never asks about voice or style, nor when nothing was found', async () => {
    const real = await ruled(() => ({ verdicts: [{ n: 1, real: true }, { n: 2, real: true }] }))
    expect(real.quotes).toHaveLength(2)
    const voice = await ruled(
      () => ({ verdicts: [{ n: 1, real: false }] }),
      ['voice'],
      (system) => (system.startsWith('[AIWRITE-CHECK v1] voice') ? { issues: [{ check: 'voice', quote: 'You took your time', message: 'Tobin never says that.' }], checked: [] } : null)
    )
    expect(voice.asked).toHaveLength(0)
    // (The free rules still find the dead man speaking.)
    expect(voice.quotes).toContain('You took your time')
    const w = world()
    const fetchImpl = stubbed(() => null)
    await checkScene({ ...options(w.db), fetchImpl }, w.s1, DONE_CHECKS)
    expect(fetchImpl.asked.some((a) => a.system.startsWith(CHECK_SECOND_MARKER))).toBe(false)
  })
})

describe('the facts a scene touches, by meaning (2026-10-16)', () => {
  it('ranks them by meaning too when the search model is on; by keyword alone when it is off, slow or failing', async () => {
    const w = world()
    mem.insertChange(w.db, {
      entryId: w.maraId,
      anchor: 'scene',
      sceneId: w.s1,
      kind: 'knowledge',
      payload: { factId: 'f-oath', fact: 'Tobin swore an oath to wait at the ferry.' },
      origin: 'text'
    })
    const ctx = gatherSceneCheck(w.db, w.s2, PREFS)
    expect(ctx.factRank?.has('f-oath')).toBe(false)
    const asked: { queries: string[]; docs: string[] }[] = []
    await rankByMeaning(
      {
        byMeaning: async (queries, docs) => {
          asked.push({ queries, docs: docs.map((d) => d.key) })
          return new Map([['f-oath', 0.9]])
        },
        stopped: () => false
      },
      ctx
    )
    expect(asked).toEqual([{ queries: [SCENE_2], docs: ['f-oath'] }])
    expect(ctx.factRank?.get('f-oath')).toBe(0.9)
    for (const byMeaning of [async () => null, async () => Promise.reject(new Error('no model'))]) {
      const again = gatherSceneCheck(w.db, w.s2, PREFS)
      await rankByMeaning({ byMeaning, stopped: () => false }, again)
      expect(again.factRank?.has('f-oath')).toBe(false)
    }
  })
})
