import Database from 'better-sqlite3'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEvents } from '@shared/api'
import type { ContentIntensity, DraftOptions, ModelChoice, ThinkingLevel } from '@shared/types'
import { migrate } from '../db/migrations'
import * as repo from '../db/repo'
import * as gens from '../db/generations'
import { insertChange, putSummary, setBlockMode, setDefaultExistsPoints, setPin } from '../db/memory'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import { AUTO_LENGTH } from '@shared/defaults'
import { SPEAKER_TAG_LINE } from './speakerTags'
import { assembleContext, replyTokenLimit, replyTokens, sentEntryVersions } from './context'
import { draftCost, isDrafting, onDraftActivity, startDraftJob, stopDraft, stopDraftsFor, type DraftActivity, type Emit } from './drafts'
import { catchUpBeforeDraft, cleanOptions, gatherContextInput, setBeforeDraft } from './gather'
import { countRaw } from './tokens'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 2, words: 80, slowWords: 4000, slowDelayMs: 4 })
})
afterAll(() => fake.close())

type Ev = { name: keyof AppEvents; payload: AppEvents[keyof AppEvents] }

function setup() {
  const db = new Database(':memory:')
  migrate(db)
  repo.initWorld(db, 'w1', 'Test world')
  const story = repo.listStories(db)[0]
  const outline = repo.getOutline(db, story.id)
  const first = outline.scenes[0]
  const second = repo.createScene(db, outline.chapters[0].id, { title: 'The knock' })
  repo.saveSceneText(db, first.id, null, 'She left the docks at dusk, the rain at her back.')
  const mara = repo.createEntry(db, 'character', { name: 'Mara', summary: 'A smuggler.', notes: 'SECRET NOTE', fields: { speech: 'Short, dry.' } })
  const tobin = repo.createEntry(db, 'character', { name: 'Tobin', summary: 'A ferryman.' })
  const eel = repo.createEntry(db, 'place', { name: 'The Gilded Eel', summary: 'A tavern.' })
  const rule = repo.createEntry(db, 'lore', { name: 'The Binding', summary: 'Oaths bind.', hardRule: true })
  repo.updateSceneCard(db, second.id, {
    ...repo.getScene(db, second.id).card,
    povId: mara.id,
    presentIds: [mara.id, tobin.id],
    locationId: eel.id,
    beats: ['Mara meets Tobin', 'Someone knocks'],
    targetWords: 600
  })
  return { db, story, first, second, mara, tobin, eel, rule }
}

const model = (over: Partial<ModelChoice> = {}): ModelChoice => ({
  providerId: 'p1',
  modelId: 'fake/writer',
  label: 'Fake: Writer',
  contextLength: 32000,
  promptPrice: 0.000003,
  completionPrice: 0.000015,
  ...over
})

function recorder() {
  const events: Ev[] = []
  const emit: Emit = (name, payload) => events.push({ name, payload })
  const done = (id: string) =>
    new Promise<AppEvents['generation:done']>((resolve) => {
      const check = () => {
        const d = events.find((e) => e.name === 'generation:done' && (e.payload as AppEvents['generation:done']).generationId === id)
        if (d) resolve(d.payload as AppEvents['generation:done'])
        else setTimeout(check, 5)
      }
      check()
    })
  return { events, emit, done }
}

function start(
  w: ReturnType<typeof setup>,
  emit: Emit,
  modelId = 'fake/writer',
  kind: 'custom' | 'openrouter' = 'custom',
  options: Partial<DraftOptions> = {},
  onKeyRejected?: () => void,
  modelOver: Partial<ModelChoice> = {},
  onWorked?: () => void,
  thinking?: ThinkingLevel,
  intensity?: ContentIntensity
) {
  const input = gatherContextInput(w.db, w.second.id, { direction: 'End on the knock.', ...options }, { prefs: { spelling: 'UK', pov: 'Close third', tense: 'Past', voiceNotes: '', avoidWords: [] }, contextLength: 32000, creativity: 'steady' })
  const preview = assembleContext(input, countRaw)
  return {
    input,
    preview,
    ...startDraftJob({
      db: w.db,
      sceneId: w.second.id,
      options: input.options,
      preview,
      provider: { id: 'p1', name: 'Fake', kind, baseUrl: fake.url, apiKey: 'k' },
      model: model({ modelId, ...modelOver }),
      thinking,
      intensity,
      entryVersions: sentEntryVersions(input.memory, preview.blocks),
      emit,
      onKeyRejected,
      onWorked,
      retryDelays: [5, 5, 5, 5]
    })
  }
}

const plain = {
  prefs: { spelling: 'UK' as const, pov: '', tense: '', voiceNotes: '', avoidWords: [] },
  contextLength: null,
  creativity: 'steady' as const
}

