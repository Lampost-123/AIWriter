// Building the world from a summary, against the fake provider: tests/fake-provider/m4/world.mjs answers
// the World builder's requests with deterministic replies (its rules are at the top of that file), so these
// tests know exactly what each summary makes.

import type Database from 'better-sqlite3'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEvents } from '@shared/api'
import type { WorldBuildDone, WorldBuildProgress } from '@shared/contracts/worldBuilder'
import type { Entry, EntryKind, ID, ModelChoice, ProviderConfig, ThinkingLevel } from '@shared/types'
import { defaultSettings, defaultWritingPrefs } from '@shared/defaults'
import { memoryWorld } from '../../../tests/unit/helpers'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as kdb from '../db/keeper'
import { stopTasksFor } from '../ai/tasks'
import { jobModel, type JobModel, type ModelSources } from '../ai/jobModel'
import { undoItem } from '../keeper/undo'
import { madeItems, redoBuild, undoBuild } from './lines'
import {
  buildRunning,
  buildState,
  cancelBuild,
  cancelBuildFor,
  closeBuildsFor,
  pagesToFill,
  resetBuildsForTests,
  startBuild,
  UNUSABLE,
  type BuildContext
} from './run'
import { estimateCost, guessBuild, guessNames } from './estimate'
import { startTimeline, timelineStory } from './timeline'
import { timelineOf } from '../worldViews/index'
import { getEntryReadAloud, setEntryReadAloud } from '../readAloud/voiceStore'
import { keepOutline, unkeepOutline } from '../outline/structure'
import { entryState } from '../db/worldBuilder'
import { storySummary } from './storySummary'
import * as save from './save'
import { batchSystem, characterSystem, overviewSystem, summaryLead, themesUser, worldSystem } from './prompts'
import { sentMessages } from '../ai/client'
import { profileKeys } from '../builder/profile'

let fake: FakeProvider
beforeAll(async () => {
  // No pause between pieces of a reply: Windows' timers wait about 15 ms for even 1 ms, and a build makes
  // several long replies, so a pause per piece took each test past its time there.
  fake = await startFakeProvider({ delayMs: 0, slowDelayMs: 15 })
})
afterAll(() => fake.close())
beforeEach(() => resetBuildsForTests())

const SUMMARY = [
  'Mara Venn is a smuggler captain who owes the Salt Guild a fortune.',
  "Tobin is Mara Venn's younger brother.",
  'Saltmarsh is a port town in the Grey Coast.',
  'The Grey Coast is a cold land of fog and reefs.',
  'Mara keeps the Tide Compass.',
  'Magic always costs blood.',
  'The Great Flood happened in the year 312, when Tobin was born.',
  'Who sank the Merrow?',
  'The word "drowner" means a ghost that walks out of the sea.'
].join(' ')

function modelFor(modelId = 'fake/writer', contextLength = 32000): JobModel {
  return {
    job: 'world',
    target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: 'test' },
    choice: { providerId: 'p1', modelId, label: modelId, contextLength, promptPrice: 0.000001, completionPrice: 0.000002 },
    thinking: 'off'
  }
}

type Ev = { name: keyof AppEvents; payload: unknown }

function setup(o: { db?: Database.Database; modelId?: string; contextLength?: number } = {}) {
  const db = o.db ?? memoryWorld()
  const events: Ev[] = []
  const saved: ID[] = []
  const ctx: BuildContext = {
    db,
    worldId: 'world-1',
    model: modelFor(o.modelId, o.contextLength),
    prefs: defaultWritingPrefs(),
    emit: (name, payload) => events.push({ name, payload }),
    onSaved: (ids) => saved.push(...ids),
    retryDelays: [1, 1]
  }
  let n = 0
  const doneOf = (buildId: ID): WorldBuildDone | undefined =>
    events.find((e) => e.name === 'worldBuilder:done' && (e.payload as WorldBuildDone).buildId === buildId)?.payload as
      | WorldBuildDone
      | undefined
  const build = async (summary: string, storyId: ID | null = null): Promise<WorldBuildDone> => {
    const buildId = `build-${++n}`
    await startBuild(ctx, { buildId, summary, storyId })
    const done = doneOf(buildId)
    if (!done) throw new Error('The build ended without saying so')
    return done
  }
  const progress = (): WorldBuildProgress[] =>
    events.filter((e) => e.name === 'worldBuilder:progress').map((e) => e.payload as WorldBuildProgress)
  const steps = (): string[] => [...new Set(progress().map((p) => p.step))]
  const names = (kind?: EntryKind): string[] =>
    repo
      .listEntries(db, kind)
      .map((e) => e.name)
      .sort()
  const named = (name: string): Entry => {
    const e = repo.listEntries(db).find((x) => x.name === name)
    if (!e) throw new Error(`No entry named ${name}`)
    return e
  }
  return { db, ctx, events, saved, build, doneOf, progress, steps, names, named }
}

/** Who a field's value comes from. */
const originOf = (e: Entry, key: string): string => e.fieldOrigins[key] ?? e.origin

const records = (db: Database.Database): { job: string; status: string }[] =>
  db.prepare("SELECT job, status FROM generations WHERE job = 'world' ORDER BY created_at, rowid").all() as {
    job: string
    status: string
  }[]

async function until(check: () => boolean, ms = 15000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('Timed out waiting')
    await new Promise((r) => setTimeout(r, 5))
  }
}

describe('building a fresh world from a summary', () => {
  it('lays out every kind the summary names, in one go, and keeps the summary’s own words as Adam’s', async () => {
    const t = setup()
    const done = await t.build(SUMMARY)
    expect(done.status).toBe('complete')
    expect(done.error).toBeNull()
    expect(t.names('character')).toEqual(['Mara Venn', 'Tobin'])
    expect(t.names('place')).toEqual(['Saltmarsh', 'The Grey Coast'])
    expect(t.names('group')).toEqual(['Salt Guild'])
    expect(t.names('item')).toEqual(['Tide Compass'])
    expect(t.names('lore')).toEqual(['Magic'])
    expect(t.names('event')).toEqual(['The Great Flood'])
    expect(t.names('thread')).toEqual(['Who sank the Merrow'])
    expect(t.names('glossary')).toEqual(['drowner'])

    // A character's full profile, as Quick start makes it: his words verbatim and his, the rest drafted by AI.
    const mara = t.named('Mara Venn')
    expect(mara.origin).toBe('adam')
    expect(mara.summary).toBe('Mara Venn is a smuggler captain who owes the Salt Guild a fortune.')
    expect(originOf(mara, 'summary')).toBe('adam')
    expect(originOf(mara, 'name')).toBe('adam')
    expect(mara.aliases).toEqual(['Mara'])
    expect(mara.fields.traits).toBe('Core traits of Mara Venn, drafted to fit the world.')
    expect(originOf(mara, 'traits')).toBe('ai')
    expect(originOf(mara, 'description')).toBe('ai')
    expect(mara.fields.role).toBe('supporting')

    // A place inside the place the summary puts it in.
    const coast = t.named('The Grey Coast')
    expect(t.named('Saltmarsh').parentId).toBe(coast.id)
    expect(coast.parentId).toBeNull()

    // An absolute rule is a hard rule, in Adam's words.
    const magic = t.named('Magic')
    expect(magic.hardRule).toBe(true)
    expect(magic.fields.rules).toBe('Magic always costs blood.')
    expect(originOf(magic, 'rules')).toBe('adam')

    // An event with its date, and the characters in it.
    const flood = t.named('The Great Flood')
    expect(flood.fields.when).toBe('in the year 312')
    expect(originOf(flood, 'when')).toBe('adam')
    expect(flood.fields.happened).toBe('The Great Flood happened in the year 312, when Tobin was born.')
    const tobin = t.named('Tobin')
    const tobinChanges = mem.changesForEntry(t.db, tobin.id).filter((c) => c.entryId === tobin.id && c.kind === 'relationship')
    expect(tobinChanges.map((c) => (c.kind === 'relationship' ? [c.payload.type, c.payload.otherId] : []))).toEqual([
      ['involved in', flood.id],
      ['younger brother', mara.id]
    ])
    expect(tobinChanges.every((c) => c.anchor === 'baseline' && c.origin === 'ai')).toBe(true)

    // A plot thread, open and set up before the story starts.
    const thread = t.named('Who sank the Merrow')
    const opened = mem.changesForEntry(t.db, thread.id)
    expect(opened).toHaveLength(1)
    expect(opened[0]).toMatchObject({ kind: 'thread', anchor: 'baseline', origin: 'ai', payload: { status: 'open' } })
    expect(thread.fields.promise).toBe('Who sank the Merrow?')

    expect(t.named('drowner').summary).toBe('The word "drowner" means a ghost that walks out of the sea.')
    expect(repo.getMeta(t.db, 'themes')).toBe('Debt, family and what the sea takes back.')
    expect(repo.getMeta(t.db, 'tone')).toBe('Salt-stung and wary, with dry humour.')
  })

  it('is one run in What changed, with a line for each thing, and says how it goes in plain words', async () => {
    const t = setup()
    const done = await t.build(SUMMARY)
    expect(done.runId).toBeTruthy()
    const run = kdb.getRun(t.db, done.runId!)
    expect(run).toMatchObject({ status: 'done', sceneId: '', modelId: 'fake/writer' })
    const lines = kdb.logForRun(t.db, done.runId!)
    // Each thing made, and the story's opening scene put on Day 1 (2026-10-17: a line, so Undo build takes it back).
    expect(lines).toHaveLength(14)
    expect(lines.at(-1)).toMatchObject({ what: 'scene', text: 'The story starts on Day 1', before: '', after: 'Day 1' })
    expect(lines.filter((l) => l.text === 'New character').map((l) => l.entryName)).toEqual(['Mara Venn', 'Tobin'])
    expect(lines.find((l) => l.entryName === 'Magic')?.text).toBe('New rule, never to be broken')
    expect(lines.find((l) => l.entryName === 'Tobin' && l.what === 'change')?.text).toBe('Younger brother: Mara Venn')
    expect(lines.filter((l) => l.entryName === '').map((l) => l.text)).toEqual(["The world's themes", "The world's tone"])
    expect(lines.every((l) => l.sceneId === null && !l.undone)).toBe(true)
    // Each line shows the sentence that says what the thing is, not merely the first to name it.
    expect(lines.find((l) => l.entryName === 'The Grey Coast')?.quote).toBe('The Grey Coast is a cold land of fog and reefs.')
    expect(lines.find((l) => l.entryName === 'Salt Guild')?.quote).toBe(
      'Mara Venn is a smuggler captain who owes the Salt Guild a fortune.'
    )

    // Every request is recorded as the World builder's (the first look, its look again for anything missed, and the rest), and the run keeps them all.
    const recs = records(t.db)
    expect(recs).toHaveLength(13)
    expect(recs.every((r) => r.status === 'complete')).toBe(true)
    expect(run?.generationIds).toHaveLength(13)
    expect(done.cost).toBeGreaterThan(0)

    expect(done.made).toHaveLength(13)
    expect(done.made.find((m) => m.kind === 'lore')).toMatchObject({ name: 'Magic', hardRule: true, what: 'entry' })
    expect(done.made.find((m) => m.what === 'relationship')).toMatchObject({ name: 'Tobin', detail: 'Younger brother: Mara Venn' })
    expect(done.found).toEqual([])
    expect(done.missed).toEqual([])
    expect(done.conflicts).toEqual([])

    const steps = t.steps()
    expect(steps[0]).toBe('Reading your summary')
    for (const s of [
      'Laying out characters: 1 of 2',
      'Laying out characters: 2 of 2',
      'Laying out places: 1 of 2',
      'Laying out lore and rules: 1 of 1',
      'Laying out plot threads: 1 of 1',
      'Working out relationships',
      "Setting the world's themes and tone"
    ]) {
      expect(steps).toContain(s)
    }
    // Characters and places come first, then the rest.
    expect(steps.indexOf('Laying out places: 1 of 2')).toBeLessThan(steps.indexOf('Laying out groups: 1 of 1'))
    expect(steps.indexOf('Laying out characters: 2 of 2')).toBeLessThan(steps.indexOf('Laying out places: 1 of 2'))
    // What is made shows up as it is saved.
    const counts = t.progress().map((p) => p.made.length)
    expect(counts.some((c) => c > 0 && c < 13)).toBe(true)
    expect(new Set(t.saved).size).toBeGreaterThanOrEqual(10)
    expect(buildRunning()).toBe(false)
  })

  it('goes through a long summary in parts', { timeout: 20000 }, async () => {
    const filler = 'The sea is grey and wide, and the wind is cold. '.repeat(50).trim()
    const summary = [
      `Mara Venn is a smuggler captain. ${filler}`,
      filler,
      filler,
      filler,
      filler,
      `Tobin is Mara Venn's younger brother. ${filler}`
    ].join('\n')
    const t = setup({ contextLength: 8000 })
    const done = await t.build(summary)
    expect(done.status).toBe('complete')
    expect(t.steps()).toContain('Reading your summary: part 1 of 2')
    expect(t.steps()).toContain('Reading your summary: part 2 of 2')
    expect(t.names('character')).toEqual(['Mara Venn', 'Tobin'])
    expect(t.named('Mara Venn').summary).toBe('Mara Venn is a smuggler captain.')
    expect(done.made.find((m) => m.what === 'relationship')?.detail).toBe('Younger brother: Mara Venn')
  })

  it('reads the summary again for what the first look left out, so one build makes everything', async () => {
    const summary = [
      'Mara Venn is a smuggler captain.',
      'Tobin is her younger brother.',
      'Ilse is the harbour master.',
      'Corran is a lighthouse keeper.',
      'Saltmarsh is a port.',
      'Fenreach is a village.',
      'Gullhaven is a town.'
    ].join(' ')
    const t = setup({ modelId: 'fake/world-lazy' })
    const done = await t.build(summary)
    expect(done.status).toBe('complete')
    expect(t.names('character')).toEqual(['Corran', 'Ilse', 'Mara Venn', 'Tobin'])
    expect(t.names('place')).toEqual(['Fenreach', 'Gullhaven', 'Saltmarsh'])
    expect(t.steps()).toContain('Reading your summary again for anything missed')
  })
})

