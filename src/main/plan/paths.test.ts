// Plan before writing on every writing path (Adam's spec, "Plan before writing, done properly", 2026-10-19), end to end
// against an in-memory world and the fake provider (tests/fake-provider: the planner in plan.mjs looks the point of view
// up first, then plans): with "Plan before writing" on, Generate, Add below, Beat by beat (one plan for the scene), a set
// of Variants (one plan they share) and Write the whole chapter's drafts each make a plan call, and the plan reaches the
// writer's request as its own notes; Continue makes no call and is given the scene's last plan, with the end of the scene
// before. Off, none of them plans. Every request sent is read as it goes (the global fetch, wrapped). Invented text only.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import type { AppEvents } from '@shared/api'
import type { DraftOptions, ID } from '@shared/types'
import { defaultSettings, defaultWritingPrefs } from '@shared/defaults'

const h = vi.hoisted(() => ({
  db: null as Database.Database | null,
  url: '',
  planFirst: true,
  events: [] as { name: string; payload: unknown }[]
}))

const choice = (modelId: string) => ({ providerId: 'p1', modelId, label: modelId, contextLength: 64_000, promptPrice: null, completionPrice: null })
const target = () => ({ id: 'p1', name: 'Fake', kind: 'custom' as const, baseUrl: h.url, apiKey: 'k' })

vi.mock('../world', () => ({ db: () => h.db, maybeCurrentWorld: () => (h.db ? { db: h.db } : null) }))
vi.mock('../settings', () => ({
  getSettings: () => ({
    ...defaultSettings(),
    models: { ...defaultSettings().models, writer: choice('fake/writer'), memory: choice('fake/memory') },
    planFirst: h.planFirst,
    continuityBrief: false
  }),
  getWritingPrefs: () => defaultWritingPrefs()
}))
vi.mock('../ai/providers', () => ({
  getProvider: () => ({ id: 'p1', name: 'Fake', kind: 'custom', baseUrl: h.url, hasKey: true }),
  providerTarget: () => target(),
  markCheck: () => undefined
}))
vi.mock('../keeper', () => ({
  memoryModel: () => ({ target: target(), choice: choice('fake/memory'), thinking: 'off' }),
  memoryReady: () => true
}))
vi.mock('../retrieval', () => ({ recallForBriefing: async () => null, findInStory: async () => null }))
vi.mock('../events', () => ({
  emit: (name: string, payload: unknown) => {
    h.events.push({ name, payload })
  }
}))
vi.mock('../readAloud', () => ({ noteWriterSpeakers: () => undefined, noteGenerationSpeakers: () => undefined }))

import { memoryWorld } from '../../../tests/unit/helpers'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import * as repo from '../db/repo'
import { draftBriefing, type DraftBriefing } from '../ai/draftFlow'
import { startDraftJob } from '../ai/drafts'
import { VARIANTS_CATCH_UP_MS } from '../ai/gather'
import { soFarBlock } from '../beats/instructions'
import { startBeat } from '../beats'
import { resetVariantsForTests, startVariantSet } from '../variants'
import { startEdit } from '../edits'
import { PLAN_HEAD, PLAN_MARKER } from './plan'
import { forgetScenePlans } from '.'

/** Every chat request sent, as the provider got it. */
type Sent = { model: string; system: string; user: string; all: string; tools: string[] }
let sent: Sent[] = []
const realFetch = globalThis.fetch
let fake: FakeProvider

beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0, words: 80 })
  h.url = fake.url
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/chat/completions') && typeof init?.body === 'string') {
      const body = JSON.parse(init.body) as { model: string; messages: { role: string; content: unknown }[]; tools?: { function: { name: string } }[] }
      const text = (c: unknown): string => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p: { text?: string }) => p.text ?? '').join('') : '')
      sent.push({
        model: body.model,
        system: text(body.messages.find((m) => m.role === 'system')?.content),
        user: text(body.messages.find((m) => m.role === 'user')?.content),
        all: body.messages.map((m) => text(m.content)).join('\n\n'),
        tools: (body.tools ?? []).map((t) => t.function.name)
      })
    }
    return realFetch(input, init)
  }) as typeof fetch
}, 60_000)
afterAll(async () => {
  globalThis.fetch = realFetch
  await fake.close()
})
beforeEach(() => {
  sent = []
  h.events = []
  h.planFirst = true
  forgetScenePlans()
  resetVariantsForTests()
})
afterEach(() => {
  h.db?.close()
  h.db = null
})

