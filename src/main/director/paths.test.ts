// Directed writing on its paths, end to end against an in-memory world and the fake provider (tests/fake-provider:
// director.mjs answers the director and writes each stretch with its beat): Generate and Add below through the app's own
// handler (ipc/ai.ts startDraft), planned first, a stretch a plan beat; the director asked only when needed; Adam's note
// going in at the next pause and the fake director asking for one retake; the switch off (or the draft options saying
// no), one call as before. Every request sent is read as it goes (the global fetch, wrapped). Invented text only.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import type { AppEvents } from '@shared/api'
import type { DraftOptions, ID } from '@shared/types'
import { defaultSettings, defaultWritingPrefs } from '@shared/defaults'

const h = vi.hoisted(() => ({
  db: null as Database.Database | null,
  url: '',
  directed: true,
  events: [] as { name: string; payload: unknown }[]
}))

const choice = (modelId: string) => ({ providerId: 'p1', modelId, label: modelId, contextLength: 64_000, promptPrice: null, completionPrice: null })
const target = () => ({ id: 'p1', name: 'Fake', kind: 'custom' as const, baseUrl: h.url, apiKey: 'k' })

vi.mock('../world', () => ({ db: () => h.db, maybeCurrentWorld: () => (h.db ? { db: h.db } : null) }))
vi.mock('../settings', () => ({
  getSettings: () => ({
    ...defaultSettings('library'),
    models: { ...defaultSettings('library').models, writer: choice('fake/writer'), memory: choice('fake/memory') },
    planFirst: true,
    continuityBrief: false,
    directedWriting: h.directed
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
  memoryReady: () => true,
  memorySettingsChanged: () => undefined
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
import * as gens from '../db/generations'
import { aiHandlers } from '../ipc/ai'
import { forgetScenePlans } from '../plan'
import { PLAN_MARKER } from '../plan/plan'
import { addNote } from './live'
import { DIRECTOR_MARKER } from './prompts'

type Sent = { model: string; system: string; user: string; roles: string[]; messages: { role: string; content: string }[] }
let sent: Sent[] = []
const realFetch = globalThis.fetch
let fake: FakeProvider

beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 2, words: 120 })
  h.url = fake.url
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/chat/completions') && typeof init?.body === 'string') {
      const body = JSON.parse(init.body) as { model: string; messages: { role: string; content: unknown }[] }
      const text = (c: unknown): string => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p: { text?: string }) => p.text ?? '').join('') : '')
      const messages = body.messages.map((m) => ({ role: m.role, content: text(m.content) }))
      sent.push({
        model: body.model,
        system: messages.find((m) => m.role === 'system')?.content ?? '',
        user: messages.filter((m) => m.role === 'user').at(-1)?.content ?? '',
        roles: messages.map((m) => m.role),
        messages
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
  h.directed = true
  delete process.env.AIWRITE_DIRECTED
  forgetScenePlans()
})
afterEach(() => {
  h.db?.close()
  h.db = null
})

/** The scene before, written, and the scene being written, with a card of two beats. */
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
  return { db, scene }
}

const OPTIONS: DraftOptions = { targetWords: 400, creativity: 'balanced', direction: '' }
const writes = (): Sent[] => sent.filter((s) => s.model === 'fake/writer')
const directorCalls = (): Sent[] => sent.filter((s) => s.system.startsWith(DIRECTOR_MARKER))
const plans = (): Sent[] => sent.filter((s) => s.system.startsWith(PLAN_MARKER))

function ended(id: ID): Promise<AppEvents['generation:done']> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const check = (): void => {
      const e = h.events.find((x) => x.name === 'generation:done' && (x.payload as { generationId: ID }).generationId === id)
      if (e) return resolve(e.payload as AppEvents['generation:done'])
      if (Date.now() - started > 30_000) return reject(new Error(`no generation:done for ${id}`))
      setTimeout(check, 5)
    }
    check()
  })
}

