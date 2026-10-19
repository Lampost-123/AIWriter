// One reading of a scene (overhaul phase 1, keeper/oneReading.ts): the memory keeper's reading of a scene also says where
// things stand at the end of the words it reads and, when the whole scene is read and its summary is due, writes the
// summary, so the tracker's and the summary's own calls are skipped; in every other case they make their own calls as
// before. Kept by their own rules: values only with words from what was read, never on a start that changed since,
// Adam's Recall edits and his own summary kept, the story index told. The fake memory model; invented text.

import type Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import { startFakeProvider, PRUDE_REFUSAL, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import { fakeModel, saveParas, testWorld, textOf } from '../../../tests/unit/keeperRead'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as kdb from '../db/keeper'
import { editState, keepStageRead, onStageKept, stageToRead, stateAfter, stateBefore, storedState } from '../continuity/tracker'
import type { MemoryModel } from './model'
import { runScene, type RunOutcome } from './run'
import { Keeper } from './engine'
import { ONE_READING_MARKER, READING_MARKER, READING_SYSTEM, SUMMARY_MARKER } from './prompts'
import { keepSceneSummary, sceneSourceHash } from './summaries'
import { hashText } from './text'
import { wasRefused } from './refusals'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0 })
})
afterAll(() => fake.close())

type DB = Database.Database
type Kind = 'one' | 'read' | 'stage' | 'summary' | 'other'

/** Every call the memory model was asked, oldest first, by what it was for, with what it was sent. */
function asked(db: DB): { kind: Kind; system: string; user: string }[] {
  return (db.prepare('SELECT messages_json AS m FROM generations ORDER BY rowid').all() as { m: string }[]).map((r) => {
    const ms = JSON.parse(r.m) as { role: string; content: string }[]
    const system = ms.find((m) => m.role === 'system')?.content ?? ''
    const user = ms.find((m) => m.role === 'user')?.content ?? ''
    const kind: Kind = system.includes('[AIWRITE-CONTINUITY')
      ? 'stage'
      : system.includes(SUMMARY_MARKER)
        ? 'summary'
        : system.includes(ONE_READING_MARKER)
          ? 'one'
          : system.includes(READING_MARKER)
            ? 'read'
            : 'other'
    return { kind, system, user }
  })
}
const kinds = (db: DB): Kind[] => asked(db).map((c) => c.kind)

function read(
  db: DB,
  sceneId: ID,
  o: { summaryDue?: () => boolean; fetchImpl?: typeof fetch; model?: MemoryModel; alone?: boolean } = {}
): Promise<RunOutcome> {
  return runScene(
    {
      db,
      model: o.model ?? fakeModel(fake),
      signal: new AbortController().signal,
      closed: () => false,
      retryDelays: [0, 0],
      fetchImpl: o.fetchImpl,
      ...(o.alone ? {} : { oneReading: { summaryDue: o.summaryDue ?? (() => false) } })
    },
    sceneId
  )
}

const tracking = (db: DB, model: MemoryModel = fakeModel(fake), fetchImpl?: typeof fetch) => ({
  db,
  model,
  signal: new AbortController().signal,
  closed: () => false,
  retryDelays: [0],
  fetchImpl
})

/** The tracker as the keeper's follow-on runs it after a read (keeper/index.ts standUp). */
async function standUp(db: DB, sceneId: ID, model?: MemoryModel): Promise<void> {
  if (storedState(db, sceneId)?.current) return
  await stateBefore(tracking(db, model), sceneId)
  await stateAfter(tracking(db, model), sceneId)
}

const P1 = 'Mara came in from the rain in her grey cloak, and the door was barred behind her.'
const P2 = 'Tobin was by the fire, turning his cup on the table and watching the shutters shake in the wind off the sea.'
const P3 = 'They spoke of the road, of the toll at the bridge, of the rain that had not stopped since noon, and of nothing at all.'
const P4 = 'Later Mara took off her hood.'

/** Three scenes in one chapter, with Mara and Tobin in the codex. */
function world(): { db: DB; scenes: ID[] } {
  const w = testWorld(2)
  repo.createEntry(w.db, 'character', { name: 'Mara' })
  repo.createEntry(w.db, 'character', { name: 'Tobin' })
  return { db: w.db, scenes: w.scenes }
}

const opening = (db: DB, sceneId: ID): void =>
  saveParas(db, sceneId, [
    ['p1', P1],
    ['p2', P2],
    ['p3', P3]
  ])

/** A reply over the wire, as a provider streams it. */
function streamed(content: string, finish = 'stop'): Response {
  const chunk = { choices: [{ index: 0, delta: { content }, finish_reason: finish }] }
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
}

