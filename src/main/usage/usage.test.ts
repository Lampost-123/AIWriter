// Usage and cost (milestone 6): adding up the spending (by day, model and job, months, unknown costs, several
// worlds, no double counting), the limit's rules (80% once, the ask, Carry on this month, the month turning)
// and automatic work waiting while the limit is reached.

import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { SPEND_LIMIT, dollars, limitDollars, reachedWords } from '@shared/contracts/usage'
import type { ID } from '@shared/types'
import { memoryDb, memoryWorld } from '../../../tests/unit/helpers'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import * as repo from '../db/repo'
import * as gens from '../db/generations'
import * as kdb from '../db/keeper'
import { Keeper } from '../keeper/engine'
import type { MemoryModel } from '../keeper/model'
import { addUp, monthCost, tallyWorld, type WorldTally } from './aggregate'
import { buildReport, jobGroup, periodDays } from './report'
import { NEAR_SHARE, carriedOn, cleanLimit, msToNextMonth, noticeFor, spendStateOf, toastShown } from './limit'
import { UsageLibrary } from './library'
import { beforeAiCall, heldAt, pausedNote, setSpendHooks } from './gate'

/** Days as UTC dates, so the tests don't depend on the computer's time zone. */
const utcDay = (iso: string): string => iso.slice(0, 10)

