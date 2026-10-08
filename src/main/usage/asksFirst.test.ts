// The window's AI actions that ask first while this month's spending limit holds AI calls (usage/index.ts ASKS_FIRST).
import { describe, expect, it } from 'vitest'
import { ASKS_FIRST } from './index'

describe('asking first at the spending limit', () => {
  it('includes re-reading a scene or a story (World Memory Overhaul B8)', () => {
    expect(ASKS_FIRST.has('startReread')).toBe(true)
    expect(ASKS_FIRST.has('checkMemoryAgain')).toBe(true)
  })
})