/** The fake provider, but a reading that also asks where things stand or for the summary gets `answer`'s reply. */
function withOneReading(answer: (body: { messages: { role: string; content: unknown }[] }) => Response | null): typeof fetch {
  return async (input, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { messages: { role: string; content: unknown }[] }
    if (textOf(body.messages.find((m) => m.role === 'system')?.content).includes(ONE_READING_MARKER)) {
      const r = answer(body)
      if (r) return r
    }
    return fetch(input, init)
  }
}

/** A state as compared between worlds: the scene a value's words are in named by its place. */
const sameAcross = (state: unknown, sceneId: ID): string => JSON.stringify(state).replaceAll(sceneId, 'SCENE')

describe('one reading of a new scene', () => {
  it('says where things stand and writes the summary in the reading’s own call, as the tracker and the summary would', async () => {
    const w = world()
    const [one, two] = w.scenes
    opening(w.db, one)
    const out = await read(w.db, one, { summaryDue: () => true })
    expect(out).toMatchObject({ status: 'done', staged: true })
    const [call] = asked(w.db)
    expect(kinds(w.db)).toEqual(['one'])
    // The reading's own instructions first, unchanged, so every reading shares the start of its prompt.
    expect(call.system.startsWith(READING_SYSTEM)).toBe(true)
    expect(call.system).toContain('Where things stand ("stage")')
    expect(call.system).toContain('The summary ("summary")')
    expect(call.user).toContain('## Where things stand before the P paragraphs\n(nothing known yet: this may be the opening)')
    expect(call.user).toMatch(/Characters in this story[^\n]*:\n- Mara\n- Tobin/)
    expect(call.user).toContain('## The summary\nSummarise the whole scene in two or three sentences.')

    // Where things stand at its end, kept as the tracker keeps its own reading: from the scene's words as they are now.
    const kept = storedState(w.db, one)!
    expect(kept).toMatchObject({ current: true, unchecked: false, edited: false })
    expect(kept.state.time).toBe('evening')
    expect(kept.state.things).toEqual([{ name: 'the door', state: 'barred' }])
    expect(kept.state.characters.map((c) => [c.name, c.where, c.clothes])).toEqual([
      ['Mara', 'in the scene', [{ name: 'grey cloak', state: 'on' }]],
      ['Tobin', 'in the scene', [{ name: 'grey cloak', state: 'on' }]]
    ])
    // The tracker has nothing left to ask, for this scene or for the next one's start.
    await standUp(w.db, one)
    await stateBefore(tracking(w.db), two)
    expect(kinds(w.db)).toEqual(['one'])

    // The summary, of the scene's words as they were read.
    const scene = kdb.keeperScene(w.db, one)!
    expect(out.status === 'done' && out.summary).toMatchObject({
      text: expect.stringMatching(/^This part of the story begins: Mara came in from the rain/),
      sourceHash: sceneSourceHash(scene.text, scene.doc)
    })

    // The same state the tracker's own call works out from the same words.
    const v = world()
    opening(v.db, v.scenes[0])
    await read(v.db, v.scenes[0], { alone: true })
    await standUp(v.db, v.scenes[0])
    expect(kinds(v.db)).toEqual(['read', 'stage'])
    expect(sameAcross(storedState(v.db, v.scenes[0])!.state, v.scenes[0])).toBe(sameAcross(kept.state, one))
  })

  it('reads words added at the end once for both, from where things stood before them, but leaves the summary to its own call', async () => {
    const w = world()
    const [one] = w.scenes
    opening(w.db, one)
    await read(w.db, one)
    saveParas(w.db, one, [
      ['p1', P1],
      ['p2', P2],
      ['p3', P3],
      ['p4', P4]
    ])
    const out = await read(w.db, one, { summaryDue: () => true })
    expect(out).toMatchObject({ status: 'done', staged: true })
    expect(out.status === 'done' && out.summary).toBeFalsy()
    const call = asked(w.db)[1]
    expect(call.kind).toBe('one')
    // Only the new paragraph is read, laid over the state its checkpoint kept; no summary asked (not the whole scene).
    expect(call.user).toContain(`P4: ${P4}`)
    expect(call.user).not.toContain(`P1: ${P1}`)
    expect(call.user).toContain('## Where things stand before the P paragraphs (the scene up to them is counted in it)')
    expect(call.user).toMatch(/- Mara: where: in the scene/)
    expect(call.system).not.toContain('The summary ("summary")')
    const mara = storedState(w.db, one)!.state.characters.find((c) => c.name === 'Mara')!
    expect(mara.clothes).toEqual([
      { name: 'grey cloak', state: 'on' },
      { name: 'hood', state: 'off' }
    ])
    await standUp(w.db, one)
    expect(kinds(w.db)).toEqual(['one', 'one'])
  })
})

