// Show me the plan first (plan/review.ts), end to end against an in-memory world and the fake provider: the draft stops once
// the scene is planned and shows the plan (with what the card check noted), with no call of its own; Write with a beat
// changed sends the writer Adam's plan, and the scene's kept plan is his (Continue follows it); Cancel, or Stop while it
// waits, writes nothing. Then the pure parts: Adam's changes to a plan, and when a draft shows its plan first. Every request
// sent is read as it goes (the global fetch, wrapped). Invented text only.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import type { DraftOptions, ID } from '@shared/types'
import type { ScenePlanReview } from '@shared/contracts/planReview'
import { defaultSettings, defaultWritingPrefs } from '@shared/defaults'

const h = vi.hoisted(() => ({
  db: null as Database.Database | null,
  url: '',
  planFirst: true,
  events: [] as { name: string; payload: unknown }[]
}))

const choice = (modelId: string) => ({ providerId: 'p1', modelId, label: modelId, contextLength: 64_000, promptPrice: null, completionPrice: null })
const target = () => ({ id: 'p1', name: 'Fake', kind: 'custom' as const, baseUrl: h.url, apiKey: 'k' })

vi.mock('../world', () => ({ db: () => h.db, maybeCurrentWorld: () => (h.db ? { db: h.db } : null), onWorldClosing: () => undefined }))
vi.mock('../settings', () => ({
  getSettings: () => ({
    ...defaultSettings('library'),
    models: { ...defaultSettings('library').models, writer: choice('fake/writer'), memory: choice('fake/memory') },
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
import * as mem from '../db/memory'
import * as gens from '../db/generations'
import { draftBriefing, type DraftBriefing } from '../ai/draftFlow'
import { startDraftJob } from '../ai/drafts'
import { CARD_CHECK_LABEL, PLAN_HEAD, PLAN_MARKER, emptyPlan } from './plan'
import { CARD_NOTE } from './cardCheck'
import { forgetScenePlans, planForContinueOf } from '.'
import {
  answerScenePlan,
  CANCELLED_BEFORE_WRITING,
  changedPlan,
  reviewOf,
  reviewWanted,
  scenePlansWaiting,
  stopWaitingPlans,
  waitForReview,
  type REVIEW_MOST
} from './review'

type Sent = { model: string; system: string; user: string }
let sent: Sent[] = []
const realFetch = globalThis.fetch
let fake: FakeProvider

beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0, words: 80 })
  h.url = fake.url
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/chat/completions') && typeof init?.body === 'string') {
      const body = JSON.parse(init.body) as { model: string; messages: { role: string; content: unknown }[] }
      const text = (c: unknown): string => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p: { text?: string }) => p.text ?? '').join('') : '')
      sent.push({
        model: body.model,
        system: text(body.messages.find((m) => m.role === 'system')?.content),
        user: text(body.messages.find((m) => m.role === 'user')?.content)
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
})
afterEach(() => {
  stopWaitingPlans()
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
  return { db, scene, before, wren, ash }
}

const OPTIONS: DraftOptions = { targetWords: 300, creativity: 'balanced', direction: '' }
const plans = (): Sent[] => sent.filter((s) => s.system.startsWith(PLAN_MARKER))
const writes = (): Sent[] => sent.filter((s) => s.model === 'fake/writer')

/** Starts the draft as Generate does (ipc/ai.ts startDraft), and waits for it. */
async function draft(db: Database.Database, sceneId: ID, b: DraftBriefing): Promise<void> {
  const events: { name: string; payload: unknown }[] = []
  startDraftJob({
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
  const started = Date.now()
  while (!events.some((e) => e.name === 'generation:done')) {
    if (Date.now() - started > 20_000) throw new Error('the draft never ended')
    await new Promise((r) => setTimeout(r, 5))
  }
}

/** The review as Generate shows it: the plan waits (waitForReview), and `answer` says what Adam does once it is shown. */
function reviewing(sceneId: ID, answer: (r: ScenePlanReview) => void, signal?: AbortSignal) {
  const shown: ScenePlanReview[] = []
  const closed: unknown[] = []
  const review = (made: Parameters<typeof reviewOf>[1], notes: string[]) =>
    waitForReview(reviewOf(sceneId, made, notes, false), signal, (name, payload) => {
      if (name === 'scenePlan:review') {
        shown.push(payload as ScenePlanReview)
        // Adam reads it a moment later.
        setTimeout(() => answer(payload as ScenePlanReview), 0)
      } else closed.push(payload)
    })
  return { review, shown, closed }
}

describe('Show me the plan first', () => {
  it('stops once the scene is planned, with no call of its own, and writes the plan as Adam changed it', async () => {
    const w = world()
    const changed = 'Wren asks the innkeeper for a dry room, and pays in coin she can’t spare.'
    const r = reviewing(w.scene, (rv) => {
      // While it waits, nothing has been written, and the plan can be read again (a window opening now shows it).
      expect(writes()).toHaveLength(0)
      expect(scenePlansWaiting().map((x) => x.reviewId)).toEqual([rv.reviewId])
      answerScenePlan({ reviewId: rv.reviewId, write: true, plan: { ...rv.plan!, beats: [changed, ...rv.plan!.beats.slice(1)] } })
    })
    const b = await draftBriefing(w.scene, OPTIONS, { review: r.review })
    await draft(w.db, w.scene, b)

    // The plan shown: the card's beats as the planner made them (the stranger it added left out by the check), who is
    // where, the turn and the image it ends on.
    expect(r.shown).toHaveLength(1)
    const shown = r.shown[0].plan!
    expect(shown.beats[0]).toMatch(/^Wren and Ash stop for the night at the inn/)
    expect(shown.beats.join(' ')).not.toContain('crossbow')
    expect(shown.wants).toBe('Wren wants a dry bed and no questions.')
    expect(shown.closing).not.toBe('')
    expect(r.closed).toHaveLength(1)
    expect(scenePlansWaiting()).toEqual([])
    // No extra call: the plan's own two (the look-ups, then the plan), then the writer.
    expect(plans()).toHaveLength(2)
    expect(writes()).toHaveLength(1)
    const writer = writes()[0].user
    expect(writer).toContain(PLAN_HEAD)
    const notes = writer.slice(writer.indexOf(PLAN_HEAD))
    expect(notes).toContain(`The beats, in order:\n1. ${changed}`)
    expect(notes).not.toContain('Wren and Ash stop for the night at the inn')
    // The scene's kept plan is Adam's: Continue follows it.
    expect(planForContinueOf(w.scene, repo.getScene(w.db, w.scene).card, '')).toContain(`1. ${changed}`)
  })

  it('writes the plan as made when Adam changes nothing', async () => {
    const w = world()
    const r = reviewing(w.scene, (rv) => answerScenePlan({ reviewId: rv.reviewId, write: true }))
    const b = await draftBriefing(w.scene, OPTIONS, { review: r.review })
    await draft(w.db, w.scene, b)
    expect(writes()[0].user).toContain('The beats, in order:\n1. Wren and Ash stop for the night at the inn')
  })

  it('Cancel writes nothing: the draft ends before it starts', async () => {
    const w = world()
    const r = reviewing(w.scene, (rv) => answerScenePlan({ reviewId: rv.reviewId, write: false }))
    await expect(draftBriefing(w.scene, OPTIONS, { review: r.review })).rejects.toMatchObject({ code: 'cancelled', message: CANCELLED_BEFORE_WRITING })
    expect(writes()).toHaveLength(0)
    expect(scenePlansWaiting()).toEqual([])
  })

  it('Stop while the plan waits ends it, and a late answer is told it isn’t waiting any more', async () => {
    const w = world()
    const stop = new AbortController()
    let late: ScenePlanReview | null = null
    const r = reviewing(
      w.scene,
      (rv) => {
        late = rv
        stop.abort()
      },
      stop.signal
    )
    await expect(draftBriefing(w.scene, OPTIONS, { review: r.review, signal: stop.signal })).rejects.toMatchObject({ code: 'cancelled' })
    expect(writes()).toHaveLength(0)
    expect(() => answerScenePlan({ reviewId: late!.reviewId, write: true })).toThrow(/isn’t waiting for this plan any more/)
  })

  it('shows what the card check noted, which the planner was asked to resolve and the plan’s record keeps', async () => {
    const w = world()
    mem.insertChange(w.db, { entryId: w.ash, anchor: 'scene', sceneId: w.before, kind: 'update', payload: { note: 'died in the river' }, origin: 'text' })
    const r = reviewing(w.scene, (rv) => answerScenePlan({ reviewId: rv.reviewId, write: false }))
    await expect(draftBriefing(w.scene, OPTIONS, { review: r.review })).rejects.toMatchObject({ code: 'cancelled' })
    const note = `${CARD_NOTE} Ash Penrose died in Ch 1, Sc 1, but this scene’s card has Ash Penrose there. The dead may be remembered, talked of or found here, never act.`
    expect(r.shown[0].notes).toEqual([note])
    expect(plans()[0].user).toContain(`- ${note}`)
    const record = w.db.prepare("SELECT id FROM generations WHERE job = 'memory' AND scene_id = ?").get(w.scene) as { id: ID }
    const steps = gens.getGeneration(w.db, record.id).params.steps ?? []
    expect(steps.find((s) => s.label === CARD_CHECK_LABEL)?.result).toBe(`- ${note}`)
  })

  it('a draft that doesn’t ask writes straight on, as before', async () => {
    const w = world()
    const b = await draftBriefing(w.scene, OPTIONS)
    await draft(w.db, w.scene, b)
    expect(plans()).toHaveLength(2)
    expect(writes()).toHaveLength(1)
    expect(h.events.filter((e) => e.name.startsWith('scenePlan:'))).toEqual([])
  })
})

describe('Adam’s changes to a plan, and when a draft shows its plan first', () => {
  const made = () => ({
    ...emptyPlan(),
    point: { wants: 'Mara wants the letter.', against: 'Tobin has it.', turn: 'She takes it.' },
    beats: ['Mara reads the letter.', 'Tobin comes in.', 'They argue.'],
    whoWhere: ['Mara: by the window'],
    changes: ['Mara, holding: nothing → the letter.'],
    closing: 'The letter burning.',
    keep: ['Mara is wearing: grey coat'],
    first: [{ beat: 0, note: 'First Mara must fetch the letter from the study.' }]
  })

  it('takes his words for each part, leaves out empty lines, and keeps what must come first with its beat', () => {
    const p = made()
    const out = changedPlan(p, {
      wants: '  Mara wants it  back. ',
      beats: ['Tobin comes in.', '', 'Mara reads the letter.', 'They argue, and she wins.'],
      whoWhere: ['Mara: by the window', ' '],
      closing: ''
    })
    expect(out.point).toEqual({ wants: 'Mara wants it back.', against: 'Tobin has it.', turn: 'She takes it.' })
    expect(out.beats).toEqual(['Tobin comes in.', 'Mara reads the letter.', 'They argue, and she wins.'])
    expect(out.first).toEqual([{ beat: 1, note: 'First Mara must fetch the letter from the study.' }])
    expect(out.whoWhere).toEqual(['Mara: by the window'])
    expect(out.changes).toEqual(p.changes)
    expect(out.closing).toBe('')
    expect(out.keep).toEqual(p.keep)
    // A beat reworded loses its note: the note was about the words as they were.
    expect(changedPlan(p, { beats: ['Mara skims the letter.'] }).first).toBeUndefined()
  })

  it('holds each list to its most', () => {
    const most: typeof REVIEW_MOST = { line: 400, beats: 12, lines: 10 }
    const out = changedPlan(made(), { beats: Array.from({ length: 20 }, (_, i) => `Beat ${i + 1}.`), changes: Array.from({ length: 20 }, (_, i) => `Change ${i}.`) })
    expect(out.beats).toHaveLength(most.beats)
    expect(out.changes).toHaveLength(most.lines)
  })

  it('shows the plan first for this draft when its options say so, else as Settings say; never with planning off', () => {
    expect(reviewWanted({ showPlan: true }, { showPlanFirst: false })).toBe(true)
    expect(reviewWanted({ showPlan: false }, { showPlanFirst: true })).toBe(false)
    expect(reviewWanted({}, { showPlanFirst: true })).toBe(true)
    expect(reviewWanted(undefined, {})).toBe(false)
    h.planFirst = false
    expect(reviewWanted({ showPlan: true }, { showPlanFirst: true })).toBe(false)
  })

  it('the review says when no plan could be made, with the notes still', () => {
    const r = reviewOf('s1', null, ['Before writing, note: x'], true)
    expect(r).toMatchObject({ sceneId: 's1', carryingOn: true, plan: null, notes: ['Before writing, note: x'], flags: [] })
  })
})