/** A story of two scenes: the scene before, written, and the scene being written, with a card of two beats. */
function world() {
  const db = memoryWorld()
  h.db = db
  const story = repo.listStories(db)[0]
  const o = repo.getOutline(db, story.id)
  const before = o.scenes[0].id
  const wren = repo.createEntry(db, 'character', { name: 'Wren Hollis', aliases: ['Wren'], summary: 'A surveyor’s apprentice.' }).id
  const ash = repo.createEntry(db, 'character', { name: 'Ash Penrose', aliases: ['Ash'], summary: 'A drover.' }).id
  const inn = repo.createEntry(db, 'place', { name: 'The Drovers’ Inn', summary: 'An inn on the coast road.' }).id
  repo.saveSceneText(db, before, null, 'They rode on north in the rain, and neither of them said anything for a mile or more.')
  repo.updateSceneCard(db, before, { ...repo.getScene(db, before).card, povId: wren, presentIds: [ash], when: 'Day 23, evening' })
  const scene = repo.createScene(db, o.chapters[0].id, { title: 'The inn on the coast road' }).id
  repo.updateSceneCard(db, scene, {
    ...repo.getScene(db, scene).card,
    povId: wren,
    presentIds: [ash],
    locationId: inn,
    when: 'Day 23, night',
    goal: 'Wren wants a dry bed and no questions.',
    beats: ['Wren and Ash stop for the night at the inn.', 'They talk about what comes next.']
  })
  return { db, scene, before }
}

const OPTIONS: Partial<DraftOptions> = { targetWords: 300, creativity: 'balanced', direction: '' }
const plans = (): Sent[] => sent.filter((s) => s.system.startsWith(PLAN_MARKER))
const writes = (): Sent[] => sent.filter((s) => s.model === 'fake/writer')

/** Resolves once the event for this record has come (a draft or a task ending). */
function ended(id: ID, name: 'generation:done' | 'task:done' = 'generation:done', events?: { name: string; payload: unknown }[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const check = (): void => {
      const list = events ?? h.events
      if (list.some((e) => e.name === name && (e.payload as { generationId: ID }).generationId === id)) return resolve()
      if (Date.now() - started > 20_000) return reject(new Error(`no ${name} for ${id}`))
      setTimeout(check, 5)
    }
    check()
  })
}

/** Starts the draft as Generate (and Add below) do (ipc/ai.ts startDraft), and waits for it. */
async function draft(db: Database.Database, sceneId: ID, b: DraftBriefing): Promise<void> {
  const events: { name: string; payload: unknown }[] = []
  const { generationId } = startDraftJob({
    db,
    sceneId,
    options: b.input.options,
    preview: b.preview,
    provider: b.target,
    model: b.choice,
    thinking: b.thinking,
    intensity: b.input.style.intensity,
    entryVersions: b.entryVersions,
    emit: (name, payload) => void events.push({ name, payload })
  })
  await ended(generationId, 'generation:done', events)
}

