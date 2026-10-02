import { describe, expect, it } from 'vitest'
import { slugify } from '../../src/main/util'

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
