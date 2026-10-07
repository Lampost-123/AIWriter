// The facts read from one scene, through their source links: changes pinned to it, entries found
// in it, details (fields) of entries read from it and voice sample lines. How each is described to
// the memory model and in the "What changed" list, and its fingerprint (what a suppression and a
// duplicate check compare). No Electron imports.

import type Database from 'better-sqlite3'
import type { Change, ChangeData, Entry, ID, Origin, SourceLink } from '@shared/types'
import { FIELD_GROUPS, KIND_LABELS } from '@shared/fields'
import { getChange } from '../db/memory'
import { getEntries } from '../db/repo'
import { linksInScene } from '../db/history'
import { lowerFirstWord, plain, upperFirst } from './text'

type DB = Database.Database

export type SceneFact =
  | { kind: 'change'; key: string; change: Change; entry: Entry; origin: Origin; links: SourceLink[] }
  | { kind: 'field'; key: string; entry: Entry; field: string; origin: Origin; links: SourceLink[] }
  | { kind: 'entry'; key: string; entry: Entry; origin: Origin; links: SourceLink[] }
  | { kind: 'voice'; key: string; entry: Entry; line: string; origin: Origin; links: SourceLink[] }

/** Who a field's value comes from (missing keys follow the entry's own origin). */
export const fieldOrigin = (e: Entry, field: string): Origin => e.fieldOrigins?.[field] ?? e.origin

/** A field's value: kind-specific fields, or one of the entry's own ('name', 'summary', 'description'). */
export function fieldValue(e: Entry, field: string): string {
  if (field === 'name') return e.name
  if (field === 'summary') return e.summary
  if (field === 'description') return e.description
  if (field === 'aliases') return e.aliases.join(', ')
  return e.fields?.[field] ?? ''
}

/** A field's label in plain words ("Eyes", "Distinguishing marks", "Summary"). */
export function fieldLabel(e: Pick<Entry, 'kind'>, field: string): string {
  if (field === 'summary') return 'Summary'
  if (field === 'description') return 'Description'
  if (field === 'name') return 'Name'
  if (field === 'aliases') return 'Also called'
  for (const g of FIELD_GROUPS[e.kind] ?? []) for (const f of g.fields) if (f.key === field) return f.label
  return upperFirst(field)
}

/** Every fact with a source link in this scene (links in every state), whose fact still exists. */
export function sceneFacts(db: DB, sceneId: ID): SceneFact[] {
  const links = linksInScene(db, sceneId)
  const groups = new Map<string, SourceLink[]>()
  for (const l of links) {
    if (l.factKind === 'summary') continue
    const key =
      l.factKind === 'voice' ? `voice:${l.id}` : l.factKind === 'field' ? `field:${l.factId}:${l.field ?? ''}` : `${l.factKind}:${l.factId}`
    groups.set(key, [...(groups.get(key) ?? []), l])
  }
  const entryIds = new Set<ID>()
  const changes = new Map<ID, Change>()
  for (const ls of groups.values()) {
    const l = ls[0]
    if (l.factKind === 'change') {
      try {
        const c = getChange(db, l.factId)
        changes.set(c.id, c)
        entryIds.add(c.entryId)
      } catch {
        /* removed since: its links say nothing any more */
      }
    } else entryIds.add(l.factId)
  }
  const entries = new Map(getEntries(db, [...entryIds]).map((e) => [e.id, e]))
  const out: SceneFact[] = []
  for (const [key, ls] of groups) {
    const l = ls[0]
    if (l.factKind === 'change') {
      const change = changes.get(l.factId)
      const entry = change && entries.get(change.entryId)
      if (change && entry) out.push({ kind: 'change', key, change, entry, origin: change.origin, links: ls })
      continue
    }
    const entry = entries.get(l.factId)
    if (!entry) continue
    if (l.factKind === 'entry') out.push({ kind: 'entry', key, entry, origin: entry.origin, links: ls })
    else if (l.factKind === 'field' && l.field)
      out.push({ kind: 'field', key, entry, field: l.field, origin: fieldOrigin(entry, l.field), links: ls })
    else if (l.factKind === 'voice')
      out.push({ kind: 'voice', key, entry, line: l.quote, origin: fieldOrigin(entry, 'sampleLines'), links: ls })
  }
  return out
}

// ---------- In plain words ----------

/** How "What changed" names something said (0.6.29), for the speaker and those who heard it alike. */
const SAID_WORDS: Record<string, string> = { promise: 'A promise', threat: 'A threat', secret: 'A secret told' }

