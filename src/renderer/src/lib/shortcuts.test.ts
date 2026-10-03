import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SHORTCUTS, isShortcut, isTyping, shortcutKeys, shortcutText, withShortcut, type KeyPress } from './shortcuts'

const press = (key: string, mods: Partial<KeyPress> = {}): KeyPress => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods
})

describe('the shortcuts list', () => {
  it('names keys for Windows and for a Mac, where Cmd replaces Ctrl', () => {
    expect(shortcutText('generate', false)).toBe('Ctrl+G')
    expect(shortcutText('generate', true)).toBe('⌘+G')
    expect(shortcutKeys('markDone', false)).toEqual(['Ctrl', 'Enter'])
    expect(shortcutKeys('redo', false)).toEqual(['Ctrl', 'Y'])
    expect(shortcutKeys('redo', true)).toEqual(['⌘', '⇧', 'Z'])
    expect(shortcutText('stop', true)).toBe('Esc')
    expect(shortcutText('binderMove', false)).toBe('↑ or ↓')
    expect(withShortcut('Search', 'search', false)).toBe('Search (Ctrl+K)')
  })

  it('lists the spec’s frequent actions, focus mode among them', () => {
    const keys = (id: string): string => shortcutText(SHORTCUTS.find((s) => s.id === id)!.id, false)
    expect(keys('generate')).toBe('Ctrl+G')
    expect(keys('markDone')).toBe('Ctrl+Enter')
    expect(keys('stop')).toBe('Esc')
    expect(keys('search')).toBe('Ctrl+K')
    expect(keys('focusMode')).toBe('F11')
    expect(keys('leaveFocusMode')).toBe('Esc')
    expect(withShortcut('Focus mode', 'focusMode', true)).toBe('Focus mode (F11)')
  })

  it('has each shortcut once, in plain words, in a group', () => {
    expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(SHORTCUTS.length)
    for (const s of SHORTCUTS) {
      expect(s.name).toMatch(/^[A-Z]/)
      expect(s.name).not.toMatch(/\b(entity|generation|LLM|JSON|baseline|anchor)\b/i)
      expect(['Writing', 'Moving around']).toContain(s.group)
    }
  })

  it('knows a key press, with Ctrl or ⌘ either way, and ? whatever the keyboard', () => {
    expect(isShortcut(press('k', { ctrlKey: true }), 'search', false)).toBe(true)
    expect(isShortcut(press('K', { metaKey: true }), 'search', true)).toBe(true)
    expect(isShortcut(press('k', { ctrlKey: true, shiftKey: true }), 'search', false)).toBe(false)
    expect(isShortcut(press('k', { ctrlKey: true, altKey: true }), 'search', false)).toBe(false)
    expect(isShortcut(press('k'), 'search', false)).toBe(false)
    expect(isShortcut(press('?', { shiftKey: true }), 'shortcuts', false)).toBe(true)
    expect(isShortcut(press('?'), 'shortcuts', false)).toBe(true)
    expect(isShortcut(press('?', { ctrlKey: true }), 'shortcuts', false)).toBe(false)
    expect(isShortcut(press('Escape'), 'stop', false)).toBe(true)
    expect(isShortcut(press('z', { metaKey: true, shiftKey: true }), 'redo', true)).toBe(true)
    expect(isShortcut(press('F11'), 'focusMode', false)).toBe(true)
    expect(isShortcut(press('F11', { ctrlKey: true }), 'focusMode', false)).toBe(false)
    expect(isShortcut(press('F11', { shiftKey: true }), 'focusMode', false)).toBe(false)
  })

  it('knows when Adam is typing, so ? goes into the text', () => {
    const el = (match: string | null) =>
      ({ closest: (sel: string) => (match && sel.includes(match) ? {} : null) }) as unknown as EventTarget
    expect(isTyping(el('textarea'))).toBe(true)
    expect(isTyping(el('[contenteditable="true"]'))).toBe(true)
    expect(isTyping(el(null))).toBe(false)
    expect(isTyping(null)).toBe(false)
  })
})

