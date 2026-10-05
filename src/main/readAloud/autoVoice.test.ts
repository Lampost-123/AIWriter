// A character's read-aloud voice filled in by the AI by itself, against the fake provider: its voice reply is
// SUGGESTED_VOICE, and a character called Siobhan also gets "SAY IT AS: shiv-AWN" when that is asked for
// (tests/fake-provider/m4/readAloud.mjs).

import type Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Entry, ID } from '@shared/types'
import { memoryWorld } from '../../../tests/unit/helpers'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import { SUGGESTED_SAY, SUGGESTED_VOICE } from '../../../tests/fake-provider/m4/readAloud.mjs'
import * as repo from '../db/repo'
import type { JobModel } from '../ai/jobModel'
import { VOICE_TRIES, giveVoices, keepVoice, needsVoice, voiceLater, voicesSettled } from './autoVoice'
import { cleanSay, readVoiceReply, voicePrompt } from './suggest'
import { getEntryReadAloud, setEntryReadAloud } from './voiceStore'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0 })
})
afterAll(() => fake.close())

const model = (): JobModel => ({
  job: 'speech',
  target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: 'test' },
  choice: {
    providerId: 'p1',
    modelId: 'fake/writer',
    label: 'fake/writer',
    contextLength: 32000,
    promptPrice: 0.000001,
    completionPrice: 0.000002
  },
  thinking: 'off'
})

const character = (db: Database.Database, name: string, more: Record<string, unknown> = {}): Entry =>
  repo.createEntry(db, 'character', { name, summary: `${name} runs the harbour ferry.`, ...more }, { origin: 'text' })

const voiceOf = (db: Database.Database, id: ID) => getEntryReadAloud(db, id)

/** Who each voice request was about, by the CHARACTER line of its user message. */
function watching(onAsk?: (who: string) => void): typeof fetch & { asked: string[] } {
  const asked: string[] = []
  const f = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: { role: string; content: string }[] }
    const who = body.messages?.find((m) => m.role === 'user')?.content.match(/^CHARACTER: ([^(\n]+?)(?: \(|$)/m)?.[1]
    if (who) {
      asked.push(who)
      onAsk?.(who)
    }
    return fetch(input, init)
  }) as typeof fetch & { asked: string[] }
  f.asked = asked
  return f
}

const speechRecords = (db: Database.Database): number =>
  (db.prepare("SELECT COUNT(*) AS n FROM generations WHERE job = 'speech'").get() as { n: number }).n

async function until(check: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('Timed out waiting')
    await new Promise((r) => setTimeout(r, 5))
  }
}

describe('"Say it as" from the AI', () => {
  const siobhan = { name: 'Siobhan', aliases: [] }

  it('keeps a respelling for a name a narrator would misread', () => {
    expect(readVoiceReply(`${SUGGESTED_VOICE}\nSAY IT AS: shiv-AWN`, siobhan)).toEqual({ design: SUGGESTED_VOICE, say: 'shiv-AWN' })
    // However the AI dresses the line.
    expect(readVoiceReply(`"${SUGGESTED_VOICE}"\n\n**Say it as:** "shiv-AWN".`, siobhan)).toEqual({
      design: SUGGESTED_VOICE,
      say: 'shiv-AWN'
    })
    expect(readVoiceReply(`${SUGGESTED_VOICE}\n- Say it as — shiv-AWN`, siobhan).say).toBe('shiv-AWN')
  })

  it('keeps nothing when the name needs no help', () => {
    expect(readVoiceReply(SUGGESTED_VOICE, siobhan)).toEqual({ design: SUGGESTED_VOICE, say: '' })
    for (const none of ['none', 'None.', 'N/A', '-', 'Siobhan', 'siobhan.']) expect(cleanSay(none, siobhan)).toBe('')
    expect(cleanSay('MAH-ra', { name: 'Mara', aliases: ['Mar'] })).toBe('MAH-ra')
    expect(cleanSay('mar', { name: 'Mara', aliases: ['Mar'] })).toBe('')
  })

  it('keeps only pairs for words in the name, and one respelling only when it says the whole name', () => {
    const name = { name: 'Siobhan Nguyen', aliases: [] }
    expect(cleanSay('Siobhan = shiv-AWN; Nguyen = win', name)).toBe('Siobhan = shiv-AWN; Nguyen = win')
    expect(cleanSay('Siobhan = shiv-AWN; Dublin = DUB-lin; Nguyen = Nguyen', name)).toBe('Siobhan = shiv-AWN')
    expect(cleanSay('shiv-AWN win', name)).toBe('shiv-AWN win')
    // "shiv-AWN" alone would have the voice say it for both words.
    expect(cleanSay('shiv-AWN', name)).toBe('')
  })

  it('is asked for only when the AI fills in a voice by itself: Suggest’s prompt is as it was', () => {
    const db = memoryWorld()
    const e = character(db, 'Siobhan')
    const suggest = voicePrompt(e, [], '')[0].content
    expect(suggest.endsWith('Describe the sound only, not the plot or what they say. Output only the description.')).toBe(true)
    expect(suggest).not.toContain('SAY IT AS')
    const auto = voicePrompt(e, [], '', { say: true })
    expect(auto[0].content).toContain('SAY IT AS:')
    expect(auto[0].content.startsWith(suggest.replace(/Output only the description\.$/, ''))).toBe(true)
    expect(auto[1]).toEqual(voicePrompt(e, [], '')[1])
  })

  it('says what a thing that talks is, so its voice fits', () => {
    const db = memoryWorld()
    const ring = repo.createEntry(db, 'item', { name: 'Ring', summary: 'A gold ring with a sly voice.' })
    expect(voicePrompt(ring, ['Go on.'], '')[1].content).toContain('SPEAKER (an item in the story that talks): Ring')
  })
})

