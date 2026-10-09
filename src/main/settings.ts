import { join } from 'node:path'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import type { DeepPartial, Settings, ThemeName, WritingPrefs } from '@shared/types'
import { DESK_READY, defaultSettings, defaultWritingPrefs } from '@shared/defaults'
import { ARRANGEMENTS, LOOKS, arrangementNoteDue, lookNoteDue, lookOf, type Arrangement, type Look } from '@shared/contracts/look'
import { defaultLibraryDir, userDataDir } from './paths'
import { readJson, writeFileAtomic } from './util'

let cached: Settings | null = null

const settingsFile = (): string => join(userDataDir(), 'settings.json')

function merge<T>(base: T, patch: unknown): T {
  if (patch === undefined) return base
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch as T
  if (base === null || typeof base !== 'object' || Array.isArray(base)) return patch as T
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    out[k] = merge((base as Record<string, unknown>)[k], v)
  }
  return out as T
}

export function getSettings(): Settings {
  if (!cached) {
    const file = settingsFile()
    const existed = existsSync(file)
    const stored = readJson<Partial<Settings>>(file, {})
    cached = merge(defaultSettings(defaultLibraryDir()), stored)
    // The New look is the default, with a one-time note offering Classic to anyone who used AI Write before it.
    // App tests choose the look they start in (AIWRITE_LOOK) and never see the note unless they ask for it.
    if (!('look' in stored)) {
      const forced = lookFromEnv()
      if (forced) cached.look = forced
      cached.lookNote = !forced && lookNoteDue(existed ? (stored as Record<string, unknown>) : null)
    }
    // The theme: Dark for anyone who never chose one (the default). App tests choose the theme they start in
    // (AIWRITE_THEME), so their pictures stay as they were taken.
    if (!('theme' in stored)) {
      const forced = themeFromEnv()
      if (forced) cached.theme = forced
    }
    // App tests never see the guided tour of the desk (AIWRITE_TOUR=off) unless they ask for it.
    if (!('tourSeen' in stored) && process.env.AIWRITE_TOUR === 'off') cached.tourSeen = true
    // The New look's layout: once the desk is ready (or in a try-out build), everyone on the New look who never chose a
    // layout moves to the desk, with its story list and scene drawer shut to start with, and a one-time note offering
    // the panels to anyone who used them. App tests choose the layout they start in (AIWRITE_ARRANGEMENT).
    if (!('arrangement' in stored)) {
      const forced = arrangementFromEnv()
      const desk = forced ? forced === 'desk' : deskReady() && lookOf(cached.look) === 'new'
      cached.arrangement = desk ? 'desk' : 'panels'
      if (desk) cached.layout = { ...cached.layout, binderOpen: false, inspectorOpen: false }
      cached.arrangementNote = desk && !forced && arrangementNoteDue(existed ? (stored as Record<string, unknown>) : null)
    }
    // A library on a drive that isn't plugged in must not stop AI Write starting:
    // the welcome screen says so and offers to try again or choose another folder.
    ensureLibraryFolder(cached.libraryPath)
  }
  return cached
}

/** The look app tests start in (AIWRITE_LOOK=new or classic); undefined for everyone else. */
function lookFromEnv(): Look | undefined {
  const v = process.env.AIWRITE_LOOK
  return (LOOKS as readonly string[]).includes(v ?? '') ? (v as Look) : undefined
}

/** The theme app tests start in (AIWRITE_THEME=system, light, dark or sepia); undefined for everyone else. */
function themeFromEnv(): ThemeName | undefined {
  const v = process.env.AIWRITE_THEME
  return (THEMES as readonly string[]).includes(v ?? '') ? (v as ThemeName) : undefined
}
const THEMES: readonly ThemeName[] = ['system', 'light', 'dark', 'sepia']

/** The layout app tests start in (AIWRITE_ARRANGEMENT=desk or panels); undefined for everyone else. */
function arrangementFromEnv(): Arrangement | undefined {
  const v = process.env.AIWRITE_ARRANGEMENT
  return (ARRANGEMENTS as readonly string[]).includes(v ?? '') ? (v as Arrangement) : undefined
}

/**
 * The desk can be chosen (Settings › Appearance › Layout) and is where people on the New look start: once it is ready
 * for everyone (DESK_READY), and before that in try-out builds (AIWRITE_DESK_READY=1) and app tests that pick a layout.
 */
export function deskReady(): boolean {
  return DESK_READY || process.env.AIWRITE_DESK_READY === '1' || arrangementFromEnv() === 'desk'
}

/** Makes sure the library folder exists. False when it can't be reached or made. */
export function ensureLibraryFolder(path = getSettings().libraryPath): boolean {
  try {
    mkdirSync(path, { recursive: true })
    return statSync(path).isDirectory()
  } catch (e) {
    console.warn('The library folder cannot be reached:', path, e instanceof Error ? e.message : e)
    return false
  }
}

export function updateSettings(patch: DeepPartial<Settings>): Settings {
  const current = getSettings()
  const next = merge(current, patch)
  const text = JSON.stringify(next, null, 2)
  // Opening a scene or a panel often changes nothing that is stored: don't rewrite the file then.
  if (text === JSON.stringify(current, null, 2)) return current
  writeFileAtomic(settingsFile(), text)
  cached = next
  return next
}

// Writing preferences live in the library folder, outside every world.
const prefsFile = (): string => join(getSettings().libraryPath, 'writing-preferences.json')

export function getWritingPrefs(): WritingPrefs {
  return { ...defaultWritingPrefs(), ...readJson<Partial<WritingPrefs>>(prefsFile(), {}) }
}

export function setWritingPrefs(prefs: WritingPrefs): WritingPrefs {
  writeFileAtomic(prefsFile(), JSON.stringify(prefs, null, 2))
  return prefs
}