describe('the tracker and the summary as before', () => {
  it('an edit in the middle: the reading reads that paragraph alone, and the tracker reads the scene itself', async () => {
    const w = world()
    const [one] = w.scenes
    opening(w.db, one)
    await read(w.db, one)
    saveParas(w.db, one, [
      ['p1', P1],
      ['p2', 'Tobin was by the hearth, turning his cup on the table and watching the shutters shake in the wind.'],
      ['p3', P3]
    ])
    const out = await read(w.db, one, { summaryDue: () => true })
    expect(out.status === 'done' && (out.staged || out.summary)).toBeFalsy()
    expect(kinds(w.db)).toEqual(['one', 'read'])
    await standUp(w.db, one)
    expect(kinds(w.db)).toEqual(['one', 'read', 'stage'])
    expect(storedState(w.db, one)!.current).toBe(true)
  })

  it('the scenes before not kept from their words: the tracker brings them up to date, then reads the scene itself', async () => {
    const w = world()
    const [one, two] = w.scenes
    opening(w.db, one)
    await read(w.db, one, { alone: true })
    saveParas(w.db, two, [['q1', 'Tobin left for the docks. The bells began the hour.']])
    const out = await read(w.db, two)
    expect(out.status === 'done' && out.staged).toBeFalsy()
    expect(kinds(w.db)).toEqual(['read', 'read'])
    await standUp(w.db, two)
    expect(kinds(w.db)).toEqual(['read', 'read', 'stage', 'stage'])
  })

  it('the next scene builds on the one before as kept: one reading each, in order', async () => {
    const w = world()
    const [one, two] = w.scenes
    opening(w.db, one)
    await read(w.db, one)
    saveParas(w.db, two, [['q1', 'Tobin left for the docks. The bells began the hour.']])
    expect(await read(w.db, two)).toMatchObject({ status: 'done', staged: true })
    const call = asked(w.db)[1]
    // What the scene before left (the time of day carries only at the same moment: neither card says when).
    expect(call.user).toMatch(/## Where things stand before the P paragraphs\n- Mara: where: in the scene/)
    await standUp(w.db, two)
    expect(kinds(w.db)).toEqual(['one', 'one'])
    const tobin = storedState(w.db, two)!.state.characters.find((c) => c.name === 'Tobin')!
    expect(tobin.where).toBe('gone to the docks')
  })

  it('a summary that isn’t due, or is Adam’s own, isn’t asked for; his stays as he wrote it', async () => {
    const w = world()
    const [one] = w.scenes
    opening(w.db, one)
    mem.putSummary(w.db, { level: 'scene', targetId: one, text: 'My own summary.', origin: 'adam', sourceHash: '' })
    let follow: Promise<void> = Promise.resolve()
    const k = new Keeper({
      db: w.db,
      model: () => fakeModel(fake),
      emitStatus: () => {},
      emitChanged: () => {},
      quietMs: 60_000,
      retryDelays: [0],
      onSceneRead: (id) => {
        follow = standUp(w.db, id)
      }
    })
    k.updateNow(one)
    await k.whenIdle()
    await follow
    k.stop()
    const [call] = asked(w.db)
    expect(call.kind).toBe('one')
    expect(call.system).not.toContain('The summary ("summary")')
    expect(asked(w.db).filter((c) => c.user.startsWith('Summarise this scene'))).toEqual([])
    expect(kdb.summaryRow(w.db, 'scene', one)).toMatchObject({ text: 'My own summary.', origin: 'adam' })
    expect(kinds(w.db).filter((x) => x === 'stage')).toEqual([])
  })

  it('a model whose reply limit can’t hold them reads alone', async () => {
    const w = world()
    const [one] = w.scenes
    opening(w.db, one)
    const small = fakeModel(fake)
    small.choice = { ...small.choice, maxOutput: 4000 }
    await read(w.db, one, { summaryDue: () => true, model: small })
    expect(kinds(w.db)).toEqual(['read'])
  })
})

describe('the keeper keeps what the reading said', () => {
  it('keeps the summary as written on its own (What changed, its words), and the tracker and the summary ask nothing', async () => {
    const w = world()
    const [one] = w.scenes
    opening(w.db, one)
    let follow: Promise<void> = Promise.resolve()
    const staged: boolean[] = []
    const k = new Keeper({
      db: w.db,
      model: () => fakeModel(fake),
      emitStatus: () => {},
      emitChanged: () => {},
      quietMs: 60_000,
      retryDelays: [0],
      onSceneRead: (id, _m, r) => {
        staged.push(!!r?.staged)
        follow = standUp(w.db, id)
      }
    })
    k.updateNow(one)
    await k.whenIdle()
    await follow
    k.stop()
    expect(staged).toEqual([true])
    const scene = kdb.keeperScene(w.db, one)!
    expect(kdb.summaryRow(w.db, 'scene', one)).toMatchObject({
      origin: 'text',
      stale: false,
      sourceHash: sceneSourceHash(scene.text, scene.doc),
      text: expect.stringMatching(/^This part of the story begins: Mara came in from the rain/)
    })
    expect(kdb.listLog(w.db, { limit: 100 }).some((l) => l.what === 'summary' && l.text === 'Scene summary written')).toBe(true)
    // One call for the scene: no tracker, no scene summary (a chapter's roll-up may follow, as before).
    expect(kinds(w.db).filter((x) => x !== 'summary')).toEqual(['one'])
    expect(asked(w.db).filter((c) => c.user.startsWith('Summarise this scene'))).toEqual([])
    expect(storedState(w.db, one)!.current).toBe(true)
  })

  it('keeps a summary only while the scene’s words are those it was written from', async () => {
    const w = world()
    const [one] = w.scenes
    opening(w.db, one)
    const out = await read(w.db, one, { summaryDue: () => true })
    if (out.status !== 'done' || !out.summary) throw new Error('no summary')
    saveParas(w.db, one, [
      ['p1', P1],
      ['p2', P2]
    ])
    const o = { db: w.db, model: fakeModel(fake), signal: new AbortController().signal, closed: () => false }
    expect(keepSceneSummary(o, one, out.summary, null)).toBe(false)
    expect(kdb.summaryRow(w.db, 'scene', one)).toBeNull()
  })
})

describe('safeties', () => {
  it('a scene the memory model turns down: nothing kept, the words remembered, as before', async () => {
    const w = world()
    const [one] = w.scenes
    saveParas(w.db, one, [['p1', `EXPLICIT. ${P1}`]])
    const prude = fakeModel(fake, 'fake/prude')
    const out = await read(w.db, one, { summaryDue: () => true, model: prude })
    expect(out.status).toBe('failed')
    expect(kinds(w.db)).toEqual(['one'])
    expect(wasRefused(w.db, 'read', one, hashText(kdb.keeperScene(w.db, one)!.text), `p1:fake/prude`)).toBe(true)
    expect(storedState(w.db, one)).toBeNull()
    expect(kdb.summaryRow(w.db, 'scene', one)).toBeNull()
  })

  it('words the tracker was turned down on aren’t asked about again in the reading', async () => {
    const w = world()
    const [one] = w.scenes
    opening(w.db, one)
    // The memory model reads the scene but won't say where things stand in it.
    const refusing: typeof fetch = async (input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { messages: { role: string; content: unknown }[] }
      if (textOf(body.messages.find((m) => m.role === 'system')?.content).includes('[AIWRITE-CONTINUITY')) return streamed(PRUDE_REFUSAL)
      return fetch(input, init)
    }
    await stateAfter(tracking(w.db, fakeModel(fake), refusing), one)
    expect(storedState(w.db, one)).toMatchObject({ unchecked: true, refused: true })
    await read(w.db, one)
    expect(kinds(w.db)).toEqual(['stage', 'read'])
  })

  it('nothing is kept on a start that has changed since the reading was asked (no ghosts)', async () => {
    const w = world()
    const [one, two] = w.scenes
    opening(w.db, one)
    await read(w.db, one)
    saveParas(w.db, two, [['q1', 'Tobin left for the docks. The bells began the hour.']])
    const ask = stageToRead(w.db, two, fakeModel(fake))!
    expect(ask).toMatchObject({ at: 0, words: 'Tobin left for the docks. The bells began the hour.' })
    // Adam puts the scene before right in Recall meanwhile: what the scene starts from is no longer what was read on.
    editState(w.db, one, (e) => {
      e.characters = { tobin: { where: 'asleep upstairs' } }
    })
    const reply = { characters: [{ name: 'Tobin', where: { value: 'gone to the docks', quote: 'Tobin left for the docks' } }] }
    expect(keepStageRead(w.db, ask, reply)).toBe(false)
    expect(storedState(w.db, two)).toBeNull()
  })

  it('the scene’s end is kept only while its words are the ones read; values only with words from what was read', async () => {
    const w = world()
    const [one] = w.scenes
    opening(w.db, one)
    await read(w.db, one)
    saveParas(w.db, one, [
      ['p1', P1],
      ['p2', P2],
      ['p3', P3],
      ['p4', P4]
    ])
    const ask = stageToRead(w.db, one, fakeModel(fake))!
    expect(ask.words.trim()).toBe(P4)
    const reply = {
      characters: [
        // Words from before the checkpoint (already counted): thrown away, as the tracker throws them away.
        { name: 'Tobin', where: { value: 'by the fire', quote: 'Tobin was by the fire' } },
        { name: 'Mara', clothes: [{ item: 'hood', state: 'off', quote: 'Mara took off her hood' }] }
      ]
    }
    const seen: ID[] = []
    const stop = onStageKept((_db, id) => seen.push(id))
    try {
      expect(keepStageRead(w.db, ask, reply)).toBe(true)
    } finally {
      stop()
    }
    // The story index is told, as for the tracker's own reading.
    expect(seen).toEqual([one])
    const state = storedState(w.db, one)!.state
    expect(state.characters.find((c) => c.name === 'Tobin')!.where).toBe('in the scene')
    expect(state.characters.find((c) => c.name === 'Mara')!.clothes).toContainEqual({ name: 'hood', state: 'off' })

    // Words changed after they were read: no end kept for them (the tracker reads on from the checkpoint kept).
    const again = stageToRead(w.db, one, fakeModel(fake))
    expect(again).toBeNull()
    saveParas(w.db, one, [
      ['p1', P1],
      ['p2', P2],
      ['p3', P3],
      ['p4', P4],
      ['p5', 'Tobin put his cup on the shelf.']
    ])
    const later = stageToRead(w.db, one, fakeModel(fake))!
    expect(later.words.trim()).toBe('Tobin put his cup on the shelf.')
    saveParas(w.db, one, [['p1', P1]])
    expect(keepStageRead(w.db, later, { characters: [] })).toBe(false)
    expect(storedState(w.db, one)!.current).toBe(false)
  })

  it('Adam’s Recall edits stay while the words are the ones he edited against', async () => {
    const w = world()
    const [one] = w.scenes
    opening(w.db, one)
    editState(w.db, one, (e) => {
      e.characters = { mara: { mood: 'furious' } }
    })
    expect(await read(w.db, one)).toMatchObject({ status: 'done', staged: true })
    const kept = storedState(w.db, one)!
    expect(kept).toMatchObject({ edited: true, unchecked: false, current: true })
    expect(kept.state.characters.find((c) => c.name === 'Mara')).toMatchObject({ mood: 'furious', where: 'in the scene' })
  })
})

describe('when the reply can’t be used', () => {
  it('a reading that also asked where things stand, cut off by its reply limit, is read again alone (not in halves)', async () => {
    const w = world()
    const [one] = w.scenes
    opening(w.db, one)
    const cut = withOneReading(() => streamed(`{"facts": [], "add": [{"type": "change", "note": "${'on and on '.repeat(2500)}`, 'length'))
    const out = await read(w.db, one, { summaryDue: () => true, fetchImpl: cut })
    expect(out.status).toBe('done')
    expect(out.status === 'done' && (out.staged || out.summary)).toBeFalsy()
    const calls = asked(w.db)
    expect(calls.map((c) => c.kind)).toEqual(['one', 'read'])
    // The whole scene in one request still: P1 to P3.
    expect(calls[1].user).toContain(`P1: ${P1}`)
    expect(calls[1].user).toContain(`P3: ${P3}`)
    expect(storedState(w.db, one)).toBeNull()
  })

  it('a reading that also asked where things stand, its reply not JSON, is asked once more alone, saying what was wrong', async () => {
    const w = world()
    const [one] = w.scenes
    opening(w.db, one)
    const junk = withOneReading(() => streamed('Here is what I found: nothing to report.'))
    const out = await read(w.db, one, { summaryDue: () => true, fetchImpl: junk })
    expect(out.status).toBe('done')
    const [first, retry] = asked(w.db)
    expect([first.kind, retry.kind]).toEqual(['one', 'read'])
    expect(retry.system).toBe(READING_SYSTEM)
    expect(retry.user).toMatch(/\n\nYour last reply to this couldn't be used: there was no JSON object in it\. Reply with only the JSON object/)
    expect(retry.user).not.toContain('Here is what I found')
    // Where things stand and the summary make their own calls, as before.
    expect(out.status === 'done' && (out.staged || out.summary)).toBeFalsy()
  })
})