let seq = 0
interface Row {
  job?: string
  model?: string
  provider?: string
  status?: string
  pt?: number | null
  ct?: number | null
  cost?: number | null
  at: string
  response?: string
}
/** A generation record written straight to the table, as the AI code leaves it. */
function addRow(db: Database.Database, r: Row): ID {
  const id = `g${++seq}`
  db.prepare(
    `INSERT INTO generations (id, scene_id, job, status, error, provider_id, provider_name, model_id, params_json, direction, blocks_json,
      messages_json, budget_json, response, prompt_tokens, completion_tokens, cost, created_at, finished_at)
     VALUES (?, '', ?, ?, NULL, 'p1', ?, ?, '{}', '', '[]', '[]', '{}', ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    r.job ?? 'draft',
    r.status ?? 'complete',
    r.provider ?? 'OpenRouter',
    r.model ?? 'acme/writer',
    r.response ?? 'Some words.',
    r.pt === undefined ? 100 : r.pt,
    r.ct === undefined ? 200 : r.ct,
    r.cost === undefined ? 0.01 : r.cost,
    r.at,
    r.at
  )
  return id
}

const tally = (db: Database.Database, before: WorldTally | null = null): WorldTally => tallyWorld(db, before, utcDay)
const total = (t: WorldTally) => addUp(Object.values(t.buckets))

describe('adding up one world', () => {
  it("leaves out a copy's records from before it was copied (the original counts them)", () => {
    const db = memoryDb()
    addRow(db, { cost: 0.5, at: '2026-10-01T09:00:00.000Z' })
    addRow(db, { cost: 0.25, at: '2026-10-01T10:00:00.000Z' })
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('usage_from_rowid', '2')").run()
    expect(total(tally(db)).calls).toBe(0)
    addRow(db, { cost: 0.1, at: '2026-10-02T10:00:00.000Z' })
    expect(total(tally(db)).cost).toBeCloseTo(0.1)
  })

  it('counts every call with its tokens and cost, by day, job, model and provider', () => {
    const db = memoryDb()
    addRow(db, { job: 'draft', cost: 0.02, at: '2026-10-01T09:00:00.000Z' })
    addRow(db, { job: 'draft', cost: 0.03, at: '2026-10-01T10:00:00.000Z' })
    addRow(db, { job: 'memory', model: 'acme/small', cost: 0.001, pt: 50, ct: 10, at: '2026-10-02T10:00:00.000Z' })
    const t = tally(db)
    expect(total(t)).toMatchObject({ calls: 3, promptTokens: 250, completionTokens: 410 })
    expect(total(t).cost).toBeCloseTo(0.051)
    expect(Object.keys(t.buckets).sort()).toEqual([
      '2026-10-01\tdraft\tacme/writer\tOpenRouter',
      '2026-10-02\tmemory\tacme/small\tOpenRouter'
    ])
    expect(t.buckets['2026-10-01\tdraft\tacme/writer\tOpenRouter'].calls).toBe(2)
  })

  it('says which calls had no price, and which prices are estimates; a request turned down before it ran is no call', () => {
    const db = memoryDb()
    addRow(db, { cost: null, at: '2026-10-01T09:00:00.000Z' }) // tokens but no price
    addRow(db, { cost: 0.004, pt: null, ct: null, at: '2026-10-01T09:01:00.000Z' }) // estimated
    addRow(db, { status: 'error', cost: null, pt: null, ct: null, response: '', at: '2026-10-01T09:02:00.000Z' }) // never ran
    const t = total(tally(db))
    expect(t).toMatchObject({ calls: 2, unpriced: 1, estimated: 1 })
    expect(t.cost).toBeCloseTo(0.004)
  })

  it("never counts the memory keeper twice: memory_runs only adds up its generation records", () => {
    const db = memoryWorld()
    const sceneId = repo.getOutline(db, repo.listStories(db)[0].id).scenes[0].id
    const a = addRow(db, { job: 'memory', cost: 0.01, at: '2026-10-01T09:00:00.000Z' })
    const b = addRow(db, { job: 'summary', cost: 0.02, at: '2026-10-01T09:01:00.000Z' })
    const run = kdb.startRun(db, sceneId, 1)
    kdb.finishRun(db, run, 'done', null, { providerId: 'p1', modelId: 'acme/writer', promptTokens: 200, completionTokens: 400, cost: 0.03, generationIds: [a, b] })
    expect(total(tally(db)).cost).toBeCloseTo(0.03)
    expect(total(tally(db)).calls).toBe(2)
  })

  it('reads only what is new, and picks up a call that was still being written', () => {
    const db = memoryDb()
    addRow(db, { cost: 0.01, at: '2026-10-01T09:00:00.000Z' })
    const writing = addRow(db, { status: 'streaming', cost: null, pt: null, ct: null, response: 'Half', at: '2026-10-01T09:05:00.000Z' })
    const first = tally(db)
    expect(total(first).calls).toBe(1)
    expect(first.pending).toHaveLength(1)
    db.prepare("UPDATE generations SET status = 'complete', cost = 0.05, prompt_tokens = 10, completion_tokens = 20 WHERE id = ?").run(writing)
    addRow(db, { cost: 0.02, at: '2026-10-02T09:00:00.000Z' })
    const next = tally(db, first)
    expect(next.pending).toEqual([])
    expect(total(next).calls).toBe(3)
    expect(total(next).cost).toBeCloseTo(0.08)
    // The same as reading it all from scratch, and the first tally is left as it was.
    expect(next.buckets).toEqual(tally(db).buckets)
    expect(total(first).calls).toBe(1)
  })

  it("keeps spending whose records went with a deleted scene (that money was spent)", () => {
    const db = memoryDb()
    const old = addRow(db, { cost: 0.5, at: '2026-10-01T09:00:00.000Z' })
    addRow(db, { cost: 0.25, at: '2026-10-02T09:00:00.000Z' })
    const before = tally(db)
    db.prepare('DELETE FROM generations WHERE id = ?').run(old)
    addRow(db, { cost: 0.1, at: '2026-10-03T09:00:00.000Z' })
    const after = tally(db, before)
    expect(total(after).cost).toBeCloseTo(0.85)
    expect(monthCost(after, '2026-10')).toBeCloseTo(0.85)
    expect(monthCost(after, '2026-09')).toBe(0)
  })
})

describe('the usage page', () => {
  const today = new Date(2026, 9, 15, 12) // 15 October 2026, local time
  const local = (y: number, m: number, d: number): string => new Date(y, m - 1, d, 12).toISOString()

  function worldWith(rows: Row[]): WorldTally {
    const db = memoryDb()
    for (const r of rows) addRow(db, r)
    return tallyWorld(db, null)
  }

  it('shows this month day by day, with the days still to come drawn empty', () => {
    const t = worldWith([
      { cost: 1, at: local(2026, 10, 1) },
      { cost: 2, at: local(2026, 10, 15) },
      { cost: 4, at: local(2026, 9, 30) }
    ])
    const r = buildReport({ period: 'this-month', scope: 'library', tallies: [t], everyTally: [t], today, worldName: 'A', unreadable: 0 })
    expect(r.unit).toBe('day')
    expect(r.bars).toHaveLength(31)
    expect(r.from).toBe('2026-10-01')
    expect(r.to).toBe('2026-10-31')
    expect(r.bars[0]).toMatchObject({ label: '1 Oct', cost: 1, ahead: false })
    expect(r.bars[14]).toMatchObject({ key: '2026-10-15', cost: 2, ahead: false })
    expect(r.bars[15].ahead).toBe(true)
    expect(r.total.cost).toBe(3)
  })

  it('switches to last month, the last 30 days and all time (by month)', () => {
    const t = worldWith([
      { cost: 1, at: local(2026, 10, 1) },
      { cost: 4, at: local(2026, 9, 30) },
      { cost: 8, at: local(2026, 7, 4) }
    ])
    const of = (period: 'last-month' | 'last-30-days' | 'all-time') =>
      buildReport({ period, scope: 'library', tallies: [t], everyTally: [t], today, worldName: null, unreadable: 0 })
    expect(of('last-month').total.cost).toBe(4)
    expect(of('last-month').bars).toHaveLength(30)
    expect(of('last-30-days').total.cost).toBe(5)
    expect(of('last-30-days').bars).toHaveLength(30)
    expect(of('last-30-days').bars.at(-1)?.key).toBe('2026-10-15')
    const all = of('all-time')
    expect(all.unit).toBe('month')
    expect(all.bars.map((b) => b.label)).toEqual(['Jul 2026', 'Aug 2026', 'Sep 2026', 'Oct 2026'])
    expect(all.bars.map((b) => b.cost)).toEqual([8, 0, 4, 1])
    expect(all.total.cost).toBe(13)
  })

  it('periods cover whole months, across a year end', () => {
    expect(periodDays('last-month', new Date(2027, 0, 10))).toMatchObject({ from: '2026-12-01', to: '2026-12-31' })
    expect(periodDays('this-month', new Date(2028, 1, 3))?.days).toHaveLength(29)
  })

  it('adds up several worlds, by model and by job in plain words, most spent first', () => {
    const a = worldWith([
      { job: 'draft', model: 'acme/writer', cost: 1, at: local(2026, 10, 2) },
      { job: 'memory', model: 'acme/small', cost: 0.25, at: local(2026, 10, 2) }
    ])
    const b = worldWith([
      { job: 'beat', model: 'acme/writer', cost: 2, at: local(2026, 10, 3) },
      { job: 'summary', model: 'acme/small', cost: 0.25, at: local(2026, 10, 3) },
      { job: 'ideas', model: 'acme/chat', provider: 'Local', cost: null, at: local(2026, 10, 3) },
      { job: 'import', model: 'acme/small', cost: 0.1, at: local(2026, 10, 3) }
    ])
    const r = buildReport({ period: 'this-month', scope: 'library', tallies: [a, b], everyTally: [a, b], today, worldName: 'A', unreadable: 1 })
    expect(r.total.cost).toBeCloseTo(3.6)
    expect(r.total.calls).toBe(6)
    expect(r.total.unpriced).toBe(1)
    expect(r.worlds).toBe(2)
    expect(r.unreadable).toBe(1)
    expect(r.models.map((m) => [m.modelId, m.cost])).toEqual([
      ['acme/writer', 3],
      ['acme/small', 0.6],
      ['acme/chat', 0]
    ])
    expect(r.models[2]).toMatchObject({ provider: 'Local', unpriced: 1 })
    expect(r.jobs.map((j) => j.label)).toEqual(['Writing', 'Memory', 'Import', 'Chat and brainstorm'])
    // Only the open world.
    const own = buildReport({ period: 'this-month', scope: 'world', tallies: [a], everyTally: [a, b], today, worldName: 'A', unreadable: 0 })
    expect(own.total.cost).toBeCloseTo(1.25)
  })

  it('says when nothing has ever been spent (the empty state)', () => {
    const empty = tallyWorld(memoryDb(), null)
    const r = buildReport({ period: 'all-time', scope: 'library', tallies: [empty], everyTally: [empty], today, worldName: null, unreadable: 0 })
    expect(r.anyEver).toBe(false)
    expect(r.bars).toEqual([])
    expect(r.from).toBeNull()
  })

  it('names every job in plain words', () => {
    expect(jobGroup('draft').label).toBe('Writing')
    expect(jobGroup('check').label).toBe('Consistency checks')
    expect(jobGroup('speech').label).toBe('Read aloud')
    expect(jobGroup('world').label).toBe('World builder')
    expect(jobGroup('builder').label).toBe('Character builder')
    expect(jobGroup('story').label).toBe('Story flows')
    expect(jobGroup('import_catch-up').label).toBe('Import catch up')
  })
})

describe('dollars', () => {
  it('shows 2 decimals, and more for tiny sums', () => {
    expect(dollars(0)).toBe('$0.00')
    expect(dollars(12.4)).toBe('$12.40')
    expect(dollars(1234.567)).toBe('$1,234.57')
    expect(dollars(0.0042)).toBe('$0.0042')
    expect(dollars(0.00031)).toBe('$0.00031')
    expect(dollars(0.005)).toBe('$0.005')
    expect(limitDollars(20)).toBe('$20')
    expect(limitDollars(12.5)).toBe('$12.50')
    expect(reachedWords(20)).toBe("This month's AI spending has reached your $20 limit.")
  })
})

describe('the monthly limit', () => {
  const month = '2026-10'

  it('says and holds nothing without a limit (the default)', () => {
    expect(spendStateOf(500, null, null, month)).toMatchObject({ level: 'none', paused: false, toast: null })
  })

  it('warns once at 80%, then once more when the limit is reached', () => {
    let notice = null as ReturnType<typeof noticeFor> | null
    expect(spendStateOf(15.99, 20, notice, month)).toMatchObject({ level: 'under', toast: null })
    expect(spendStateOf(20 * NEAR_SHARE, 20, notice, month)).toMatchObject({ level: 'near', toast: 'near', paused: false })
    notice = toastShown(notice, month, 20, 'near')
    expect(spendStateOf(17, 20, notice, month).toast).toBeNull()
    const reached = spendStateOf(20, 20, notice, month)
    expect(reached).toMatchObject({ level: 'reached', toast: 'reached', paused: true })
    notice = toastShown(notice, month, 20, 'reached')
    expect(spendStateOf(25, 20, notice, month)).toMatchObject({ toast: null, paused: true })
  })

  it('going straight past the limit says it once, not the 80% warning as well', () => {
    const notice = toastShown(null, month, 20, 'reached')
    expect(spendStateOf(19, 20, notice, month).toast).toBeNull()
  })

  it('"Carry on this month" stops the asking until the month turns or the limit changes', () => {
    const notice = carriedOn(null, month, 20)
    expect(spendStateOf(30, 20, notice, month)).toMatchObject({ carryOn: true, paused: false, toast: null })
    // The month turns: asked again once the new month reaches the limit.
    expect(spendStateOf(30, 20, notice, '2026-11')).toMatchObject({ carryOn: false, paused: true })
    // A new limit starts afresh too.
    expect(spendStateOf(30, 25, notice, month)).toMatchObject({ carryOn: false, paused: true, toast: 'reached' })
  })

  it('a new month starts with nothing said', () => {
    const notice = toastShown(null, month, 20, 'near')
    expect(spendStateOf(17, 20, notice, '2026-11').toast).toBe('near')
    expect(noticeFor(notice, '2026-11', 20)).toEqual({ month: '2026-11', limit: 20, warned: false, reached: false, carryOn: false })
  })

  it('takes dollars and cents, and says why anything else is refused', () => {
    expect(cleanLimit('')).toEqual({ ok: true, limit: null })
    expect(cleanLimit(null)).toEqual({ ok: true, limit: null })
    expect(cleanLimit('$20')).toEqual({ ok: true, limit: 20 })
    expect(cleanLimit('12.499')).toEqual({ ok: true, limit: 12.5 })
    expect(cleanLimit(0)).toMatchObject({ ok: false })
    expect(cleanLimit('-3')).toMatchObject({ ok: false })
    expect(cleanLimit('lots')).toMatchObject({ ok: false, error: expect.stringContaining('above $0') })
  })

  it('knows when next month starts', () => {
    const now = new Date(2026, 9, 31, 23, 59, 0)
    expect(msToNextMonth(now)).toBe(60_000)
  })
})

describe('AI calls while the limit is reached', () => {
  afterEach(() => setSpendHooks(null))

  it('refuses a call as it is recorded, with the code the window asks on', () => {
    setSpendHooks({ held: () => 20, finished: () => {} })
    const db = memoryDb()
    let err: unknown
    try {
      gens.insertGeneration(db, {
        id: 'x',
        sceneId: '',
        job: 'draft',
        providerId: 'p1',
        providerName: 'Fake',
        modelId: 'm',
        params: { temperature: 1, top_p: 1, max_tokens: 10 },
        direction: '',
        blocks: [],
        messages: [],
        budget: { contextLength: 0, reserved: 0, available: 0, used: 0 },
        entries: [],
        createdAt: '2026-10-01T00:00:00.000Z'
      })
    } catch (e) {
      err = e
    }
    expect(err).toMatchObject({ code: SPEND_LIMIT, message: reachedWords(20) })
    expect(db.prepare('SELECT count(*) AS n FROM generations').get()).toEqual({ n: 0 })
    expect(() => beforeAiCall()).toThrow(reachedWords(20))
  })

  it('lets calls go when nothing holds them, and tells the spending when one finishes', () => {
    const finished: unknown[] = []
    setSpendHooks({ held: () => null, finished: (d) => finished.push(d) })
    expect(heldAt()).toBeNull()
    expect(pausedNote()).toBeNull()
    const db = memoryDb()
    addRow(db, { status: 'streaming', at: '2026-10-01T00:00:00.000Z' })
    gens.finishGeneration(db, `g${seq}`, {
      status: 'complete',
      error: null,
      response: 'Done.',
      promptTokens: 1,
      completionTokens: 1,
      cost: 0.01,
      finishedAt: '2026-10-01T00:00:01.000Z'
    })
    expect(finished).toEqual([db])
  })
})

describe('the memory keeper waits while the limit is reached', () => {
  let fake: FakeProvider
  beforeAll(async () => {
    fake = await startFakeProvider({ delayMs: 0 })
  })
  afterAll(() => fake.close())
  afterEach(() => setSpendHooks(null))

  const model = (): MemoryModel => ({
    target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: 'test' },
    choice: { providerId: 'p1', modelId: 'fake/writer', label: 'fake/writer', contextLength: 32000, promptPrice: null, completionPrice: null }
  })

  it('leaves the scene waiting with the reason, and reads it once Adam carries on', async () => {
    let limit: number | null = 20
    setSpendHooks({ held: () => limit, finished: () => {} })
    const db = memoryWorld()
    const sceneId = repo.getOutline(db, repo.listStories(db)[0].id).scenes[0].id
    repo.saveSceneText(
      db,
      sceneId,
      { type: 'doc', content: [{ type: 'paragraph', attrs: { pid: 'p1' }, content: [{ type: 'text', text: 'Mara Venn crossed the bridge at dusk.' }] }] },
      'Mara Venn crossed the bridge at dusk.'
    )
    kdb.noteSceneSaved(db, sceneId)
    // As keeper/index.ts gives it its model.
    const k = new Keeper({
      db,
      model: () => {
        const paused = pausedNote()
        return paused ? { error: paused } : model()
      },
      emitStatus: () => {},
      emitChanged: () => {},
      quietMs: 60_000,
      summaries: false,
      retryDelays: [0]
    })
    k.start()
    await k.whenIdle()
    const calls = (): number => (db.prepare('SELECT count(*) AS n FROM generations').get() as { n: number }).n
    expect(calls()).toBe(0)
    const paused = k.status()
    expect(paused.behind).toBe(1)
    expect(paused.failed).toBe(0)
    expect(paused.error).toContain(reachedWords(20))
    expect(paused.error).not.toMatch(/\bSettings\b/)

    // "Carry on this month": the memory catches up.
    limit = null
    k.updateNow()
    await k.whenIdle()
    expect(calls()).toBeGreaterThan(0)
    expect(k.status()).toMatchObject({ behind: 0, error: null })
    k.stop()
  })

  it('a read stopped part way when the limit is reached says why, and goes on once Adam carries on', async () => {
    // Free when the run starts, reached by the time its call would be sent.
    let looks = 0
    let carriedOn = false
    setSpendHooks({ held: () => (carriedOn ? null : ++looks > 1 ? 20 : null), finished: () => {} })
    const db = memoryWorld()
    const sceneId = repo.getOutline(db, repo.listStories(db)[0].id).scenes[0].id
    repo.saveSceneText(
      db,
      sceneId,
      { type: 'doc', content: [{ type: 'paragraph', attrs: { pid: 'p1' }, content: [{ type: 'text', text: 'Mara Venn crossed the bridge at dusk.' }] }] },
      'Mara Venn crossed the bridge at dusk.'
    )
    kdb.noteSceneSaved(db, sceneId)
    const k = new Keeper({
      db,
      model: () => {
        const paused = pausedNote()
        return paused ? { error: paused } : model()
      },
      emitStatus: () => {},
      emitChanged: () => {},
      quietMs: 60_000,
      summaries: false,
      retryDelays: [0]
    })
    k.start()
    await k.whenIdle()
    expect(k.status()).toMatchObject({ behind: 1, failed: 0 })
    expect(k.status().error).toContain(reachedWords(20))
    carriedOn = true
    k.updateNow()
    await k.whenIdle()
    expect(k.status()).toMatchObject({ behind: 0, error: null })
    k.stop()
  })
})

describe('every world in the library', () => {
  let dir: string
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'aiwrite-usage-'))
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  function makeWorld(name: string, rows: Row[]): string {
    const folder = join(dir, 'library', name)
    mkdirSync(folder, { recursive: true })
    const db = new Database(join(folder, 'world.db'))
    db.exec((memoryDb().prepare("SELECT group_concat(sql, ';') AS s FROM sqlite_master WHERE sql IS NOT NULL").get() as { s: string }).s)
    db.prepare("INSERT INTO meta (key, value) VALUES ('name', ?)").run(name)
    for (const r of rows) addRow(db, r)
    db.close()
    return folder
  }

  it('reads other worlds read-only, the open one through its own connection, and keeps the figures between runs', () => {
    const at = new Date(2026, 9, 5, 12).toISOString()
    makeWorld('Alpha', [{ cost: 1, at }])
    const beta = makeWorld('Beta', [{ cost: 2, at }])
    const openFolder = join(dir, 'library', 'Gamma')
    mkdirSync(openFolder)
    writeFileSync(join(openFolder, 'world.db'), '')
    const openDb = memoryDb()
    addRow(openDb, { cost: 4, at })
    // Not a world: no world.db.
    mkdirSync(join(dir, 'library', 'Notes'))

    const cacheFile = join(dir, 'usage-cache.json')
    const lib = new UsageLibrary({ cacheFile, zone: 'test' })
    lib.refreshAll(join(dir, 'library'), { folder: openFolder, db: openDb, name: 'Gamma' })
    expect(lib.tallies().map((w) => w.name).sort()).toEqual(['Alpha', 'Beta', 'Gamma'])
    expect(lib.monthSpend('2026-10')).toBeCloseTo(7)

    // Another world changes on disk: read again; the open one gains a call.
    const b = new Database(join(beta, 'world.db'))
    addRow(b, { cost: 8, at })
    b.close()
    addRow(openDb, { cost: 16, at })
    lib.refreshAll(join(dir, 'library'), { folder: openFolder, db: openDb, name: 'Gamma' })
    expect(lib.monthSpend('2026-10')).toBeCloseTo(31)
    lib.save()

    // A fresh start reads the kept figures; only what changed is read again.
    const again = new UsageLibrary({ cacheFile, zone: 'test' })
    again.refreshAll(join(dir, 'library'), { folder: openFolder, db: openDb, name: 'Gamma' })
    expect(again.monthSpend('2026-10')).toBeCloseTo(31)
    // Kept figures from another time zone are read afresh, with the same result.
    const elsewhere = new UsageLibrary({ cacheFile, zone: 'elsewhere' })
    elsewhere.refreshAll(join(dir, 'library'), { folder: openFolder, db: openDb, name: 'Gamma' })
    expect(elsewhere.monthSpend('2026-10')).toBeCloseTo(31)
  })

  it('counts a world it cannot read, and never fails because of it', () => {
    const folder = join(dir, 'broken-lib', 'Broken')
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'world.db'), 'not a database at all, just some words in a file')
    const lib = new UsageLibrary({ cacheFile: null, zone: 'test' })
    lib.refreshAll(join(dir, 'broken-lib'), null)
    expect(lib.unreadableCount).toBe(1)
    expect(lib.monthSpend('2026-10')).toBe(0)
  })
})