describe('gatherContextInput', () => {
  it('reads the card, the previous scene, entries and the merged style', () => {
    const w = setup()
    const input = gatherContextInput(w.db, w.second.id, undefined, { prefs: { spelling: 'US', pov: 'First person', tense: 'Present', voiceNotes: '', avoidWords: ['very'] }, contextLength: null, creativity: 'adventurous' })
    expect(input.memory.previous?.text).toContain('She left the docks')
    expect(input.scene.card.beats).toEqual(['Mara meets Tobin', 'Someone knocks'])
    expect(input.memory.entries.map((e) => e.name).sort()).toEqual(['Mara', 'The Binding', 'The Gilded Eel', 'Tobin'])
    expect(input.style.pov).toBe('First person')
    expect(input.style.avoidPhrases).toEqual(['very'])
    // Defaults come from the card and settings.
    expect(input.options).toEqual({ direction: '', targetWords: 600, creativity: 'adventurous' })
    expect(input.series).toEqual({ name: 'Test world', themes: '', tone: '' })
    expect(input.pins).toEqual([])
    expect(input.blockModes).toEqual({})
  })

  it("reads the scene's pins, its story's and the world's, and its block modes", () => {
    const w = setup()
    setPin(w.db, w.tobin.id, 'scene', w.second.id, 'hide')
    setPin(w.db, w.rule.id, 'world', null, 'pin')
    setPin(w.db, w.eel.id, 'scene', w.first.id, 'pin')
    setBlockMode(w.db, w.second.id, 'pov', 'short')
    const input = gatherContextInput(w.db, w.second.id, undefined, plain)
    expect(input.pins.map((p) => [p.entryId, p.scope, p.action])).toEqual([
      [w.tobin.id, 'scene', 'hide'],
      [w.rule.id, 'world', 'pin']
    ])
    expect(input.blockModes).toEqual({ pov: 'short' })
    const preview = assembleContext(input, countRaw)
    expect(preview.blocks.find((b) => b.id === 'present')).toBeUndefined()
    expect(preview.blocks.find((b) => b.id === 'pov')!.mode).toBe('short')
    const tobin = preview.entries!.find((e) => e.entryId === w.tobin.id)
    expect(tobin).toMatchObject({ hidden: true, blockId: null, why: 'Kept out of this scene' })
  })

  it('records the version of each entry actually sent', () => {
    const w = setup()
    const input = gatherContextInput(w.db, w.second.id, undefined, plain)
    const preview = assembleContext(input, countRaw)
    const versions = sentEntryVersions(input.memory, preview.blocks)
    expect([...versions.keys()].sort()).toEqual([w.mara.id, w.tobin.id, w.eel.id, w.rule.id].sort())
    expect(versions.get(w.mara.id)).toBe(w.mara.updatedAt)
    const withoutPov = preview.blocks.map((b) => (b.id === 'pov' ? { ...b, dropped: true } : b))
    expect(sentEntryVersions(input.memory, withoutPov).has(w.mara.id)).toBe(false)
  })
})

