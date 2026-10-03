// The app's keyboard shortcuts, in one list. The shortcuts list (?) shows it, and tooltips and the
// command palette name keys from it, so a key is described the same way everywhere. On a Mac, Cmd
// (⌘) replaces Ctrl. Each shortcut is handled where it acts (the editor, the scene header, the
// binder...); shortcuts.test.ts checks that every one the app handles is listed here.

import { isMac } from './api'

export type ShortcutId =
  | 'generate'
  | 'stop'
  | 'stopAnswer'
  | 'acceptChange'
  | 'rejectChange'
  | 'markDone'
  | 'save'
  | 'bold'
  | 'italic'
  | 'quote'
  | 'lineBreak'
  | 'showName'
  | 'undo'
  | 'redo'
  | 'search'
  | 'shortcuts'
  | 'settings'
  | 'close'
  | 'binderMove'
  | 'binderFold'
  | 'binderOpen'
  | 'binderRename'
  | 'binderDelete'
  | 'binderUndo'
  // Milestone 4
  | 'listen'
  | 'stopReading'
  | 'buildWorld'
  // Milestone 6
  | 'focusMode'
  | 'leaveFocusMode'

export type ShortcutGroup = 'Writing' | 'Moving around'

export interface Shortcut {
  id: ShortcutId
  /** What it does, in plain words. */
  name: string
  /** Where it works, when that isn't everywhere: "in the binder". */
  where?: string
  group: ShortcutGroup
  /** The keys on Windows. 'Mod' is Ctrl there and ⌘ on a Mac. */
  keys: string[]
  /** The keys on a Mac, when they are not simply Ctrl → ⌘. */
  mac?: string[]
  /** The keys are each a way to do it (↑ or ↓), not pressed together. */
  either?: boolean
}

export const SHORTCUTS: Shortcut[] = [
  { id: 'generate', name: 'Generate a draft of the scene', group: 'Writing', keys: ['Mod', 'G'] },
  { id: 'stop', name: 'Stop the draft', group: 'Writing', keys: ['Esc'] },
  { id: 'stopAnswer', name: 'Stop the answer', where: 'in Ask the world', group: 'Writing', keys: ['Esc'] },
  { id: 'acceptChange', name: 'Accept the AI’s change to the words', where: 'in the page', group: 'Writing', keys: ['Tab'] },
  {
    id: 'rejectChange',
    name: 'Reject the AI’s change, or stop it while it’s being written',
    where: 'in the page',
    group: 'Writing',
    keys: ['Esc']
  },
  { id: 'markDone', name: 'Mark scene done', group: 'Writing', keys: ['Mod', 'Enter'] },
  { id: 'save', name: 'Save now (AI Write also saves as you type)', group: 'Writing', keys: ['Mod', 'S'] },
  { id: 'bold', name: 'Bold', group: 'Writing', keys: ['Mod', 'B'] },
  { id: 'italic', name: 'Italic', group: 'Writing', keys: ['Mod', 'I'] },
  { id: 'quote', name: 'Quoted passage', group: 'Writing', keys: ['Mod', 'Shift', 'B'] },
  { id: 'lineBreak', name: 'New line in the same paragraph', group: 'Writing', keys: ['Shift', 'Enter'] },
  { id: 'showName', name: 'Show who or what an underlined name is, beside the page', group: 'Writing', keys: ['Mod', 'Click'] },
  { id: 'listen', name: 'Listen from the cursor, or pause and carry on', group: 'Writing', keys: ['Mod', 'L'] },
  { id: 'stopReading', name: 'Stop reading aloud', group: 'Writing', keys: ['Mod', 'Shift', 'Space'] },
  {
    id: 'buildWorld',
    name: 'Build the world from your summary',
    where: 'on the World builder page',
    group: 'Writing',
    keys: ['Mod', 'Enter']
  },
  { id: 'focusMode', name: 'Focus mode: only the page shows (press again to leave)', group: 'Writing', keys: ['F11'] },
  { id: 'leaveFocusMode', name: 'Leave focus mode', where: 'in focus mode', group: 'Writing', keys: ['Esc'] },
  { id: 'undo', name: 'Undo', group: 'Writing', keys: ['Mod', 'Z'] },
  { id: 'redo', name: 'Redo', group: 'Writing', keys: ['Mod', 'Y'], mac: ['Mod', 'Shift', 'Z'] },
  { id: 'search', name: 'Search, or find any action', group: 'Moving around', keys: ['Mod', 'K'] },
  { id: 'shortcuts', name: 'This list of shortcuts', group: 'Moving around', keys: ['?'] },
  { id: 'settings', name: 'Settings', group: 'Moving around', keys: ['Mod', ','] },
  { id: 'close', name: 'Close a menu, list or dialog', group: 'Moving around', keys: ['Esc'] },
  {
    id: 'binderMove',
    name: 'Move between acts, chapters and scenes',
    where: 'in the binder',
    group: 'Moving around',
    keys: ['↑', '↓'],
    either: true
  },
  {
    id: 'binderFold',
    name: 'Close or open an act or chapter',
    where: 'in the binder',
    group: 'Moving around',
    keys: ['←', '→'],
    either: true
  },
  { id: 'binderOpen', name: 'Open the scene', where: 'in the binder', group: 'Moving around', keys: ['Enter'] },
  { id: 'binderRename', name: 'Rename an act, chapter or scene', where: 'in the binder', group: 'Moving around', keys: ['F2'] },
  { id: 'binderDelete', name: 'Delete an act, chapter or scene', where: 'in the binder', group: 'Moving around', keys: ['Delete'] },
  {
    id: 'binderUndo',
    name: 'Bring back what you just deleted',
    where: 'in the binder or the Drafts tab',
    group: 'Moving around',
    keys: ['Mod', 'Z']
  }
]

