// The builder's jobs against the fake provider (tests/fake-provider/server.mjs answers builder requests
// with deterministic replies) and, where a test needs an exact reply, against canned streams.

import type Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AppEvents } from '@shared/api'
import type { BuilderDone, BuilderProgress } from '@shared/contracts/builder'
import type { ID, ThinkingLevel } from '@shared/types'
import { defaultWritingPrefs } from '@shared/defaults'
import { memoryWorld } from '../../../tests/unit/helpers'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import * as repo from '../db/repo'
import * as gens from '../db/generations'
import * as hist from '../db/history'
import { gatherWorld } from './context'
import { builderFailure } from './errors'
import {
  isRunning,
  room,
  startFleshOut,
  startInterview,
  startOptions,
  startQuestions,
  startQuickStart,
  startRelationships,
  stopJob,
  stopJobsFor,
  type Emit,
  type JobContext
} from './jobs'
import type { BuilderModel } from './model'
import { BUILDER_MARKER, worldText } from './prompts'
import * as mem from '../db/memory'
import { createBuilt, keepRelationship, keepSuggestions, noteWritten, restoreField, saveBuilt, takeBackRelationship, type Written } from './save'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 1, slowDelayMs: 15 })
})
afterAll(() => fake.close())

const NOTES = `Brann Holt runs the ferry across the Narrows.
A grumpy ex-soldier who owes the Duke money.
Missing two fingers on his left hand.`

function modelFor(modelId = 'fake/writer', contextLength: number | null = 32000, thinking?: ThinkingLevel): BuilderModel {
  return {
    target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: 'test' },
    choice: { providerId: 'p1', modelId, label: modelId, contextLength, promptPrice: 0.000001, completionPrice: 0.000002 },
    ...(thinking ? { thinking } : {})
  }
}

type Ev = { name: keyof AppEvents; payload: unknown }

function setup(o: { modelId?: string; fetchImpl?: typeof fetch; thinking?: ThinkingLevel } = {}) {
  const db = memoryWorld()
  const events: Ev[] = []
  const saved: ID[] = []
  const emit: Emit = (name, payload) => events.push({ name, payload })
  const ctx: JobContext = {
    db,
    model: modelFor(o.modelId, 32000, o.thinking),
    emit,
    onSaved: (id) => saved.push(id),
    fetchImpl: o.fetchImpl,
    retryDelays: [1, 1]
  }
  const storyId = repo.listStories(db)[0].id
  const done = (jobId: ID): Promise<BuilderDone> =>
    new Promise((resolve) => {
      const check = (): void => {
        const d = events.find((e) => e.name === 'builder:done' && (e.payload as BuilderDone).jobId === jobId)
        if (d) resolve(d.payload as BuilderDone)
        else setTimeout(check, 5)
      }
      check()
    })
  const progress = (jobId: ID): BuilderProgress[] =>
    events
      .filter((e) => e.name === 'builder:progress' && (e.payload as BuilderProgress).jobId === jobId)
      .map((e) => e.payload as BuilderProgress)
  const brief = (kind: 'character' | 'place' | 'group' | 'item' = 'character', excludeId: ID | null = null) =>
    gatherWorld(db, { kind, excludeId, storyId, prefs: defaultWritingPrefs() })
  return { db, ctx, events, saved, storyId, done, progress, brief }
}

/** A fetch that streams one reply a few characters at a time, `ms` apart, like a slow model. */
function trickle(reply: string, ms: number): typeof fetch {
  const line = (delta: object, finish: string | null = null): string =>
    `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
  return (async () => {
    const enc = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      async start(c) {
        for (const p of reply.match(/[\s\S]{1,6}/g) ?? []) {
          c.enqueue(enc.encode(line({ content: p })))
          await new Promise((r) => setTimeout(r, ms))
        }
        c.enqueue(enc.encode(`${line({}, 'stop')}data: [DONE]\n\n`))
        c.close()
      }
    })
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }) as unknown as typeof fetch
}

/** A fetch that answers each request with the next canned reply, streamed in small pieces. */
function canned(replies: string[]): typeof fetch & { calls: () => number; bodies: () => Record<string, unknown>[] } {
  let n = 0
  const bodies: Record<string, unknown>[] = []
  const f = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)))
    const text = replies[Math.min(n++, replies.length - 1)]
    const chunk = (delta: object, finish: string | null = null): string =>
      `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
    const parts = text.match(/[\s\S]{1,7}/g) ?? []
    const body = `${parts.map((p) => chunk({ content: p })).join('')}${chunk({}, 'stop')}data: [DONE]\n\n`
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }) as unknown as typeof fetch & { calls: () => number; bodies: () => Record<string, unknown>[] }
  f.calls = () => n
  f.bodies = () => bodies
  return f
}

function builderRecords(db: Database.Database) {
  const rows = db.prepare("SELECT id FROM generations WHERE job = 'builder' ORDER BY rowid").all() as { id: ID }[]
  return rows.map((r) => gens.getGeneration(db, r.id))
}

describe('Thinking', () => {
  const good = JSON.stringify({ fromNotes: { name: 'Brann Holt' }, drafted: { hair: 'Grey' } })

  it('asks the model not to think by default, and leaves room in case it does', async () => {
    const f = canned([good])
    const w = setup({ fetchImpl: f })
    startQuickStart(w.ctx, { jobId: 't1', kind: 'character', notes: NOTES }, w.brief())
    expect((await w.done('t1')).status).toBe('complete')
    const body = f.bodies()[0]
    expect(body.reasoning_effort).toBe('none')
    expect(body.max_tokens).toBeGreaterThan(room(w.ctx.model, 'quick-start', 0).reply)
    expect(builderRecords(w.db)[0].params).toMatchObject({ max_tokens: body.max_tokens, thinking: 'off' })
  })

  it("asks with the character builder's Thinking level", async () => {
    const f = canned([good])
    const w = setup({ fetchImpl: f, thinking: 'high' })
    startQuickStart(w.ctx, { jobId: 't2', kind: 'character', notes: NOTES }, w.brief())
    expect((await w.done('t2')).status).toBe('complete')
    expect(f.bodies()[0].reasoning_effort).toBe('high')
    expect(builderRecords(w.db)[0].params.thinking).toBe('high')
  })

  it('says what to change when a model used up its room thinking', () => {
    const target = modelFor().target
    expect(builderFailure({ type: 'empty', thinking: true }, target, 'fake/writer', 'off')).toBe(
      'The character builder model thinks even with Thinking off, and used up its room before it answered. Pick another character builder model in Settings › Models.'
    )
    expect(builderFailure({ type: 'empty', thinking: true }, target, 'fake/writer', 'high')).toBe(
      "The character builder model used up its room thinking and didn't answer. Set the character builder's Thinking to Off in Settings › Models, or pick another character builder model."
    )
  })
})

