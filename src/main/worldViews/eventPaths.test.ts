// Every way an event is made puts it at its scene (Adam, 2026-10-19: "all the events being added by the AI went right
// after the first chapter's scene as a long line"). For each path, an event planned or found for Ch 2, Sc 3 shows on the
// timeline right after Ch 2, Sc 3, not after Ch 1, Sc 1. The World builder, the Story builder and a recipe's build run
// against the fake AI server (tests/fake-provider/m4/world.mjs: an event is a sentence "The X struck|began ..." and, on a
// story plan's scene line, that scene); the memory keeper against the fake memory model. Invented stories only.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { CodexItem } from '@shared/contracts/storyBuilder'
import type { WorldBuildDone } from '@shared/contracts/worldBuilder'
import type { ID } from '@shared/types'
import { defaultWritingPrefs } from '@shared/defaults'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import { EVENT_OUTLINE, eventWorld, sceneBefore } from '../../../tests/unit/eventWorld'
import { chatSwitches, memoryWorld } from '../../../tests/unit/helpers'
import { readScene, saveParas } from '../../../tests/unit/keeperRead'
import type { KeepItem } from '@shared/contracts/outline'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import type { JobModel } from '../ai/jobModel'
import { EditorAgent } from '../ask/agent'
import { fillGaps, fillTargets } from '../builder/fill'
import { keepOutline, unkeepOutline } from '../outline/structure'
import { buildSummary, planOf } from '../storyBuilder/codex'
import { resetBuildsForTests, startBuild, type BuildContext } from '../worldBuilder/run'
import { storySummary } from '../worldBuilder/storySummary'
import { makingAt } from './eventHomes'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0, slowDelayMs: 15 })
})
afterAll(() => fake.close())
beforeEach(() => resetBuildsForTests())
afterEach(() => chatSwitches(null))

type DB = ReturnType<typeof memoryWorld>

const model = (): JobModel => ({
  job: 'world',
  target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: 'test' },
  choice: { providerId: 'p1', modelId: 'fake/writer', label: 'fake/writer', contextLength: 32000, promptPrice: null, completionPrice: null },
  thinking: 'off'
})

let n = 0
/** Runs a World build to its end, as the window starts one (ipc/worldBuilder.ts startIn). */
async function build(db: DB, input: { summary: string; storyId: ID | null; plan?: ReturnType<typeof planOf> }): Promise<WorldBuildDone> {
  const events: { name: string; payload: unknown }[] = []
  const ctx: BuildContext = {
    db,
    worldId: 'world-1',
    model: model(),
    prefs: defaultWritingPrefs(),
    emit: (name, payload) => events.push({ name, payload }),
    onSaved: () => undefined,
    retryDelays: [1, 1]
  }
  const buildId = `b-${++n}`
  await startBuild(ctx, { buildId, ...input })
  const done = events.find((e) => e.name === 'worldBuilder:done' && (e.payload as WorldBuildDone).buildId === buildId)?.payload as WorldBuildDone
  if (!done) throw new Error('The build ended without saying so')
  return done
}

const named = (db: DB, name: string): ID => {
  const e = repo.listEntries(db, 'event').find((x) => x.name === name)
  if (!e) throw new Error(`No event named ${name}`)
  return e.id
}

/** The outline with these words as a scene's one line (the outline is asked to put each event in the scene it happens in). */
const withLines = (lines: Record<string, string>): KeepItem[] => EVENT_OUTLINE.map((k) => (lines[k.key] ? { ...k, text: lines[k.key] } : k))

describe('the World builder, building a story from its plan', () => {
  it('puts each event in the numbered scene it happens in', async () => {
    const w = eventWorld(withLines({ s22: 'The Gale began on Day 3.', s23: 'The Storm struck the reef.' }))
    const done = await build(w.db, { summary: storySummary(w.db, w.storyId), storyId: w.storyId })
    expect(done.status).toBe('complete')
    const storm = named(w.db, 'The Storm')
    expect(sceneBefore(w.db, w.storyId, storm)).toBe(w.c2s3)
    expect(sceneBefore(w.db, w.storyId, named(w.db, 'The Gale'))).toBe(w.c2s2)
    expect(mem.listExistsPoints(w.db, storm)).toEqual([expect.objectContaining({ kind: 'scene', sceneId: w.c2s3, byHand: false })])
  })
})

describe('Build from a summary (the author’s own, true from the story’s start)', () => {
  it('shows a dated event on its day, right after that day’s scene', async () => {
    const w = eventWorld()
    await build(w.db, { summary: 'The Storm struck on Day 4. Mara Venn is a smuggler captain.', storyId: w.storyId })
    const storm = named(w.db, 'The Storm')
    // True from where the summary is (the story's start), as his own summary says: no scene is guessed for it…
    expect(mem.listExistsPoints(w.db, storm)).toEqual([expect.objectContaining({ kind: 'world' })])
    // …and the timeline shows it on its day.
    expect(sceneBefore(w.db, w.storyId, storm)).toBe(w.c2s3)
  })
})