/** A change in plain words, without the entry's name: "Lost her left hand", "Knows Mara is the heir". */
export function changeWords(c: ChangeData, nameOf: (id: ID) => string): string {
  switch (c.kind) {
    case 'update': {
      const fields = Object.entries(c.payload.fields ?? {}).filter(([, v]) => v)
      return upperFirst(c.payload.note || fields.map(([k, v]) => `${k}: ${v}`).join('; ') || 'Changed')
    }
    case 'relationship': {
      const p = c.payload
      return p.ended
        ? `No longer ${p.type || 'linked'} with ${nameOf(p.otherId)}`
        : `${upperFirst(p.type || 'linked')}: ${nameOf(p.otherId)}`
    }
    case 'knowledge':
      if (c.payload.said && !c.payload.forgets) return `${SAID_WORDS[c.payload.said.kind] ?? 'Knows'}: ${c.payload.fact}`
      return `${c.payload.forgets ? 'Forgets' : 'Knows'} ${lowerFirstWord(c.payload.fact)}`
    case 'thread':
      return `Plot thread ${c.payload.status === 'resolved' ? 'resolved' : 'opened'}${c.payload.note ? `: ${c.payload.note}` : ''}`
    case 'full':
      return 'Full description at the start of the story'
  }
}

/** A removed change in plain words: "No longer knows Mara is the heir". */
export function removedWords(c: ChangeData, nameOf: (id: ID) => string): string {
  if (c.kind === 'knowledge' && !c.payload.forgets) return `No longer knows ${lowerFirstWord(c.payload.fact)}`
  return changeWords(c, nameOf)
}

export const kindWord = (kind: Entry['kind']): string => KIND_LABELS[kind].one.toLowerCase()

// ---------- Fingerprints ----------

/**
 * What a suppression and a duplicate check compare: the fact's identity, without its wording, so
 * an undone guess isn't made again from the same words however the model phrases it.
 */
export type Guess =
  | { type: 'entry'; kind: Entry['kind']; name: string }
  | { type: 'link'; entryId: ID }
  | { type: 'change'; entryId: ID; change: ChangeData }
  | { type: 'field'; entryId: ID; field: string }
  | { type: 'voice'; entryId: ID }
  | { type: 'event'; name: string }

export function fingerprint(g: Guess): string {
  switch (g.type) {
    case 'entry':
      return `entry:${g.kind}:${plain(g.name)}`
    case 'event':
      return `entry:event:${plain(g.name)}`
    case 'link':
      return `link:${g.entryId}`
    case 'field':
      return `field:${g.entryId}:${g.field}`
    case 'voice':
      return `voice:${g.entryId}`
    case 'change': {
      const c = g.change
      if (c.kind === 'update') {
        const keys = Object.keys(c.payload.fields ?? {}).sort()
        return `update:${g.entryId}:${keys.length ? keys.join(',') : 'note'}`
      }
      if (c.kind === 'relationship') return `relationship:${g.entryId}:${c.payload.otherId}`
      // Something said (0.6.29) is its own kind of guess: a "knows" for the same words never stands in for it.
      if (c.kind === 'knowledge') return c.payload.said ? `said:${g.entryId}` : `knowledge:${g.entryId}`
      if (c.kind === 'thread') return `thread:${g.entryId}`
      return `full:${g.entryId}`
    }
  }
}

/** The fingerprint of a fact already in the scene. */
export function factFingerprint(f: SceneFact): string {
  switch (f.kind) {
    case 'change':
      return fingerprint({ type: 'change', entryId: f.change.entryId, change: f.change })
    case 'field':
      return fingerprint({ type: 'field', entryId: f.entry.id, field: f.field })
    case 'voice':
      return fingerprint({ type: 'voice', entryId: f.entry.id })
    case 'entry':
      return f.entry.origin === 'text'
        ? fingerprint({ type: 'entry', kind: f.entry.kind, name: f.entry.name })
        : fingerprint({ type: 'link', entryId: f.entry.id })
  }
}

/** The words a change stands for, to compare two guesses about the same thing (see sameFact). */
export function changeContent(c: ChangeData): string {
  switch (c.kind) {
    case 'update':
      return `${c.payload.note} ${Object.values(c.payload.fields ?? {}).join(' ')} ${c.payload.description ?? ''} ${c.payload.summary ?? ''}`
    case 'relationship':
      return `${c.payload.type} ${c.payload.ended ? 'ended' : 'ongoing'}`
    case 'knowledge':
      // Something said is the same fact when the same speaker says the same line, however the fact is worded.
      if (c.payload.said) return `said by ${c.payload.said.by}: ${c.payload.said.words}`
      return `${c.payload.fact} ${c.payload.forgets ? 'forgets' : 'knows'}`
    case 'thread':
      return `${c.payload.status} ${c.payload.note}`
    case 'full':
      return c.payload.description
  }
}

/** The words a fact stands for, to compare two guesses about the same thing. */
export function factContent(f: SceneFact): string {
  switch (f.kind) {
    case 'change':
      return changeContent(f.change)
    case 'field':
      return fieldValue(f.entry, f.field)
    case 'voice':
      return f.line
    case 'entry':
      return f.entry.name
  }
}
