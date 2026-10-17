// Saving what the builder makes, under the origin rules: an entry Adam makes is his (never moved to the
// Trash automatically), his own words are his and saved exactly as he wrote them, and what the AI wrote
// is marked "drafted by AI", so the memory keeper updates it when the story later says otherwise and
// never touches his. Nothing here writes over words someone else has put in a field. No Electron imports.

import type Database from 'better-sqlite3'
import type { Change, Entry, ID, Origin } from '@shared/types'
import type { BuilderKept, BuilderKind, BuilderValues, SuggestedRelationship } from '@shared/contracts/builder'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { stampOrigins } from '../db/builder'
import { UserError } from '../util'
import { bareName, findMatch, isPlaceholderName } from '../worldBuilder/names'
import { cleanValue, entryText, ownInput, profileKeys, toInput } from './profile'

type DB = Database.Database

export const BUILDER_KINDS: BuilderKind[] = ['character', 'place', 'group', 'item']
export const isBuilderKind = (k: string): k is BuilderKind => (BUILDER_KINDS as string[]).includes(k)

/** The profile's own fields, tidied, empty ones left out. For the AI's words. */
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

/**
 * The profile as it is saved: the AI's words (`aiKeys`) tidied, Adam's exactly as he wrote them.
 * Other keys and empty fields are left out.
 */
export function savedValues(kind: BuilderKind, values: BuilderValues, aiKeys: ReadonlySet<string>): BuilderValues {
  const known = new Set(profileKeys(kind))
  const out: BuilderValues = {}
  for (const [key, raw] of Object.entries(values ?? {})) {
    if (!known.has(key) || typeof raw !== 'string' || !raw.trim()) continue
    const v = aiKeys.has(key) ? cleanValue(kind, key, raw) : raw
    if (v) out[key] = v
  }
  return out
}

const pick = (values: BuilderValues, keep: (key: string) => boolean): BuilderValues =>
  Object.fromEntries(Object.entries(values).filter(([k]) => keep(k)))

/**
 * Makes an entry from a profile: made by Adam, in the story he is working in. Fields in `aiKeys` are
 * marked as drafted by AI (a name included); the rest are his, saved as he wrote them. Needs a name.
 */
export function createBuilt(db: DB, kind: BuilderKind, values: BuilderValues, aiKeys: Iterable<string>, storyId: ID | null): Entry {
  const ai = new Set(aiKeys)
  const all = savedValues(kind, values, ai)
  if (!all.name?.trim()) throw new UserError('Give it a name first. Nothing else is needed.')
  const mine = pick(all, (k) => !ai.has(k) || k === 'name')
  const drafted = pick(all, (k) => ai.has(k) && k !== 'name')
  return db.transaction(() => {
    let e = repo.createEntry(db, kind, { ...ownInput(kind, mine), originStoryId: storyId }, { origin: 'adam' })
    if (ai.has('name')) e = stampOrigins(db, e.id, { name: 'ai' })
    if (Object.keys(drafted).length) e = repo.updateEntry(db, e.id, toInput(kind, drafted), { origin: 'ai' })
    return e
  })()
}

/**
 * The world's entry of this kind that already goes by the profile's name or one of its aliases, exactly (case,
 * accents and a leading "the" aside), or null (2026-10-17: Quick start from a passage about someone the world
 * has adds to their page rather than making a second one). A name one letter away is never taken as the same.
 */
export function sameEntry(db: DB, kind: BuilderKind, values: BuilderValues): Entry | null {
  const want = { kind, name: values.name ?? '', aliases: (values.aliases ?? '').split(',') }
  const names = (e: { name: string; aliases: string[] }): string[] => [e.name, ...e.aliases].map(bareName).filter((n) => n && !isPlaceholderName(n))
  const mine = names(want)
  if (!mine.length) return null
  const found = findMatch(want, repo.listEntries(db, kind))
  return found && names(found).some((n) => mine.includes(n)) ? found : null
}

/** What Quick start has saved of each field: the value it sent, and the field's text once saved. */
export type Written = Record<string, { sent: string; held: string }>

/** Notes what was saved, so the next save of a profile still arriving skips it. */
export function noteWritten(written: Written, e: Entry, values: BuilderValues): void {
  for (const [key, v] of Object.entries(values)) written[key] = { sent: v, held: entryText(e, key) }
}

/**
 * Saves the fields of a profile that is still arriving: Adam's words (`fromNotes`) as his, exactly as
 * he wrote them, the rest as drafted by AI. A field already saved with the same value is skipped, and so
 * is one holding words that someone else has put there since (Adam typing on the entry's page
 * meanwhile, say) or that were there before (Finish the rest fills only empty fields).
 */
export function saveBuilt(db: DB, kind: BuilderKind, entryId: ID, values: BuilderValues, fromNotes: string[], written: Written): Entry {
  const his = new Set(fromNotes)
  const all = savedValues(kind, values, new Set(Object.keys(values).filter((k) => !his.has(k))))
  return db.transaction(() => {
    let e = repo.getEntry(db, entryId)
    const mine: BuilderValues = {}
    const drafted: BuilderValues = {}
    for (const [key, v] of Object.entries(all)) {
      const w = written[key]
      if (w?.sent === v) continue
      const now = entryText(e, key)
      if (now.trim() && now !== (w?.held ?? '')) continue
      if (his.has(key)) mine[key] = v
      else drafted[key] = v
    }
    if (Object.keys(mine).length) e = repo.updateEntry(db, entryId, ownInput(kind, mine), { origin: 'adam' })
    if (Object.keys(drafted).length) e = repo.updateEntry(db, entryId, toInput(kind, drafted), { origin: 'ai' })
    noteWritten(written, e, { ...mine, ...drafted })
    return e
  })()
}