export const SHORTCUT_GROUPS: ShortcutGroup[] = ['Writing', 'Moving around']

const MAC_KEYS: Record<string, string> = { Mod: '⌘', Shift: '⇧', Alt: '⌥' }

export function shortcut(id: ShortcutId): Shortcut {
  return SHORTCUTS.find((s) => s.id === id)!
}

/** The keys to press, as their labels: ['Ctrl', 'G'] on Windows, ['⌘', 'G'] on a Mac. */
export function shortcutKeys(id: ShortcutId, mac = isMac()): string[] {
  const s = shortcut(id)
  return ((mac && s.mac) || s.keys).map((k) => (k === 'Mod' ? (mac ? '⌘' : 'Ctrl') : mac ? (MAC_KEYS[k] ?? k) : k))
}

/** The keys as one piece of text: "Ctrl+G", "⌘+G", "Esc", "↑ or ↓". */
export const shortcutText = (id: ShortcutId, mac = isMac()): string => shortcutKeys(id, mac).join(shortcut(id).either ? ' or ' : '+')

/** A tooltip or name with its shortcut: "Generate (Ctrl+G)". */
export const withShortcut = (label: string, id: ShortcutId, mac = isMac()): string => `${label} (${shortcutText(id, mac)})`

/** The parts of a key press that decide a shortcut. */
export interface KeyPress {
  key: string
  /** The physical key, when known: Space is told by it as well as by its character. */
  code?: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/**
 * True when a key press is this shortcut. Ctrl and ⌘ both count as 'Mod', as in the app's other
 * shortcuts, so either works on any computer.
 */
export function isShortcut(e: KeyPress, id: ShortcutId, mac = isMac()): boolean {
  const s = shortcut(id)
  const keys = (mac && s.mac) || s.keys
  const mod = keys.includes('Mod')
  const shift = keys.includes('Shift')
  const main = keys.filter((k) => k !== 'Mod' && k !== 'Shift')
  if (main.length !== 1 || e.altKey || mod !== (e.ctrlKey || e.metaKey)) return false
  const want = main[0] === 'Esc' ? 'Escape' : main[0]
  // '?' is Shift and / on many keyboards (and other keys elsewhere): the character decides, not Shift.
  if (want === '?') return e.key === '?'
  if (want === 'Space') return shift === e.shiftKey && (e.key === ' ' || e.code === 'Space')
  return shift === e.shiftKey && e.key.toLowerCase() === want.toLowerCase()
}

/**
 * True while Adam is typing somewhere (the page, a text box, a field), so single-key shortcuts like
 * ? must let the key through.
 */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.closest !== 'function') return false
  return !!el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="combobox"]')
}

/**
 * Presses a shortcut for the part of the app that handles it (as if Adam had pressed the keys), so
 * the command palette runs exactly what the keys run.
 */
export function pressShortcut(id: ShortcutId, mac = isMac()): void {
  const s = shortcut(id)
  const keys = (mac && s.mac) || s.keys
  const main = keys.filter((k) => k !== 'Mod' && k !== 'Shift')[0]
  const key = main === 'Esc' ? 'Escape' : main === 'Space' ? ' ' : main.length === 1 ? main.toLowerCase() : main
  const mod = keys.includes('Mod')
  window.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      code: main === 'Space' ? 'Space' : undefined,
      bubbles: true,
      cancelable: true,
      ctrlKey: mod && !mac,
      metaKey: mod && mac,
      shiftKey: keys.includes('Shift')
    })
  )
}
