// Starting a beat end to end, against an in-memory world and the fake provider: what is sent for beat i
// (the beat, the beats either side, Adam's note, the scene so far once, right above the closing
// instruction) and what is kept in its record. draftBriefing is stood in for by the same steps without
// the app's settings or the token counting thread (it reads the open world's settings in the app).
import Database from 'better-sqlite3'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEvents } from '@shared/api'
import type { BeatStart } from '@shared/contracts/beats'
import type { DraftOptions } from '@shared/types'
import { migrate } from '../db/migrations'
import * as repo from '../db/repo'
import * as gens from '../db/generations'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import type { Emit } from '../ai/drafts'
import { isStartingBeat, startBeat } from './index'

const h = vi.hoisted(() => ({
  db: null as import('better-sqlite3').Database | null,
  url: '',
  calls: [] as { sceneId: string; options: Partial<import('@shared/types').DraftOptions>; catchUp: boolean }[]
}))

vi.mock('../world', () => ({ db: () => h.db }))
vi.mock('../settings', () => ({ getSettings: () => ({ models: { writer: { contextLength: 32000 } } }) }))
vi.mock('../ai/draftFlow', async () => {
  const { gatherContextInput } = await import('../ai/gather')
  const { finishContext, prepareContext, sentEntryVersions } = await import('../ai/context')
  const { countRaw } = await import('../ai/tokens')
  return {
    providerNotes: () => ({}),
    draftBriefing: async (
      sceneId: string,
      options: Partial<DraftOptions>,
      o: { extras?: Parameters<typeof prepareContext>[1]; catchUp?: boolean }
    ) => {
      h.calls.push({ sceneId, options, catchUp: o.catchUp !== false })
      const prefs = { spelling: 'UK' as const, pov: 'Close third person', tense: 'Past tense', voiceNotes: '', avoidWords: [] }
      const input = gatherContextInput(h.db!, sceneId, options, { prefs, contextLength: 32000, creativity: 'balanced' })
      const prepared = prepareContext(input, o.extras)
      const preview = finishContext(prepared, prepared.texts.map(countRaw))
      return {
        input,
        preview,
        choice: {
          providerId: 'p1',
          modelId: 'fake/writer',
          label: 'Fake: Writer',
          contextLength: 32000,
          promptPrice: null,
          completionPrice: null
        },
        target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: h.url, apiKey: 'k' },
        thinking: 'off',
        entryVersions: sentEntryVersions(input.memory, preview.blocks)
      }
    }
  }
})

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 1, words: 60 })
  h.url = fake.url
  // The briefing's parts and the word counter load once, here, so no test's time goes on loading them
  // (the counter's tables take a moment, and longer on a busy machine).
  await import('../ai/draftFlow')
  const { countRaw } = await import('../ai/tokens')
  countRaw('Ready.')
}, 60_000)
afterAll(() => fake.close())

const BEATS = ['Mara meets Tobin at the Gilded Eel.', 'Tobin asks for the ledger.', 'Someone knocks at the door.']
const EARLIER = 'She left the docks at dusk, the rain at her back.'
const OLD_TEXT = 'An old draft of the scene that Adam chose to replace.'
const SO_FAR = 'Rain ran down the windows of the Eel.\n\nMara found Tobin by the fire, a cup turning in his hands.'

function setup(beats: string[] = BEATS) {
  const db = new Database(':memory:')
  migrate(db)
  repo.initWorld(db, 'w1', 'Test world')
  const outline = repo.getOutline(db, repo.listStories(db)[0].id)
  const first = outline.scenes[0]
  const scene = repo.createScene(db, outline.chapters[0].id, { title: 'The ledger' })
  repo.saveSceneText(db, first.id, null, EARLIER)
  repo.saveSceneText(db, scene.id, null, OLD_TEXT)
  repo.updateSceneCard(db, scene.id, { ...repo.getScene(db, scene.id).card, beats, targetWords: 1500 })
  h.db = db
  return { db, sceneId: scene.id }
}

function recorder() {
  const events: { name: keyof AppEvents; payload: unknown }[] = []
  const emit: Emit = (name, payload) => void events.push({ name, payload })
  const done = (id: string) =>
    new Promise<AppEvents['generation:done']>((resolve) => {
      const check = (): void => {
        const d = events.find((e) => e.name === 'generation:done' && (e.payload as AppEvents['generation:done']).generationId === id)
        if (d) resolve(d.payload as AppEvents['generation:done'])
        else setTimeout(check, 5)
      }
      check()
    })
  return { emit, done }
}

const input = (sceneId: string, over: Partial<BeatStart> = {}): BeatStart => ({
  sceneId,
  sessionId: 'session-1',
  index: 2,
  options: { direction: 'Keep it tense', targetWords: 1500, creativity: 'balanced' },
  steer: 'Make Tobin stall before he asks.',
  soFar: SO_FAR,
  ...over
})

const count = (text: string, part: string): number => text.split(part).length - 1

beforeEach(() => {
  h.calls = []
  fake.reset()
})