describe('drafting an earlier scene does not show later changes to the AI', () => {
  /** One chapter of four scenes; what happens in scene 1 and in scene 3 is in the memory. */
  function fourScenes() {
    const w = setup()
    const chapterId = repo.getOutline(w.db, w.story.id).chapters[0].id
    const s3 = repo.createScene(w.db, chapterId, { title: 'The hand', afterId: w.second.id })
    const s4 = repo.createScene(w.db, chapterId, { title: 'After', afterId: s3.id })
    for (const s of [s3, s4]) repo.updateSceneCard(w.db, s.id, { ...repo.getScene(w.db, w.second.id).card })
    repo.saveSceneText(w.db, s3.id, null, 'The blade came down. Kell watched from the door.')
    const mara = w.mara.id
    const tobin = w.tobin.id
    const at = (sceneId: string) => ({ entryId: mara, anchor: 'scene' as const, sceneId, origin: 'text' as const })
    insertChange(w.db, { ...at(w.first.id), kind: 'update', payload: { note: 'Cuts her hair short' } })
    insertChange(w.db, { ...at(w.first.id), kind: 'knowledge', payload: { factId: 'heir', fact: 'Mara is the heir' } })
    insertChange(w.db, { ...at(s3.id), kind: 'update', payload: { note: 'Loses her left hand', fields: { marks: 'No left hand' } } })
    insertChange(w.db, { ...at(s3.id), kind: 'relationship', payload: { otherId: tobin, type: 'sworn enemies', feels: '', otherFeels: '' } })
    insertChange(w.db, { ...at(s3.id), entryId: tobin, kind: 'knowledge', payload: { factId: 'heir', fact: 'Mara is the heir' } })
    putSummary(w.db, { level: 'scene', targetId: w.first.id, text: 'Mara leaves the docks.', origin: 'text' })
    putSummary(w.db, { level: 'scene', targetId: s3.id, text: 'Mara loses her hand; Tobin learns who she is.', origin: 'text' })
    // Kell first appears in scene 3, and is named in every scene's beats.
    const kell = repo.createEntry(w.db, 'character', { name: 'Kell', summary: 'A drifter with a crossbow.' })
    setDefaultExistsPoints(w.db, kell.id, [{ kind: 'scene', storyId: w.story.id, sceneId: s3.id }])
    for (const s of [w.second, s3, s4]) {
      const card = repo.getScene(w.db, s.id).card
      repo.updateSceneCard(w.db, s.id, { ...card, beats: [...card.beats, 'Kell watches from the door'] })
    }
    const draft = (sceneId: string) => {
      const input = gatherContextInput(w.db, sceneId, undefined, plain)
      const preview = assembleContext(input, countRaw)
      return { input, preview, all: preview.messages.map((m) => m.content).join('\n') }
    }
    return { w, s3, s4, kell, draft }
  }

  it('scene 2 sees what happened in scene 1, and nothing from scene 3 or later', () => {
    const { w, draft, kell } = fourScenes()
    const { all, preview } = draft(w.second.id)
    expect(all).toContain('Cuts her hair short')
    expect(all).toContain('Mara leaves the docks.')
    expect(all).toContain('She left the docks at dusk')
    expect(all).toContain('What Mara knows:\n- Mara is the heir.')
    // Tobin learns it in scene 3.
    expect(all).toContain('Tobin does not know: Mara is the heir. (Mara knows it.)')
    for (const later of ['Loses her left hand', 'No left hand', 'sworn enemies', 'Tobin learns', 'loses her hand', 'The blade came down']) {
      expect(all, later).not.toContain(later)
    }
    // Kell doesn't exist yet: his name on the card is Adam's, but nothing about him is sent.
    expect(preview.entries!.map((e) => e.entryId)).not.toContain(kell.id)
    expect(all).not.toContain('### Kell')
    expect(all).not.toContain('A drifter with a crossbow')
  })

  it('scene 3 is told what it should bring about as aims, never as facts', () => {
    const { s3, draft, kell } = fourScenes()
    const { all, preview } = draft(s3.id)
    expect(all).toContain(
      'What this scene should bring about (aims for this draft, not facts yet):\n- Mara: Loses her left hand\n- Mara and Tobin: sworn enemies\n- Tobin learns: Mara is the heir'
    )
    const facts = preview.blocks.filter((b) => b.id !== 'scene-card' && !b.dropped).map((b) => b.text).join('\n')
    for (const aim of ['Loses her left hand', 'No left hand', 'sworn enemies', 'Tobin learns', 'loses her hand']) expect(facts, aim).not.toContain(aim)
    expect(facts).toContain('Cuts her hair short')
    // Until this scene brings it about, Tobin doesn't know.
    expect(facts).toContain('Tobin does not know: Mara is the heir. (Mara knows it.)')
    // Kell first appears here: named in the beats, and sent as such.
    expect(preview.entries!.find((e) => e.entryId === kell.id)).toMatchObject({ label: 'first appears in this scene' })
    expect(all).toContain('### Kell (character; first appears in this scene)')
  })

  it('scene 4 knows all of it as facts', () => {
    const { s4, draft } = fourScenes()
    const { all } = draft(s4.id)
    expect(all).toContain('Loses her left hand')
    expect(all).toContain('- Distinguishing marks: No left hand')
    expect(all).toContain('Mara and Tobin: sworn enemies.')
    expect(all).not.toContain('does not know')
    expect(all).toContain('Mara loses her hand; Tobin learns who she is.')
    expect(all).toContain('A drifter with a crossbow')
    expect(all).toContain('The blade came down.')
    expect(all).not.toContain('What this scene should bring about')
  })
})

describe('catching the memory up before a draft', () => {
  const db = {} as Database.Database

  it('goes ahead at once when nothing is registered', async () => {
    setBeforeDraft(null)
    expect(await catchUpBeforeDraft(db, 's1')).toBe('none')
  })

  it('waits for the catch-up, and drafts anyway when it fails or takes too long', async () => {
    const seen: string[] = []
    setBeforeDraft(async (_db, sceneId) => {
      seen.push(sceneId)
    })
    expect(await catchUpBeforeDraft(db, 's1')).toBe('done')
    expect(seen).toEqual(['s1'])

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    setBeforeDraft(() => {
      throw new Error('no memory model')
    })
    expect(await catchUpBeforeDraft(db, 's1')).toBe('failed')
    setBeforeDraft(() => Promise.reject(new Error('offline')))
    expect(await catchUpBeforeDraft(db, 's1')).toBe('failed')
    warn.mockRestore()

    setBeforeDraft(() => new Promise(() => undefined))
    expect(await catchUpBeforeDraft(db, 's1', 20)).toBe('timed-out')
    setBeforeDraft(null)
  })

  it('stops waiting at once when Adam stops the draft before it begins', async () => {
    setBeforeDraft(() => new Promise(() => undefined))
    const stop = new AbortController()
    const started = Date.now()
    setTimeout(() => stop.abort(), 10)
    expect(await catchUpBeforeDraft(db, 's1', 60_000, stop.signal)).toBe('cancelled')
    expect(Date.now() - started).toBeLessThan(1000)
    // Already stopped: the catch-up isn't even asked for.
    const asked = vi.fn()
    setBeforeDraft(asked)
    expect(await catchUpBeforeDraft(db, 's1', 60_000, stop.signal)).toBe('cancelled')
    expect(asked).not.toHaveBeenCalled()
    setBeforeDraft(null)
  })
})