describe('the Story builder’s cast and world', () => {
  const item = (o: Partial<CodexItem>): CodexItem => ({
    key: o.name ?? '',
    kind: 'event',
    name: '',
    aliases: [],
    about: '',
    in: '',
    rule: false,
    when: '',
    role: '',
    mine: false,
    on: true,
    existing: null,
    ...o
  })

  it('lays the events out before the outline, and keeping the outline puts each in its scene (its Undo back)', async () => {
    const db = memoryWorld()
    const storyId = repo.listStories(db)[0].id
    const items = [
      item({ kind: 'character', name: 'Mara Venn', about: 'A smuggler captain.' }),
      item({ name: 'The Storm', about: 'A storm wrecks Mara’s boat on the reef.' }),
      item({ name: 'The Wedding', about: 'Mara’s brother marries.', when: 'Day 6' })
    ]
    const done = await build(db, { summary: buildSummary('Mara Venn loses her boat and comes home.', '', '', items), storyId, plan: planOf(items) })
    expect(done.status).toBe('complete')
    const storm = named(db, 'The Storm')
    const wedding = named(db, 'The Wedding')
    // No scene to put them in yet: they wait at the story's start.
    expect(mem.listExistsPoints(db, storm).map((p) => p.kind)).toEqual(['world'])

    // The outline puts the Storm in The Wreck (its line names it) and the Wedding on Day 6.
    const kept = keepOutline(db, storyId, withLines({ s23: 'The Storm drives the boat onto the reef.' }))
    const o = repo.getOutline(db, storyId)
    const at = (c: number, s: number): ID => o.scenes.filter((x) => x.chapterId === o.chapters[c - 1].id)[s - 1].id
    expect(sceneBefore(db, storyId, storm)).toBe(at(2, 3))
    expect(sceneBefore(db, storyId, wedding)).toBe(at(3, 1))

    unkeepOutline(db, kept)
    expect(mem.listExistsPoints(db, storm).map((p) => p.kind)).toEqual(['world'])
    expect(mem.listExistsPoints(db, wedding).map((p) => p.kind)).toEqual(['world'])
  })
})

describe('a story planned from a recipe', () => {
  it('builds its cast with the recipe’s parts and still puts each event in its scene', async () => {
    const w = eventWorld(withLines({ s23: 'The Storm struck the reef.' }))
    const summary = storySummary(w.db, w.storyId, { cast: '- The lead: an outsider who learns to stay.', devices: '- A storm foreshadowed early.' })
    expect(summary).toContain('from the recipe')
    await build(w.db, { summary, storyId: w.storyId })
    expect(sceneBefore(w.db, w.storyId, named(w.db, 'The Storm'))).toBe(w.c2s3)
  })
})

describe('the outline in stages', () => {
  it('keeping a chapter’s scenes later puts a waiting event in the kept scene that names it', async () => {
    const db = memoryWorld()
    const storyId = repo.listStories(db)[0].id
    await build(db, { summary: 'The Storm struck the reef. Mara Venn is a smuggler captain.', storyId })
    const storm = named(db, 'The Storm')
    // The chapters first (In stages), then the second chapter's scenes, into the chapter kept already.
    keepOutline(db, storyId, [
      ...EVENT_OUTLINE.filter((k) => k.kind === 'chapter'),
      { ...EVENT_OUTLINE[1], parent: { key: 'c1' } }
    ])
    const chapters = repo.getOutline(db, storyId).chapters
    const kept = keepOutline(
      db,
      storyId,
      EVENT_OUTLINE.filter((k) => k.parent?.key === 'c2').map((k) => ({
        ...k,
        parent: { id: chapters[1].id },
        ...(k.key === 's23' ? { text: 'The storm drives the boat onto the reef.' } : {})
      }))
    )
    const wreck = kept.at(-1)!.id
    expect(kept.at(-1)!.events?.map((m) => m.entryId)).toEqual([storm])
    expect(sceneBefore(db, storyId, storm)).toBe(wreck)
  })
})

describe('the memory keeper', () => {
  it('makes an event it finds in a scene’s words exist from that scene', async () => {
    const w = eventWorld()
    const STRUCK = 'The storm struck the reef at midnight.'
    saveParas(w.db, w.c2s3, [['p1', STRUCK]])
    await readScene(w.db, fake, w.c2s3, { add: [{ type: 'event', name: 'The Storm', summary: 'A storm wrecks the boat', involved: [], quote: STRUCK }] })
    const storm = named(w.db, 'The Storm')
    expect(mem.listExistsPoints(w.db, storm)).toEqual([expect.objectContaining({ kind: 'scene', sceneId: w.c2s3 })])
    expect(sceneBefore(w.db, w.storyId, storm)).toBe(w.c2s3)
  })
})

