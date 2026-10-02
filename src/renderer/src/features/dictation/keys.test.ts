import { describe, expect, it } from 'vitest'
import { isDictationKey, isModifierKey, keptKey, keyName, pressedAlone, refusal, type KeyEventLike } from './keys'

const ev = (key: string, code: string, mods: Partial<KeyEventLike> = {}): KeyEventLike => ({
  key,
  code,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods
})

describe('keeping the dictation key', () => {
  it('keeps Ctrl, Shift and Alt keys by side, so left and right differ', () => {
    expect(keptKey(ev('Control', 'ControlRight'))).toBe('ControlRight')
    expect(keptKey(ev('Control', 'ControlLeft'))).toBe('ControlLeft')
    expect(keptKey(ev('Shift', 'ShiftLeft'))).toBe('ShiftLeft')
    expect(keptKey(ev('AltGraph', 'AltRight'))).toBe('AltRight')
  })

  it('keeps any other key by what it is', () => {
    expect(keptKey(ev('F9', 'F9'))).toBe('F9')
    expect(keptKey(ev('Insert', 'Numpad0'))).toBe('Insert')
    expect(keptKey(ev('ContextMenu', 'ContextMenu'))).toBe('ContextMenu')
  })

  it('knows which keys only count when pressed on their own', () => {
    expect(isModifierKey('ControlRight')).toBe(true)
    expect(isModifierKey('AltLeft')).toBe(true)
    expect(isModifierKey('F9')).toBe(false)
    expect(isModifierKey('Control')).toBe(false)
  })
})

describe('matching the dictation key', () => {
  it('matches a Ctrl, Shift or Alt key by its side', () => {
    expect(isDictationKey(ev('Control', 'ControlRight'), 'ControlRight')).toBe(true)
    expect(isDictationKey(ev('Control', 'ControlLeft'), 'ControlRight')).toBe(false)
    expect(isDictationKey(ev('Shift', 'ShiftRight'), 'ShiftLeft')).toBe(false)
  })

  it('matches any other key by what it is, wherever it is', () => {
    expect(isDictationKey(ev('F9', 'F9'), 'F9')).toBe(true)
    expect(isDictationKey(ev('F8', 'F8'), 'F9')).toBe(false)
    expect(isDictationKey(ev('Insert', 'Numpad0'), 'Insert')).toBe(true)
  })

  it('matches nothing when no key is picked', () => {
    expect(isDictationKey(ev('Control', 'ControlRight'), '')).toBe(false)
    expect(isDictationKey(ev('', ''), '')).toBe(false)
  })
})

describe('a Ctrl, Shift or Alt key used for dictation counts only on its own', () => {
  it('counts the key pressed alone', () => {
    expect(pressedAlone(ev('Control', 'ControlRight', { ctrlKey: true }), 'ControlRight')).toBe(true)
    expect(pressedAlone(ev('Shift', 'ShiftLeft', { shiftKey: true }), 'ShiftLeft')).toBe(true)
    expect(pressedAlone(ev('Alt', 'AltLeft', { altKey: true }), 'AltLeft')).toBe(true)
    expect(pressedAlone(ev('F9', 'F9'), 'F9')).toBe(true)
  })

  it("doesn't count it pressed with another Ctrl, Shift, Alt or Windows key", () => {
    expect(pressedAlone(ev('Control', 'ControlRight', { ctrlKey: true, shiftKey: true }), 'ControlRight')).toBe(false)
    expect(pressedAlone(ev('Shift', 'ShiftLeft', { shiftKey: true, ctrlKey: true }), 'ShiftLeft')).toBe(false)
    expect(pressedAlone(ev('Alt', 'AltLeft', { altKey: true, ctrlKey: true }), 'AltLeft')).toBe(false)
    expect(pressedAlone(ev('Control', 'ControlRight', { ctrlKey: true, metaKey: true }), 'ControlRight')).toBe(false)
    expect(pressedAlone(ev('F9', 'F9', { ctrlKey: true }), 'F9')).toBe(false)
  })

  it('counts Right Alt as AltGr, which comes with a left Ctrl of its own', () => {
    expect(pressedAlone(ev('AltGraph', 'AltRight', { altKey: true, ctrlKey: true }), 'AltRight')).toBe(true)
    expect(pressedAlone(ev('AltGraph', 'AltRight', { altKey: true, ctrlKey: true, shiftKey: true }), 'AltRight')).toBe(false)
  })
})

describe('picking the dictation key', () => {
  it('takes keys nobody types with', () => {
    for (const key of ['F9', 'F8', 'F1', 'F24', 'ControlRight', 'AltRight', 'ShiftLeft', 'Insert', 'Pause', 'ScrollLock', 'ContextMenu']) {
      expect(refusal(key), key).toBeNull()
    }
  })

  it('says in plain words why a key used for writing is refused', () => {
    expect(refusal('a')).toMatch(/^That key types/)
    expect(refusal('7')).toMatch(/^That key types/)
    expect(refusal('`')).toMatch(/^That key types/)
    expect(refusal(' ')).toMatch(/^Space is for typing/)
    for (const key of ['Enter', 'Tab', 'Backspace', 'Delete', 'ArrowLeft', 'Home', 'PageDown'])
      expect(refusal(key)).toMatch(/for writing and moving the cursor/)
    expect(refusal('CapsLock')).toMatch(/changes how the keyboard types/)
  })

  it("refuses keys that belong to Windows or to the app's own shortcuts", () => {
    expect(refusal('Meta')).toMatch(/belongs to Windows/)
    expect(refusal('PrintScreen')).toMatch(/belongs to Windows/)
    expect(refusal('AudioVolumeUp')).toMatch(/belongs to Windows/)
    expect(refusal('F2')).toMatch(/renames chapters and scenes/)
    expect(refusal('F11')).toMatch(/focus mode/)
    // The window keeps F5 (reload) and F12 (developer tools) from ever reaching the page.
    expect(refusal('F5')).toMatch(/keeps F5 to itself/)
    expect(refusal('F12')).toMatch(/keeps F12 to itself/)
    expect(refusal('Unidentified')).toMatch(/can't tell that key apart/)
  })

  it('suggests keys that work', () => {
    expect(refusal('a')).toContain('F9, Right Ctrl or Right Alt')
  })
})

describe("the key's name", () => {
  it('names keys for Windows', () => {
    expect(keyName('ControlRight')).toBe('Right Ctrl')
    expect(keyName('ShiftLeft')).toBe('Left Shift')
    expect(keyName('AltRight')).toBe('Right Alt')
    expect(keyName('F9')).toBe('F9')
    expect(keyName('ContextMenu')).toBe('Menu key')
    expect(keyName('ScrollLock')).toBe('Scroll Lock')
    expect(keyName('')).toBe('')
  })

  it('names Ctrl and Alt the Mac way on a Mac', () => {
    expect(keyName('ControlRight', true)).toBe('Right Control')
    expect(keyName('AltLeft', true)).toBe('Left Option')
    expect(keyName('ShiftRight', true)).toBe('Right Shift')
  })
})