describe('gatherContextInput, options', () => {

  it('cleans draft options', () => {
    expect(cleanOptions({ targetWords: 5, creativity: 'wild' as never, direction: '  hi  ' }, { targetWords: 1500, creativity: 'balanced' })).toEqual({
      targetWords: 100,
      creativity: 'balanced',
      direction: 'hi'
    })
    expect(cleanOptions({ targetWords: 1e9 }, { targetWords: 1500, creativity: 'steady' }).targetWords).toBe(12000)
    expect(cleanOptions({ targetWords: NaN }, { targetWords: 1500, creativity: 'steady' }).targetWords).toBe(1500)
  })

  it('keeps Auto (a length of null), and falls back to the card, which may be on Auto itself', () => {
    expect(cleanOptions({ targetWords: null }, { targetWords: 2500, creativity: 'steady' }).targetWords).toBeNull()
    expect(cleanOptions({}, { targetWords: 2500, creativity: 'steady' }).targetWords).toBe(2500)
    expect(cleanOptions({}, { targetWords: null, creativity: 'steady' }).targetWords).toBeNull()
    expect(cleanOptions({ targetWords: 'lots' as never }, { targetWords: null, creativity: 'steady' }).targetWords).toBeNull()
    expect(cleanOptions(undefined, { targetWords: null, creativity: 'steady' }).targetWords).toBeNull()
  })

  it("drafts on Auto unless Adam set a length on the card: an older card's 1,500 reads as Auto", () => {
    const w = setup()
    const card = repo.getScene(w.db, w.second.id).card
    const length = () => gatherContextInput(w.db, w.second.id, undefined, plain).options.targetWords
    // Set before Auto existed: 600 isn't the old default, so it was Adam's.
    expect(length()).toBe(600)
    repo.updateSceneCard(w.db, w.second.id, { ...card, targetWords: 1500 })
    expect(length()).toBeNull()
    repo.updateSceneCard(w.db, w.second.id, { ...card, targetWords: 1500, lengthSet: true })
    expect(length()).toBe(1500)
    repo.updateSceneCard(w.db, w.second.id, { ...card, targetWords: 2500, lengthSet: false })
    expect(length()).toBeNull()
    // The draft options' own length wins, Auto included.
    expect(gatherContextInput(w.db, w.second.id, { targetWords: 900 }, plain).options.targetWords).toBe(900)
    repo.updateSceneCard(w.db, w.second.id, { ...card, targetWords: 2500, lengthSet: true })
    expect(gatherContextInput(w.db, w.second.id, { targetWords: null }, plain).options.targetWords).toBeNull()
  })
})

