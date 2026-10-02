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

/** Everything the world keeps for reading aloud, by entry id. */
export function readAloudOf(db: DB): Record<ID, EntryReadAloud> {
  try {
    const raw = JSON.parse(repo.getMeta(db, META_KEY) ?? '{}') as Partial<Stored>
    const entries = raw.entries && typeof raw.entries === 'object' ? raw.entries : {}
    return Object.fromEntries(Object.entries(entries).map(([id, v]) => [id, cleanReadAloud(v)]))
  } catch {
    return {}
  }
}

export function getEntryReadAloud(db: DB, entryId: ID): EntryReadAloud {
  return readAloudOf(db)[entryId] ?? emptyReadAloud()
}

/** Saves one entry's voice and "Say it as"; an empty one is removed. Returns what was saved. */
export function setEntryReadAloud(db: DB, entryId: ID, value: unknown): EntryReadAloud {
  repo.getEntry(db, entryId) // A plain-words error when the page has gone.
  const clean = cleanReadAloud(value)
  const all = readAloudOf(db)
  if (isEmpty(clean)) delete all[entryId]
  else all[entryId] = clean
  const stored: Stored = { v: 1, entries: all }
  repo.setMeta(db, META_KEY, JSON.stringify(stored))
  return clean
}
