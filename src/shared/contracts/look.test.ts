import { describe, expect, it } from 'vitest'
import { lookNoteDue, lookOf } from './look'

describe('the two looks', () => {
  it('is the New look unless Classic is asked for', () => {
    expect(lookOf('classic')).toBe('classic')
    expect(lookOf('new')).toBe('new')
    for (const other of [undefined, null, '', 'Classic', 'old', 3, {}]) expect(lookOf(other)).toBe('new')
  })

  it('offers Classic once, only to someone who used AI Write before the New look', () => {
    // A fresh install: no settings yet, nothing to compare the New look with.
    expect(lookNoteDue(null)).toBe(false)
    // Settings from before the New look: never a look in them.
    expect(lookNoteDue({})).toBe(true)
    expect(lookNoteDue({ theme: 'dark', accent: 'teal' })).toBe(true)
    // Once a look has been kept (chosen, or the note answered), never again.
    expect(lookNoteDue({ look: 'new' })).toBe(false)
    expect(lookNoteDue({ look: 'classic', theme: 'sepia' })).toBe(false)
  })
})
