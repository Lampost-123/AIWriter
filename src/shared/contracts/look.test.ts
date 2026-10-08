import { describe, expect, it } from 'vitest'
import { ARRANGEMENTS, arrangementNoteDue, arrangementOf, lookNoteDue, lookOf } from './look'

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

describe('the New look’s two layouts', () => {
  it('is the desk unless the panels are asked for', () => {
    expect(ARRANGEMENTS).toEqual(['desk', 'panels'])
    expect(arrangementOf('panels')).toBe('panels')
    expect(arrangementOf('desk')).toBe('desk')
    for (const other of [undefined, null, '', 'Panels', 'rail', 0, {}]) expect(arrangementOf(other)).toBe('desk')
  })

  it('tells someone already on the New look about the desk once', () => {
    // A fresh install, and settings from before the New look (they get the New look's own note): no desk note.
    expect(arrangementNoteDue(null)).toBe(false)
    expect(arrangementNoteDue({})).toBe(false)
    expect(arrangementNoteDue({ theme: 'dark' })).toBe(false)
    // On the New look with no layout yet: the note is due.
    expect(arrangementNoteDue({ look: 'new' })).toBe(true)
    expect(arrangementNoteDue({ look: 'new', theme: 'sepia', layout: { binderOpen: true } })).toBe(true)
    // Classic never sees the desk.
    expect(arrangementNoteDue({ look: 'classic' })).toBe(false)
    // Once a layout has been kept (chosen, or the note answered), never again.
    expect(arrangementNoteDue({ look: 'new', arrangement: 'panels' })).toBe(false)
    expect(arrangementNoteDue({ look: 'new', arrangement: 'desk' })).toBe(false)
  })
})