describe('building from a list already chosen (the Story builder, 2026-10-17)', () => {
  it('skips the first look and lays out exactly what the list has', async () => {
    const t = setup()
    const plan = [
      { kind: 'character' as const, name: 'Mara Venn', aliases: ['Mara'], about: 'A smuggler captain.', in: '', rule: false, when: '', scene: '' },
      { kind: 'place' as const, name: 'Saltmarsh', aliases: [], about: 'A port town.', in: '', rule: false, when: '', scene: '' },
      // Not a kind a build lays out, and no name: both left out.
      { kind: 'nonsense', name: 'X' },
      { kind: 'item', name: '' }
    ]
    await startBuild(t.ctx, { buildId: 'given-1', summary: SUMMARY, storyId: null, plan: plan as never })
    const done = t.doneOf('given-1')!
    expect(done.status).toBe('complete')
    expect(t.names('character')).toEqual(['Mara Venn'])
    expect(t.names('place')).toEqual(['Saltmarsh'])
    expect(t.names('group')).toEqual([])
    expect(t.names('item')).toEqual([])
    expect(t.steps()).not.toContain('Reading your summary')
  })
})

describe('undoing a build', () => {
  it('takes the whole build away with one Undo, and brings it all back with the Undo on that', async () => {
    const t = setup()
    const done = await t.build(SUMMARY)
    const runId = done.runId!
    const opening = repo.getOutline(t.db, repo.listStories(t.db)[0].id).scenes[0].id
    expect(repo.getScene(t.db, opening).card.when).toBe('Day 1')
    const { lineIds } = t.db.transaction(() => undoBuild(t.db, runId))()
    expect(lineIds).toHaveLength(14)
    expect(t.names()).toEqual([])
    expect(repo.getScene(t.db, opening).card.when).toBe('')
    expect(repo.getMeta(t.db, 'themes') ?? '').toBe('')
    expect(repo.getMeta(t.db, 'tone') ?? '').toBe('')
    expect(madeItems(t.db, runId).every((m) => m.undone)).toBe(true)
    expect(buildState(t.db, 'world-1', SUMMARY).last?.made.every((m) => m.undone)).toBe(true)

    t.db.transaction(() => redoBuild(t.db, runId, lineIds))()
    expect(t.names()).toHaveLength(10)
    expect(repo.getScene(t.db, opening).card.when).toBe('Day 1')
    expect(madeItems(t.db, runId).some((m) => m.undone)).toBe(false)
    expect(t.named('Saltmarsh').parentId).toBe(t.named('The Grey Coast').id)
    expect(repo.getMeta(t.db, 'themes')).toBe('Debt, family and what the sea takes back.')
    const tobin = t.named('Tobin')
    expect(mem.changesForEntry(t.db, tobin.id).filter((c) => c.kind === 'relationship')).toHaveLength(2)
  })

  it('leaves a page Adam deleted himself deleted when the whole build is brought back', async () => {
    const t = setup()
    const done = await t.build(SUMMARY)
    const saltmarsh = t.named('Saltmarsh')
    repo.deleteEntry(t.db, saltmarsh.id, { origin: 'adam' })
    const { lineIds } = t.db.transaction(() => undoBuild(t.db, done.runId!))()
    expect(lineIds).toHaveLength(13)
    t.db.transaction(() => redoBuild(t.db, done.runId!, lineIds))()
    expect(t.names()).toHaveLength(9)
    expect(t.names('place')).toEqual(['The Grey Coast'])
  })

  it('shows the newest build again after a restart, with what it made as it is now', async () => {
    const t = setup()
    const done = await t.build(SUMMARY)
    resetBuildsForTests()
    const state = buildState(t.db, 'world-1', SUMMARY)
    expect(state.running).toBeNull()
    expect(state.last).toMatchObject({ buildId: '', status: 'complete', runId: done.runId, cost: done.cost })
    expect(state.last?.made).toHaveLength(13)
    t.db.transaction(() => undoBuild(t.db, done.runId!))()
    expect(buildState(t.db, 'world-1', SUMMARY).last?.made.every((m) => m.undone)).toBe(true)
  })

  it('adds it all again when the summary is built again after the whole build was undone', async () => {
    const t = setup()
    const first = await t.build(SUMMARY)
    const { lineIds } = t.db.transaction(() => undoBuild(t.db, first.runId!))()
    const again = await t.build(SUMMARY)
    expect(again.status).toBe('complete')
    expect(again.skipped).toEqual([])
    expect(again.made.filter((m) => m.what === 'entry')).toHaveLength(10)
    expect(t.names()).toHaveLength(10)

    // Bringing the first build back now makes no second of anything: what was made again is the one kept.
    t.db.transaction(() => redoBuild(t.db, first.runId!, lineIds))()
    expect(t.names()).toHaveLength(10)
    expect(repo.getMeta(t.db, 'themes')).toBe('Debt, family and what the sea takes back.')
    expect(madeItems(t.db, first.runId!).every((m) => m.undone)).toBe(true)
    expect(madeItems(t.db, again.runId!).some((m) => m.undone)).toBe(false)
  })

  it("doesn't add a line undone in What changed again from the same words", async () => {
    const t = setup()
    const first = await t.build(SUMMARY)
    const line = kdb.logForRun(t.db, first.runId!).find((l) => l.entryName === 'Tobin' && l.what === 'entry')!
    t.db.transaction(() => undoItem(t.db, line.id))()
    expect(t.names('character')).toEqual(['Mara Venn'])
    // His relationship went with him.
    const made = madeItems(t.db, first.runId!)
    expect(made.filter((m) => m.undone).map((m) => m.detail ?? m.name)).toHaveLength(2)

    const again = await t.build(SUMMARY)
    expect(again.status).toBe('complete')
    expect(again.skipped).toEqual(['Tobin'])
    expect(again.made).toEqual([])
    expect(again.runId).toBeNull()
    expect(again.found.map((f) => f.name)).toContain('Mara Venn')
    expect(t.names('character')).toEqual(['Mara Venn'])
  })
})

