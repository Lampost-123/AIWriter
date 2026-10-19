import { describe, expect, it } from 'vitest'
import { ARRANGEMENTS, arrangementNoteDue, arrangementOf, classicNoteDue, lookNoteDue, lookOf } from './look'

describe('the look (Classic retired)', () => {
  it('is always the New look, even where Classic is kept', () => {
    for (const kept of ['classic', 'new', undefined, null, '', 'Classic', 'old', 3, {}]) expect(lookOf(kept)).toBe('new')
  })

  it('tells someone who used AI Write before the New look about it once', () => {
    // A fresh install: no settings yet, nothing to compare the New look with.
    expect(lookNoteDue(null)).toBe(false)
    // Settings from before the New look: never a look in them.
    expect(lookNoteDue({})).toBe(true)
    expect(lookNoteDue({ theme: 'dark', accent: 'teal' })).toBe(true)
    // Once a look has been kept, never again.
    expect(lookNoteDue({ look: 'new' })).toBe(false)
    expect(lookNoteDue({ look: 'classic', theme: 'sepia' })).toBe(false)
  })

  it('tells someone still on Classic, once, that it has been retired', () => {
    expect(classicNoteDue(null)).toBe(false)
    expect(classicNoteDue({})).toBe(false)
    expect(classicNoteDue({ look: 'new' })).toBe(false)
    expect(classicNoteDue({ look: 'classic' })).toBe(true)
    expect(classicNoteDue({ look: 'classic', theme: 'sepia', arrangement: 'panels' })).toBe(true)
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
    // Someone moved from Classic gets the note about Classic instead.
    expect(arrangementNoteDue({ look: 'classic' })).toBe(false)
    // Once a layout has been kept (chosen, or the note answered), never again.
    expect(arrangementNoteDue({ look: 'new', arrangement: 'panels' })).toBe(false)
    expect(arrangementNoteDue({ look: 'new', arrangement: 'desk' })).toBe(false)
  })
})