describe('drafting', () => {
  let w: ReturnType<typeof setup>
  beforeEach(() => {
    w = setup()
    fake.reset()
  })

  it('tells its watchers (reading aloud marks a draft as it lands) when it starts and ends; a watcher that fails never fails the draft', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const heard: DraftActivity[] = []
    const offHeard = onDraftActivity((e) => heard.push(e))
    const offBroken = onDraftActivity(() => {
      throw new Error('The marks could not be made.')
    })
    try {
      const { emit, done } = recorder()
      const { generationId } = start(w, emit)
      expect(heard).toEqual([{ sceneId: w.second.id, phase: 'start', variant: false }])
      const end = await done(generationId)
      expect(end.status).toBe('complete')
      expect(gens.getGeneration(w.db, generationId).status).toBe('complete')
      expect(heard.map((e) => e.phase)).toEqual(['start', 'end'])
      expect(warn).toHaveBeenCalled()
    } finally {
      offHeard()
      offBroken()
      warn.mockRestore()
    }
  })

  it('records an Auto draft as Auto, with room kept for the longest scene Auto allows', async () => {
    const { emit, done } = recorder()
    const { generationId, preview } = start(w, emit, 'fake/writer', 'custom', { targetWords: null })
    expect(preview.budget.reserved).toBe(replyTokens(AUTO_LENGTH.max))
    expect((await done(generationId)).status).toBe('complete')
    const rec = gens.getGeneration(w.db, generationId)
    expect(rec.params.autoLength).toBe(true)
    expect(rec.params).not.toHaveProperty('targetWords')
    expect(rec.messages[1].content).toContain('- Make the scene as long as it needs to be, between 800 and 4,000 words')
  })

  it('records the draft, streams batched text, and finishes the record', async () => {
    const { events, emit, done } = recorder()
    const { generationId, preview } = start(w, emit)
    // The record exists straight away, marked as being written.
    expect(gens.getGeneration(w.db, generationId).status).toBe('streaming')
    expect(isDrafting(w.second.id)).toBe(true)

    const end = await done(generationId)
    expect(end.status).toBe('complete')
    expect(end.error).toBeNull()
    expect(isDrafting(w.second.id)).toBe(false)

    const chunks = events.filter((e) => e.name === 'generation:chunk').map((e) => (e.payload as AppEvents['generation:chunk']).text)
    const rec = gens.getGeneration(w.db, generationId)
    expect(chunks.join('')).toBe(rec.response)
    // Batched: far fewer events than streamed pieces (about 3 words each).
    expect(chunks.length).toBeLessThan(rec.words / 3)
    expect(rec.status).toBe('complete')
    expect(rec.messages).toEqual(preview.messages)
    expect(rec.blocks.map((b) => b.id)).toEqual(preview.blocks.map((b) => b.id))
    // The reply limit leaves headroom beyond the reply room (target + 40%), so a long scene isn't cut off.
    expect(rec.params).toMatchObject({ temperature: 0.6, top_p: 0.9, creativity: 'steady', targetWords: 600, max_tokens: replyTokenLimit(preview.budget).limit })
    expect(rec.params.max_tokens).toBeGreaterThan(preview.budget.reserved)
    expect(fake.lastRequest()!.body.max_tokens).toBe(rec.params.max_tokens)
    expect(rec.direction).toBe('End on the knock.')
    expect(rec.promptTokens).toBeGreaterThan(0)
    expect(rec.cost).toBeCloseTo(rec.promptTokens! * 0.000003 + rec.completionTokens! * 0.000015, 10)
    expect(rec.costEstimated).toBe(false)
    expect(rec.finishedAt).not.toBeNull()

    // Entries sent, with names, kinds and versions.
    // In the order the briefing sent them: the world's rules first, the scene's own people last.
    expect(rec.entries.map((e) => e.name)).toEqual(['The Binding', 'The Gilded Eel', 'Mara', 'Tobin'])
    expect(rec.entries.find((e) => e.name === 'Mara')).toMatchObject({ kind: 'character', version: w.mara.updatedAt, deleted: false, changedSince: false })

    // What was sent never includes private notes.
    expect(JSON.stringify(fake.lastRequest()!.body.messages)).not.toContain('SECRET NOTE')
    // Exactly the preview's messages; where caching may start is noted with them but never sent.
    expect(preview.messages[1].cacheUpTo).toBeGreaterThan(0)
    expect(fake.lastRequest()!.body.messages).toEqual(preview.messages.map(({ cacheUpTo: _cut, ...m }) => m))

    const list = gens.listGenerations(w.db, w.second.id)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: generationId, status: 'complete', modelId: 'fake/writer', providerName: 'Fake' })
    expect(list[0].words).toBeGreaterThan(50)
  })

  it('keeps room in the reply for the writer’s speaker tags, and records how well it tagged', async () => {
    const { emit, done } = recorder()
    const input = gatherContextInput(w.db, w.second.id, { targetWords: 600 }, { prefs: { spelling: 'UK', pov: 'Close third', tense: 'Past', voiceNotes: '', avoidWords: [] }, contextLength: 32000, creativity: 'steady' })
    const plain = assembleContext(input, countRaw)
    const last = plain.messages.at(-1)!
    const preview = { ...plain, messages: [...plain.messages.slice(0, -1), { ...last, content: `${last.content}\n${SPEAKER_TAG_LINE}` }] }
    const { generationId } = startDraftJob({
      db: w.db,
      sceneId: w.second.id,
      options: input.options,
      preview,
      provider: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: 'k' },
      model: model({ modelId: 'fake/writer' }),
      entryVersions: sentEntryVersions(input.memory, preview.blocks),
      emit,
      retryDelays: [5]
    })
    await done(generationId)
    const rec = gens.getGeneration(w.db, generationId)
    const roomy = { ...preview.budget, reserved: Math.ceil(preview.budget.reserved * 1.15) }
    expect(rec.params.max_tokens).toBe(replyTokenLimit(roomy).limit)
    expect(rec.params.max_tokens).toBeGreaterThan(replyTokenLimit(preview.budget).limit)
    expect(rec.response).not.toContain('{')
    expect(rec.params.speakerTags).toMatchObject({ dropped: 0 })
    expect(rec.params.speakerTags!.tagged).toBe(rec.params.speakerTags!.quotes)
  })

  it('asks with the plain reply room if the model cannot write that much, and records it', async () => {
    const { emit, done } = recorder()
    const { generationId, preview } = start(w, emit, 'fake/max-output', 'custom', { targetWords: 400 })
    const end = await done(generationId)
    expect(end.status).toBe('complete')
    const rec = gens.getGeneration(w.db, generationId)
    expect(rec.params.max_tokens).toBe(preview.budget.reserved)
    expect(fake.lastRequest()!.body.max_tokens).toBe(preview.budget.reserved)
  })

  it('says when a reply ran into the reply limit, and records it', async () => {
    const { emit, done } = recorder()
    const { generationId } = start(w, emit, 'fake/length')
    const end = await done(generationId)
    expect(end.status).toBe('complete')
    expect(end.cutOff).toBe(true)
    const rec = gens.getGeneration(w.db, generationId)
    expect(rec.params.cutOff).toBe(true)
    expect(rec.response.length).toBeGreaterThan(0)
    const normal = start(w, emit)
    expect((await done(normal.generationId)).cutOff).toBe(false)
    expect(gens.getGeneration(w.db, normal.generationId).params.cutOff).toBeUndefined()
  })

  it('records how the settings were sent to a model that wants them differently', async () => {
    const { emit, done } = recorder()
    const { generationId } = start(w, emit, 'fake/o3')
    expect((await done(generationId)).status).toBe('complete')
    const rec = gens.getGeneration(w.db, generationId)
    expect(rec.params).toMatchObject({ tokenParam: 'max_completion_tokens', sampling: false, creativity: 'steady' })
    expect(rec.params.max_tokens).toBeGreaterThan(0)
    // A model its provider says sets its own creativity is asked without temperature from the start.
    fake.reset()
    const own = start(w, emit, 'fake/writer', 'openrouter', {}, undefined, { sampling: false })
    await done(own.generationId)
    expect(fake.requestCounts()['fake/writer']).toBe(1)
    expect('temperature' in fake.lastRequest()!.body).toBe(false)
    expect(gens.getGeneration(w.db, own.generationId).params.sampling).toBe(false)
  })

  it('sends min_p with Balanced and Adventurous to OpenRouter only, and records it', async () => {
    const { emit, done } = recorder()
    fake.reset()
    const balanced = start(w, emit, 'fake/writer', 'openrouter', { creativity: 'balanced' })
    expect((await done(balanced.generationId)).status).toBe('complete')
    expect(fake.lastRequest()!.body.min_p).toBe(0.05)
    expect(gens.getGeneration(w.db, balanced.generationId).params.min_p).toBe(0.05)
    const steady = start(w, emit, 'fake/writer', 'openrouter', { creativity: 'steady' })
    await done(steady.generationId)
    expect('min_p' in fake.lastRequest()!.body).toBe(false)
    expect(gens.getGeneration(w.db, steady.generationId).params.min_p).toBeUndefined()
    const other = start(w, emit, 'fake/writer', 'custom', { creativity: 'adventurous' })
    await done(other.generationId)
    expect('min_p' in fake.lastRequest()!.body).toBe(false)
    expect(gens.getGeneration(w.db, other.generationId).params.min_p).toBeUndefined()
  })

  it('suggests another writer model when a draft is refused at strong content levels', async () => {
    const { emit, done } = recorder()
    const strong = start(w, emit, 'fake/refuse', 'custom', {}, undefined, {}, undefined, undefined, { violence: 4 })
    const d = await done(strong.generationId)
    expect(d.status).toBe('error')
    expect(d.error).toBe(
      "The writer model refused this scene. Some models won't write violence at the level your style guide sets, so pick a different writer model in Settings › Models."
    )
    expect(gens.getGeneration(w.db, strong.generationId).error).toBe(d.error)
    // At milder levels the usual words stand.
    const mild = start(w, emit, 'fake/refuse', 'custom', {}, undefined, {}, undefined, undefined, { violence: 2 })
    expect((await done(mild.generationId)).error).toBe('This model refused the scene. Try another model in Settings › Models.')
  })

  it("asks with the writer's thinking level, with room for it, and records how it was sent", async () => {
    const { emit, done } = recorder()
    fake.reset()
    const high = start(w, emit, 'fake/writer', 'openrouter', {}, undefined, {}, undefined, 'high')
    expect((await done(high.generationId)).status).toBe('complete')
    expect(fake.lastRequest()!.body.reasoning).toEqual({ effort: 'high' })
    const rec = gens.getGeneration(w.db, high.generationId)
    expect(rec.params.thinking).toBe('high')
    // At High the thinking may take 80% of the limit: the scene keeps its own room beside it.
    expect(rec.params.max_tokens).toBe(replyTokenLimit(high.preview.budget, null, 'high').limit)
    expect(rec.params.max_tokens).toBe(Math.ceil(high.preview.budget.reserved * 5))
    // A model that can't stop thinking is asked for as little as it can, and the record says so.
    const off = start(w, emit, 'fake/must-think', 'openrouter', {}, undefined, {}, undefined, 'off')
    expect((await done(off.generationId)).status).toBe('complete')
    expect(gens.getGeneration(w.db, off.generationId).params.thinking).toBe('low')
    // Left to the model: nothing is asked, nothing recorded.
    const auto = start(w, emit, 'fake/writer', 'custom', {}, undefined, {}, undefined, 'auto')
    await done(auto.generationId)
    expect(fake.lastRequest()!.body).not.toHaveProperty('reasoning_effort')
    expect(gens.getGeneration(w.db, auto.generationId).params).not.toHaveProperty('thinking')
  })

  it("doesn't put a price on a draft the provider turned down", async () => {
    const { emit, done } = recorder()
    let rejected = 0
    const credit = start(w, emit, 'fake/credit', 'custom', {}, () => rejected++)
    const end = await done(credit.generationId)
    expect(end.status).toBe('error')
    expect(end.cost).toBeNull()
    expect(gens.getGeneration(w.db, credit.generationId).cost).toBeNull()
    expect(gens.listGenerations(w.db, w.second.id)[0].cost).toBeNull()
    expect(rejected).toBe(0)
    // A key the provider turns down is reported, so Settings can show it isn't working.
    let worked = 0
    const key = start(w, emit, 'fake/badkey', 'custom', {}, () => rejected++, {}, () => worked++)
    await done(key.generationId)
    expect(rejected).toBe(1)
    expect(worked).toBe(0)
    // And a draft that comes back in full says the provider works.
    const fine = start(w, emit, 'fake/writer', 'custom', {}, () => rejected++, {}, () => worked++)
    await done(fine.generationId)
    expect([rejected, worked]).toEqual([1, 1])
  })

  it('stops on request and keeps the text so far', async () => {
    const { events, emit } = recorder()
    const { generationId } = start(w, emit, 'fake/slow')
    while (!events.some((e) => e.name === 'generation:chunk')) await new Promise((r) => setTimeout(r, 5))
    await stopDraft(generationId)
    const rec = gens.getGeneration(w.db, generationId)
    expect(rec.status).toBe('stopped')
    expect(rec.response.length).toBeGreaterThan(0)
    expect(rec.words).toBeLessThan(4000)
    const end = events.find((e) => e.name === 'generation:done')!.payload as AppEvents['generation:done']
    expect(end.status).toBe('stopped')
    // No usage from the provider, so the cost is an estimate.
    expect(rec.cost).toBeGreaterThan(0)
    expect(rec.costEstimated).toBe(true)
  })

  it('allows only one draft at a time per scene', async () => {
    const { emit, done } = recorder()
    const { generationId } = start(w, emit, 'fake/slow')
    expect(() => start(w, emit)).toThrow(/already being written/)
    await stopDraft(generationId)
    await done(generationId)
    const again = start(w, emit)
    await done(again.generationId)
  })

  it('saves the text as it arrives, so a crash keeps it', async () => {
    const { events, emit } = recorder()
    const { generationId } = start(w, emit, 'fake/slow')
    await new Promise((r) => setTimeout(r, 700))
    const mid = gens.getGeneration(w.db, generationId)
    expect(mid.status).toBe('streaming')
    expect(mid.response.length).toBeGreaterThan(0)
    // Simulate the app closing the world mid-draft.
    stopDraftsFor(w.db)
    const closed = gens.getGeneration(w.db, generationId)
    expect(closed.status).toBe('stopped')
    while (!events.some((e) => e.name === 'generation:done')) await new Promise((r) => setTimeout(r, 5))
    expect(gens.getGeneration(w.db, generationId).status).toBe('stopped')
  })

  it('records errors in plain words and keeps partial text', async () => {
    const { emit, done } = recorder()
    const { generationId } = start(w, emit, 'fake/drop')
    const end = await done(generationId)
    expect(end.status).toBe('error')
    expect(end.error).toContain('dropped')
    const rec = gens.getGeneration(w.db, generationId)
    expect(rec.error).toBe(end.error)
    expect(rec.response.length).toBeGreaterThan(0)
  })

  it('tells the window when it is retrying', async () => {
    const { events, emit, done } = recorder()
    const { generationId } = start(w, emit, 'fake/servererror-once')
    await done(generationId)
    const retry = events.find((e) => e.name === 'generation:retrying')!.payload as AppEvents['generation:retrying']
    expect(retry).toMatchObject({ generationId, attempt: 1, reason: 'Fake had a hiccup' })
  })

  it('marks drafts left streaming by a crash as stopped', () => {
    const { emit } = recorder()
    const { generationId } = start(w, emit, 'fake/slow')
    // Pretend the app died: the record is still 'streaming'.
    expect(gens.stopInterrupted(w.db, '2026-10-01T00:00:00.000Z')).toBe(1)
    expect(gens.getGeneration(w.db, generationId).status).toBe('stopped')
    return stopDraft(generationId)
  })

  it('still lists entries that were deleted or changed since', async () => {
    const { emit, done } = recorder()
    const { generationId } = start(w, emit)
    await done(generationId)
    repo.deleteEntry(w.db, w.tobin.id)
    await new Promise((r) => setTimeout(r, 5))
    repo.updateEntry(w.db, w.mara.id, { summary: 'Changed.' })
    const rec = gens.getGeneration(w.db, generationId)
    expect(rec.entries.find((e) => e.name === 'Tobin')).toMatchObject({ deleted: true })
    expect(rec.entries.find((e) => e.name === 'Mara')).toMatchObject({ changedSince: true, deleted: false })
  })

  it('counts a change over time made since as changed since', async () => {
    const { emit, done } = recorder()
    const { generationId } = start(w, emit)
    await done(generationId)
    expect(gens.getGeneration(w.db, generationId).entries.find((e) => e.name === 'Mara')).toMatchObject({ changedSince: false })
    await new Promise((r) => setTimeout(r, 5))
    insertChange(w.db, { entryId: w.mara.id, anchor: 'baseline', kind: 'update', payload: { note: 'Cuts her hair short' }, origin: 'text' })
    expect(gens.getGeneration(w.db, generationId).entries.find((e) => e.name === 'Mara')).toMatchObject({ changedSince: true })
  })

  it('throws a plain message for a missing record', () => {
    expect(() => gens.getGeneration(w.db, 'nope')).toThrow(/could not be found/)
  })

  it('keeps the text a draft replaced with its record, whether it is kept before or after the draft finishes', async () => {
    const { emit, done } = recorder()
    const old = {
      doc: { type: 'doc', content: [{ type: 'paragraph', attrs: { pid: 'p-old' }, content: [{ type: 'text', text: 'Adam wrote this.' }] }] },
      text: 'Adam wrote this.'
    }
    // Kept as the first words arrive. This model gets a smaller reply limit on the way, so the finish
    // rewrites the settings: the kept text stays with them.
    const { generationId, preview } = start(w, emit, 'fake/max-output', 'custom', { targetWords: 400 })
    gens.keepReplacedText(w.db, generationId, old)
    expect((await done(generationId)).status).toBe('complete')
    const rec = gens.getGeneration(w.db, generationId)
    expect(rec.params.max_tokens).toBe(preview.budget.reserved)
    expect(rec.replacedText).toEqual(old)
    expect(rec.replaced).toBe(true)
    // It is kept beside the settings, not shown as one of them.
    expect(rec.params).not.toHaveProperty('replaced')
    expect(gens.listGenerations(w.db, w.second.id)[0]).toMatchObject({ id: generationId, replaced: true })

    // Kept after the draft has finished (the two can cross on the way): the same.
    const later = start(w, emit)
    await done(later.generationId)
    gens.keepReplacedText(w.db, later.generationId, old)
    expect(gens.getGeneration(w.db, later.generationId).replacedText).toEqual(old)

    // Forgotten when the draft brought nothing and the old text was put back.
    gens.keepReplacedText(w.db, generationId, null)
    expect(gens.getGeneration(w.db, generationId)).toMatchObject({ replaced: false, replacedText: null })
    expect(gens.getGeneration(w.db, generationId).params.max_tokens).toBe(preview.budget.reserved)
    expect(gens.listGenerations(w.db, w.second.id).map((g) => g.replaced)).toEqual([true, false])

    // A draft that replaced nothing says so.
    const plainDraft = start(w, emit)
    await done(plainDraft.generationId)
    expect(gens.getGeneration(w.db, plainDraft.generationId)).toMatchObject({ replaced: false, replacedText: null })

    expect(() => gens.keepReplacedText(w.db, 'nope', old)).toThrow(/could not be found/)
    expect(() => gens.keepReplacedText(w.db, generationId, { doc: {} } as never)).toThrow(/couldn't be kept/)
  })
})

describe('draftCost', () => {
  const m = { promptPrice: 0.000001, completionPrice: 0.000002 }
  it('prefers the provider figure, then tokens times prices, then an estimate', () => {
    expect(draftCost({ cost: 0.5, promptTokens: 1, completionTokens: 1, text: '' }, m, 100)).toBe(0.5)
    expect(draftCost({ cost: null, promptTokens: 1000, completionTokens: 500, text: '' }, m, 100)).toBeCloseTo(0.002)
    expect(draftCost({ cost: null, promptTokens: null, completionTokens: null, text: 'one two three four' }, m, 1000)).toBeCloseTo(1000 * 0.000001 + 6 * 0.000002)
    expect(draftCost({ cost: null, promptTokens: 1, completionTokens: 1, text: '' }, { promptPrice: null, completionPrice: null }, 100)).toBeNull()
  })
})