describe('building in a world that has things already', () => {
  it('adds only what is missing, never changes what Adam wrote, and makes a disagreement an issue', async () => {
    const t = setup()
    const mara = repo.createEntry(t.db, 'character', { name: 'Mara Venn', summary: 'A harbour pilot.', fields: { age: '29' } })
    repo.setMeta(t.db, 'tone', 'Bleak.')
    const done = await t.build(`${SUMMARY} Mara Venn is 34.`)
    expect(done.status).toBe('complete')
    expect(done.found).toEqual([{ entryId: mara.id, kind: 'character', name: 'Mara Venn' }])
    expect(t.names('character')).toEqual(['Mara Venn', 'Tobin'])
    const after = repo.getEntry(t.db, mara.id)
    expect(after.summary).toBe('A harbour pilot.')
    expect(after.fields).toEqual({ age: '29' })
    expect(after.aliases).toEqual([])
    expect(after.updatedAt).toBe(mara.updatedAt)
    // The tone was there already; only the themes were filled.
    expect(repo.getMeta(t.db, 'tone')).toBe('Bleak.')
    expect(repo.getMeta(t.db, 'themes')).toBe('Debt, family and what the sea takes back.')
    expect(done.made.map((m) => m.what)).not.toContain('tone')

    const message = 'Mara Venn: your summary says age or birth date is “34”, but the page says “29”.'
    expect(done.conflicts).toEqual([{ entryId: mara.id, kind: 'character', name: 'Mara Venn', field: 'age', message }])
    const issues = t.db.prepare('SELECT kind, severity, status, message, quote, payload_json FROM issues').all() as Record<string, string>[]
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ kind: 'fact', severity: 'warning', status: 'open', message, quote: 'Mara Venn is 34.' })
    expect(JSON.parse(issues[0].payload_json)).toMatchObject({ entryId: mara.id, field: 'age', memory: '29', text: '34' })

    // Building again adds nothing more, and raises the same issue only once.
    const again = await t.build(`${SUMMARY} Mara Venn is 34.`)
    expect(again.made).toEqual([])
    expect(t.names()).toHaveLength(10)
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM issues').get()).toEqual({ n: 1 })
    expect(repo.getEntry(t.db, mara.id).updatedAt).toBe(mara.updatedAt)
  })

  it('takes the disagreement back with Undo build, and brings it back with its Undo (2026-10-17)', async () => {
    const t = setup()
    repo.createEntry(t.db, 'character', { name: 'Mara Venn', summary: 'A harbour pilot.', fields: { age: '29' } })
    const done = await t.build(`${SUMMARY} Mara Venn is 34.`)
    const issues = (): { status: string }[] => t.db.prepare('SELECT status FROM issues').all() as { status: string }[]
    expect(issues()).toEqual([{ status: 'open' }])
    const line = kdb.logForRun(t.db, done.runId!).find((l) => l.text === 'Your summary disagrees with this page')
    expect(line).toMatchObject({ entryName: 'Mara Venn', before: '29', after: '34' })
    const { lineIds } = t.db.transaction(() => undoBuild(t.db, done.runId!))()
    expect(issues()).toEqual([])
    t.db.transaction(() => redoBuild(t.db, done.runId!, lineIds))()
    expect(issues()).toEqual([{ status: 'open' }])
  })

  it('leaves a disagreement Adam ignored when the build is undone (2026-10-17)', async () => {
    const t = setup()
    repo.createEntry(t.db, 'character', { name: 'Mara Venn', summary: 'A harbour pilot.', fields: { age: '29' } })
    const done = await t.build(`${SUMMARY} Mara Venn is 34.`)
    t.db.prepare("UPDATE issues SET status = 'ignored'").run()
    t.db.transaction(() => undoBuild(t.db, done.runId!))()
    expect(t.db.prepare('SELECT status FROM issues').all()).toEqual([{ status: 'ignored' }])
  })

  it('dates an event the world has already when its When is empty, and never changes one it has (2026-10-17)', async () => {
    const t = setup()
    const storm = repo.createEntry(t.db, 'event', { name: 'The Storm', summary: 'A great storm.' })
    const flood = repo.createEntry(t.db, 'event', { name: 'The Great Flood', summary: 'The sea rose.', fields: { when: 'long ago' } })
    const done = await t.build(`${SUMMARY} The Storm struck on Day 3.`)
    expect(done.status).toBe('complete')
    const dated = repo.getEntry(t.db, storm.id)
    expect(dated.fields.when).toBe('Day 3')
    expect(dated.fieldOrigins.when).toBe('ai')
    expect(repo.getEntry(t.db, flood.id).fields.when).toBe('long ago')
    expect(kdb.logForRun(t.db, done.runId!).find((l) => l.entryId === storm.id)).toMatchObject({ text: 'When it happens', after: 'Day 3' })
    t.db.transaction(() => undoBuild(t.db, done.runId!))()
    expect(repo.getEntry(t.db, storm.id).fields.when ?? '').toBe('')
  })

  it('makes what a story’s start says true from that story’s start', async () => {
    const t = setup()
    const story = repo.createStory(t.db, { title: 'Book 2' })
    const done = await t.build(SUMMARY, story.id)
    expect(done.status).toBe('complete')
    expect(done.storyId).toBe(story.id)
    const thread = t.named('Who sank the Merrow')
    expect(thread.originStoryId).toBe(story.id)
    expect(mem.changesForEntry(t.db, thread.id)[0]).toMatchObject({ kind: 'thread', anchor: 'story-start', storyId: story.id })
    const tobin = t.named('Tobin')
    const rel = mem.changesForEntry(t.db, tobin.id).filter((c) => c.kind === 'relationship')
    expect(rel.every((c) => c.anchor === 'story-start' && c.storyId === story.id)).toBe(true)
  })
})

describe('the timeline a build starts', () => {
  const opening = (db: Database.Database, storyId: ID): { id: ID; when: string } => {
    const first = repo.getOutline(db, storyId).scenes[0]
    return { id: first.id, when: repo.getScene(db, first.id).card.when }
  }

  it('puts the story’s opening scene on Day 1 and dates the events that happen during it, so the timeline shows them', async () => {
    const t = setup()
    const book = repo.listStories(t.db)[0]
    expect(opening(t.db, book.id).when).toBe('')
    const done = await t.build(`${SUMMARY} The Storm struck on Day 3.`)
    expect(done.status).toBe('complete')
    expect(opening(t.db, book.id).when).toBe('Day 1')
    const storm = t.named('The Storm')
    expect(storm.fields.when).toBe('Day 3')
    // Long-ago history keeps the summary's own words.
    expect(t.named('The Great Flood').fields.when).toBe('in the year 312')

    const timeline = timelineOf(t.db, book.id)
    const dated = timeline.points.filter((p) => p.dated).map((p) => [p.kind, p.title, p.when])
    expect(dated).toContainEqual(['scene', 'Scene 1', 'Day 1'])
    expect(dated).toContainEqual(['event', 'The Storm', 'Day 3'])
    // Day 1 comes before Day 3.
    const at = (title: string): number => timeline.points.findIndex((p) => p.title === title)
    expect(at('Scene 1')).toBeLessThan(at('The Storm'))
  })

  it('never changes a When Adam set, nor dates a story whose scenes have one already', async () => {
    const t = setup()
    const book = repo.listStories(t.db)[0]
    const chapter = repo.getOutline(t.db, book.id).chapters[0]
    const later = repo.createScene(t.db, chapter.id, { title: 'Scene 2' })
    repo.updateSceneCard(t.db, later.id, { ...repo.getScene(t.db, later.id).card, when: 'Day 12' })
    await t.build(SUMMARY)
    expect(opening(t.db, book.id).when).toBe('')
    expect(repo.getScene(t.db, later.id).card.when).toBe('Day 12')

    const mine = setup()
    const first = opening(mine.db, repo.listStories(mine.db)[0].id)
    repo.updateSceneCard(mine.db, first.id, { ...repo.getScene(mine.db, first.id).card, when: 'Spring, Year 3' })
    expect(startTimeline(mine.db, null)).toBeNull()
    expect(opening(mine.db, repo.listStories(mine.db)[0].id).when).toBe('Spring, Year 3')
  })

  it('dates the story it was built for, or the first story the world starts with, and nothing when the build made nothing', async () => {
    const t = setup()
    const [book] = repo.listStories(t.db)
    const two = repo.createStory(t.db, { title: 'Book 2' })
    repo.createScene(t.db, repo.createChapter(t.db, two.id, { title: 'Chapter 1' }).id, { title: 'Scene 1' })
    expect(timelineStory(t.db, null)).toBe(book.id)
    expect(timelineStory(t.db, two.id)).toBe(two.id)
    expect(timelineStory(t.db, 'gone')).toBeNull()
    await t.build(SUMMARY, two.id)
    expect(opening(t.db, two.id).when).toBe('Day 1')
    expect(opening(t.db, book.id).when).toBe('')

    const empty = setup({ modelId: 'fake/world-junk' })
    await empty.build(SUMMARY)
    expect(opening(empty.db, repo.listStories(empty.db)[0].id).when).toBe('')
  })

  it('built for the world’s beginning, dates the world’s first story, not the first on the shelf (2026-10-17)', () => {
    const t = setup()
    const [book] = repo.listStories(t.db)
    const two = repo.createStory(t.db, { title: 'The Salt Road' })
    // The book is its own version of events, so the world's first story is the other one, which starts at the beginning.
    t.db.prepare("UPDATE stories SET kind = 'own' WHERE id = ?").run(book.id)
    t.db.prepare('UPDATE stories SET start_story_id = NULL WHERE id = ?').run(two.id)
    expect(timelineStory(t.db, null)).toBe(two.id)
  })

  it('tells the window which scene it dated, and Undo build takes the date back unless Adam changed it (2026-10-17)', async () => {
    const t = setup()
    const book = repo.listStories(t.db)[0]
    const done = await t.build(SUMMARY)
    const first = opening(t.db, book.id)
    expect(first.when).toBe('Day 1')
    expect(t.events).toContainEqual({ name: 'memory:changed', payload: { sceneId: first.id, entryIds: [] } })

    // Adam changed the When since: Undo build leaves his.
    repo.updateSceneCard(t.db, first.id, { ...repo.getScene(t.db, first.id).card, when: 'Day 4, dawn' })
    t.db.transaction(() => undoBuild(t.db, done.runId!))()
    expect(opening(t.db, book.id).when).toBe('Day 4, dawn')
    expect(t.names()).toEqual([])
  })
})

