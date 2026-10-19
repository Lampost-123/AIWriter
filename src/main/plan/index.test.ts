// Whether a draft plans first: Settings › Models "Plan before writing" (on unless Adam turns it off), AIWRITE_PLAN=off
// for app tests, and no plan (no call) with no memory model or while the month's spending limit has paused the AI. With
// "Write a continuity brief before each scene" (long story memory fix 14), the same call is asked for the brief too:
// off (or AIWRITE_BRIEF=off), or a brief that can't be put together, leaves the plan as it was. Beat by beat plans the
// scene once (Adam's spec, 2026-10-19): its later beats get that plan and its brief with no call, while the card and the
// direction read the same; Continue gets the scene's last plan while its words haven't moved on too far.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  planFirst: true as boolean | undefined,
  continuityBrief: undefined as boolean | undefined,
  model: { error: 'Choose a writer model first.' } as unknown,
  paused: null as string | null,
  made: 0,
  materials: [] as Record<string, unknown>[],
  beats: [] as unknown[],
  briefFails: false,
  /** The plan's reply: a brief when one was asked for, unless this says not. */
  writesBrief: true,
  /** The plan's call says nothing usable. */
  nothing: false,
  replies: 0,
  db: { open: true }
}))

vi.mock('../settings', () => ({ getSettings: () => ({ planFirst: h.planFirst, continuityBrief: h.continuityBrief }) }))
vi.mock('../keeper', () => ({ memoryModel: () => h.model }))
vi.mock('../usage/gate', () => ({ pausedNote: () => h.paused }))
vi.mock('../world', () => ({ maybeCurrentWorld: () => ({ db: h.db }) }))
vi.mock('../retrieval', () => ({ findInStory: async () => null }))
vi.mock('./core', () => ({ planCore: () => null }))
vi.mock('./plan', () => ({
  PLAN_REPLY_TOKENS: 900,
  planMaterial: () => ({ threads: 'the writer’s few', people: ['Osric'], pov: 'Wren' }),
  planMessages: () => [
    { role: 'system', content: 'plan' },
    { role: 'user', content: 'card' }
  ],
  planText: (_p: unknown, carryingOn: boolean, o: { beat?: { index: number } }) => `notes for beat ${o.beat?.index}${carryingOn ? ', carrying on' : ''}`,
  planForContinue: (p: { beats: string[] }, pov: string) => `${pov}'s plan: ${p.beats.join('; ')}`,
  makePlan: async (o: { material: Record<string, unknown>; beat?: unknown }) => {
    h.made++
    h.materials.push(o.material)
    h.beats.push(o.beat)
    if (h.nothing) return null
    const n = ++h.replies
    return {
      needs: [],
      text: 'notes',
      must: ['Osric reaches the loft'],
      checked: { corrected: 0, dropped: 0 },
      plan: { beats: [`Plan ${n}`] },
      ...(o.material.brief && h.writesBrief ? { brief: { parts: { keep: [`Brief ${n}.`] } } } : {})
    }
  }
}))
vi.mock('./brief', () => ({
  BOOK_MOST: 150_000,
  BOOK_READER: 200_000,
  BOOK_SHARE: 0.5,
  BRIEF_REPLY_SHARE: 1.3,
  WHOLE_SHARE: 0.9,
  bookPart: () => '',
  bookWithin: () => null,
  planThreads: () => 'the open threads the memory model has room for',
  briefFrees: () => ({ always: 0, knows: 0 }),
  briefRoom: () => ({ book: false, record: 4_000 }),
  briefMaterial: () => {
    if (h.briefFails) throw new Error('The record could not be read.')
    return {
      book: null,
      record: [{ title: 'Who knows what, among everyone here', body: '- Wren knows the tax was forged.' }],
      late: [],
      words: 750,
      tokens: 1_000
    }
  }
}))

import { forgetScenePlans, planBeforeWriting, planForContinueOf, planWanted } from './index'

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
  h.beats = []
  h.briefFails = false
  h.writesBrief = true
  h.nothing = false
  h.replies = 0
  forgetScenePlans()
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

const card = { beats: ['Osric climbs up', 'They argue'], when: 'Day 3', presentIds: [] }
const soFarBlock = { id: 'scene-so-far', dropped: false }
const briefing = (o: { direction?: string; when?: string; soFar?: string } = {}) =>
  ({
    input: {
      continuity: null,
      memory: { entries: [], facts: [], relationships: [], storyId: 'story' },
      contextLength: 64_000,
      story: { title: 'The Mill' },
      scene: { title: 'The hatch', card: { ...card, when: o.when ?? card.when } },
      options: { direction: o.direction ?? '', targetWords: 400 },
      style: {},
      ...(o.soFar ? { soFar: o.soFar } : {})
    },
    preview: { blocks: o.soFar ? [soFarBlock] : [], entries: [] },
    prepared: { finals: {} }
  }) as never
