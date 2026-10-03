import { describe, expect, it } from 'vitest'
import { canFocus, escLeaves, layoutToRestore, mustLeave, panelsOf, type EscPress } from './focusLogic'

const layout = { binderOpen: true, binderWidth: 280, inspectorOpen: false, inspectorWidth: 360 }

describe('focus mode: when it can start and must end', () => {
  it('starts with a scene open in a world, from any page (it goes back to the writing page)', () => {
    expect(canFocus({ view: 'write', sceneId: 's1', hasWorld: true })).toBe(true)
    expect(canFocus({ view: 'codex', sceneId: 's1', hasWorld: true })).toBe(true)
    expect(canFocus({ view: 'write', sceneId: null, hasWorld: true })).toBe(false)
    expect(canFocus({ view: 'write', sceneId: 's1', hasWorld: false })).toBe(false)
  })

  it('ends when the writing page goes: another page, no scene, or the world closed', () => {
    expect(mustLeave({ view: 'write', sceneId: 's1', hasWorld: true })).toBe(false)
    // Another scene (opened from the palette's search) keeps it.
    expect(mustLeave({ view: 'write', sceneId: 's2', hasWorld: true })).toBe(false)
    expect(mustLeave({ view: 'settings', sceneId: 's1', hasWorld: true })).toBe(true)
    expect(mustLeave({ view: 'write', sceneId: null, hasWorld: true })).toBe(true)
    expect(mustLeave({ view: 'write', sceneId: 's1', hasWorld: false })).toBe(true)
  })
})

describe('focus mode: the panels come back exactly as they were', () => {
  it('keeps the panels part of the layout', () => {
    expect(panelsOf(layout)).toEqual(layout)
  })

  it('puts nothing back when nothing changed', () => {
    expect(layoutToRestore(panelsOf(layout), { ...layout })).toBeNull()
    expect(layoutToRestore(null, layout)).toBeNull()
    expect(layoutToRestore(panelsOf(layout), null)).toBeNull()
  })

  it('puts back what changed inside it (Ask the world opened the scene panel, which was dragged wider)', () => {
    const now = { ...layout, inspectorOpen: true, inspectorWidth: 480 }
    expect(layoutToRestore(panelsOf(layout), now)).toEqual({ inspectorOpen: false, inspectorWidth: 360 })
  })

  it('puts back the binder too, if the palette hid it meanwhile', () => {
    expect(layoutToRestore(panelsOf(layout), { ...layout, binderOpen: false })).toEqual({ binderOpen: true })
  })
})

describe('focus mode: Esc', () => {
  const press = (over: Partial<EscPress> = {}): EscPress => ({
    handled: false,
    composing: false,
    inPageOrNowhere: true,
    layerOpen: false,
    drafting: false,
    ...over
  })

  it('leaves from the page, or with the keyboard nowhere in particular', () => {
    expect(escLeaves(press())).toBe(true)
  })

  it('does one thing at a time: a menu, a card or a dialog closes first', () => {
    expect(escLeaves(press({ layerOpen: true }))).toBe(false)
  })

  it('stops a draft or a beat being written first (as Stop says), and leaves on the next press', () => {
    expect(escLeaves(press({ drafting: true }))).toBe(false)
    expect(escLeaves(press({ drafting: false }))).toBe(true)
  })

  it('leaves an Esc that something already used alone (the selection bar, the AI’s change, a field)', () => {
    expect(escLeaves(press({ handled: true }))).toBe(false)
  })

  it('belongs to the box or panel it was pressed in (Ask the world, a name beside the page)', () => {
    expect(escLeaves(press({ inPageOrNowhere: false }))).toBe(false)
  })

  it('is part of typing while composing an accent', () => {
    expect(escLeaves(press({ composing: true }))).toBe(false)
  })
})