describe('stopping a build', () => {
  it('keeps what was saved when it is cancelled, and one Undo still takes it away', { timeout: 30000 }, async () => {
    const t = setup({ modelId: 'fake/slow' })
    const later: ID[][] = []
    t.ctx.voiceLater = (ids) => later.push(ids)
    const finished = startBuild(t.ctx, { buildId: 'slow-1', summary: SUMMARY, storyId: null })
    await until(() => t.progress().some((p) => p.made.length > 0))
    expect(buildRunning()).toBe(true)
    expect(buildState(t.db, 'world-1', SUMMARY).running).toMatchObject({ buildId: 'slow-1', storyId: null })
    await cancelBuild('slow-1')
    await finished
    const done = t.doneOf('slow-1')!
    expect(done.status).toBe('cancelled')
    expect(done.error).toBeNull()
    const kept = done.made.filter((m) => m.what === 'entry')
    expect(kept.length).toBeGreaterThan(0)
    expect(kept.length).toBeLessThan(10)
    expect(t.names()).toHaveLength(kept.length)
    expect(kdb.getRun(t.db, done.runId!)?.status).toBe('stopped')
    expect(records(t.db).some((r) => r.status === 'stopped')).toBe(true)
    // The characters it had made get their voices in the background, as it never reached that step.
    const characters = kept.filter((m) => m.kind === 'character').map((m) => m.entryId)
    expect(later).toEqual([characters])
    expect(buildRunning()).toBe(false)
    expect(buildState(t.db, 'world-1', SUMMARY)).toMatchObject({ running: null, last: { buildId: 'slow-1', status: 'cancelled' } })

    t.db.transaction(() => undoBuild(t.db, done.runId!))()
    expect(t.names()).toEqual([])
    // Cancelled builds never start the timeline (2026-10-17).
    const first = repo.getOutline(t.db, repo.listStories(t.db)[0].id).scenes[0]
    expect(repo.getScene(t.db, first.id).card.when).toBe('')
  })

  it('stops when the world closes, finishing its run while the world is still open', { timeout: 30000 }, async () => {
    const t = setup({ modelId: 'fake/slow' })
    const finished = startBuild(t.ctx, { buildId: 'slow-2', summary: SUMMARY, storyId: null })
    await until(() => t.progress().some((p) => p.made.length > 0))
    closeBuildsFor(t.db)
    stopTasksFor(t.db)
    await finished
    expect(t.doneOf('slow-2')).toBeUndefined()
    const runId = kdb.listLog(t.db).find((l) => l.entryName)?.runId
    expect(runId).toBeTruthy()
    expect(kdb.getRun(t.db, runId!)?.status).toBe('stopped')
    expect(buildRunning()).toBe(false)
  })

  it('says in plain words when a reply could not be used, and makes nothing', async () => {
    const t = setup({ modelId: 'fake/world-junk' })
    const done = await t.build(SUMMARY)
    expect(done.status).toBe('error')
    expect(done.error).toBe(UNUSABLE)
    expect(done.runId).toBeNull()
    expect(t.names()).toEqual([])
    // Asked once more, saying what was wrong, before giving up.
    expect(records(t.db)).toHaveLength(2)
  })

  it('says what is missing before anything starts', async () => {
    const t = setup()
    expect(() => startBuild(t.ctx, { buildId: 'b', summary: '   ', storyId: null })).toThrow('Write or paste a summary first.')
    expect(() => startBuild(t.ctx, { buildId: 'b', summary: SUMMARY, storyId: 'gone' })).toThrow(/no longer exists/)
    const first = startBuild(t.ctx, { buildId: 'b1', summary: SUMMARY, storyId: null })
    expect(() => startBuild(t.ctx, { buildId: 'b2', summary: SUMMARY, storyId: null })).toThrow(/already running/)
    await first
    expect(t.doneOf('b1')?.status).toBe('complete')
  })
})

describe('the World builder model', () => {
  const provider: ProviderConfig = {
    id: 'p1',
    name: 'OpenRouter',
    kind: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    hasKey: true
  }
  const choice = (modelId: string): ModelChoice => ({
    providerId: 'p1',
    modelId,
    label: modelId,
    contextLength: 32000,
    promptPrice: null,
    completionPrice: null
  })
  const src = (models: Partial<Record<'writer' | 'builder' | 'world', ModelChoice>>, thinking: ThinkingLevel = 'off'): ModelSources => {
    const d = defaultSettings('/tmp/library')
    return {
      settings: { models: { ...d.models, ...models }, thinking: { ...d.thinking, builder: 'high', world: thinking } },
      getProvider: (id) => (id === 'p1' ? provider : null),
      providerTarget: (p) => ({ id: p.id, name: p.name, kind: p.kind, baseUrl: p.baseUrl, apiKey: 'k' })
    }
  }

  it('is the character builder model until one is picked, and the writer model until that is', () => {
    expect(jobModel('world', src({ writer: choice('w') })).choice.modelId).toBe('w')
    expect(jobModel('world', src({ writer: choice('w'), builder: choice('b') })).choice.modelId).toBe('b')
    expect(jobModel('world', src({ writer: choice('w'), builder: choice('b'), world: choice('x') })).choice.modelId).toBe('x')
    expect(() => jobModel('world', src({}))).toThrow(/Settings › Models/)
  })

  it('thinks as its own Thinking says, Off unless changed', () => {
    expect(defaultSettings('/tmp/library').thinking.world).toBe('off')
    expect(jobModel('world', src({ builder: choice('b') })).thinking).toBe('off')
    expect(jobModel('world', src({ builder: choice('b') }, 'medium')).thinking).toBe('medium')
  })
})

describe('the cost before starting', () => {
  it('finds the names a summary uses', () => {
    expect(guessNames(SUMMARY)).toEqual([
      'Mara Venn',
      'Salt Guild',
      'Tobin',
      'Saltmarsh',
      'Grey Coast',
      'Mara',
      'Tide Compass',
      'Magic',
      'Great Flood',
      'Merrow'
    ])
  })

  it('grows with the summary and with Thinking, and is unknown without prices', () => {
    const c = { contextLength: 32000, promptPrice: 0.000001, completionPrice: 0.000002 }
    const short = guessBuild(SUMMARY, c, 0, 'off')
    expect(short.parts).toBe(1)
    expect(short.characters).toBeGreaterThan(0)
    const who = (i: number): string => `Ka${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}n`
    const text = Array.from({ length: 40 }, (_, i) => `Captain ${who(i)} sails from Port ${who(i)}. ${SUMMARY}`).join('\n')
    const long = guessBuild(text, c, 0, 'off')
    expect(long.characters).toBeGreaterThan(short.characters)
    // A model with a small window reads it in parts.
    expect(guessBuild(text, { ...c, contextLength: 8000 }, 0, 'off').parts).toBeGreaterThan(1)
    expect(estimateCost(long, c)!).toBeGreaterThan(estimateCost(short, c)!)
    expect(guessBuild(SUMMARY, c, 0, 'high').output).toBeGreaterThan(short.output)
    expect(estimateCost(short, { promptPrice: null, completionPrice: null })).toBeNull()
  })
})