describe('giving characters their voices', () => {
  it('gives each character without a voice one, as Suggest would, and "Say it as" only for a hard name', async () => {
    const db = memoryWorld()
    const mara = character(db, 'Mara')
    const siobhan = character(db, 'Siobhan')
    const place = repo.createEntry(db, 'place', { name: 'Saltmarsh' }, { origin: 'text' })
    const voiced: ID[] = []
    const f = watching()
    const result = await giveVoices({ db, model: model(), fetchImpl: f, onVoiced: (id) => voiced.push(id) }, [
      mara.id,
      place.id,
      siobhan.id
    ])
    expect(f.asked).toEqual(['Mara', 'Siobhan'])
    expect(result.voiced).toEqual([mara.id, siobhan.id])
    expect(voiced).toEqual([mara.id, siobhan.id])
    expect(voiceOf(db, mara.id)).toEqual({ voice: { design: SUGGESTED_VOICE, voice: '' }, say: '' })
    expect(voiceOf(db, siobhan.id)).toEqual({ voice: { design: SUGGESTED_VOICE, voice: '' }, say: SUGGESTED_SAY })
    // A place has no voice of its own.
    expect(voiceOf(db, place.id)).toEqual({ voice: { design: '', voice: '' }, say: '' })
    // Recorded as Read aloud's requests, with their cost.
    expect(speechRecords(db)).toBe(2)
    expect(result.cost).toBeGreaterThan(0)
  })

  it('never replaces a voice or "Say it as" Adam set, before or while the AI was writing', async () => {
    const db = memoryWorld()
    const brann = character(db, 'Brann')
    const tobin = character(db, 'Tobin')
    const siobhan = character(db, 'Siobhan')
    const kell = character(db, 'Kell')
    setEntryReadAloud(db, brann.id, { voice: { design: 'Gravel and smoke.', voice: '' }, say: '' })
    setEntryReadAloud(db, kell.id, { voice: { design: '', voice: 'breeze-anna' }, say: '' })
    setEntryReadAloud(db, siobhan.id, { voice: { design: '', voice: '' }, say: 'SHIV-on' })
    const f = watching((who) => {
      // Adam describes Tobin while the AI is still thinking of a voice for him.
      if (who === 'Tobin') setEntryReadAloud(db, tobin.id, { voice: { design: 'Adam’s own.', voice: '' }, say: '' })
    })
    expect(needsVoice(db, brann)).toBe(false)
    expect(needsVoice(db, kell)).toBe(false)
    const result = await giveVoices({ db, model: model(), fetchImpl: f }, [brann.id, tobin.id, siobhan.id, kell.id])
    expect(f.asked).toEqual(['Tobin', 'Siobhan'])
    expect(result.voiced).toEqual([siobhan.id])
    expect(voiceOf(db, brann.id).voice.design).toBe('Gravel and smoke.')
    expect(voiceOf(db, kell.id).voice).toEqual({ design: '', voice: 'breeze-anna' })
    expect(voiceOf(db, tobin.id).voice.design).toBe('Adam’s own.')
    // Her voice is filled in; how her name is said stays his.
    expect(voiceOf(db, siobhan.id)).toEqual({ voice: { design: SUGGESTED_VOICE, voice: '' }, say: 'SHIV-on' })
  })

  it('a request that fails leaves the box empty, and the rest go on', async () => {
    const db = memoryWorld()
    const mara = character(db, 'Mara')
    const tobin = character(db, 'Tobin')
    const f = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (String(init?.body).includes('CHARACTER: Mara')) return Promise.resolve(new Response('no', { status: 500 }))
      return fetch(input, init)
    }) as typeof fetch
    const result = await giveVoices({ db, model: model(), fetchImpl: f, retryDelays: [1] }, [mara.id, tobin.id])
    expect(result.voiced).toEqual([tobin.id])
    expect(voiceOf(db, mara.id).voice.design).toBe('')
    expect(voiceOf(db, tobin.id).voice.design).toBe(SUGGESTED_VOICE)
  })

  it('keeps nothing into a box that has words, nor for a page that has gone', () => {
    const db = memoryWorld()
    const mara = character(db, 'Mara')
    setEntryReadAloud(db, mara.id, { voice: { design: 'His.', voice: '' }, say: 'MAH-ra' })
    expect(keepVoice(db, mara.id, { design: 'The AI’s.', say: 'mar-AH' })).toBe(false)
    expect(voiceOf(db, mara.id)).toEqual({ voice: { design: 'His.', voice: '' }, say: 'MAH-ra' })
    const gone = character(db, 'Tobin')
    repo.deleteEntry(db, gone.id)
    expect(keepVoice(db, gone.id, { design: 'The AI’s.', say: '' })).toBe(false)
  })
})

