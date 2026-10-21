import { describe, expect, it } from 'vitest'
import { lastCheckWords } from './lastCheckWords'

describe('when the story was last checked', () => {
  const at = new Date(2026, 9, 21, 14, 5).getTime()
  it('says just now, then minutes, then the time', () => {
    expect(lastCheckWords({ at, scenes: 4 }, at + 20_000)).toBe('Checked just now · 4 scenes')
    expect(lastCheckWords({ at, scenes: 1 }, at + 60_000)).toBe('Checked 1 minute ago · 1 scene')
    expect(lastCheckWords({ at, scenes: 12 }, at + 5 * 60_000)).toBe('Checked 5 minutes ago · 12 scenes')
    expect(lastCheckWords({ at, scenes: 3 }, at + 2 * 3_600_000)).toBe('Checked at 14:05 · 3 scenes')
  })
  it('leaves the scenes out when it doesn’t know them', () => {
    expect(lastCheckWords({ at, scenes: 0 }, at)).toBe('Checked just now')
  })
})