describe('the last steps: filling in what is missing, and the characters’ voices', () => {
  /** What tests/fake-provider/m4/readAloud.mjs answers when asked for a voice (SUGGESTED_VOICE). */
  const VOICE = 'A woman in her thirties with a low, steady voice, a slight northern lilt and a dry, unhurried delivery.'

  const voiceModel = (): JobModel => ({ ...modelFor('fake/writer'), job: 'speech' })
  const voiceOf = (db: Database.Database, id: ID): string => getEntryReadAloud(db, id).voice.design
  /** Who a voice request asks about (the build asks about them all in one request), or null for another request. */
  const isVoiceAsk = (init?: RequestInit): string[] | null => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: { role: string; content: string }[] }
    if (!body.messages?.some((m) => m.role === 'system' && /\] voices?\n/.test(m.content))) return null
    const user = body.messages.find((m) => m.role === 'user')?.content ?? ''
    return [...user.matchAll(/^CHARACTER: ([^(\n]+?)(?: \(|$)/gm)].map((m) => m[1])
  }

  /** A world where the memory found Erin in the opening scene: a name, a line and her pronouns. */
  function withErin(): { db: Database.Database; erin: Entry } {
    const db = memoryWorld()
    const story = repo.listStories(db)[0]
    const sceneId = repo.getOutline(db, story.id).scenes[0].id
    const words = ['The storm threw them onto the sand.', 'Erin pushed her red hair out of her eyes and stood.']
    const doc = {
      type: 'doc',
      content: words.map((text, i) => ({ type: 'paragraph', attrs: { pid: `p${i}` }, content: [{ type: 'text', text }] }))
    }
    repo.saveSceneText(db, sceneId, doc, words.join('\n\n'))
    const erin = repo.createEntry(
      db,
      'character',
      { name: 'Erin', summary: 'A castaway.', fields: { pronouns: 'she/her' } },
      { origin: 'text', originStoryId: story.id, originSceneId: sceneId }
    )
    return { db, erin }
  }

  it('fills in a thin page the memory made from the text, as the AI’s, and leaves what the text said', async () => {
    const { db, erin } = withErin()
    const t = setup({ db })
    const done = await t.build(SUMMARY)
    expect(done.status).toBe('complete')
    expect(t.steps()).toContain('Filling in missing details: 1 of 1')
    expect(t.progress().find((p) => p.step.startsWith('Filling'))?.stage).toBe('filling')

    const after = t.named('Erin')
    expect(after.description).toBe('Description of Erin, filled in from the story.')
    expect(after.fields.traits).toBe('Core traits of Erin, filled in from the story.')
    expect(originOf(after, 'description')).toBe('ai')
    expect(after.summary).toBe('A castaway.')
    expect(after.fields.pronouns).toBe('she/her')
    expect(originOf(after, 'summary')).toBe('text')
    expect(t.saved).toContain(erin.id)
    // Recorded as the World builder's, and part of the build's cost and records.
    expect(records(t.db)).toHaveLength(14)
    expect(kdb.getRun(t.db, done.runId!)?.generationIds).toHaveLength(14)
    // The pages the build made were full already: nothing else was asked.
    expect(pagesToFill(t.db, [])).toEqual([])
  })

  it('never fills a page Adam made himself, unless the build laid it out and it came back thin', () => {
    const db = memoryWorld()
    const his = repo.createEntry(db, 'character', { name: 'Brann' })
    const text = repo.createEntry(db, 'character', { name: 'Kell' }, { origin: 'text' })
    const lore = repo.createEntry(db, 'lore', { name: 'Magic' }, { origin: 'text' })
    expect(pagesToFill(db, [])).toEqual([text.id])
    // Laid out by this build and thin: topped up, first.
    expect(pagesToFill(db, [his.id])).toEqual([his.id, text.id])
    expect(pagesToFill(db, [lore.id])).toEqual([text.id])
    // Laid out by this build and full: left as it is.
    const full = repo.createEntry(db, 'character', {
      name: 'Odile',
      summary: 'A diver.',
      description: 'Quick and sure.',
      fields: Object.fromEntries(profileKeys('character').filter((k) => !['name', 'aliases', 'summary', 'description'].includes(k)).map((k) => [k, 'Set.']))
    })
    expect(pagesToFill(db, [full.id])).toEqual([text.id])
  })

  it('fills only the thin pages of the build’s story, and pages that are still only a name, never another story’s AI pages', () => {
    const db = memoryWorld()
    const story = repo.listStories(db)[0]
    const other = repo.createStory(db, { title: 'Another tale' })
    const found = repo.createEntry(db, 'character', { name: 'Kell', summary: 'A dock hand.' }, { origin: 'text', originStoryId: story.id })
    const ours = repo.createEntry(db, 'place', { name: 'The Weir', summary: 'A weir.' }, { origin: 'ai', originStoryId: story.id })
    const theirs = repo.createEntry(db, 'character', { name: 'Odo', summary: 'Drafted for the other tale.' }, { origin: 'ai', originStoryId: other.id })
    const theirFound = repo.createEntry(db, 'character', { name: 'Pell', summary: 'A sailor.' }, { origin: 'text', originStoryId: other.id })
    // Kept from another story's outline with only a name (outline/chapterCard.ts addMissing): still filled.
    const stub = repo.createEntry(db, 'character', { name: 'Wren' }, { origin: 'ai', originStoryId: other.id })
    const fill = (storyId: ID | null): ID[] => pagesToFill(db, [], storyId).sort()
    expect(fill(story.id)).toEqual([found.id, ours.id, stub.id].sort())
    expect(fill(other.id)).toEqual([theirs.id, theirFound.id, stub.id].sort())
    // With no story: everything but what the AI drafted for a story, and pages that are only a name.
    expect(fill(null)).toEqual([found.id, theirFound.id, stub.id].sort())
  })

  it('a plain build fills nothing and asks for no voices without a read-aloud model', async () => {
    const t = setup()
    await t.build(SUMMARY)
    expect(t.steps().some((s) => s.startsWith('Filling') || s.startsWith('Giving'))).toBe(false)
    expect(voiceOf(t.db, t.named('Mara Venn').id)).toBe('')
  })

  it('gives each character it made a voice, as Suggest would, and never replaces one set meanwhile', async () => {
    const t = setup()
    const brann = repo.createEntry(t.db, 'character', { name: 'Brann', summary: 'A ferryman.' })
    setEntryReadAloud(t.db, brann.id, { voice: { design: 'Gravel and smoke.', voice: '' }, say: [] })
    const asked: string[][] = []
    t.ctx.voiceModel = voiceModel()
    t.ctx.fetchImpl = (input, init) => {
      const who = isVoiceAsk(init)
      if (who) {
        asked.push(who)
        // Adam sets Tobin's voice while the AI is still thinking of one.
        if (who.includes('Tobin')) setEntryReadAloud(t.db, t.named('Tobin').id, { voice: { design: 'Adam’s own.', voice: '' }, say: [] })
      }
      return fetch(input, init)
    }
    const done = await t.build(SUMMARY)
    expect(done.status).toBe('complete')
    // Both in one request (2026-10-17), each told as Suggest would tell it alone.
    expect(asked).toEqual([['Mara Venn', 'Tobin']])
    expect(t.steps()).toContain('Giving the characters their voices: 2 of 2')
    expect(t.progress().find((p) => p.step.startsWith('Giving'))?.stage).toBe('voices')
    expect(voiceOf(t.db, t.named('Mara Venn').id)).toBe(VOICE)
    expect(voiceOf(t.db, t.named('Tobin').id)).toBe('Adam’s own.')
    // A character it didn't make keeps its voice, and isn't asked about.
    expect(voiceOf(t.db, brann.id)).toBe('Gravel and smoke.')
    // Recorded as read aloud's requests, not the World builder's.
    expect(records(t.db)).toHaveLength(13)
    const speech = t.db.prepare("SELECT status FROM generations WHERE job = 'speech'").all()
    expect(speech).toHaveLength(1)
  })

  it('a voice that can’t be had leaves the character without one, and the build ends well', async () => {
    const t = setup()
    t.ctx.voiceModel = voiceModel()
    t.ctx.fetchImpl = async (input, init) =>
      isVoiceAsk(init) ? new Response('{"error":{"message":"Down for the night"}}', { status: 503 }) : fetch(input, init)
    const later: ID[][] = []
    t.ctx.voiceLater = (ids) => later.push(ids)
    const done = await t.build(SUMMARY)
    expect(done.status).toBe('complete')
    expect(voiceOf(t.db, t.named('Mara Venn').id)).toBe('')
    // Handed on, to be asked for again in the background.
    expect(later).toEqual([[t.named('Mara Venn').id, t.named('Tobin').id]])
  })

  it('gives a voice to a character it filled in as well as those it made', async () => {
    const { db, erin } = withErin()
    const t = setup({ db })
    const asked: string[][] = []
    t.ctx.voiceModel = voiceModel()
    t.ctx.fetchImpl = (input, init) => {
      const who = isVoiceAsk(init)
      if (who) asked.push(who)
      return fetch(input, init)
    }
    const done = await t.build(SUMMARY)
    expect(done.status).toBe('complete')
    expect(asked).toEqual([['Mara Venn', 'Tobin', 'Erin']])
    expect(voiceOf(t.db, erin.id)).toBe(VOICE)
    expect(t.steps()).toContain('Giving the characters their voices: 3 of 3')
  })
})

describe('the events of a story built from its plan', () => {
  // A plan of three chapters, a scene each: the Storm first exists in the second, the first scene on or after its Day 3.
  const planned = () => {
    const t = setup()
    const id = repo.listStories(t.db)[0].id
    keepOutline(t.db, id, [
      { key: 'c0', kind: 'chapter', title: 'Harbour', text: 'The ferry waits.', card: { when: 'Day 1' } },
      { key: 's0', kind: 'scene', title: 'Debt', text: 'Mara Venn is a smuggler captain.', parent: { key: 'c0' } },
      { key: 'c1', kind: 'chapter', title: 'Reefs', text: 'Out past the light.', card: { when: 'Day 7' } },
      { key: 's1', kind: 'scene', title: 'Wreck', text: 'The Storm struck on Day 3, and Mara Venn lost her ship.', parent: { key: 'c1' } },
      { key: 'c2', kind: 'chapter', title: 'Ashore', text: 'Back on land.', card: { when: 'Day 9' } },
      { key: 's2', kind: 'scene', title: 'Home', text: 'The quay is quiet.', parent: { key: 'c2' } }
    ])
    const scenes = repo.getOutline(t.db, id).scenes.map((s) => s.id)
    return { t, id, scenes }
  }

  it('puts each event in the scene it happens in: it first exists there, and those in it are involved from there', async () => {
    const { t, id, scenes } = planned()
    const done = await t.build(storySummary(t.db, id), id)
    expect(done.status).toBe('complete')
    const storm = t.named('The Storm')
    expect(storm.originSceneId).toBe(scenes[1])
    expect(mem.listExistsPoints(t.db, storm.id)).toEqual([expect.objectContaining({ kind: 'scene', sceneId: scenes[1], byHand: false })])
    const involved = mem.changesForEntry(t.db, t.named('Mara Venn').id).filter((c) => c.kind === 'relationship' && c.payload.otherId === storm.id)
    expect(involved).toEqual([expect.objectContaining({ anchor: 'scene', sceneId: scenes[1], storyId: id })])
    // Working the defaults out again (a story's kind or start changed) leaves it there.
    mem.refreshDefaultExistsPoints(t.db)
    expect(mem.listExistsPoints(t.db, storm.id)).toEqual([expect.objectContaining({ kind: 'scene', sceneId: scenes[1] })])

    // On the timeline its date decides (Adam, 2026-10-17: worldViews/eventPlace.ts): Day 3 is after the Day 1 scene and
    // before the Day 7 one it first exists at.
    const points = timelineOf(t.db, id).points
    const at = (pid: ID): number => points.findIndex((p) => p.id === pid)
    expect(at(storm.id)).toBe(at(scenes[0]) + 1)
    expect(at(storm.id)).toBeLessThan(at(scenes[1]))
  })

  it('leaves an event where the build is true when the summary is Adam’s own, not the story’s plan', async () => {
    const { t, id } = planned()
    await t.build(`${storySummary(t.db, id)} Mara Venn is tired.`, id)
    const storm = t.named('The Storm')
    expect(storm.originSceneId).toBeNull()
    expect(mem.listExistsPoints(t.db, storm.id)).toEqual([expect.objectContaining({ kind: 'world' })])
  })
})