// ---------- Every shortcut the app handles is listed ----------

const ROOT = join(__dirname, '..')

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name)
    if (d.isDirectory()) return sources(p)
    return /\.tsx?$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) ? [p] : []
  })
}

/** A key as the list writes it. */
const LABELS: Record<string, string> = { Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }
const label = (key: string): string => LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : key)

/** True when the list has a shortcut with these keys (with or without Ctrl/⌘). */
function listed(key: string, mod: boolean): boolean {
  const want = label(key).toUpperCase()
  const has = (keys: string[]): boolean => keys.includes('Mod') === mod && keys.some((k) => k.toUpperCase() === want)
  return SHORTCUTS.some((s) => has(s.keys) || has(s.mac ?? []))
}

const KEY_LITERAL = /key(?:\.toLowerCase\(\))?\s*[!=]==\s*'([^']+)'/g
const CASE_LITERAL = /case '([^']+)':/g
const literals = (text: string, re: RegExp): string[] => [...text.matchAll(re)].map((m) => m[1])

describe('every shortcut the app handles is listed', () => {
  const files = sources(ROOT).map((file) => ({ file: relative(ROOT, file), text: readFileSync(file, 'utf8') }))

  it('finds the places that handle keys', () => {
    expect(files.length).toBeGreaterThan(50)
    expect(files.some((f) => f.file.endsWith('GenerateControls.tsx'))).toBe(true)
  })

  it('lists every Ctrl (⌘) shortcut', () => {
    const found = new Set<string>()
    for (const { file, text } of files) {
      const lines = text.split('\n')
      lines.forEach((line, i) => {
        if (!/ctrlKey\s*\|\|\s*e\.metaKey|metaKey\s*\|\|\s*e\.ctrlKey/.test(line)) return
        // The key is on the same line, named by the `case` just above it, or (`const mod = e.ctrlKey || e.metaKey`) just below.
        const before = lines.slice(Math.max(0, i - 3), i).join('\n')
        const after = /=\s*e\.(ctrl|meta)Key\s*\|\|/.test(line) ? lines.slice(i + 1, i + 4).join('\n') : ''
        const named = [...literals(line, KEY_LITERAL), ...literals(before, CASE_LITERAL), ...literals(after, KEY_LITERAL)]
        for (const key of named) found.add(`${label(key)} ${file}`)
      })
      // The editor's own shortcuts ('Mod-Enter').
      for (const m of text.matchAll(/'Mod-([^']+)'\s*:/g)) found.add(`${label(m[1])} ${file}`)
    }
    const keys = [...found].map((f) => f.split(' ')[0])
    // The scan finds the shortcuts known to be there (so it isn't passing by finding nothing).
    for (const key of ['G', 'Enter', 'S', ',', 'Z']) expect(keys).toContain(key)
    expect([...found].filter((f) => !listed(f.split(' ')[0], true))).toEqual([])
  })

  it('lists every key the window listens for, and the binder’s keys', () => {
    const found: string[] = []
    for (const { file, text } of files) {
      if (!text.includes("window.addEventListener('keydown'")) continue
      for (const key of literals(text, KEY_LITERAL)) found.push(`${label(key)} ${file}`)
    }
    // Home and End go to the first and last row, as in any list.
    const tree = files.find((f) => f.file.endsWith('StoryTree.tsx'))!
    for (const key of literals(tree.text, CASE_LITERAL)) if (!['Home', 'End'].includes(key)) found.push(`${label(key)} ${tree.file}`)
    const keys = found.map((f) => f.split(' ')[0])
    for (const key of ['Esc', 'F2', 'Delete', '↓', 'Enter']) expect(keys).toContain(key)
    expect(found.filter((f) => !listed(f.split(' ')[0], false) && !listed(f.split(' ')[0], true))).toEqual([])
  })
})
