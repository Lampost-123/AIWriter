// Whether a draft plans first: Settings › Models "Plan before writing" (on unless Adam turns it off), AIWRITE_PLAN=off
// for app tests, and no plan (no call) with no memory model or while the month's spending limit has paused the AI.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  planFirst: true as boolean | undefined,
  model: { error: 'Choose a writer model first.' } as unknown,
  paused: null as string | null,
  made: 0
}))

vi.mock('../settings', () => ({ getSettings: () => ({ planFirst: h.planFirst }) }))
vi.mock('../keeper', () => ({ memoryModel: () => h.model }))
vi.mock('../usage/gate', () => ({ pausedNote: () => h.paused }))
vi.mock('../world', () => ({ maybeCurrentWorld: () => null }))
vi.mock('./plan', () => ({
  planMaterial: () => ({}),
  makePlan: async () => {
    h.made++
    return { needs: [], text: 'notes', checked: { corrected: 0, dropped: 0 } }
  }
}))

import { planBeforeWriting, planWanted } from './index'

const was = process.env.AIWRITE_PLAN
beforeEach(() => {
  delete process.env.AIWRITE_PLAN
  h.planFirst = true
  h.model = { error: 'Choose a writer model first.' }
  h.paused = null
  h.made = 0
})
afterEach(() => {
  if (was === undefined) delete process.env.AIWRITE_PLAN
  else process.env.AIWRITE_PLAN = was
})

const briefing = { input: { continuity: null, memory: { entries: [] } }, preview: { blocks: [], entries: [] }, prepared: { finals: {} } } as never
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
