// Whether a draft plans first: Settings › Models "Plan before writing" (on unless Adam turns it off), AIWRITE_PLAN=off
// for app tests, and no plan (no call) with no memory model or while the month's spending limit has paused the AI. With
// "Write a continuity brief before each scene" (long story memory fix 14), the same call is asked for the brief too:
// off (or AIWRITE_BRIEF=off), or a brief that can't be put together, leaves the plan as it was.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  planFirst: true as boolean | undefined,
  continuityBrief: undefined as boolean | undefined,
  model: { error: 'Choose a writer model first.' } as unknown,
  paused: null as string | null,
  made: 0,
  materials: [] as Record<string, unknown>[],
  briefFails: false
}))

vi.mock('../settings', () => ({ getSettings: () => ({ planFirst: h.planFirst, continuityBrief: h.continuityBrief }) }))
vi.mock('../keeper', () => ({ memoryModel: () => h.model }))
vi.mock('../usage/gate', () => ({ pausedNote: () => h.paused }))
vi.mock('../world', () => ({ maybeCurrentWorld: () => null }))
vi.mock('./plan', () => ({
  PLAN_REPLY_TOKENS: 900,
  planMaterial: () => ({ threads: 'the writer’s few' }),
  planMessages: () => [
    { role: 'system', content: 'plan' },
    { role: 'user', content: 'card' }
  ],
  makePlan: async (o: { material: Record<string, unknown> }) => {
    h.made++
    h.materials.push(o.material)
    return { needs: [], text: 'notes', checked: { corrected: 0, dropped: 0 } }
  }
}))
vi.mock('./brief', () => ({
  BOOK_READER: 200_000,
  BRIEF_REPLY_SHARE: 1.3,
  allOpenThreads: () => 'every open thread',
  briefFrees: () => 0,
  briefRoom: () => ({ book: false, record: 4_000 }),
  briefMaterial: () => {
    if (h.briefFails) throw new Error('The record could not be read.')
    return { book: null, record: [{ title: 'Who knows what, among everyone here', body: '- …' }], late: [], words: 750, tokens: 1_000 }
  }
}))

import { planBeforeWriting, planWanted } from './index'

const was = { plan: process.env.AIWRITE_PLAN, brief: process.env.AIWRITE_BRIEF }
beforeEach(() => {
  delete process.env.AIWRITE_PLAN
  delete process.env.AIWRITE_BRIEF
  h.planFirst = true
  h.continuityBrief = undefined
  h.model = { error: 'Choose a writer model first.' }
  h.paused = null
  h.made = 0
  h.materials = []
  h.briefFails = false
})
afterEach(() => {
  for (const [key, value] of [
    ['AIWRITE_PLAN', was.plan],
    ['AIWRITE_BRIEF', was.brief]
  ] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  vi.restoreAllMocks()
})

const briefing = {
  input: { continuity: null, memory: { entries: [] }, contextLength: 64_000, story: { title: 'The Mill' } },
  preview: { blocks: [], entries: [] },
  prepared: { finals: {} }
} as never
const db = { open: true } as never

describe('plan before writing', () => {
  it('is on unless Adam turns it off; app tests turn it off with AIWRITE_PLAN=off', () => {
    expect(planWanted()).toBe(true)
    h.planFirst = undefined
    expect(planWanted()).toBe(true)
    h.planFirst = false
    expect(planWanted()).toBe(false)
    h.planFirst = true
    process.env.AIWRITE_PLAN = 'off'
    expect(planWanted()).toBe(false)
    process.env.AIWRITE_PLAN = 'on'
    expect(planWanted()).toBe(true)
  })

  it('makes no call when planning is off, there is no memory model, or the AI is paused', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(await planBeforeWriting(db, 's', briefing)).toBeNull()
    h.model = { target: {}, choice: {}, thinking: 'off' }
    h.planFirst = false
    expect(await planBeforeWriting(db, 's', briefing)).toBeNull()
    h.planFirst = true
    h.paused = 'This month’s AI spending has reached your limit.'
    expect(await planBeforeWriting(db, 's', briefing)).toBeNull()
    expect(h.made).toBe(0)
    h.paused = null
    expect(await planBeforeWriting(db, 's', briefing)).toMatchObject({ text: 'notes' })
    expect(h.made).toBe(1)
  })
})

describe('the continuity brief, in the same call (fix 14)', () => {
  beforeEach(() => {
    h.model = { target: {}, choice: { contextLength: 64_000 }, thinking: 'off' }
    // The world's parts the brief reads (the book so far, the chapters, the rule checks' findings) can't be read from this
    // stand-in database: each is left out, with a warning.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  it('is asked for unless Adam turns it off: the planner then reads every open plot thread and the record', async () => {
    await planBeforeWriting(db, 's', briefing)
    expect(h.made).toBe(1)
    expect(h.materials[0]).toMatchObject({ threads: 'every open thread', brief: { words: 750, tokens: 1_000 } })
  })

  it('off in Settings, or AIWRITE_BRIEF=off, the plan is asked for exactly as before', async () => {
    h.continuityBrief = false
    await planBeforeWriting(db, 's', briefing)
    process.env.AIWRITE_BRIEF = 'off'
    h.continuityBrief = true
    await planBeforeWriting(db, 's', briefing)
    expect(h.materials).toEqual([{ threads: 'the writer’s few' }, { threads: 'the writer’s few' }])
  })

  it('a brief that cannot be put together leaves the plan as it was, and still makes it', async () => {
    h.briefFails = true
    expect(await planBeforeWriting(db, 's', briefing)).toMatchObject({ text: 'notes' })
    expect(h.materials).toEqual([{ threads: 'the writer’s few' }])
  })
})