describe('in the background', () => {
  it('asks once a session for each character, after the job that made them', async () => {
    const db = memoryWorld()
    const mara = character(db, 'Mara')
    const told: ID[][] = []
    const f = watching()
    const o = { db, model: model, fetchImpl: f, onVoiced: (ids: ID[]) => told.push(ids) }
    voiceLater([mara.id], o)
    await voicesSettled()
    expect(voiceOf(db, mara.id).voice.design).toBe(SUGGESTED_VOICE)
    expect(told).toEqual([[mara.id]])
    // Adam clears it: the AI doesn't put it back when it fills her in again.
    setEntryReadAloud(db, mara.id, { voice: { design: '', voice: '' }, say: '' })
    voiceLater([mara.id], o)
    await voicesSettled()
    expect(f.asked).toEqual(['Mara'])
    expect(voiceOf(db, mara.id).voice.design).toBe('')
  })

  it('waits for a pause, starting again each time the same character is handed over', async () => {
    const db = memoryWorld()
    const mara = character(db, 'Mara')
    const f = watching()
    const o = { db, model: model, fetchImpl: f, delayMs: 60 }
    voiceLater([mara.id], o)
    await new Promise((r) => setTimeout(r, 30))
    voiceLater([mara.id], o)
    await new Promise((r) => setTimeout(r, 40))
    expect(f.asked).toEqual([])
    await until(() => voiceOf(db, mara.id).voice.design !== '')
    await voicesSettled()
    expect(f.asked).toEqual(['Mara'])
  })

  it('asks again a little later when a request failed, a few times in all', async () => {
    const db = memoryWorld()
    const mara = character(db, 'Mara')
    const tobin = character(db, 'Tobin')
    // Mara's first request fails (each of the client's quick retries inside it too): her service is down until
    // Tobin, after her in line, is asked about. Tobin's always fail.
    let maraDown = true
    const f = watching((who) => {
      if (who === 'Tobin') maraDown = false
      if (who === 'Tobin' || maraDown) throw new TypeError('fetch failed')
    })
    voiceLater([mara.id, tobin.id], { db, model: model, fetchImpl: f, retryDelays: [1, 1, 1], againAfterMs: 20 })
    await until(() => voiceOf(db, mara.id).voice.design !== '')
    expect(voiceOf(db, mara.id).voice.design).toBe(SUGGESTED_VOICE)
    // One record a request (the client's own quick retries are inside it): Mara twice, Tobin three times, then no more.
    await until(() => speechRecords(db) === 2 + VOICE_TRIES)
    await new Promise((r) => setTimeout(r, 100))
    await voicesSettled()
    expect(speechRecords(db)).toBe(2 + VOICE_TRIES)
    expect(voiceOf(db, tobin.id).voice.design).toBe('')
  })

  it('does nothing without a Read aloud model, or once the world has closed', async () => {
    const db = memoryWorld()
    const mara = character(db, 'Mara')
    const f = watching()
    voiceLater([mara.id], { db, model: () => null, fetchImpl: f })
    voiceLater([mara.id], { db, model: model, live: () => false, fetchImpl: f })
    await voicesSettled()
    expect(f.asked).toEqual([])
    expect(voiceOf(db, mara.id).voice.design).toBe('')
    // No model then isn't "asked": once there is one, she gets her voice.
    voiceLater([mara.id], { db, model: model, fetchImpl: f })
    await voicesSettled()
    expect(voiceOf(db, mara.id).voice.design).toBe(SUGGESTED_VOICE)
  })
})