/** Streams a reply as the provider would, a few characters at a time. */
function streamed(reply: string): Response {
  const chunk = (delta: object, finish: string | null = null): string =>
    `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
  const body = `${(reply.match(/[\s\S]{1,7}/g) ?? []).map((p) => chunk({ content: p })).join('')}${chunk({}, 'stop')}data: [DONE]\n\n`
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

/**
 * A fetch that answers some of the World builder's jobs ("[AIWRITE-WORLD v1] <job>") itself, from the request's user
 * message, and sends the rest to the fake provider. Counts the requests of each job.
 */
function answering(replies: Record<string, (user: string) => string | null>): typeof fetch & { asked: Record<string, number> } {
  const asked: Record<string, number> = {}
  const f = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: { role: string; content: string }[] }
    // The job's line comes after the summary, in the first user message.
    const first = body.messages?.find((m) => m.role === 'user')?.content ?? ''
    const job = /^\[AIWRITE-WORLD v1\] (\w+)$/m.exec(first)?.[1] ?? ''
    if (job) asked[job] = (asked[job] ?? 0) + 1
    const user = (body.messages ?? []).filter((m) => m.role === 'user').map((m) => m.content).join('\n')
    const reply = replies[job]?.(user) ?? null
    return reply === null ? fetch(input, init) : streamed(reply)
  }) as typeof fetch & { asked: Record<string, number> }
  f.asked = asked
  return f
}

/** A first look listing these, by kind (asked again for anything missed, it lists them again). */
const listing = (lists: Record<string, unknown[]>) => (): string =>
  JSON.stringify({ characters: [], places: [], groups: [], items: [], lore: [], events: [], threads: [], glossary: [], ...lists })

describe('names one letter apart, and the same name of two kinds', () => {
  it('makes two people of two names one letter apart in one summary', async () => {
    const t = setup()
    const done = await t.build('Tom is a fisherman. Tim is a baker. Mara Venn is a smuggler captain. Mira Venn is a sailmaker.')
    expect(done.status).toBe('complete')
    expect(t.names('character')).toEqual(['Mara Venn', 'Mira Venn', 'Tim', 'Tom'])
    expect(done.found).toEqual([])
  })

  it('makes both the place and the group one summary gives the same name', async () => {
    const t = setup()
    t.ctx.fetchImpl = answering({
      overview: listing({ places: [{ name: 'Ironhold', about: 'a fortress' }], groups: [{ name: 'Ironhold', about: 'its garrison' }] })
    })
    const done = await t.build('Ironhold is a fortress in the hills. The garrison is called Ironhold too.')
    expect(done.status).toBe('complete')
    expect(t.names('place')).toEqual(['Ironhold'])
    expect(t.names('group')).toEqual(['Ironhold'])
  })

  it('still takes a clear typo of a long name in the world as that page', async () => {
    const t = setup()
    const town = repo.createEntry(t.db, 'place', { name: 'Grimsby', summary: 'A fishing town.' })
    const done = await t.build('Grimbsy is a fishing town.')
    expect(done.status).toBe('complete')
    expect(done.found).toEqual([{ entryId: town.id, kind: 'place', name: 'Grimsby' }])
    expect(t.names('place')).toEqual(['Grimsby'])
  })
})

describe('replies in other shapes', () => {
  it.each([
    ['a bare list', (list: string) => list],
    ['a fenced list', (list: string) => `Here they are:\n\`\`\`json\n${list}\n\`\`\``]
  ])('saves relationships given as %s', async (_, shape) => {
    const t = setup()
    const list = JSON.stringify([
      { from: 'Tobin', to: 'Mara Venn', type: 'shipmate', feels: '', otherFeels: '' },
      { from: 'Mara Venn', to: 'Salt Guild', type: 'debtor' }
    ])
    const f = answering({ relationships: () => shape(list) })
    t.ctx.fetchImpl = f
    const done = await t.build(SUMMARY)
    expect(done.status).toBe('complete')
    expect(f.asked.relationships).toBe(1)
    const types = (name: string) =>
      mem
        .changesForEntry(t.db, t.named(name).id)
        .flatMap((c) => (c.kind === 'relationship' && c.entryId === t.named(name).id ? [c.payload.type] : []))
    expect(types('Tobin')).toContain('shipmate')
    expect(types('Mara Venn')).toContain('debtor')
  })

  it('saves a profile given on its own, not in a list, without asking again', async () => {
    const t = setup()
    const f = answering({
      places: () =>
        JSON.stringify({
          name: 'Fenwick',
          in: '',
          fromNotes: { name: 'Fenwick', summary: 'Fenwick is a fishing village.' },
          drafted: { description: 'Grey roofs and nets drying on the wall.' }
        })
    })
    t.ctx.fetchImpl = f
    const done = await t.build('Fenwick is a fishing village.')
    expect(done.status).toBe('complete')
    expect(t.names('place')).toEqual(['Fenwick'])
    expect(t.named('Fenwick').description).toBe('Grey roofs and nets drying on the wall.')
    expect(f.asked.places).toBe(1)
    expect(done.missed).toEqual([])
  })
})

describe('a planned name the profile changes', () => {
  const SUMMARY_RENAMED = [
    'The Ferryman is an old boatman, and his real name is Bram Holt.',
    'The Low Tavern is an inn by the river, called the Riverside Inn by travellers.',
    'The Taproom is a room in the Low Tavern.',
    'The Long Night happened in the year 300, when the Ferryman lost his boat.'
  ].join(' ')

  it('still links what names it by the planned name, and keeps that name as another name', async () => {
    const t = setup()
    t.ctx.fetchImpl = answering({
      overview: listing({
        characters: [{ name: 'The Ferryman', about: 'an old boatman' }],
        places: [
          { name: 'The Low Tavern', aliases: ['Riverside Inn'], about: 'an inn by the river' },
          { name: 'The Taproom', in: 'The Low Tavern', about: 'a room in the inn' }
        ],
        events: [{ name: 'The Long Night', when: 'in the year 300' }]
      }),
      character: () =>
        JSON.stringify({
          fromNotes: { name: 'Bram Holt', summary: 'The Ferryman is an old boatman, and his real name is Bram Holt.' },
          drafted: { traits: 'Quiet and patient.' }
        }),
      places: () =>
        JSON.stringify({
          places: [
            { name: 'Riverside Inn', in: '', fromNotes: { name: 'Riverside Inn' }, drafted: { description: 'Low beams.' } },
            { name: 'The Taproom', in: 'The Low Tavern', fromNotes: { name: 'The Taproom' }, drafted: { description: 'Barrels.' } }
          ]
        }),
      events: () =>
        JSON.stringify({
          events: [{ name: 'The Long Night', involved: ['The Ferryman'], fromNotes: { name: 'The Long Night' }, drafted: { happened: 'A storm.' } }]
        })
    })
    const done = await t.build(SUMMARY_RENAMED)
    expect(done.status).toBe('complete')
    expect(t.names('character')).toEqual(['Bram Holt'])
    expect(t.names('place')).toEqual(['Riverside Inn', 'The Taproom'])
    const bram = t.named('Bram Holt')
    expect(bram.aliases).toContain('The Ferryman')
    const inn = t.named('Riverside Inn')
    expect(inn.aliases).toContain('The Low Tavern')
    expect(t.named('The Taproom').parentId).toBe(inn.id)
    const night = t.named('The Long Night')
    const involved = mem.changesForEntry(t.db, bram.id).filter((c) => c.kind === 'relationship' && c.payload.otherId === night.id)
    expect(involved).toHaveLength(1)
  })

  it('links a description it planned by too, without keeping it as a name', async () => {
    const t = setup()
    t.ctx.fetchImpl = answering({
      overview: listing({
        characters: [{ name: 'The old ferryman', about: 'an old boatman' }],
        events: [{ name: 'The Long Night', when: 'in the year 300' }]
      }),
      character: () =>
        JSON.stringify({ fromNotes: { name: 'Bram Holt' }, drafted: { summary: 'An old boatman.', traits: 'Quiet and patient.' } }),
      events: () =>
        JSON.stringify({
          events: [{ name: 'The Long Night', involved: ['The old ferryman'], fromNotes: { name: 'The Long Night' }, drafted: { happened: 'A storm.' } }]
        })
    })
    const done = await t.build('The old ferryman, whose name is Bram Holt, rows the river. The Long Night happened in the year 300.')
    expect(done.status).toBe('complete')
    const bram = t.named('Bram Holt')
    expect(bram.aliases).toEqual([])
    const night = t.named('The Long Night')
    expect(mem.changesForEntry(t.db, bram.id).filter((c) => c.kind === 'relationship' && c.payload.otherId === night.id)).toHaveLength(1)
  })
})

