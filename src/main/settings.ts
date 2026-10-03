import { join } from 'node:path'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import type { DeepPartial, Settings, WritingPrefs } from '@shared/types'
import { defaultSettings, defaultWritingPrefs } from '@shared/defaults'
import { LOOKS, lookNoteDue, type Look } from '@shared/contracts/look'
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
