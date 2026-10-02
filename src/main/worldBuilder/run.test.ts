// Building the world from a summary, against the fake provider: tests/fake-provider/m4/world.mjs answers
// the World builder's requests with deterministic replies (its rules are at the top of that file), so these
// tests know exactly what each summary makes.

import type Database from 'better-sqlite3'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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
    expect(lines).toHaveLength(13)
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

    // Every request is recorded as the World builder's, and the run keeps them all.
    const recs = records(t.db)
    expect(recs).toHaveLength(12)
    expect(recs.every((r) => r.status === 'complete')).toBe(true)
    expect(run?.generationIds).toHaveLength(12)
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
})

describe('undoing a build', () => {
  it('takes the whole build away with one Undo, and brings it all back with the Undo on that', async () => {
    const t = setup()
    const done = await t.build(SUMMARY)
    const runId = done.runId!
    const { lineIds } = t.db.transaction(() => undoBuild(t.db, runId))()
    expect(lineIds).toHaveLength(13)
    expect(t.names()).toEqual([])
    expect(repo.getMeta(t.db, 'themes') ?? '').toBe('')
    expect(repo.getMeta(t.db, 'tone') ?? '').toBe('')
    expect(madeItems(t.db, runId).every((m) => m.undone)).toBe(true)
    expect(buildState(t.db, 'world-1', SUMMARY).last?.made.every((m) => m.undone)).toBe(true)

    t.db.transaction(() => redoBuild(t.db, runId, lineIds))()
    expect(t.names()).toHaveLength(10)
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
    expect(lineIds).toHaveLength(12)
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
})

describe('stopping a build', () => {
  it('keeps what was saved when it is cancelled, and one Undo still takes it away', { timeout: 30000 }, async () => {
    const t = setup({ modelId: 'fake/slow' })
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
    expect(buildRunning()).toBe(false)
    expect(buildState(t.db, 'world-1', SUMMARY)).toMatchObject({ running: null, last: { buildId: 'slow-1', status: 'cancelled' } })

    t.db.transaction(() => undoBuild(t.db, done.runId!))()
    expect(t.names()).toEqual([])
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
  const isVoiceAsk = (init?: RequestInit): string | null => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: { role: string; content: string }[] }
    if (!body.messages?.some((m) => m.role === 'system' && /\] voice\n/.test(m.content))) return null
    return body.messages.find((m) => m.role === 'user')?.content.match(/^CHARACTER: ([^(\n]+?)(?: \(|$)/m)?.[1] ?? null
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
    expect(records(t.db)).toHaveLength(13)
    expect(kdb.getRun(t.db, done.runId!)?.generationIds).toHaveLength(13)
    // The pages the build made were full already: nothing else was asked.
    expect(pagesToFill(t.db, [])).toEqual([])
  })

  it('never fills a page Adam made himself, unless the build made it', () => {
    const db = memoryWorld()
    const his = repo.createEntry(db, 'character', { name: 'Brann' })
    const text = repo.createEntry(db, 'character', { name: 'Kell' }, { origin: 'text' })
    const lore = repo.createEntry(db, 'lore', { name: 'Magic' }, { origin: 'text' })
    expect(pagesToFill(db, [])).toEqual([text.id])
    expect(pagesToFill(db, [his.id])).toEqual([his.id, text.id])
    expect(pagesToFill(db, [lore.id])).toEqual([text.id])
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
    const asked: string[] = []
    t.ctx.voiceModel = voiceModel()
    t.ctx.fetchImpl = (input, init) => {
      const who = isVoiceAsk(init)
      if (who) {
        asked.push(who)
        // Adam sets Tobin's voice while the AI is still thinking of one.
        if (who === 'Tobin') setEntryReadAloud(t.db, t.named('Tobin').id, { voice: { design: 'Adam’s own.', voice: '' }, say: [] })
      }
      return fetch(input, init)
    }
    const done = await t.build(SUMMARY)
    expect(done.status).toBe('complete')
    expect(asked).toEqual(['Mara Venn', 'Tobin'])
    expect(t.steps()).toEqual(
      expect.arrayContaining(['Giving the characters their voices: 1 of 2', 'Giving the characters their voices: 2 of 2'])
    )
    expect(t.progress().find((p) => p.step.startsWith('Giving'))?.stage).toBe('voices')
    expect(voiceOf(t.db, t.named('Mara Venn').id)).toBe(VOICE)
    expect(voiceOf(t.db, t.named('Tobin').id)).toBe('Adam’s own.')
    // A character it didn't make keeps its voice, and isn't asked about.
    expect(voiceOf(t.db, brann.id)).toBe('Gravel and smoke.')
    // Recorded as read aloud's requests, not the World builder's.
    expect(records(t.db)).toHaveLength(12)
    const speech = t.db.prepare("SELECT status FROM generations WHERE job = 'speech'").all()
    expect(speech).toHaveLength(2)
  })

  it('a voice that can’t be had leaves the character without one, and the build ends well', async () => {
    const t = setup()
    t.ctx.voiceModel = voiceModel()
    t.ctx.fetchImpl = async (input, init) =>
      isVoiceAsk(init) ? new Response('{"error":{"message":"Down for the night"}}', { status: 503 }) : fetch(input, init)
    const done = await t.build(SUMMARY)
    expect(done.status).toBe('complete')
    expect(voiceOf(t.db, t.named('Mara Venn').id)).toBe('')
  })
})