describe('more fixes to building (2026-10-17)', () => {
  it('misses a profile whose save fails, and goes on with the rest', async () => {
    const t = setup()
    const real = save.saveEntry
    const spy = vi.spyOn(save, 'saveEntry').mockImplementation((w, n) => {
      if (n.planned === 'Saltmarsh') throw new Error('The disk is full')
      return real(w, n)
    })
    try {
      const done = await t.build(SUMMARY)
      expect(done.status).toBe('complete')
      expect(done.missed).toEqual(['Saltmarsh'])
      expect(t.names('place')).toEqual(['The Grey Coast'])
      expect(t.names('character')).toEqual(['Mara Venn', 'Tobin'])
    } finally {
      spy.mockRestore()
    }
  })

  it('lays out characters and places as they start, but events and plot threads when they happen', () => {
    const start = 'Describe everything as it stands at the start'
    expect(characterSystem()).toContain(start)
    expect(batchSystem('place')).toContain(start)
    for (const kind of ['event', 'thread'] as const) {
      expect(batchSystem(kind)).not.toContain(start)
      expect(batchSystem(kind)).toContain('Say when it happens in the story')
    }
  })

  it('never asks about later books, and an event the AI still puts in one keeps those words, undated, at no scene', async () => {
    expect(overviewSystem()).not.toMatch(/Book \d/)
    expect(batchSystem('event')).not.toMatch(/Book \d/)
    const t = setup()
    const id = repo.listStories(t.db)[0].id
    keepOutline(t.db, id, [
      { key: 'c0', kind: 'chapter', title: 'Harbour', text: 'The ferry waits.', card: { when: 'Day 1' } },
      { key: 's0', kind: 'scene', title: 'Debt', text: 'Mara Venn is a smuggler captain.', parent: { key: 'c0' } },
      { key: 's1', kind: 'scene', title: 'Wreck', text: 'The Storm struck on Day 3.', parent: { key: 'c0' } }
    ])
    t.ctx.fetchImpl = answering({
      events: () =>
        JSON.stringify({
          events: [{ name: 'The Storm', scene: 'Scene 2', fromNotes: { name: 'The Storm' }, drafted: { when: 'in Book 2, Day 3', happened: 'A gale.' } }]
        })
    })
    const done = await t.build(storySummary(t.db, id), id)
    expect(done.status).toBe('complete')
    const storm = t.named('The Storm')
    expect(storm.fields.when).toBe('in Book 2, Day 3')
    expect(storm.originSceneId).toBeNull()
    expect(storm.originStoryId).toBe(id)
  })

  it('links characters to where they live, items to their owners, and events to their place and the groups in them', async () => {
    const t = setup()
    let asked = ''
    t.ctx.fetchImpl = answering({
      relationships: (user) => {
        asked = user
        return JSON.stringify({
          relationships: [
            { from: 'Mara Venn', to: 'Saltmarsh', type: 'lives in' },
            { from: 'Tide Compass', to: 'Mara Venn', type: 'owns' }
          ]
        })
      },
      events: () =>
        JSON.stringify({
          events: [
            {
              name: 'The Great Flood',
              at: 'Saltmarsh',
              involved: ['Tobin', 'Salt Guild'],
              fromNotes: { name: 'The Great Flood' },
              drafted: { happened: 'The sea rose.' }
            }
          ]
        })
    })
    const done = await t.build(SUMMARY)
    expect(done.status).toBe('complete')
    expect(asked).toContain('Places: The Grey Coast; Saltmarsh')
    expect(asked).toContain('Items: Tide Compass')
    const links = (name: string): [string, string][] =>
      mem
        .changesForEntry(t.db, t.named(name).id)
        .flatMap((c): [string, string][] => (c.kind === 'relationship' && c.entryId === t.named(name).id ? [[c.payload.type, c.payload.otherId]] : []))
    const mara = links('Mara Venn')
    expect(mara).toContainEqual(['lives in', t.named('Saltmarsh').id])
    expect(mara).toContainEqual(['owns', t.named('Tide Compass').id])
    const flood = t.named('The Great Flood')
    expect(links('The Great Flood')).toContainEqual(['happens at', t.named('Saltmarsh').id])
    expect(links('Salt Guild')).toContainEqual(['involved in', flood.id])
    expect(links('Tobin')).toContainEqual(['involved in', flood.id])
  })

  it('stops a story’s build before its kept outline is undone, so a page the Undo removes is never filled after', { timeout: 30000 }, async () => {
    const t = setup({ modelId: 'fake/slow' })
    const id = repo.listStories(t.db)[0].id
    const kept = keepOutline(t.db, id, [
      { key: 'c0', kind: 'chapter', title: 'The Ferry', text: 'Mara Venn is a smuggler captain.', card: { pov: 'Tobin Hale', location: 'Gull Quay' } },
      { key: 's0', kind: 'scene', title: 'Debt', text: 'Tobin Hale is a ferryman who owes the Salt Guild.', parent: { key: 'c0' } }
    ])
    const made = kept.flatMap((k) => k.entryIds ?? [])
    expect(made.length).toBeGreaterThan(0)
    const finished = startBuild(t.ctx, { buildId: 'story-1', summary: storySummary(t.db, id), storyId: id })
    await until(() => t.progress().some((p) => p.made.length > 0))
    await cancelBuildFor(t.db, [id])
    expect(buildRunning()).toBe(false)
    unkeepOutline(t.db, kept)
    const stamp = (e: ID): unknown => t.db.prepare('SELECT updated_at, fields_json FROM entries WHERE id = ?').get(e)
    const after = new Map(made.map((e) => [e, stamp(e)]))
    await finished
    await new Promise((r) => setTimeout(r, 50))
    expect(t.doneOf('story-1')?.status).toBe('cancelled')
    for (const e of made) {
      expect(entryState(t.db, e)).toBe('deleted')
      expect(stamp(e)).toEqual(after.get(e))
    }
    expect(t.names('character')).not.toContain('Tobin Hale')
  })
})