// Each path plans, then writes several stretches against a local server: slower than most unit tests under a full run.
describe('directed writing on its paths', { timeout: 30_000 }, () => {
  it('Generate: planned first, then a stretch a plan beat from the same briefing, the record keeping each', async () => {
    const w = world()
    const { generationId } = await aiHandlers.startDraft(w.scene, OPTIONS)
    const done = await ended(generationId)
    expect(done.status).toBe('complete')
    expect(plans().length).toBeGreaterThanOrEqual(1)
    const writer = writes()
    expect(writer.length).toBeGreaterThanOrEqual(2)
    expect(writer[0].user).toMatch(/Write only stretch 1 of \d+ now, about \d+ words: “Wren and Ash stop for the night at the inn\.”/)
    // Every later stretch starts with the very same briefing, then the draft so far as the writer's own words.
    for (const s of writer.slice(1)) {
      expect(s.messages[0]).toEqual(writer[1].messages[0])
      expect(s.messages[1]).toEqual(writer[1].messages[1])
      expect(s.roles).toEqual(['system', 'user', 'assistant', 'user'])
    }
    expect(writer[0].messages[1].content.startsWith(writer[1].messages[1].content)).toBe(true)
    const rec = gens.getGeneration(w.db, generationId)
    expect(rec.params.directed?.stretches).toBe(writer.length)
    expect(rec.params.directed?.directorCalls).toBe(directorCalls().length)
    // The fake writer lands each beat it is asked for: the director is asked at most at the end (the closing image).
    expect(directorCalls().length).toBeLessThanOrEqual(1)
    expect(rec.params.steps?.length).toBeGreaterThanOrEqual(writer.length)
    expect(rec.params.steps?.[0].tool).toBe('director')
    expect(rec.response).toContain('Wren and Ash stop for the night at the inn.')
    expect(rec.response).toContain('They talk about what comes next.')
    // The window heard the director's line, and the draft's words as they came.
    expect(h.events.some((e) => e.name === 'director:progress')).toBe(true)
  })

  it('Adam’s note goes in at the next pause, and the fake director asks for one retake', async () => {
    const w = world()
    const { generationId } = await aiHandlers.startDraft(w.scene, { ...OPTIONS, direction: '[[fake: director retake]] Keep it quiet.' })
    expect(addNote(generationId, 'slower')).toBe(true)
    await ended(generationId)
    expect(directorCalls()[0].user).toContain('The author’s note: “slower”')
    const back = h.events.filter((e) => e.name === 'generation:takeBack')
    expect(back).toHaveLength(1)
    const retake = writes().find((s) => s.user.includes('Take your last paragraph again'))!
    expect(retake.user).toContain('What’s wrong: The fake director wants the last paragraph again.')
    expect(retake.user).toContain('Director’s note: Make it quieter, and keep Mara still.')
    expect(retake.user).toContain('The author’s note, just now: “slower”')
    const rec = gens.getGeneration(w.db, generationId)
    expect(rec.params.directed).toMatchObject({ retakes: 1, notes: 1 })
    // The paragraph written again (the fake's own words for a retake) is in the draft.
    expect(rec.response).toContain('Mara stood very still by the door and let the room come to her.')
  })

  it('Add below: carries on from the scene’s words, which are never taken back', async () => {
    const w = world()
    const soFar = 'The inn stood on its own where the coast road dropped towards the sea. Wren and Ash stopped there for the night.'
    repo.saveSceneText(w.db, w.scene, null, soFar)
    const { generationId } = await aiHandlers.startDraft(w.scene, { ...OPTIONS, addBelow: true, direction: 'Ash goes out to see to the horses.' })
    const done = await ended(generationId)
    expect(done.status).toBe('complete')
    const writer = writes()
    expect(writer.length).toBeGreaterThanOrEqual(1)
    expect(writer[0].messages[1].content).toContain(soFar)
    expect(writer[0].user).toMatch(/Write only stretch 1 of \d+ now/)
    const rec = gens.getGeneration(w.db, generationId)
    expect(rec.response).not.toContain(soFar)
    expect(rec.params.directed?.stretches).toBe(writer.length)
  })

  it('off in Settings: one call as before; the draft options can still direct one draft, or not direct one', async () => {
    h.directed = false
    const w = world()
    const a = await aiHandlers.startDraft(w.scene, OPTIONS)
    await ended(a.generationId)
    expect(writes()).toHaveLength(1)
    expect(writes()[0].user).not.toContain('stretch')
    expect(gens.getGeneration(w.db, a.generationId).params.directed).toBeUndefined()

    sent = []
    const b = await aiHandlers.startDraft(w.scene, { ...OPTIONS, directed: true })
    await ended(b.generationId)
    expect(writes().length).toBeGreaterThanOrEqual(2)

    sent = []
    h.directed = true
    const c = await aiHandlers.startDraft(w.scene, { ...OPTIONS, directed: false })
    await ended(c.generationId)
    expect(writes()).toHaveLength(1)
  })
})
