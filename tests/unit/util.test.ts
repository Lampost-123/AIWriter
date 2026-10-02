import { describe, expect, it, vi } from 'vitest'
import { now, slugify } from '../../src/main/util'

describe('slugify (world folder names)', () => {
  it('never gives a name Windows reserves for a device', () => {
    expect(slugify('Con')).toBe('Con world')
    expect(slugify('nul')).toBe('nul world')
    expect(slugify('COM1')).toBe('COM1 world')
    expect(slugify('LPT9')).toBe('LPT9 world')
    expect(slugify('Aux.')).toBe('Aux world')
    expect(slugify('Console')).toBe('Console')
  })

  it('never ends in a space, even when cut to length', () => {
    const s = slugify('a'.repeat(59) + ' bc')
    expect(s).toBe('a'.repeat(59))
    expect(s.length).toBeLessThanOrEqual(60)
  })

  it('keeps letters in any language', () => {
    expect(slugify('Ærøskøbing')).toBe('Ærøskøbing')
    expect(slugify('Мир')).toBe('Мир')
    expect(slugify('日本の物語')).toBe('日本の物語')
    expect(slugify('Café Noir')).toBe('Café Noir')
  })

  it('drops characters Windows forbids and falls back to World', () => {
    expect(slugify('The North: "Part 1" / <draft>?')).toBe('The North Part 1 draft')
    expect(slugify('  Two   spaces  ')).toBe('Two spaces')
    expect(slugify('!!!')).toBe('World')
    expect(slugify('')).toBe('World')
  })
})

describe('now (the time saves are stamped with)', () => {
  it('never gives the same instant twice, even within one millisecond', () => {
    vi.useFakeTimers({ now: new Date('2026-10-02T12:00:00.000Z') })
    try {
      expect([now(), now(), now()]).toEqual(['2026-10-02T12:00:00.000Z', '2026-10-02T12:00:00.001Z', '2026-10-02T12:00:00.002Z'])
      // The clock catching up takes over again.
      vi.setSystemTime(new Date('2026-10-02T12:00:05.000Z'))
      expect(now()).toBe('2026-10-02T12:00:05.000Z')
      // A clock set back by more than a second is followed.
      vi.setSystemTime(new Date('2026-10-02T11:00:00.000Z'))
      expect(now()).toBe('2026-10-02T11:00:00.000Z')
    } finally {
      vi.useRealTimers()
    }
  })
})