describe('filling in the gaps', () => {
  it('never fills an event, so where it first exists stays as it is', async () => {
    const w = eventWorld()
    const storm = repo.createEntry(w.db, 'event', { name: 'The Storm' }, makingAt(w.db, 'event', {}, { sceneId: w.c2s3 }))
    expect(fillTargets(storm)).toEqual([])
    const out = await fillGaps({ db: w.db, model: model(), job: 'world', prefs: defaultWritingPrefs(), storyId: w.storyId }, [storm.id])
    expect(out.filled).toEqual([])
    expect(sceneBefore(w.db, w.storyId, storm.id)).toBe(w.c2s3)
  })
})

describe('Ask the world', () => {
  const agentAt = (db: DB, storyId: ID, sceneId: ID): EditorAgent =>
    new EditorAgent(db, { storyId, sceneId, prefs: defaultWritingPrefs() }, () => undefined, () => undefined)
  let c = 0
  const run = (agent: EditorAgent, name: string, args: Record<string, unknown>) => agent.run({ id: `c${++c}`, name, arguments: JSON.stringify(args) })

  it('proposes a new event in the scene it happens in, and applying it puts it there', () => {
    const w = eventWorld()
    const agent = agentAt(w.db, w.storyId, w.c2s3)
    run(agent, 'propose_changes', {
      changes: [
        { kind: 'new_entry', entry_kind: 'event', name: 'The Storm', summary: 'A storm wrecks the boat.', why: 'It happens here.' },
        { kind: 'new_entry', entry_kind: 'event', name: 'The Gale', when: 'Day 3', scene: 'Ch 2, Sc 2', why: 'It happens there.' },
        { kind: 'new_entry', entry_kind: 'event', name: 'The Old War', scene: 'before the story', why: 'Backstory.' }
      ]
    })
    const [storm, gale, war] = agent.proposals
    expect(storm).toMatchObject({ kind: 'newEntry', entryKind: 'event', sceneId: w.c2s3, sceneLabel: expect.stringContaining('Ch 2, Sc 3') })
    expect(gale).toMatchObject({ kind: 'newEntry', sceneId: w.c2s2, when: 'Day 3' })
    expect(war).toMatchObject({ kind: 'newEntry' })
    expect(war.kind === 'newEntry' && war.sceneId).toBeFalsy()

    // Applied as the window applies it (applyProposal.ts: createEntry with the proposal's scene).
    const apply = (p: (typeof agent.proposals)[number]): ID => {
      if (p.kind !== 'newEntry') throw new Error('Not a new entry')
      const input = { name: p.name, summary: p.summary, ...(p.when ? { fields: { when: p.when } } : {}), originStoryId: w.storyId }
      return repo.createEntry(w.db, p.entryKind, input, makingAt(w.db, p.entryKind, input, p.sceneId ? { sceneId: p.sceneId } : null)).id
    }
    expect(sceneBefore(w.db, w.storyId, apply(storm))).toBe(w.c2s3)
    expect(sceneBefore(w.db, w.storyId, apply(gale))).toBe(w.c2s2)
    expect(mem.listExistsPoints(w.db, apply(war)).map((p) => p.kind)).toEqual(['world'])
  })

  it('does the same with the older tool', () => {
    chatSwitches([])
    const w = eventWorld()
    const agent = agentAt(w.db, w.storyId, w.c2s3)
    run(agent, 'propose_new_entry', { kind: 'event', name: 'The Storm', why: 'It happens here.' })
    expect(agent.proposals[0]).toMatchObject({ kind: 'newEntry', sceneId: w.c2s3 })
  })
})

describe('Add to memory, on a scene’s words', () => {
  it('makes an event exist from that scene; other kinds as before', () => {
    const w = eventWorld()
    const storm = repo.createEntry(w.db, 'event', { name: 'The Storm', originStoryId: w.storyId }, makingAt(w.db, 'event', {}, { sceneId: w.c2s3 }))
    expect(storm.originSceneId).toBe(w.c2s3)
    expect(sceneBefore(w.db, w.storyId, storm.id)).toBe(w.c2s3)
    expect(makingAt(w.db, 'character', {}, { sceneId: w.c2s3 })).toEqual({ origin: 'adam' })
    // A scene that has gone: as before, from the story's start.
    repo.deleteScene(w.db, w.c3s1)
    expect(makingAt(w.db, 'event', { originStoryId: w.storyId }, { sceneId: w.c3s1 })).toEqual({ origin: 'adam', originStoryId: w.storyId })
  })
})
