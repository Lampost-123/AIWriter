// The hold-to-talk key (milestone 4, dictation): how a key is kept, named, matched and picked. Ctrl, Shift
// and Alt keys are kept by where they are (KeyboardEvent.code, 'ControlRight'), so the left and right ones
// differ; any other key by what it is (KeyboardEvent.key, 'F9'). Pure.

/** The parts of a key event that matter here. */
export interface KeyEventLike {
  key: string
  code: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

const MODIFIER = /^(?:Control|Shift|Alt)(?:Left|Right)$/

/** True for a Ctrl, Shift or Alt key, which only starts dictation when pressed on its own. */
export const isModifierKey = (key: string): boolean => MODIFIER.test(key)

/** How a key is kept in Settings: the code for Ctrl, Shift and Alt keys, the key for any other. */
export const keptKey = (e: Pick<KeyEventLike, 'key' | 'code'>): string => (MODIFIER.test(e.code) ? e.code : e.key)

/** True when this event (down or up) is the dictation key. */
export function isDictationKey(e: Pick<KeyEventLike, 'key' | 'code'>, chosen: string): boolean {
  if (!chosen) return false
  return isModifierKey(chosen) ? e.code === chosen : e.key === chosen
}

/**
 * True when the dictation key went down on its own, with no other Ctrl, Shift, Alt or Windows key held
 * (Ctrl+C stays a copy). Right Alt is AltGr on many keyboards, which comes with a left Ctrl of its own.
 */
export function pressedAlone(e: KeyEventLike, chosen: string): boolean {
  const own = (side: 'Control' | 'Shift' | 'Alt'): boolean => chosen.startsWith(side)
  const altGr = chosen === 'AltRight'
  return (!e.ctrlKey || own('Control') || altGr) && (!e.shiftKey || own('Shift')) && (!e.altKey || own('Alt')) && !e.metaKey
}

/** Keys that are part of writing and moving about, so holding one for dictation would get in the way. */
const WRITING_KEYS = new Set([
  'Enter',
  'Tab',
  'Backspace',
  'Delete',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown'
])
const LOCK_KEYS = new Set(['CapsLock', 'NumLock', 'FnLock', 'Fn'])
/** Keys the window keeps to itself (reload, the developer tools): they reach the page coming up, never going down. */
export const KEPT_BY_WINDOW = new Set(['F5', 'F12'])
/** The keys that work a button that has the keyboard: Enter and Space. */
export const BUTTON_KEYS = new Set(['Enter', ' '])
const UNKNOWN = new Set(['Unidentified', 'Dead', 'Process', 'Compose', 'AltGraph'])
/** A key's name kept on one line where the words around it wrap: "Right Ctrl", never "Right" then "Ctrl". */
const whole = (name: string): string => name.replace(/ /g, '\u00a0')

/** Good keys to pick, by the names they have on this computer (a Mac's keyboard has Option, not Alt). */
export const suggestKeys = (mac = false): string =>
  mac ? `such as F9 or ${whole('Right Option')}` : `such as F9, ${whole('Right Ctrl')} or ${whole('Right Alt')}`

/** The Windows key (the Command key on a Mac): a key of its own, though it comes with metaKey set. */
export const isSystemKey = (key: string): boolean => key === 'Meta' || key === 'OS'

/** Why a key can't be the dictation key, in plain words; null when it can. Esc is never asked about: it clears. */
export function refusal(key: string, mac = false): string | null {
  const suggest = suggestKeys(mac)
  if (key === ' ') return `Space is for typing, so it can't be the dictation key. Pick a key you don't type with, ${suggest}.`
  if (key.length === 1) return `That key types, so it can't be the dictation key. Pick a key you don't type with, ${suggest}.`
  if (WRITING_KEYS.has(key)) return `That key is for writing and moving the cursor. Pick another, ${suggest}.`
  if (LOCK_KEYS.has(key)) return `That key changes how the keyboard types. Pick another, ${suggest}.`
  if (isSystemKey(key) || key === 'PrintScreen' || /^(?:Audio|Media|Launch|Browser|Brightness)/.test(key)) {
    return `That key belongs to ${mac ? 'macOS' : 'Windows'}. Pick another, ${suggest}.`
  }
  if (KEPT_BY_WINDOW.has(key)) return `AI Write keeps ${key} to itself, so it can't be the dictation key. Pick another, ${suggest}.`
  if (key === 'F2') return `F2 renames chapters and scenes in the binder. Pick another, ${suggest}.`
  if (key === 'F11') return `F11 is kept for focus mode, which comes in a later update. Pick another, ${suggest}.`
  if (UNKNOWN.has(key)) return `AI Write can't tell that key apart from others. Pick another, ${suggest}.`
  return null
}

/** The Menu key: as the dictation key, the menu it would open is kept shut. */
export const MENU_KEY = 'ContextMenu'

const NAMES: Record<string, string> = {
  ControlLeft: 'Left Ctrl',
  ControlRight: 'Right Ctrl',
  ShiftLeft: 'Left Shift',
  ShiftRight: 'Right Shift',
  AltLeft: 'Left Alt',
  AltRight: 'Right Alt',
  ContextMenu: 'Menu key',
  ScrollLock: 'Scroll Lock',
  Insert: 'Insert',
  Pause: 'Pause'
}
const MAC_NAMES: Record<string, string> = {
  ControlLeft: 'Left Control',
  ControlRight: 'Right Control',
  AltLeft: 'Left Option',
  AltRight: 'Right Option'
}

/** The key's name for Adam: "Right Ctrl", "F9", "Menu key", kept on one line. */
export function keyName(key: string, mac = false): string {
  if (!key) return ''
  return whole((mac && MAC_NAMES[key]) || NAMES[key] || (key.length === 1 ? key.toUpperCase() : key))
}
