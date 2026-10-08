import { afterEach, describe, expect, it } from 'vitest'
import { installInputModality, keyboardDriven } from './motion'

/** A key press as the window sees it (plain Events: the unit tests have no DOM). */
const keydown = (key: string): Event => Object.assign(new Event('keydown'), { key })

describe('the New look: keyboard or pointer', () => {
  let off = (): void => undefined
  afterEach(() => off())

  it('a key press makes the next change keyboard-driven, and a click makes it pointer-driven again', () => {
    const target = new EventTarget()
    off = installInputModality(target)
    target.dispatchEvent(keydown('a'))
    expect(keyboardDriven()).toBe(true)
    target.dispatchEvent(new Event('pointerdown'))
    expect(keyboardDriven()).toBe(false)
    target.dispatchEvent(keydown('Enter'))
    expect(keyboardDriven()).toBe(true)
  })

  it('holding Ctrl or Shift for a click is not using the keyboard', () => {
    const target = new EventTarget()
    off = installInputModality(target)
    target.dispatchEvent(new Event('pointerdown'))
    for (const key of ['Control', 'Shift', 'Alt', 'Meta']) target.dispatchEvent(keydown(key))
    expect(keyboardDriven()).toBe(false)
  })

  it('stops listening once cleaned up', () => {
    const target = new EventTarget()
    installInputModality(target)()
    off = installInputModality(new EventTarget())
    target.dispatchEvent(new Event('pointerdown'))
    target.dispatchEvent(keydown('a'))
    expect(keyboardDriven()).toBe(false)
  })
})