describe('Quick start', () => {
  it('says how each job ended to what follows on from it (a character’s voice), after the window hears it', async () => {
    const w = setup()
    const after: { done: BuilderDone; told: boolean }[] = []
    w.ctx.onDone = (done) =>
      after.push({ done, told: w.events.some((e) => e.name === 'builder:done' && (e.payload as BuilderDone).jobId === done.jobId) })
    startQuickStart(w.ctx, { jobId: 'q-follow', kind: 'character', notes: NOTES, storyId: w.storyId }, w.brief())
    const done = await w.done('q-follow')
    expect(after).toHaveLength(1)
    expect(after[0].told).toBe(true)
    expect(after[0].done).toMatchObject({ job: 'quick-start', status: 'complete', entryId: done.entryId })
    // A follow-on that fails never breaks the job.
    w.ctx.onDone = () => {
      throw new Error('boom')
    }
    startQuickStart(w.ctx, { jobId: 'q-follow-2', kind: 'character', notes: NOTES, storyId: w.storyId }, w.brief())
    expect((await w.done('q-follow-2')).status).toBe('complete')
  })

  it("builds and saves a whole character from a few lines: Adam's words as his, the rest drafted by AI", async () => {
    // A model that streams at a readable pace, so the progress checked below is seen however fast the machine is.
    const w = setup({ modelId: 'fake/slow' })
    startQuickStart(w.ctx, { jobId: 'q1', kind: 'character', notes: NOTES, storyId: w.storyId }, w.brief())
    const done = await w.done('q1')
    expect(done.status).toBe('complete')
    expect(done.error).toBeNull()
    const e = repo.getEntry(w.db, done.entryId!)
    expect(e.kind).toBe('character')
    expect(e.name).toBe('Brann Holt')
    // Made by Adam, so it is never moved to the Trash automatically.
    expect(e.origin).toBe('adam')
    expect(e.byHand).toBe(true)
    expect(e.originStoryId).toBe(w.storyId)
    // His words, exactly as written, are his.
    expect(e.summary).toBe('Brann Holt runs the ferry across the Narrows.')
    expect(e.fields.traits).toBe('A grumpy ex-soldier who owes the Duke money.')
    expect(e.fields.marks).toBe('Missing two fingers on his left hand.')
    for (const k of ['name', 'summary', 'traits', 'marks']) expect(e.fieldOrigins[k] ?? e.origin).toBe('adam')
    // Everything else is filled in and drafted by AI.
    expect(e.fields.hair).toBe('Hair of Brann Holt, drafted to fit the world.')
    expect(e.fields.sampleLines).toContain('Pay first')
    expect(e.aliases).toEqual(['Old Brann'])
    const drafted = ['hair', 'eyes', 'origin', 'wants', 'sampleLines', 'aliases', 'description', 'role', 'pronouns']
    for (const k of drafted) expect(e.fieldOrigins[k]).toBe('ai')
    expect(done.fromNotes.sort()).toEqual(['marks', 'name', 'summary', 'traits'])
    expect(w.saved).toContain(e.id)

    // The profile was shown filling in as it arrived, with the entry once it had a name.
    const seen = w.progress('q1')
    expect(seen.length).toBeGreaterThan(1)
    expect(seen.some((p) => p.writing)).toBe(true)
    expect(seen.some((p) => p.entryId === e.id && Object.keys(p.values).length < Object.keys(done.values).length)).toBe(true)

    // One record, a builder call that belongs to no scene, so no Drafts list shows it.
    const [rec] = builderRecords(w.db)
    expect(rec).toMatchObject({ job: 'builder', sceneId: '', status: 'complete' })
    expect(rec.messages[0].content.startsWith(`${BUILDER_MARKER} quick-start`)).toBe(true)
    expect(rec.messages[1].content).toContain(NOTES)
    expect(rec.params.max_tokens).toBeGreaterThanOrEqual(4000)
    expect(gens.listGenerations(w.db, '')).toEqual([])
  })

  it('gives a character the AI named itself a name marked as drafted by AI, in its history too', async () => {
    const w = setup()
    const notes = 'a grumpy ex-soldier who runs the ferry and owes the Duke money'
    startQuickStart(w.ctx, { jobId: 'q2', kind: 'character', notes }, w.brief())
    const done = await w.done('q2')
    const e = repo.getEntry(w.db, done.entryId!)
    expect(e.name).toBe('Corvin Ashe')
    expect(e.fieldOrigins.name).toBe('ai')
    expect(e.summary).toBe(notes)
    expect(e.fieldOrigins.summary ?? e.origin).toBe('adam')
    const first = hist.entryHistory(w.db, e.id).find((v) => v.version === 1)!
    expect((first.data as { fieldOrigins: Record<string, string> }).fieldOrigins.name).toBe('ai')
  })

  it('builds places, groups and items the same way', async () => {
    const w = setup()
    const notes = 'Saltmere, a port town where nobody asks questions.\nIt smells of tar and fish.'
    startQuickStart(w.ctx, { jobId: 'p1', kind: 'place', notes }, w.brief('place'))
    const done = await w.done('p1')
    const e = repo.getEntry(w.db, done.entryId!)
    expect(e).toMatchObject({ kind: 'place', name: 'Saltmere', summary: 'Saltmere, a port town where nobody asks questions.' })
    expect(e.fields.atmosphere).toBe('It smells of tar and fish.')
    expect(e.fieldOrigins.atmosphere ?? e.origin).toBe('adam')
    expect(e.fields.people).toMatch(/drafted/)
    expect(e.fieldOrigins.people).toBe('ai')
  })

  it('takes a passage from a scene as the notes', async () => {
    const w = setup()
    const notes = 'Tobin was where he had promised to be.'
    startQuickStart(w.ctx, { jobId: 'q3', kind: 'character', notes, sceneId: 'scene-1' }, w.brief())
    await w.done('q3')
    const [rec] = builderRecords(w.db)
    expect(rec.messages[1].content).toContain('selected this passage from the story')
    expect(rec.sceneId).toBe('')
  })

  it('stops when asked, keeping only the fields that had fully arrived', async () => {
    const w = setup({ modelId: 'fake/slow' })
    startQuickStart(w.ctx, { jobId: 'q4', kind: 'character', notes: NOTES }, w.brief())
    // Wait until the character has been saved and a few fields are in.
    await new Promise<void>((resolve) => {
      const check = (): void => {
        const last = w.progress('q4').at(-1)
        if (last?.entryId && Object.keys(last.values).length >= 8) resolve()
        else setTimeout(check, 5)
      }
      check()
    })
    await stopJob('q4')
    expect(isRunning('q4')).toBe(false)
    const done = await w.done('q4')
    expect(done.status).toBe('stopped')
    const e = repo.getEntry(w.db, done.entryId!)
    expect(e.name).toBe('Brann Holt')
    const fields = Object.entries(e.fields).filter(([, v]) => v)
    expect(fields.length).toBeGreaterThan(3)
    // Nothing was cut off partway: every field holds its whole value (each ends with a full stop, but the role).
    for (const [k, v] of fields) if (k !== 'role') expect(v).toMatch(/\.["]?$/)
    expect(Object.keys(e.fields).length).toBeLessThan(30)
    expect(builderRecords(w.db)[0].status).toBe('stopped')
  })

  it('asks once more when the reply is not a profile, saying why', async () => {
    const good = JSON.stringify({ fromNotes: { name: 'Brann Holt' }, drafted: { hair: 'Grey' } })
    const f = canned(['Sure! Brann sounds great. Let me think about him.', good])
    const w = setup({ fetchImpl: f })
    startQuickStart(w.ctx, { jobId: 'q5', kind: 'character', notes: NOTES }, w.brief())
    const done = await w.done('q5')
    expect(done.status).toBe('complete')
    expect(f.calls()).toBe(2)
    const [first, second] = f.bodies().map((b) => b.messages as { role: string; content: string }[])
    expect(second.at(-1)!.content).toMatch(/couldn't be used, because there was no JSON object in it/)
    // The same request again, the line at its end, never the reply that couldn't be used (2026-10-19).
    expect(second.map((m) => m.role)).toEqual(first.map((m) => m.role))
    expect(second.slice(0, -1)).toEqual(first.slice(0, -1))
    expect(second.at(-1)!.content.startsWith(`${first.at(-1)!.content}\n\n`)).toBe(true)
    expect(second.some((m) => m.content.includes('Brann sounds great'))).toBe(false)
    expect(repo.getEntry(w.db, done.entryId!).fields.hair).toBe('Grey')
  })

  it("says so in plain words when the reply still isn't usable, and saves nothing", async () => {
    const w = setup({ fetchImpl: canned(['No.', '{"drafted": {}}']) })
    startQuickStart(w.ctx, { jobId: 'q6', kind: 'character', notes: NOTES }, w.brief())
    const done = await w.done('q6')
    expect(done.status).toBe('error')
    expect(done.error).toMatch(/wasn't something AI Write could use.*Settings › Models/)
    expect(repo.listEntries(w.db, 'character')).toEqual([])
  })

  it('turns an empty reply (a model that spent it all thinking) into plain words that suggest another model', async () => {
    const w = setup({ modelId: 'fake/empty' })
    startQuickStart(w.ctx, { jobId: 'q7', kind: 'character', notes: NOTES }, w.brief())
    const done = await w.done('q7')
    expect(done.status).toBe('error')
    expect(done.error).toBe('Fake sent back an empty reply. Try again, or pick another character builder model in Settings › Models.')
    expect(repo.listEntries(w.db)).toEqual([])
  })

  it('hides thinking and builds from the answer', async () => {
    const w = setup({ modelId: 'fake/think' })
    startQuickStart(w.ctx, { jobId: 'q8', kind: 'character', notes: NOTES }, w.brief())
    const done = await w.done('q8')
    expect(done.status).toBe('complete')
    expect(repo.getEntry(w.db, done.entryId!).name).toBe('Brann Holt')
  })

  it('needs some notes', () => {
    const w = setup()
    expect(() => startQuickStart(w.ctx, { jobId: 'q9', kind: 'character', notes: '  ' }, w.brief())).toThrow(/One line is enough/)
  })

  it('saves what had arrived when the world closes', async () => {
    const w = setup({ modelId: 'fake/slow' })
    startQuickStart(w.ctx, { jobId: 'q10', kind: 'character', notes: NOTES }, w.brief())
    await new Promise<void>((resolve) => {
      const check = (): void => {
        const last = w.progress('q10').at(-1)
        if (last?.entryId && Object.keys(last.values).length >= 6) resolve()
        else setTimeout(check, 5)
      }
      check()
    })
    stopJobsFor(w.db)
    const shown = Object.keys(w.progress('q10').at(-1)!.values).length
    const id = w.progress('q10').at(-1)!.entryId!
    const e = repo.getEntry(w.db, id)
    const count = ['name', 'summary', 'aliases', 'description'].filter((k) => k in w.progress('q10').at(-1)!.values).length
    expect(Object.values(e.fields).filter(Boolean).length + count).toBeGreaterThanOrEqual(shown)
    expect(builderRecords(w.db)[0].status).toBe('stopped')
    expect((await w.done('q10')).status).toBe('stopped')
  })

  it('keeps a long line from his notes whole', async () => {
    const long = `Brann Holt runs the ferry across the Narrows, ${'and has done for longer than anyone can remember, '.repeat(6)}rain or shine.`
    const w = setup()
    startQuickStart(w.ctx, { jobId: 'q11', kind: 'character', notes: `${long}\nA grumpy ex-soldier who owes the Duke money.` }, w.brief())
    const e = repo.getEntry(w.db, (await w.done('q11')).entryId!)
    expect(long.length).toBeGreaterThan(300)
    expect(e.summary).toBe(long)
    expect(e.fieldOrigins.summary ?? e.origin).toBe('adam')
  })

  it("writes only a few versions of the entry's history, however long the reply takes", async () => {
    const keys = 'hair eyes build face skin clothing origin wants needs fears flaws habits speech tics'.split(' ')
    const drafted = Object.fromEntries(keys.map((k) => [k, `The ${k}.`]))
    const fromNotes = { name: 'Brann Holt', summary: 'Brann Holt runs the ferry across the Narrows.' }
    const reply = JSON.stringify({ fromNotes, drafted }, null, 1)
    // About three and a half seconds: saving every second or so would have written a version each time.
    const w = setup({ fetchImpl: trickle(reply, 40) })
    startQuickStart(w.ctx, { jobId: 'q12', kind: 'character', notes: NOTES }, w.brief())
    const done = await w.done('q12')
    expect(done.status).toBe('complete')
    const e = repo.getEntry(w.db, done.entryId!)
    expect(e.fields.speech).toBe('The speech.')
    // Made with his name, then his words, then the AI's: never one for every second the reply took.
    expect(hist.entryHistory(w.db, e.id).length).toBeLessThanOrEqual(4)
  })

  it('saves a reply without the two parts once it has a name and then at the end, his words as his', async () => {
    const keys = 'hair eyes build face skin clothing origin wants needs fears flaws habits speech tics'.split(' ')
    const flat = {
      name: 'Brann Holt',
      summary: 'Brann Holt runs the ferry across the Narrows.',
      ...Object.fromEntries(keys.map((k) => [k, `The ${k}.`]))
    }
    const w = setup({ fetchImpl: trickle(JSON.stringify(flat, null, 1), 15) })
    startQuickStart(w.ctx, { jobId: 'q16', kind: 'character', notes: NOTES }, w.brief())
    const done = await w.done('q16')
    expect(done.status).toBe('complete')
    expect(done.fromNotes).toEqual(['name', 'summary'])
    const e = repo.getEntry(w.db, done.entryId!)
    expect(e.fields.tics).toBe('The tics.')
    expect(e.fieldOrigins.summary ?? e.origin).toBe('adam')
    expect(e.fieldOrigins.hair).toBe('ai')
    // Not a version for every field that arrived.
    expect(hist.entryHistory(w.db, e.id).length).toBeLessThanOrEqual(4)
  })

  it('reads a reply that wraps its two parts in an outer object', async () => {
    const parts = { fromNotes: { name: 'Brann Holt', summary: 'Brann Holt runs the ferry across the Narrows.' }, drafted: { hair: 'Grey' } }
    const w = setup({ fetchImpl: canned([JSON.stringify({ character: parts })]) })
    startQuickStart(w.ctx, { jobId: 'q17', kind: 'character', notes: NOTES }, w.brief())
    const e = repo.getEntry(w.db, (await w.done('q17')).entryId!)
    expect(e.summary).toBe('Brann Holt runs the ferry across the Narrows.')
    expect(e.fieldOrigins.summary ?? e.origin).toBe('adam')
    expect(e.fields.hair).toBe('Grey')
    expect(e.fieldOrigins.hair).toBe('ai')
  })

  it('finishes a build that stopped part way, filling only the fields still empty', async () => {
    const w = setup({ modelId: 'fake/midstream-error' })
    startQuickStart(w.ctx, { jobId: 'q13', kind: 'character', notes: NOTES }, w.brief())
    const failed = await w.done('q13')
    expect(failed.status).toBe('error')
    // The screen says what arrived is saved; the message is only what went wrong, with its next step.
    expect(failed.error).toMatch(/^Fake is having trouble right now\. Try again in a few minutes/)
    expect(failed.error).not.toMatch(/saved/)
    const id = failed.entryId!
    const part = repo.getEntry(w.db, id)
    expect(part.fields.marks).toBe('Missing two fingers on his left hand.')
    expect(part.fields.speech ?? '').toBe('')
    // Adam typed in one of the empty fields meanwhile.
    repo.updateEntry(w.db, id, { fields: { hair: 'Black, his own' } })

    w.ctx.model = modelFor('fake/writer')
    startQuickStart(w.ctx, { jobId: 'q14', kind: 'character', notes: NOTES, entryId: id }, w.brief('character', id))
    const done = await w.done('q14')
    expect(done.status).toBe('complete')
    expect(done.entryId).toBe(id)
    const e = repo.getEntry(w.db, id)
    expect(repo.listEntries(w.db, 'character')).toHaveLength(1)
    expect(e.fields.hair).toBe('Black, his own')
    expect(e.fields.marks).toBe('Missing two fingers on his left hand.')
    expect(e.fields.speech).toBe('How they speak of Brann Holt, drafted to fit the world.')
    expect(e.fieldOrigins.speech).toBe('ai')
    for (const k of ['name', 'summary', 'traits', 'marks', 'hair']) expect(e.fieldOrigins[k] ?? e.origin).toBe('adam')
    // Shown whole, with his words marked as his.
    expect(done.values.marks).toBe('Missing two fingers on his left hand.')
    expect(done.fromNotes).toEqual(expect.arrayContaining(['name', 'summary', 'traits', 'marks', 'hair']))
    // The model was told what is saved already, and wasn't told about the character as someone else in the world.
    const asked = builderRecords(w.db).at(-1)!.messages[1].content
    expect(asked).toContain('These fields are saved already')
    expect(asked).toContain('Hair: Black, his own')
    expect(asked).not.toContain('- Brann Holt')
  })

  // 2026-10-17: B4 in the world and story building plan.
  it('never puts back a field Adam clears while the rest is being finished', async () => {
    const reply = { fromNotes: {}, drafted: { eyes: 'Pale blue', speech: 'Low and slow.' } }
    const w = setup({ fetchImpl: canned([JSON.stringify(reply)]) })
    const had = repo.createEntry(w.db, 'character', { name: 'Brann Holt', fields: { hair: 'Grey', marks: 'Missing two fingers' } })
    startQuickStart(w.ctx, { jobId: 'q20', kind: 'character', notes: NOTES, entryId: had.id }, w.brief('character', had.id))
    repo.updateEntry(w.db, had.id, { fields: { marks: '' } })
    const done = await w.done('q20')
    expect(done.status).toBe('complete')
    const e = repo.getEntry(w.db, had.id)
    expect(e.fields.marks ?? '').toBe('')
    expect(e.fields.hair).toBe('Grey')
    expect(e.fields.eyes).toBe('Pale blue')
  })

  // 2026-10-17: B2 in the world and story building plan.
  it('tells the model about who the notes name, however long ago they were written, and not the whole of a big world', async () => {
    const good = JSON.stringify({ fromNotes: { name: 'Brann Holt' }, drafted: { hair: 'Grey' } })
    const w = setup({ fetchImpl: canned([good]) })
    const duke = repo.createEntry(w.db, 'character', { name: 'Duke Orsel', aliases: ['the Duke'], summary: 'Lends money and never forgets it.' })
    touched(w.db, duke.id, 0)
    const long = 'A quiet dock worker who keeps a ledger of every ship that passes, and never lends a coin to anyone at all.'
    for (let i = 0; i < 400; i++) touched(w.db, repo.createEntry(w.db, 'character', { name: `Dockhand ${i}`, summary: long }).id, i + 1)
    startQuickStart(w.ctx, { jobId: 'q21', kind: 'character', notes: NOTES }, w.brief())
    expect((await w.done('q21')).status).toBe('complete')
    const asked = builderRecords(w.db)[0].messages[1].content
    expect(asked).toContain('- Duke Orsel (also: the Duke)')
    expect(asked).toContain('- Dockhand 399')
    expect(asked).not.toContain('- Dockhand 0:')
  })

  // 2026-10-17: B7 in the world and story building plan.
  it('says what to do in plain words when something unexpected breaks, and keeps what broke for the log', async () => {
    const w = setup()
    const brief = w.brief()
    // A world file broken in a way no one planned for.
    w.db.exec('DROP TABLE generations')
    startQuickStart(w.ctx, { jobId: 'q22', kind: 'character', notes: NOTES }, brief)
    const done = await w.done('q22')
    expect(done.status).toBe('error')
    expect(done.error).toMatch(/Try again/)
    expect(done.error).not.toMatch(/Something went wrong|no such table|generations/)
  })

  it("says so when there's nothing left to finish", async () => {
    const w = setup()
    const e = repo.createEntry(w.db, 'place', { name: 'Saltmere' })
    const finish = () => startQuickStart(w.ctx, { jobId: 'q15', kind: 'character', notes: NOTES, entryId: e.id }, w.brief())
    expect(finish).toThrow(/finished here/)
  })

  it('adds to the page of a character the world has under that name, filling only its empty fields (2026-10-17)', async () => {
    const reply = {
      fromNotes: { name: 'brann holt', summary: 'Brann Holt runs the ferry across the Narrows.' },
      drafted: { hair: 'Grey and cropped', eyes: 'Pale blue' }
    }
    const w = setup({ fetchImpl: canned([JSON.stringify(reply)]) })
    const had = repo.createEntry(w.db, 'character', { name: 'Brann Holt', fields: { hair: 'Black, his own' } })
    // A place of the same name and a character one letter away are other pages.
    repo.createEntry(w.db, 'place', { name: 'Brann Hold' })
    startQuickStart(w.ctx, { jobId: 'q18', kind: 'character', notes: NOTES }, w.brief())
    const done = await w.done('q18')
    expect(done.status).toBe('complete')
    expect(done.entryId).toBe(had.id)
    expect(repo.listEntries(w.db, 'character')).toHaveLength(1)
    const e = repo.getEntry(w.db, had.id)
    expect(e.name).toBe('Brann Holt')
    expect(e.fields.hair).toBe('Black, his own')
    expect(e.fields.eyes).toBe('Pale blue')
    expect(e.fieldOrigins.eyes).toBe('ai')
    expect(e.summary).toBe('Brann Holt runs the ferry across the Narrows.')
    expect(done.values.hair).toBe('Black, his own')
    expect(done.text).toBe('Adding to Brann Holt’s page')
    expect(w.saved).toContain(had.id)
  })

  it('makes a new page for a name only one letter from one the world has', async () => {
    const reply = { fromNotes: { name: 'Bran Holt' }, drafted: { hair: 'Grey' } }
    const w = setup({ fetchImpl: canned([JSON.stringify(reply)]) })
    repo.createEntry(w.db, 'character', { name: 'Brann Holt' })
    startQuickStart(w.ctx, { jobId: 'q19', kind: 'character', notes: NOTES }, w.brief())
    const done = await w.done('q19')
    expect(done.status).toBe('complete')
    expect(repo.listEntries(w.db, 'character').map((c) => c.name)).toEqual(['Bran Holt', 'Brann Holt'])
  })
})

describe('saving a profile', () => {
  it('never writes over words someone else has put in a field meanwhile', () => {
    const db = memoryWorld()
    const written: Written = {}
    const values = { name: 'Brann', hair: 'Grey', eyes: 'Blue' }
    const e = createBuilt(db, 'character', values, ['hair', 'eyes'], null)
    noteWritten(written, e, values)
    // Adam types in the entry's page while the profile is still arriving.
    repo.updateEntry(db, e.id, { fields: { hair: 'Black, his own' } })
    const after = saveBuilt(db, 'character', e.id, { ...values, hair: 'Grey and cropped', eyes: 'Pale blue', build: 'Broad' }, [], written)
    expect(after.fields).toMatchObject({ hair: 'Black, his own', eyes: 'Pale blue', build: 'Broad' })
    expect(after.fieldOrigins).toMatchObject({ hair: 'adam', eyes: 'ai', build: 'ai' })
  })

  it("saves Adam's own words exactly as he typed them when a guided build is first made, however long", () => {
    const db = memoryWorld()
    const summary = `${'A ferryman who  never forgets a face, '.repeat(9)}and never forgives a debt. `
    const hair = `Grey;  cropped close, ${'with a streak of white '.repeat(14)}at the temple`
    const values = { name: ' Brann Holt ', summary, hair, aliases: 'Old Brann; the "Ferryman", Brann', eyes: 'Pale' }
    const e = createBuilt(db, 'character', values, ['eyes'], null)
    expect(summary.length).toBeGreaterThan(300)
    expect(e.name).toBe('Brann Holt')
    expect(e.summary).toBe(summary)
    expect(e.fields.hair).toBe(hair)
    // Split at commas only, as every later save splits them.
    expect(e.aliases).toEqual(['Old Brann; the "Ferryman"', 'Brann'])
    expect(e.fieldOrigins.eyes).toBe('ai')
  })

  it("makes a guided build's entry with the suggestions Adam kept marked as drafted by AI", () => {
    const db = memoryWorld()
    const e = createBuilt(db, 'character', { name: 'Mara', hair: 'Black', eyes: 'Grey', ghost: 'x' }, ['eyes'], null)
    expect(e.origin).toBe('adam')
    expect(e.fields).toEqual({ hair: 'Black', eyes: 'Grey' })
    expect(e.fieldOrigins.eyes).toBe('ai')
    expect(e.fieldOrigins.hair ?? e.origin).toBe('adam')
    expect(e.fieldOrigins.name ?? e.origin).toBe('adam')
    expect(() => createBuilt(db, 'character', { hair: 'Black' }, [], null)).toThrow(/name/)
  })

  it("keeps suggestions as drafted by AI, only in empty fields unless Adam picked an option to replace one", () => {
    const db = memoryWorld()
    const e = repo.createEntry(db, 'character', { name: 'Mara', fields: { hair: 'Black, his words' } })
    const { entry: kept, skipped } = keepSuggestions(db, e.id, { hair: 'Red', eyes: 'Grey', summary: 'A smuggler' })
    expect(kept.fields).toMatchObject({ hair: 'Black, his words', eyes: 'Grey' })
    expect(skipped).toEqual(['hair'])
    expect(kept.summary).toBe('A smuggler')
    expect(kept.fieldOrigins).toMatchObject({ eyes: 'ai', summary: 'ai' })
    expect(kept.fieldOrigins.hair ?? kept.origin).toBe('adam')
    const picked = keepSuggestions(db, e.id, { hair: 'Silver' }, true).entry
    expect(picked.fields.hair).toBe('Silver')
    expect(picked.fieldOrigins.hair).toBe('ai')
    // Editing a kept field makes it his.
    expect(repo.updateEntry(db, e.id, { fields: { eyes: 'Grey as slate' } }).fieldOrigins.eyes).toBe('adam')
  })

  it('puts a field back with who made it when Adam undoes picking an option', () => {
    const db = memoryWorld()
    const e = repo.createEntry(db, 'character', { name: 'Mara', fields: { hair: 'Black  as pitch' } }, { origin: 'text' })
    expect(keepSuggestions(db, e.id, { hair: 'Silver' }, true).entry.fieldOrigins.hair).toBe('ai')
    const back = restoreField(db, e.id, 'hair', 'Black  as pitch', 'text', 'Silver').entry
    expect(back.fields.hair).toBe('Black  as pitch')
    expect(back.fieldOrigins.hair).toBe('text')
    // Read from the story and never touched by Adam, so it can still go to the Trash when the story drops it.
    expect(back.byHand).toBe(false)
    keepSuggestions(db, e.id, { summary: 'A smuggler' })
    keepSuggestions(db, e.id, { summary: 'A thief' }, true)
    expect(restoreField(db, e.id, 'summary', 'A smuggler', 'ai').entry.fieldOrigins.summary).toBe('ai')
  })

  // 2026-10-17: B5 in the world and story building plan.
  it('leaves a field that changed since the screen last saw it, picking an option or undoing it, and says which', () => {
    const db = memoryWorld()
    const e = repo.createEntry(db, 'character', { name: 'Mara', fields: { hair: 'Black' } })
    // The memory keeper changed it while the options were open.
    repo.updateEntry(db, e.id, { fields: { hair: 'Black, gone grey at the temples' } }, { origin: 'text' })
    const picked = keepSuggestions(db, e.id, { hair: 'Silver' }, true, { hair: 'Black' })
    expect(picked.skipped).toEqual(['hair'])
    expect(picked.entry.fields.hair).toBe('Black, gone grey at the temples')
    // As the screen knew it: picked.
    expect(keepSuggestions(db, e.id, { hair: 'Silver' }, true, { hair: 'Black,  gone grey at the temples' }).skipped).toEqual([])
    // Typed over on the entry's page before Undo.
    repo.updateEntry(db, e.id, { fields: { hair: 'Shaved' } })
    const undone = restoreField(db, e.id, 'hair', 'Black, gone grey at the temples', 'text', 'Silver')
    expect(undone.skipped).toEqual(['hair'])
    expect(undone.entry.fields.hair).toBe('Shaved')
    expect(undone.entry.fieldOrigins.hair).toBe('adam')
  })
})

describe('Flesh out', () => {
  it("suggests only for the step's empty fields and saves nothing", async () => {
    const w = setup()
    const e = repo.createEntry(w.db, 'character', { name: 'Mara', fields: { hair: 'Black' } })
    const before = repo.getEntry(w.db, e.id)
    const values = { name: 'Mara', hair: 'Black', eyes: 'typed, not saved yet' }
    const keys = ['build', 'face', 'hair', 'eyes']
    startFleshOut(w.ctx, { jobId: 'f1', kind: 'character', entryId: e.id, values, keys }, w.brief('character', e.id))
    const done = await w.done('f1')
    expect(done.status).toBe('complete')
    expect(done.values).toEqual({ build: 'Suggested build for Mara.', face: 'Suggested face for Mara.' })
    expect(repo.getEntry(w.db, e.id)).toEqual(before)
    const [rec] = builderRecords(w.db)
    expect(rec.messages[1].content).toContain('Eyes: typed, not saved yet')
  })

  it('says so when every field is filled in already', () => {
    const w = setup()
    const input = { jobId: 'f2', kind: 'character' as const, entryId: null, values: { hair: 'Black' }, keys: ['hair'] }
    const flesh = () => startFleshOut(w.ctx, input, w.brief())
    expect(flesh).toThrow(/filled in already/)
  })
})

describe('Give me options', () => {
  it('offers exactly three', async () => {
    const w = setup()
    startOptions(w.ctx, { jobId: 'o1', kind: 'character', entryId: null, values: { name: 'Mara' }, key: 'origin' }, w.brief())
    const done = await w.done('o1')
    expect(done.status).toBe('complete')
    expect(done.options).toEqual([
      'Origin, first option: something only Mara would have.',
      'Origin, second option: something only Mara would have.',
      'Origin, third option: something only Mara would have.'
    ])
  })

  it('asks again for three when fewer come back, and says so if they still do not', async () => {
    const f = canned(['{"options": ["One", "Two"]}', '{"options": ["One", "Two", "Three", "Four"]}'])
    const w = setup({ fetchImpl: f })
    startOptions(w.ctx, { jobId: 'o2', kind: 'character', entryId: null, values: {}, key: 'origin' }, w.brief())
    expect((await w.done('o2')).options).toEqual(['One', 'Two', 'Three'])
    const again = (f.bodies()[1].messages as { content: string }[]).at(-1)!.content
    expect(again).toMatch(/it gave 2 different options rather than three/)

    const w2 = setup({ fetchImpl: canned(['{"options": ["One", "one"]}']) })
    startOptions(w2.ctx, { jobId: 'o3', kind: 'character', entryId: null, values: {}, key: 'origin' }, w2.brief())
    const done = await w2.done('o3')
    expect(done.status).toBe('error')
    expect(done.error).toMatch(/three different options/)
  })
})

describe('Follow-up questions', () => {
  it('asks a short round of questions about the notes, saving nothing', async () => {
    const w = setup()
    startQuestions(w.ctx, { jobId: 'q1', kind: 'character', notes: NOTES, storyId: w.storyId }, w.brief())
    const done = await w.done('q1')
    expect(done.status).toBe('complete')
    expect(done.options).toEqual(['What does Brann want most right now?', 'What is Brann afraid of?', 'What does Brann do without thinking?'])
    expect(repo.listEntries(w.db, 'character').some((e) => e.name === 'Brann Holt')).toBe(false)
    expect(builderRecords(w.db)[0].messages[0].content).toMatch(/^\[AIWRITE-BUILDER v1\] questions/)
  })

  it('asks again when no questions come back, reads a plain list, and keeps five at most', async () => {
    const f = canned(['Happy to help!', '{"questions": ["A?", "a?", "B?", "C?", "D?", "E?", "F?"]}'])
    const w = setup({ fetchImpl: f })
    startQuestions(w.ctx, { jobId: 'q2', kind: 'place', notes: 'A port.' }, w.brief('place'))
    expect((await w.done('q2')).options).toEqual(['A?', 'B?', 'C?', 'D?', 'E?'])
    // Asked again (2026-10-19): the same request with a line saying why at its end, never the reply that couldn't be used.
    const [first, again] = f.bodies().map((b) => b.messages as { role: string; content: string }[])
    expect(again.map((m) => m.role)).toEqual(first.map((m) => m.role))
    expect(again.at(-1)!.content.startsWith(`${first.at(-1)!.content}\n\nYour last reply to this couldn't be used, because `)).toBe(true)
    expect(again.at(-1)!.content).toMatch(/Reply with only the JSON object/)
    expect(again.some((m) => m.content.includes('Happy to help!'))).toBe(false)

    const w2 = setup({ fetchImpl: canned(['1. Who rules it?\n2. What does it smell of?']) })
    startQuestions(w2.ctx, { jobId: 'q3', kind: 'place', notes: 'A port.' }, w2.brief('place'))
    expect((await w2.done('q3')).options).toEqual(['Who rules it?', 'What does it smell of?'])
  })

  it('needs some notes first', () => {
    const w = setup()
    expect(() => startQuestions(w.ctx, { jobId: 'q4', kind: 'character', notes: '  ' }, w.brief())).toThrow(/One line is enough/)
  })

  it('builds with the answers as his words, and decides what he left to the AI', async () => {
    const w = setup()
    const answers = [
      { question: 'What does Brann want most right now?', answer: 'To pay off the Duke before the ice comes.' },
      { question: 'What is Brann afraid of?', answer: null }
    ]
    startQuickStart(w.ctx, { jobId: 'qa', kind: 'character', notes: NOTES, storyId: w.storyId, answers }, w.brief())
    const done = await w.done('qa')
    expect(done.status).toBe('complete')
    const e = repo.getEntry(w.db, done.entryId!)!
    expect(e.fields.wants).toBe('To pay off the Duke before the ice comes.')
    expect(e.fieldOrigins.wants ?? e.origin).toBe('adam')
    expect(e.fields.fears).toBe('Fears of Brann Holt, decided by the AI.')
    expect(e.fieldOrigins.fears).toBe('ai')
    const asked = builderRecords(w.db)[0].messages.at(-1)!.content
    expect(asked).toContain('Q: What is Brann afraid of?\nA: (left to you: decide it)')
  })
})

describe('Interview', () => {
  it('answers in character, with the conversation so far', async () => {
    const w = setup()
    startInterview(
      w.ctx,
      {
        jobId: 'i1',
        entryId: null,
        values: { name: 'Brann Holt', speech: 'Short and gruff' },
        turns: [
          { from: 'adam', text: 'Who are you?' },
          { from: 'character', text: 'The ferryman.' }
        ],
        question: 'What do you think of the Duke?'
      },
      w.brief()
    )
    const done = await w.done('i1')
    expect(done.status).toBe('complete')
    expect(done.text).toBe("You want to know about the Duke? I'll say this once: I keep my own counsel, and I pay my debts.")
    const [rec] = builderRecords(w.db)
    expect(rec.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(rec.messages[0].content).toContain('You are Brann Holt')
    expect(rec.messages[0].content).toContain('How they speak: Short and gruff')
  })

  // 2026-10-17: B7 in the world and story building plan.
  it('counts only the turns it sends, so a long interview still leaves room for the world', async () => {
    const w = setup()
    for (let i = 0; i < 10; i++) repo.createEntry(w.db, 'character', { name: `Sailor ${i}`, summary: 'Works the night boats out of the Narrows, and knows every rock in them. '.repeat(3) })
    // 200 long turns: far more than the model can read, but only the last 20 are sent.
    const turns = Array.from({ length: 200 }, (_, i) => ({ from: i % 2 ? ('character' as const) : ('adam' as const), text: `${'Tell me more. '.repeat(40)}${i}` }))
    startInterview(w.ctx, { jobId: 'i3', entryId: null, values: { name: 'Brann Holt' }, turns, question: 'And the Duke?' }, w.brief())
    expect((await w.done('i3')).status).toBe('complete')
    const system = builderRecords(w.db)[0].messages[0].content
    for (let i = 0; i < 10; i++) expect(system).toContain(`- Sailor ${i}`)
  })

  it('needs a name and a question', () => {
    const w = setup()
    const ask = (values: Record<string, string>, question: string) => () =>
      startInterview(w.ctx, { jobId: 'i2', entryId: null, values, turns: [], question }, w.brief())
    expect(ask({}, 'Hi?')).toThrow(/name first/)
    expect(ask({ name: 'B' }, ' ')).toThrow(/question/)
  })
})

// 2026-10-17: Suggest relationships, in the guided builder's Relationships step.
describe('Suggest relationships', () => {
  const world = (fetchImpl?: typeof fetch) => {
    const w = setup({ fetchImpl })
    const brann = repo.createEntry(w.db, 'character', { name: 'Brann Holt', summary: 'Runs the ferry' })
    const mara = repo.createEntry(w.db, 'character', { name: 'Mara Venn', summary: 'A smuggler' })
    const guild = repo.createEntry(w.db, 'group', { name: 'Ferry Guild' })
    const tobin = repo.createEntry(w.db, 'character', { name: 'Tobin Reed' })
    repo.createEntry(w.db, 'place', { name: 'Saltmere' })
    // Tobin is linked to Brann already, from Tobin's side.
    mem.insertChange(w.db, { entryId: tobin.id, anchor: 'baseline', kind: 'relationship', payload: { otherId: brann.id, type: 'rival', feels: '', otherFeels: '' }, origin: 'adam' })
    return { ...w, brann, mara, guild, tobin }
  }
  const relationshipsOf = (db: Database.Database, id: ID) => mem.changesForEntry(db, id).filter((c) => c.kind === 'relationship')

  it('suggests only those the world has by that name, never twice, never themselves or one they are linked to already', async () => {
    const reply = {
      relationships: [
        { with: 'Mara Venn', type: 'sister', feels: 'Protective', otherFeels: 'Resentful' },
        { with: 'mara venn', type: 'cousin', feels: '', otherFeels: '' },
        { with: 'Brann Holt', type: 'himself', feels: '', otherFeels: '' },
        { with: 'Tobin Reed', type: 'friend', feels: '', otherFeels: '' },
        { with: 'Saltmere', type: 'lives in', feels: '', otherFeels: '' },
        { with: 'Mara Ven', type: 'aunt', feels: '', otherFeels: '' },
        { with: 'Nobody Real', type: 'cousin', feels: '', otherFeels: '' },
        { with: 'The Ferry Guild', type: 'member', feels: 'Loyal', otherFeels: 'Wary of him' }
      ]
    }
    const w = world(canned([JSON.stringify(reply)]))
    startRelationships(w.ctx, { jobId: 'r1', entryId: w.brann.id, values: { name: 'Brann Holt', summary: 'Runs the ferry' } }, w.brief('character', w.brann.id))
    const done = await w.done('r1')
    expect(done.status).toBe('complete')
    expect(done.relationships).toEqual([
      { otherId: w.mara.id, otherName: 'Mara Venn', otherKind: 'character', type: 'sister', feels: 'Protective', otherFeels: 'Resentful' },
      { otherId: w.guild.id, otherName: 'Ferry Guild', otherKind: 'group', type: 'member', feels: 'Loyal', otherFeels: '' }
    ])
    const asked = builderRecords(w.db)[0].messages[1].content
    expect(asked).toContain('- Mara Venn (character)')
    expect(asked).toContain('- Ferry Guild (group)')
    expect(asked).not.toContain('Saltmere (')
    expect(asked).toContain('Already linked to (suggest none of these):\n- Tobin Reed')
    // Nothing is saved until Adam keeps one.
    expect(relationshipsOf(w.db, w.brann.id)).toHaveLength(1)
  })

  it('works with the fake AI, dropping the character themselves and anyone the world doesn’t have', async () => {
    const w = world()
    startRelationships(w.ctx, { jobId: 'r2', entryId: w.brann.id, values: { name: 'Brann Holt' } }, w.brief('character', w.brann.id))
    const done = await w.done('r2')
    expect(done.status).toBe('complete')
    expect(done.relationships?.map((r) => r.otherName).sort()).toEqual(['Ferry Guild', 'Mara Venn'])
  })

  it('needs a saved character and someone to link them to', () => {
    const w = setup()
    const lone = repo.createEntry(w.db, 'character', { name: 'Brann Holt' })
    const place = repo.createEntry(w.db, 'place', { name: 'Saltmere' })
    const start = (entryId: ID) => () => startRelationships(w.ctx, { jobId: 'r3', entryId, values: {} }, w.brief())
    expect(start(place.id)).toThrow(/name first/)
    expect(start(lone.id)).toThrow(/no other characters or groups yet/)
  })

  it('keeps one as drafted by AI, how things stand at the start, and Undo takes it back only while it is unchanged', () => {
    const w = world()
    const kept = keepRelationship(w.db, w.brann.id, { otherId: w.mara.id, type: ' sister ', feels: 'Protective', otherFeels: 'Resentful' })
    expect(kept).toMatchObject({ origin: 'ai', anchor: 'baseline', kind: 'relationship', entryId: w.brann.id })
    expect(kept.kind === 'relationship' && kept.payload).toMatchObject({ otherId: w.mara.id, type: 'sister', feels: 'Protective' })
    expect(() => keepRelationship(w.db, w.brann.id, { otherId: w.mara.id, type: 'cousin', feels: '', otherFeels: '' })).toThrow(/linked already/)
    expect(() => keepRelationship(w.db, w.brann.id, { otherId: w.tobin.id, type: 'friend', feels: '', otherFeels: '' })).toThrow(/linked already/)

    expect(takeBackRelationship(w.db, kept.id, kept.updatedAt)).toBe(true)
    expect(relationshipsOf(w.db, w.brann.id)).toHaveLength(1)
    expect(takeBackRelationship(w.db, kept.id, kept.updatedAt)).toBe(false)

    // Kept again, then changed by Adam: Undo leaves his.
    const again = keepRelationship(w.db, w.brann.id, { otherId: w.guild.id, type: 'member', feels: '', otherFeels: '' })
    mem.replaceChange(w.db, again.id, { entryId: w.brann.id, anchor: 'baseline', kind: 'relationship', payload: { otherId: w.guild.id, type: 'leader', feels: '', otherFeels: '' }, origin: 'adam' })
    expect(takeBackRelationship(w.db, again.id, again.updatedAt)).toBe(false)
    expect(relationshipsOf(w.db, w.brann.id)).toHaveLength(2)
  })
})

describe("what the builder's model is told about the world", () => {
  it('has the style guide, the rules first, and who is already there, but not the entry itself', async () => {
    const w = setup()
    repo.setMeta(w.db, 'style', JSON.stringify({ spelling: 'US', proseStyle: 'Spare and wry', avoidPhrases: ['suddenly'] }))
    repo.createEntry(w.db, 'lore', { name: 'Old tales', summary: 'Ghost stories' })
    const rules = { rules: 'Breaking one kills.' }
    repo.createEntry(w.db, 'lore', { name: 'The Binding', summary: 'Oaths bind.', hardRule: true, fields: rules })
    repo.createEntry(w.db, 'group', { name: 'The Lantern Guild', summary: 'Smugglers' })
    const mara = repo.createEntry(w.db, 'character', { name: 'Mara', aliases: ['the heir'], summary: 'A smuggler' })
    const me = repo.createEntry(w.db, 'character', { name: 'Brann' })
    const text = worldText(w.brief('character', me.id), 'character', 10_000).text
    expect(text).toContain('Spelling: US English')
    expect(text).toContain('Prose style: Spare and wry')
    expect(text).toContain('Words and phrases never to use: suddenly')
    expect(text.indexOf('The Binding')).toBeLessThan(text.indexOf('Old tales'))
    expect(text).toContain('How it works: Breaking one kills.')
    expect(text).toContain('- Mara (also: the heir): A smuggler')
    expect(text).toContain('The Lantern Guild')
    expect(text).not.toContain('- Brann')
    expect(mara.id).toBeTruthy()
  })

  it('leaves out other lore first when the model can read little, the oldest first', () => {
    const w = setup()
    repo.createEntry(w.db, 'lore', { name: 'The Binding', summary: 'Oaths bind.', hardRule: true })
    for (let i = 0; i < 40; i++) {
      const e = repo.createEntry(w.db, 'lore', { name: `Tale ${i}`, summary: 'A long story about the old days, told and retold.' })
      touched(w.db, e.id, i)
    }
    for (let i = 0; i < 5; i++) repo.createEntry(w.db, 'character', { name: `Person ${i}`, summary: 'Someone' })
    const text = worldText(w.brief(), 'character', 400).text
    expect(text).toContain('The Binding')
    expect(text).toContain('Person 4')
    expect(text).toContain('Tale 39')
    expect(text).not.toContain('Tale 0:')
  })

  it('tells it about everyone when there is room, however many there are', () => {
    const w = setup()
    for (let i = 0; i < 130; i++) repo.createEntry(w.db, 'character', { name: `Zed ${String(i).padStart(3, '0')}` })
    const text = worldText(w.brief(), 'character', 100_000).text
    expect(text).toContain('- Zed 000')
    expect(text).toContain('- Zed 129')
  })
})

/** Makes an entry look as if it was last changed `n` minutes into the day. */
function touched(db: Database.Database, id: ID, n: number): void {
  const at = new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString()
  db.prepare('UPDATE entries SET updated_at = ? WHERE id = ?').run(at, id)
}
