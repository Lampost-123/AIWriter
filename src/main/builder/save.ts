// Saving what the builder makes, under the origin rules: an entry Adam makes is his (never moved to the
// Trash automatically), his own words are his, and what the AI wrote is marked "drafted by AI", so the
// memory keeper updates it when the story later says otherwise and never touches his. Nothing here
// writes over words someone else has put in a field. No Electron imports.

import type Database from 'better-sqlite3'
import type { Entry, ID } from '@shared/types'
import type { BuilderKind, BuilderValues } from '@shared/contracts/builder'
import * as repo from '../db/repo'
import { stampOrigins } from '../db/builder'
import { UserError } from '../util'
import { cleanValue, entryText, profileKeys, toInput } from './profile'

type DB = Database.Database

export const BUILDER_KINDS: BuilderKind[] = ['character', 'place', 'group', 'item']
export const isBuilderKind = (k: string): k is BuilderKind => (BUILDER_KINDS as string[]).includes(k)

/** The profile's own fields, tidied, empty ones left out. */
export function cleanValues(kind: BuilderKind, values: BuilderValues): BuilderValues {
  const known = new Set(profileKeys(kind))
  const out: BuilderValues = {}
  for (const [key, raw] of Object.entries(values ?? {})) {
    if (!known.has(key) || typeof raw !== 'string') continue
    const v = cleanValue(kind, key, raw)
    if (v) out[key] = v
  }
  return out
}

const pick = (values: BuilderValues, keep: (key: string) => boolean): BuilderValues =>
  Object.fromEntries(Object.entries(values).filter(([k]) => keep(k)))

/**
 * Makes an entry from a profile: made by Adam, in the story he is working in. Fields in `aiKeys` are
 * marked as drafted by AI (a name included); the rest are his. Needs a name.
 */
export function createBuilt(db: DB, kind: BuilderKind, values: BuilderValues, aiKeys: Iterable<string>, storyId: ID | null): Entry {
  const clean = cleanValues(kind, values)
  if (!clean.name) throw new UserError('Give it a name first. Nothing else is needed.')
  const ai = new Set(aiKeys)
  const mine = pick(clean, (k) => !ai.has(k) || k === 'name')
  const drafted = pick(clean, (k) => ai.has(k) && k !== 'name')
  return db.transaction(() => {
    let e = repo.createEntry(db, kind, { ...toInput(kind, mine), originStoryId: storyId }, { origin: 'adam' })
    if (ai.has('name')) e = stampOrigins(db, e.id, { name: 'ai' })
    if (Object.keys(drafted).length) e = repo.updateEntry(db, e.id, toInput(kind, drafted), { origin: 'ai' })
    return e
  })()
}

/** What Quick start has saved of each field: the value it sent, and the field's text once saved. */
export type Written = Record<string, { sent: string; held: string }>

/** Notes what was saved, so the next save of a profile still arriving skips it. */
export function noteWritten(written: Written, e: Entry, values: BuilderValues): void {
  for (const [key, v] of Object.entries(values)) written[key] = { sent: v, held: entryText(e, key) }
}

/**
 * Saves the fields of a profile that is still arriving: Adam's words (`fromNotes`) as his, the rest
 * as drafted by AI. A field already saved with the same value is skipped, and so is one holding words
 * that someone else has put there since (Adam typing on the entry's page meanwhile, say).
 */
export function saveBuilt(db: DB, kind: BuilderKind, entryId: ID, values: BuilderValues, fromNotes: string[], written: Written): Entry {
  return db.transaction(() => {
    let e = repo.getEntry(db, entryId)
    const mine: BuilderValues = {}
    const drafted: BuilderValues = {}
    for (const [key, v] of Object.entries(cleanValues(kind, values))) {
      const w = written[key]
      if (w?.sent === v) continue
      const now = entryText(e, key)
      if (now.trim() && now !== (w?.held ?? '')) continue
      if (fromNotes.includes(key)) mine[key] = v
      else drafted[key] = v
    }
    if (Object.keys(mine).length) e = repo.updateEntry(db, entryId, toInput(kind, mine), { origin: 'adam' })
    if (Object.keys(drafted).length) e = repo.updateEntry(db, entryId, toInput(kind, drafted), { origin: 'ai' })
    noteWritten(written, e, { ...mine, ...drafted })
    return e
  })()
}

/**
 * Saves suggestions Adam kept, marked as drafted by AI. Only empty fields are filled, so his words (or
 * anything else written since the suggestion was made) are never written over, unless `replace`: he
 * picked one of the options for that field himself.
 */
export function keepSuggestions(db: DB, entryId: ID, values: BuilderValues, replace = false): Entry {
  const e = repo.getEntry(db, entryId)
  if (!isBuilderKind(e.kind)) throw new UserError('That page has no builder.')
  const patch: BuilderValues = {}
  for (const [key, v] of Object.entries(cleanValues(e.kind, values))) {
    if (!replace && entryText(e, key).trim()) continue
    patch[key] = v
  }
  if (!Object.keys(patch).length) return e
  return repo.updateEntry(db, entryId, toInput(e.kind, patch), { origin: 'ai' })
}