describe('every writing path plans first while "Plan before writing" is on', () => {
  it('Generate: the plan call looks things up, then plans; its notes are the last thing the writer reads', async () => {
    const w = world()
    const b = await draftBriefing(w.scene, OPTIONS)
    await draft(w.db, w.scene, b)
    // One round of look-ups: the request offered the tools, then the plan without them.
    expect(plans()).toHaveLength(2)
    expect(plans()[0].tools).toContain('state_of')
    expect(plans()[1].tools).toEqual([])
    expect(plans()[0].user).toContain('## What is being written\nA whole scene, about 300 words.')
    const writer = writes()
    expect(writer).toHaveLength(1)
    expect(writer[0].user).toContain(PLAN_HEAD)
    expect(writer[0].user).toContain('The beats, in order:\n1. Wren and Ash stop for the night at the inn')
    expect(writer[0].user.trimEnd().endsWith('Now the prose itself:')).toBe(true)
    expect(b.preview.blocks.find((x) => x.id === 'plan')?.dropped).toBe(false)
  })

  it('Add below: the stretch is planned from the scene so far, the direction said once', async () => {
    const w = world()
    const soFar = 'The inn stood on its own where the coast road dropped towards the sea. Wren and Ash stopped there for the night.'
    repo.saveSceneText(w.db, w.scene, null, soFar)
    const block = soFarBlock(soFar, 64_000)!
    const direction = 'Ash goes out to see to the horses.'
    const b = await draftBriefing(w.scene, { ...OPTIONS, addBelow: true, direction }, { soFar, extras: { extraBlocks: [block] } })
    await draft(w.db, w.scene, b)
    expect(plans().length).toBeGreaterThanOrEqual(1)
    expect(plans()[0].user).toContain(`Plan only this stretch: what the author directs:\n${direction}`)
    expect(plans()[0].user.split(direction)).toHaveLength(2)
    const writer = writes()[0].user
    expect(writer).toContain(PLAN_HEAD)
    expect(writer.trimEnd().endsWith('Now the prose, carrying straight on from the very end of the scene so far:')).toBe(true)
    // The direction once, last of all before the notes; the contract points to it.
    expect(writer.split(direction)).toHaveLength(2)
  })

  it('Beat by beat: one plan for the scene, made with its first beat; the second beat is given it with no call', async () => {
    const w = world()
    const beat = async (index: number, soFar = '') => {
      const { generationId } = await startBeat(
        { sceneId: w.scene, sessionId: 'beats', index, options: OPTIONS, soFar, steer: '' },
        { emit: (name, payload) => void h.events.push({ name, payload }) }
      )
      await ended(generationId)
    }
    await beat(1)
    expect(plans()).toHaveLength(2)
    const first = writes()[0].user
    expect(first).toContain('The beats, in order (I write only beat 1 of 2 now, and stop at its end):')
    const page = 'The inn stood on its own where the coast road dropped towards the sea. Wren and Ash stopped there for the night.'
    repo.saveSceneText(w.db, w.scene, null, page)
    await beat(2, page)
    // No new plan call for the second beat: the scene's plan, its notes for beat 2.
    expect(plans()).toHaveLength(2)
    const second = writes()[1].user
    expect(second).toContain('The beats, in order (I write only beat 2 of 2 now, and stop at its end):')
    expect(second).toContain(PLAN_HEAD)
  })

  it('Variants: one plan the set shares, each variant written from it', async () => {
    const w = world()
    const events: { name: string; payload: unknown }[] = []
    const set = await startVariantSet(
      { setId: 'set-1', sceneId: w.scene, count: 2, options: { ...OPTIONS, targetWords: 300, creativity: 'balanced', direction: '' } as DraftOptions },
      {
        db: w.db,
        emit: (name, payload) => void events.push({ name, payload }),
        // As ipc/variants.ts briefs a set: once, with the plan.
        briefing: (sceneId, options, signal) => draftBriefing(sceneId, options, { signal, catchUpMs: VARIANTS_CATCH_UP_MS })
      }
    )
    for (const id of set.generationIds) await ended(id, 'generation:done', events)
    expect(plans()).toHaveLength(2)
    const writer = writes()
    expect(writer).toHaveLength(2)
    for (const s of writer) expect(s.user).toContain(PLAN_HEAD)
    expect(writer[0].user).toBe(writer[1].user)
  })

  it('Write the whole chapter’s drafts: a scene plan for each (briefed as ipc/chapterWriter.ts briefs them, without a brief)', async () => {
    const w = world()
    const extraBlocks = [{ id: 'chapter-study', title: 'Notes for this scene, from studying the chapter', text: 'Keep it quiet.' }]
    const b = await draftBriefing(w.scene, OPTIONS, { extras: { extraBlocks }, brief: false })
    expect(plans()).toHaveLength(2)
    expect(b.preview.messages[1].content).toContain(PLAN_HEAD)
  })

  it('Continue: no call of its own; the scene’s plan while its words haven’t moved on too far, and the end of the scene before', async () => {
    const w = world()
    await draft(w.db, w.scene, await draftBriefing(w.scene, OPTIONS))
    const made = plans().length
    const before = 'The inn stood on its own where the coast road dropped towards the sea.'
    repo.saveSceneText(w.db, w.scene, null, before)
    const { generationId } = (await startEdit({
      tool: 'continue',
      taskId: 'continue-1',
      sceneId: w.scene,
      before,
      selection: '',
      after: '',
      direction: '',
      continueAs: 'paragraph'
    })) as { generationId: ID }
    await ended(generationId, 'task:done')
    expect(plans()).toHaveLength(made)
    const edit = sent[sent.length - 1]
    expect(edit.system).toContain('[AIWRITE-EDIT')
    expect(edit.user).toContain('The plan made for this scene before it was drafted.')
    expect(edit.user).toContain('The beats, in order:\n1. Wren and Ash stop for the night at the inn')
    expect(edit.user).toContain('This is how the scene before this one ended.')
    expect(edit.user).toContain('neither of them said anything for a mile or more')
  })
})

describe('with "Plan before writing" off, no path plans', () => {
  it('Generate, Beat by beat, Variants and Continue: no plan call, and no notes for the writer', async () => {
    h.planFirst = false
    const w = world()
    await draft(w.db, w.scene, await draftBriefing(w.scene, OPTIONS))
    const { generationId } = await startBeat(
      { sceneId: w.scene, sessionId: 'beats', index: 1, options: OPTIONS, soFar: '', steer: '' },
      { emit: (name, payload) => void h.events.push({ name, payload }) }
    )
    await ended(generationId)
    const events: { name: string; payload: unknown }[] = []
    const set = await startVariantSet(
      { setId: 'set-2', sceneId: w.scene, count: 2, options: { ...OPTIONS, targetWords: 300, creativity: 'balanced', direction: '' } as DraftOptions },
      { db: w.db, emit: (name, payload) => void events.push({ name, payload }), briefing: (sceneId, options, signal) => draftBriefing(sceneId, options, { signal }) }
    )
    for (const id of set.generationIds) await ended(id, 'generation:done', events)
    const cont = (await startEdit({
      tool: 'continue',
      taskId: 'continue-2',
      sceneId: w.scene,
      before: 'The inn stood on its own.',
      selection: '',
      after: '',
      direction: '',
      continueAs: 'paragraph'
    })) as { generationId: ID }
    await ended(cont.generationId, 'task:done')
    expect(plans()).toHaveLength(0)
    expect(writes().length).toBeGreaterThanOrEqual(5)
    for (const s of sent) {
      expect(s.all).not.toContain(PLAN_HEAD)
      expect(s.all).not.toContain('The plan made for this scene')
    }
  })
})

// The events the window would get are not what these tests are about.
void ({} as AppEvents)