describe('starting a beat', () => {
  it('sends beat i with the beats either side, the note and the scene so far once, right above the closing instruction', async () => {
    const { db, sceneId } = setup()
    const r = recorder()
    const { generationId, of } = await startBeat(input(sceneId), { emit: r.emit })
    expect(of).toBe(3)
    expect((await r.done(generationId)).status).toBe('complete')

    const user = fake.lastRequest()!.body.messages.find((m) => m.role === 'user')!.content
    expect(user).toContain('beat 2 of the 3 on the scene card')
    expect(user).toContain('- Beat 1 (already written: the scene so far ends with it): Mara meets Tobin at the Gilded Eel.')
    expect(user).toContain('- Beat 2 (write this one now): Tobin asks for the ledger.')
    expect(user).toContain('- Beat 3 (comes next: leave it for later): Someone knocks at the door.')
    expect(user).toContain("The author's note for this beat: Make Tobin stall before he asks.")
    // The scene so far goes in once, after the scene card and right before the closing instruction.
    expect(count(user, 'Mara found Tobin by the fire')).toBe(1)
    const card = user.indexOf('## Scene card')
    const soFar = user.indexOf('## The scene so far')
    const closing = user.indexOf('Write only the next beat')
    expect(card).toBeGreaterThan(-1)
    expect(soFar).toBeGreaterThan(card)
    expect(closing).toBeGreaterThan(soFar)
    expect(user.trimEnd().endsWith('- Never contradict the facts given above.')).toBe(true)
    // The scene's stored text is not sent besides (it is never part of a draft's briefing).
    expect(user).not.toContain(OLD_TEXT)
    // A third of the scene's 1,500 words.
    expect(user).toContain('- Aim for about 500 words.')

    const rec = gens.getGeneration(db, generationId)
    expect(rec.job).toBe('beat')
    expect(rec.params.beat).toEqual({ sessionId: 'session-1', index: 2, of: 3 })
    expect(rec.params.targetWords).toBe(500)
    expect(rec.direction).toBe('Keep it tense. For this beat: Make Tobin stall before he asks.')
    expect(rec.blocks.find((b) => b.id === 'scene-so-far')?.text).toBe(SO_FAR)
    expect(rec.response).toContain('The rain had not let up')
    // The memory caught up before the first beat only.
    expect(h.calls.map((c) => c.catchUp)).toEqual([false])
    // The beat is listed with the scene's drafts (the Drafts tab), so its record can be opened from there.
    expect(gens.listGenerations(db, sceneId)).toEqual([expect.objectContaining({ id: generationId, job: 'beat', status: 'complete' })])
  })

  it("says when the scene so far ends part-way through the beat before, or with the author's own words", async () => {
    const { sceneId } = setup()
    const r = recorder()
    const mid = await startBeat(input(sceneId, { steer: '', soFarEnds: 'mid-beat' }), { emit: r.emit })
    await r.done(mid.generationId)
    const user = fake.lastRequest()!.body.messages.find((m) => m.role === 'user')!.content
    expect(user).toContain(
      '- Beat 1 (begun, but it stopped part-way: the scene so far ends in the middle of it): Mara meets Tobin at the Gilded Eel.'
    )
    expect(user).toContain('- First bring beat 1 to its end in a few lines')
    const after = await startBeat(input(sceneId, { steer: '', soFarEnds: 'after-beat' }), { emit: r.emit })
    await r.done(after.generationId)
    expect(fake.lastRequest()!.body.messages.find((m) => m.role === 'user')!.content).toContain(
      "- Beat 1 (already written, and the author's own writing comes after it at the end of the scene so far)"
    )
  })

  it('opens the scene with the first beat: the memory catches up first, and there is no scene so far', async () => {
    const { sceneId } = setup()
    const r = recorder()
    const { generationId } = await startBeat(input(sceneId, { index: 1, steer: '', soFar: '' }), { emit: r.emit })
    await r.done(generationId)
    expect(h.calls.map((c) => c.catchUp)).toEqual([true])
    const user = fake.lastRequest()!.body.messages.find((m) => m.role === 'user')!.content
    expect(user).toContain('Write only the first beat of the scene now')
    expect(user).toContain('continuing seamlessly from where the previous scene ends')
    expect(user).toContain(EARLIER)
    expect(user).not.toContain('## The scene so far')
    expect(user).not.toContain(OLD_TEXT)
    expect(user).not.toContain("author's note")
  })

  it('says plainly when the scene card has no beats, or not that one', async () => {
    const r = recorder()
    const empty = setup(['', '  '])
    await expect(startBeat(input(empty.sceneId, { index: 1 }), { emit: r.emit })).rejects.toMatchObject({
      code: 'no-beats',
      message: expect.stringMatching(/^This scene's card has no beats/)
    })
    const three = setup()
    await expect(startBeat(input(three.sceneId, { index: 4 }), { emit: r.emit })).rejects.toMatchObject({
      code: 'no-such-beat',
      message: "The scene card has 3 beats now, so there's no beat 4 to write."
    })
    expect(h.calls).toHaveLength(0)
  })

  it('waits its turn while another draft of the scene is getting ready', async () => {
    const { sceneId } = setup()
    const r = recorder()
    await expect(startBeat(input(sceneId), { emit: r.emit, otherStarting: (id) => id === sceneId })).rejects.toThrow(
      'A draft is already being written for this scene. Stop it first, or wait for it to finish.'
    )
  })

  it('says it is getting ready while it is, so Generate waits for it too', async () => {
    const { sceneId } = setup()
    const r = recorder()
    const started = startBeat(input(sceneId, { index: 1, soFar: '' }), { emit: r.emit })
    expect(isStartingBeat(sceneId)).toBe(true)
    const { generationId } = await started
    expect(isStartingBeat(sceneId)).toBe(false)
    await r.done(generationId)
  })
})