describe('cheaper builds (2026-10-17)', () => {
  type Sent = { role: string; content: string }[]
  /** Every request's messages, in order, as sent. */
  function recording(answer?: (job: string, n: number) => string | null): typeof fetch & { sent: Sent[] } {
    const sent: Sent[] = []
    const count: Record<string, number> = {}
    const f = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { messages: Sent }
      sent.push(body.messages)
      const job = /^\[AIWRITE-[A-Z-]+ v1\] ([a-z-]+)$/m.exec(body.messages[1]?.content ?? '')?.[1] ?? ''
      count[job] = (count[job] ?? 0) + 1
      const reply = answer?.(job, count[job]) ?? null
      return reply === null ? fetch(input, init) : streamed(reply)
    }) as typeof fetch & { sent: Sent[] }
    f.sent = sent
    return f
  }
  const jobOf = (m: Sent): string => /^\[AIWRITE-[A-Z-]+ v1\] ([a-z-]+)$/m.exec(m[1]?.content ?? '')?.[1] ?? ''

  it('every request opens the same way: one system message, then the summary; the job and the world after it', async () => {
    const db = memoryWorld()
    // A page the memory read from a scene, thin: filled in at the end, opening the same way.
    repo.createEntry(db, 'character', { name: 'Kell', summary: 'A dock hand.' }, { origin: 'text' })
    const t = setup({ db })
    const f = recording()
    t.ctx.fetchImpl = f
    const done = await t.build(SUMMARY)
    expect(done.status).toBe('complete')
    const jobs = f.sent.map(jobOf)
    expect(jobs).toEqual(expect.arrayContaining(['overview', 'character', 'places', 'groups', 'items', 'lore', 'events', 'threads', 'glossary', 'relationships', 'themes', 'fill-gaps']))
    const lead = `${summaryLead(SUMMARY)}\n\n`
    for (const m of f.sent) {
      expect(m[0]).toEqual({ role: 'system', content: worldSystem() })
      expect(m[1].role).toBe('user')
      expect(m[1].content.startsWith(lead)).toBe(true)
      // The job's own instructions come straight after the summary.
      expect(m[1].content.slice(lead.length)).toMatch(/^\[AIWRITE-(WORLD|BUILDER) v1\] [a-z-]+\n/)
    }
    // The world (its style guide) and what to lay out come after the summary and the job.
    const character = f.sent.find((m) => jobOf(m) === 'character')![1].content
    expect(character.indexOf('Being laid out from the same summary')).toBeGreaterThan(character.indexOf('Fields (key: what it holds)'))
    expect(character.indexOf('The character to lay out')).toBeGreaterThan(character.indexOf('Being laid out from the same summary'))
    // For Claude through OpenRouter, what every request shares is marked up to the summary's end.
    const user = themesUser(SUMMARY, ['themes'])
    expect(user.content.slice(0, user.cacheUpTo)).toBe(summaryLead(SUMMARY))
    const sent = sentMessages({ kind: 'openrouter' }, 'anthropic/claude-sonnet-4.5', [
      { role: 'system', content: worldSystem() },
      { role: 'user', ...user }
    ]) as { content: { text: string; cache_control?: unknown }[] }[]
    expect(sent[1].content[0]).toEqual({ type: 'text', text: summaryLead(SUMMARY), cache_control: { type: 'ephemeral' } })
  })

  it('asks again after a reply it can’t use with the same opening, the correction after it', async () => {
    const t = setup()
    const f = recording((job, n) => (job === 'places' && n === 1 ? 'Here are the places, all laid out nicely.' : null))
    t.ctx.fetchImpl = f
    const done = await t.build(SUMMARY)
    expect(done.status).toBe('complete')
    const places = f.sent.filter((m) => jobOf(m) === 'places')
    expect(places).toHaveLength(2)
    expect(places[1].slice(0, 2)).toEqual(places[0])
    expect(places[1][2]).toEqual({ role: 'assistant', content: 'Here are the places, all laid out nicely.' })
    expect(places[1][3].role).toBe('user')
    expect(t.names('place')).toEqual(['Saltmarsh', 'The Grey Coast'])
  })

  it('copies a story’s own themes and tone into the world without asking the AI', async () => {
    const t = setup()
    const story = repo.listStories(t.db)[0]
    repo.updateStory(t.db, story.id, { themes: 'Debt  and family.', tone: 'Wry.' })
    const f = answering({})
    t.ctx.fetchImpl = f
    const done = await t.build(`${SUMMARY}\nThemes: Debt and family.\nTone: Wry.`, story.id)
    expect(done.status).toBe('complete')
    expect(f.asked.themes).toBeUndefined()
    expect(repo.getMeta(t.db, 'themes')).toBe('Debt and family.')
    expect(repo.getMeta(t.db, 'tone')).toBe('Wry.')
    expect(done.made.map((m) => m.what)).toEqual(expect.arrayContaining(['themes', 'tone']))
  })

  it('asks the AI only for what the story doesn’t give', async () => {
    const t = setup()
    const story = repo.listStories(t.db)[0]
    repo.updateStory(t.db, story.id, { themes: 'Debt and family.' })
    let asked = ''
    const f = answering({
      themes: (user) => {
        asked = user
        return null
      }
    })
    t.ctx.fetchImpl = f
    await t.build(`${SUMMARY}\nThemes: Debt and family.`, story.id)
    expect(f.asked.themes).toBe(1)
    expect(asked).toContain('{"tone": "..."}')
    expect(asked).not.toContain('"themes": "..."')
    expect(repo.getMeta(t.db, 'themes')).toBe('Debt and family.')
    expect(repo.getMeta(t.db, 'tone')).toBe('Salt-stung and wary, with dry humour.')
  })

  it('still asks for the themes when the summary isn’t the story’s own words for them', async () => {
    const t = setup()
    const story = repo.listStories(t.db)[0]
    repo.updateStory(t.db, story.id, { themes: 'Debt and family.', tone: 'Wry.' })
    const f = answering({})
    t.ctx.fetchImpl = f
    await t.build(SUMMARY, story.id)
    expect(f.asked.themes).toBe(1)
  })

  it('checks the summary only against pages Adam wrote, and skips the check when there are none', async () => {
    const ai = setup()
    repo.createEntry(ai.db, 'character', { name: 'Mara Venn', summary: 'A captain.', fields: { age: '50' } }, { origin: 'ai' })
    const f = answering({})
    ai.ctx.fetchImpl = f
    const skipped = await ai.build(`${SUMMARY} Mara Venn is 34.`)
    expect(skipped.found.map((x) => x.name)).toContain('Mara Venn')
    expect(f.asked.check).toBeUndefined()
    expect(skipped.conflicts).toEqual([])

    const his = setup()
    repo.createEntry(his.db, 'character', { name: 'Mara Venn', summary: 'A captain.', fields: { age: '50' } })
    const g = answering({})
    his.ctx.fetchImpl = g
    const checked = await his.build(`${SUMMARY} Mara Venn is 34.`)
    expect(g.asked.check).toBe(1)
    expect(checked.conflicts.map((c) => c.field)).toEqual(['age'])
  })

  it('tops up the pages it laid out that came back thin, and never fills another story’s AI pages', async () => {
    const t = setup()
    const story = repo.listStories(t.db)[0]
    const other = repo.createStory(t.db, { title: 'Another tale' })
    const theirs = repo.createEntry(t.db, 'character', { name: 'Odo', summary: 'Drafted for the other tale.' }, { origin: 'ai', originStoryId: other.id })
    const ours = repo.createEntry(t.db, 'character', { name: 'Kell', summary: 'A dock hand.' }, { origin: 'text', originStoryId: story.id })
    const f = recording((job) =>
      // Profiles that come back thin: only a name and a line.
      job === 'character' ? JSON.stringify({ fromNotes: {}, drafted: { summary: 'Someone in the summary.' } }) : null
    )
    t.ctx.fetchImpl = f
    const done = await t.build(SUMMARY, story.id)
    expect(done.status).toBe('complete')
    const filled = f.sent.filter((m) => jobOf(m) === 'fill-gaps').map((m) => /^Name: (.+)$/m.exec(m[1].content)?.[1])
    // The two characters laid out thin first, then this story's thin page; never the other story's.
    expect(filled.slice(0, 2).sort()).toEqual(['Mara Venn', 'Tobin'])
    expect(filled.slice(2)).toEqual(['Kell'])
    expect(t.named('Tobin').description).toBe('Description of Tobin, filled in from the story.')
    expect(t.named('Odo').description).toBe('')
    expect(theirs.id).toBeTruthy()
    expect(t.named('Kell').description).toBe('Description of Kell, filled in from the story.')
    expect(ours.id).toBeTruthy()
  })

  /** A story whose kept outline names Bram Holt and Gull Quay, which the world hasn't: keeping it makes their name-only pages. */
  function outlined() {
    const t = setup()
    const id = repo.listStories(t.db)[0].id
    const kept = keepOutline(t.db, id, [
      { key: 'c0', kind: 'chapter', title: 'The Ferry', text: 'The ferry waits.', card: { pov: 'Bram Holt', location: 'Gull Quay' } },
      {
        key: 's0',
        kind: 'scene',
        title: 'Debt',
        text: 'Bram Holt is a ferryman who owes the Salt Guild. Gull Quay is a harbour town.',
        parent: { key: 'c0' }
      }
    ])
    const chapterId = repo.getOutline(t.db, id).chapters[0].id
    const bram = t.named('Bram Holt')
    const quay = t.named('Gull Quay')
    return { t, id, kept, chapterId, bram, quay }
  }

  it('lays out a character and a place keeping the outline made with only a name, in full, into the same pages', async () => {
    const { t, id, chapterId, bram, quay } = outlined()
    expect(bram.origin).toBe('ai')
    expect(repo.getChapterCard(t.db, chapterId).povId).toBe(bram.id)
    const f = recording()
    t.ctx.fetchImpl = f
    const done = await t.build(storySummary(t.db, id), id)
    expect(done.status).toBe('complete')
    // The full character request, for him.
    const asked = f.sent.filter((m) => jobOf(m) === 'character').map((m) => /^The character to lay out:\n- (.+?)(?: \(also|: | \[|$)/m.exec(m[1].content)?.[1])
    expect(asked).toContain('Bram Holt')
    const places = f.sent.filter((m) => jobOf(m) === 'places').map((m) => m[1].content)
    expect(places.some((u) => /^The places to lay out:\n(?:- .*\n)*- Gull Quay/m.test(u))).toBe(true)
    // The same pages, with their profiles; no second one, and the card still points at him.
    expect(t.names('character').filter((n) => n === 'Bram Holt')).toHaveLength(1)
    const after = t.named('Bram Holt')
    expect(after.id).toBe(bram.id)
    // The fake's "summary" is the first line of the summary naming him, as his words.
    expect(after.summary).toContain('Bram Holt')
    expect(after.fields.traits).toBe('Core traits of Bram Holt, drafted to fit the world.')
    expect(after.fieldOrigins.summary).toBe('adam')
    expect(after.fieldOrigins.traits).toBe('ai')
    expect(t.named('Gull Quay').id).toBe(quay.id)
    expect(t.named('Gull Quay').summary).toContain('Gull Quay')
    expect(t.named('Gull Quay').fields.atmosphere).toBe('Atmosphere of Gull Quay, drafted to fit the world.')
    expect(repo.getChapterCard(t.db, chapterId).povId).toBe(bram.id)
    expect(repo.getChapterCard(t.db, chapterId).locationId).toBe(quay.id)
    // Laid out by the build (on its results page), so not filled in again: it had the full request.
    expect(done.made.some((m) => m.entryId === bram.id)).toBe(true)
    expect(done.found.some((x) => x.entryId === bram.id)).toBe(false)
    expect(f.sent.filter((m) => jobOf(m) === 'fill-gaps' && m[1].content.includes('Name: Bram Holt'))).toHaveLength(0)

    // Undo build leaves the pages as the outline made them: only the name, still on the card.
    undoBuild(t.db, done.runId!)
    const undone = t.named('Bram Holt')
    expect(undone.summary).toBe('')
    expect(undone.fields.traits ?? '').toBe('')
    expect(undone.byHand).toBe(false)
    expect(repo.getChapterCard(t.db, chapterId).povId).toBe(bram.id)
  })

  it('never lays out over a page Adam has typed into', async () => {
    const { t, id, bram } = outlined()
    repo.updateEntry(t.db, bram.id, { summary: 'An old friend of the family.' })
    const f = recording()
    t.ctx.fetchImpl = f
    const done = await t.build(storySummary(t.db, id), id)
    expect(done.status).toBe('complete')
    const asked = f.sent.filter((m) => jobOf(m) === 'character').map((m) => /^The character to lay out:\n- (.+?)(?: \(also|: | \[|$)/m.exec(m[1].content)?.[1])
    expect(asked).not.toContain('Bram Holt')
    expect(done.found.map((x) => x.entryId)).toContain(bram.id)
    expect(t.named('Bram Holt').summary).toBe('An old friend of the family.')
  })

  it('the estimate counts what a build now asks: fewer requests when the story gives the themes and no page is Adam’s', () => {
    const c = { contextLength: 64000, maxOutput: null }
    const all = guessBuild(SUMMARY, c, { existing: 10, his: 10 }, 'off')
    const lean = guessBuild(SUMMARY, c, { existing: 10, his: 0, themesKnown: true }, 'off')
    expect(lean.input).toBeLessThan(all.input)
    expect(lean.output).toBeLessThan(all.output)
    // Filling in thin pages costs more.
    expect(guessBuild(SUMMARY, c, { existing: 10, thin: 4 }, 'off').input).toBeGreaterThan(all.input)
    // The cache is taken off only at a price the provider gives.
    const price = { promptPrice: 0.000001, completionPrice: 0.000002 }
    expect(estimateCost(all, price)).toBe(estimateCost(all, price, null))
    expect(all.cached).toBeGreaterThan(0)
    expect(estimateCost(all, price, 0.0000001)!).toBeLessThan(estimateCost(all, price)!)
  })
})