const db = h.db as never

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
    expect(await planBeforeWriting(db, 's', briefing())).toBeNull()
    h.model = { target: {}, choice: {}, thinking: 'off' }
    h.planFirst = false
    expect(await planBeforeWriting(db, 's', briefing())).toBeNull()
    h.planFirst = true
    h.paused = 'This month’s AI spending has reached your limit.'
    expect(await planBeforeWriting(db, 's', briefing())).toBeNull()
    expect(h.made).toBe(0)
    h.paused = null
    expect(await planBeforeWriting(db, 's', briefing())).toMatchObject({ text: 'notes' })
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

  it('is asked for unless Adam turns it off: the planner then reads the open threads it has room for and the record', async () => {
    await planBeforeWriting(db, 's', briefing())
    expect(h.made).toBe(1)
    expect(h.materials[0]).toMatchObject({
      threads: 'the open threads the memory model has room for',
      brief: { words: 750, tokens: 1_000 }
    })
  })

  it('off in Settings, or AIWRITE_BRIEF=off, the plan is asked for without one', async () => {
    h.continuityBrief = false
    await planBeforeWriting(db, 's', briefing())
    process.env.AIWRITE_BRIEF = 'off'
    h.continuityBrief = true
    await planBeforeWriting(db, 's', briefing())
    for (const m of h.materials) expect(m).toMatchObject({ threads: 'the writer’s few' })
    expect(h.materials.some((m) => 'brief' in m)).toBe(false)
  })

  it('is never asked for when the draft says not (Write the whole chapter: its study wrote one), the plan still made', async () => {
    expect(await planBeforeWriting(db, 's', briefing(), undefined, { brief: false })).toMatchObject({ text: 'notes' })
    expect(h.materials[0]).not.toHaveProperty('brief')
  })

  it('a brief that cannot be put together leaves the plan as it was, and still makes it', async () => {
    h.briefFails = true
    expect(await planBeforeWriting(db, 's', briefing())).toMatchObject({ text: 'notes' })
    expect(h.materials[0]).not.toHaveProperty('brief')
  })
})

describe('Beat by beat plans the scene once (2026-10-19)', () => {
  beforeEach(() => {
    h.model = { target: {}, choice: { contextLength: 64_000 }, thinking: 'off' }
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  const beat = (index: number, o: Parameters<typeof briefing>[0] = {}, sceneId = 's') =>
    planBeforeWriting(db, sceneId, briefing({ soFar: index > 1 ? 'The ladder creaked.' : undefined, ...o }), undefined, { beat: { index, of: 3 } })

  it('the first beat’s plan is the scene’s, with its brief; the later beats get it with no call, their notes for their beat', async () => {
    const one = await beat(1)
    expect(h.made).toBe(1)
    expect(h.beats).toEqual([{ index: 1, of: 3 }])
    expect(one).toMatchObject({ text: 'notes', brief: { parts: { keep: ['Brief 1.'] } } })
    const two = await beat(2)
    const three = await beat(3)
    expect(h.made).toBe(1)
    expect(two).toMatchObject({ text: 'notes for beat 2, carrying on', brief: { parts: { keep: ['Brief 1.'] } }, must: [] })
    expect(three?.text).toBe('notes for beat 3, carrying on')
  })

  it('plans again once the card or the direction reads otherwise, or the scene starts again at beat 1; another scene its own', async () => {
    await beat(1)
    await beat(2, { when: 'Day 4' })
    expect(h.made).toBe(2)
    await beat(3, { when: 'Day 4' })
    expect(h.made).toBe(2)
    await beat(3, { when: 'Day 4', direction: 'Make it quieter.' })
    expect(h.made).toBe(3)
    await beat(1, { when: 'Day 4', direction: 'Make it quieter.' })
    expect(h.made).toBe(4)
    await beat(2, {}, 'other')
    expect(h.made).toBe(5)
    // Generate and Add below (no beat): a plan for each draft, as ever.
    await planBeforeWriting(db, 's', briefing())
    expect(h.made).toBe(6)
  })

  it('no plan made (the call said nothing usable): the next beat tries again', async () => {
    h.nothing = true
    expect(await beat(1)).toBeNull()
    h.nothing = false
    expect(await beat(2)).toMatchObject({ text: 'notes' })
    expect(h.made).toBe(2)
  })
})

describe('Continue gets the scene’s last plan, with no call', () => {
  beforeEach(() => {
    h.model = { target: {}, choice: { contextLength: 64_000 }, thinking: 'off' }
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  const words = (n: number): number => n

  it('while the words before the cursor are within what the plan was for, and the card is as it was', async () => {
    expect(planForContinueOf('s', card as never, 10)).toBe('')
    await planBeforeWriting(db, 's', briefing())
    // A whole scene of 400 words: until 600 words in.
    expect(planForContinueOf('s', card as never, words(0))).toBe("Wren's plan: Plan 1")
    expect(planForContinueOf('s', card as never, words(600))).toBe("Wren's plan: Plan 1")
    expect(planForContinueOf('s', card as never, words(601))).toBe('')
    expect(planForContinueOf('s', { ...card, when: 'Day 9' } as never, words(10))).toBe('')
    expect(planForContinueOf('other', card as never, words(10))).toBe('')
    // Plan before writing off: none.
    h.planFirst = false
    expect(planForContinueOf('s', card as never, words(10))).toBe('')
  })

  it('never before where the plan began (a stretch planned further on)', async () => {
    await planBeforeWriting(db, 's', briefing({ soFar: Array.from({ length: 300 }, () => 'word').join(' ') }))
    expect(planForContinueOf('s', card as never, 299)).toBe('')
    expect(planForContinueOf('s', card as never, 500)).toBe("Wren's plan: Plan 1")
  })
})
