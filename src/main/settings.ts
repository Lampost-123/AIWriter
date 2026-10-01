import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import type { DeepPartial, Settings, WritingPrefs } from '@shared/types'
import { defaultSettings, defaultWritingPrefs } from '@shared/defaults'
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
    const stored = readJson<Partial<Settings>>(settingsFile(), {})
    cached = merge(defaultSettings(defaultLibraryDir()), stored)
    mkdirSync(cached.libraryPath, { recursive: true })
  }
  return cached
}

export function updateSettings(patch: DeepPartial<Settings>): Settings {
  const next = merge(getSettings(), patch)
  cached = next
  writeFileAtomic(settingsFile(), JSON.stringify(next, null, 2))
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