/** The same words, white space and the spaces around commas aside (aliases come back as "a, b"). */
const sameWords = (a: string, b: string): boolean => {
  const tidy = (s: string): string => s.replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ').trim()
  return tidy(a) === tidy(b)
}

/**
 * Saves suggestions Adam kept, marked as drafted by AI. Only empty fields are filled, so his words (or
 * anything else written since the suggestion was made) are never written over, unless `replace`: he
 * picked one of the options for that field himself. Even then (2026-10-17), a field that no longer
 * holds what `expected` says the screen showed (the memory keeper or the entry's page changed it
 * meanwhile) is left as it is, and named in `skipped`.
 */
export function keepSuggestions(db: DB, entryId: ID, values: BuilderValues, replace = false, expected?: BuilderValues): BuilderKept {
  const e = repo.getEntry(db, entryId)
  if (!isBuilderKind(e.kind)) throw new UserError('That page has no builder.')
  const patch: BuilderValues = {}
  const skipped: string[] = []
  for (const [key, v] of Object.entries(cleanValues(e.kind, values))) {
    const now = entryText(e, key)
    const changed = replace ? !!expected && !sameWords(now, expected[key] ?? '') : !!now.trim()
    if (changed && !sameWords(now, v)) skipped.push(key)
    if (changed) continue
    patch[key] = v
  }
  if (!Object.keys(patch).length) return { entry: e, skipped }
  return { entry: repo.updateEntry(db, entryId, toInput(e.kind, patch), { origin: 'ai' }), skipped }
}

/**
 * Puts one field back as it was, with who made it (Undo after Adam picked an option for it): words
 * read from the story or drafted by AI are theirs again, so the memory keeper goes on keeping them up
 * to date as before. Saved exactly as given. A field that no longer holds `expected` (the option he
 * picked) is left as it is and named in `skipped` (2026-10-17).
 */
export function restoreField(db: DB, entryId: ID, key: string, value: string, origin: Origin, expected?: string): BuilderKept {
  const e = repo.getEntry(db, entryId)
  if (!isBuilderKind(e.kind)) throw new UserError('That page has no builder.')
  if (!profileKeys(e.kind).includes(key) || (key === 'name' && !value.trim())) return { entry: e, skipped: [] }
  const now = entryText(e, key)
  if (expected !== undefined && !sameWords(now, expected) && !sameWords(now, value)) return { entry: e, skipped: [key] }
  return { entry: repo.updateEntry(db, entryId, ownInput(e.kind, { [key]: value }), { origin }), skipped: [] }
}

// ---------- Suggest relationships (2026-10-17) ----------

/** The entries a character is linked to by a live relationship, from either side. */
export function linkedTo(db: DB, entryId: ID): Set<ID> {
  const out = new Set<ID>()
  for (const c of mem.changesForEntry(db, entryId)) {
    if (c.kind === 'relationship') out.add(c.entryId === entryId ? c.payload.otherId : c.entryId)
    else if (c.kind === 'full') {
      if (c.entryId === entryId) for (const r of c.payload.relationships ?? []) out.add(r.otherId)
      else if ((c.payload.relationships ?? []).some((r) => r.otherId === entryId)) out.add(c.entryId)
    }
  }
  out.delete(entryId)
  return out
}

/**
 * Saves a relationship Adam kept from the AI's suggestions on the character: how things stand when the story begins,
 * drafted by AI (so it says so, and Undo can take it back while it is unchanged).
 */
export function keepRelationship(db: DB, entryId: ID, s: Pick<SuggestedRelationship, 'otherId' | 'type' | 'feels' | 'otherFeels'>): Change {
  return db.transaction(() => {
    const e = repo.getEntry(db, entryId)
    if (e.kind !== 'character') throw new UserError('Only characters have relationships suggested here.')
    if (linkedTo(db, entryId).has(s.otherId)) {
      throw new UserError(`${e.name || 'They'} and ${repo.getEntry(db, s.otherId).name || 'them'} are linked already. You can change how on the step.`)
    }
    const text = (v: unknown, n: number): string => (typeof v === 'string' ? v.trim().slice(0, n) : '')
    const clean = mem.cleanChangeInput(db, {
      entryId,
      anchor: 'baseline',
      kind: 'relationship',
      payload: { otherId: s.otherId, type: text(s.type, 80), feels: text(s.feels, 300), otherFeels: text(s.otherFeels, 300) }
    })
    return mem.insertChange(db, { ...clean, origin: 'ai' })
  })()
}

/**
 * Undo after keeping a suggested relationship: removes it while it is as it was kept (still the AI's, not changed since
 * `updatedAt`). False when it has gone already or was changed, so it is left.
 */
export function takeBackRelationship(db: DB, changeId: ID, updatedAt: string): boolean {
  return db.transaction(() => {
    let c: Change
    try {
      c = mem.getChange(db, changeId)
    } catch {
      return false
    }
    if (c.kind !== 'relationship' || c.origin !== 'ai' || c.updatedAt !== updatedAt) return false
    mem.deleteChange(db, changeId, { origin: 'adam' })
    return true
  })()
}
