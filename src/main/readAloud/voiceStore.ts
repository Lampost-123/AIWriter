// Character voices and "Say it as" pronunciations, kept in the world's `meta` key `read_aloud` by entry id (no
// data model change), so they go with the world and its backups. Only the database: no settings or Electron, so
// the World builder can give the characters it makes their voices.
import type Database from 'better-sqlite3'
import type { EntryReadAloud } from '@shared/contracts/readAloud'
import type { ID } from '@shared/types'
import * as repo from '../db/repo'

type DB = Database.Database

export const META_KEY = 'read_aloud'

interface Stored {
  v: 1
  entries: Record<ID, EntryReadAloud>
  /**
   * The voices the app gave on its own (studio.ts castVoiceless and castFromStudio), by entry id: the Cast list says
   * "Auto" beside one while the character still has it. Older copies of the app leave it out; nothing else reads it.
   */
  auto?: Record<ID, string>
}

export const emptyReadAloud = (): EntryReadAloud => ({ voice: { design: '', voice: '' }, say: '' })

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** A value as it is kept: trimmed, cut to size, and every part present. */
export function cleanReadAloud(value: unknown): EntryReadAloud {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<EntryReadAloud>
  const voice = (v.voice && typeof v.voice === 'object' ? v.voice : {}) as Partial<EntryReadAloud['voice']>
  return { voice: { design: text(voice.design, 600), voice: text(voice.voice, 120) }, say: text(v.say, 200) }
}

const isEmpty = (v: EntryReadAloud): boolean => !v.voice.design && !v.voice.voice && !v.say

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function stored(db: DB): Partial<Stored> {
  try {
    const raw = JSON.parse(repo.getMeta(db, META_KEY) ?? '{}') as unknown
    return isRecord(raw) ? (raw as Partial<Stored>) : {}
  } catch {
    return {}
  }
}

/** Everything the world keeps for reading aloud, by entry id. */
export function readAloudOf(db: DB): Record<ID, EntryReadAloud> {
  const entries = stored(db).entries
  return isRecord(entries) ? Object.fromEntries(Object.entries(entries).map(([id, v]) => [id, cleanReadAloud(v)])) : {}
}

/** The voices the app gave on its own that the characters still have, by entry id. */
export function autoVoicesOf(db: DB): Record<ID, string> {
  const auto = stored(db).auto
  if (!isRecord(auto)) return {}
  const now = readAloudOf(db)
  return Object.fromEntries(
    Object.entries(auto).filter((e): e is [ID, string] => typeof e[1] === 'string' && !!e[1] && now[e[0]]?.voice.voice === e[1])
  )
}

export function getEntryReadAloud(db: DB, entryId: ID): EntryReadAloud {
  return readAloudOf(db)[entryId] ?? emptyReadAloud()
}

/**
 * Saves one entry's voice and "Say it as"; an empty one is removed. Returns what was saved. `auto`: the app gave this
 * voice on its own (casting), so the Cast list can say so while they keep it.
 */
export function setEntryReadAloud(db: DB, entryId: ID, value: unknown, opts: { auto?: boolean } = {}): EntryReadAloud {
  repo.getEntry(db, entryId) // A plain-words error when the page has gone.
  const clean = cleanReadAloud(value)
  const all = readAloudOf(db)
  const auto = autoVoicesOf(db)
  if (isEmpty(clean)) delete all[entryId]
  else all[entryId] = clean
  if (opts.auto && clean.voice.voice) auto[entryId] = clean.voice.voice
  else if (auto[entryId] !== clean.voice.voice) delete auto[entryId]
  const next: Stored = { v: 1, entries: all, ...(Object.keys(auto).length ? { auto } : {}) }
  repo.setMeta(db, META_KEY, JSON.stringify(next))
  return clean
}
