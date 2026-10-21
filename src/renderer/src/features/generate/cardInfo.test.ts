// Only the answer for the scene still open counts (review #16, 2026-10-21): a late card for the scene left is dropped.
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', () => ({ api: {} }))

import { latestOnly } from './cardInfo'

describe('latest answer only', () => {
  it('drops an answer that arrives after a newer request', () => {
    const asks = latestOnly()
    const old = asks.next()
    const now = asks.next()
    expect(asks.isLatest(old)).toBe(false)
    expect(asks.isLatest(now)).toBe(true)
  })
  it('drops every answer once the scene is left', () => {
    const asks = latestOnly()
    const one = asks.next()
    asks.drop()
    expect(asks.isLatest(one)).toBe(false)
  })
})
