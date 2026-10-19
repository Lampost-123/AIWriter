// A deleted world goes for good the same time of day 30 calendar days later, by this computer's clock, even across the
// clocks going back (2026-10-20: 30 × 24 hours showed "29 days" for a world deleted just after midnight).
import { describe, expect, it } from 'vitest'
import { purgeAtFor } from './purgeAt'

const dayNumber = (d: Date): number => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000

describe('when a deleted world goes for good', () => {
  for (const at of ['2026-10-19T23:30:00.000Z', '2026-10-20T00:15:00.000Z', '2026-03-28T23:45:00.000Z', '2026-06-01T12:00:00.000Z']) {
    it(`is 30 calendar days later at the same time of day (${at})`, () => {
      const from = new Date(at)
      const to = new Date(purgeAtFor(at))
      expect(dayNumber(to) - dayNumber(from)).toBe(30)
      expect([to.getHours(), to.getMinutes()]).toEqual([from.getHours(), from.getMinutes()])
    })
  }
})
