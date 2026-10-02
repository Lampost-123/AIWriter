// Pure helpers for an entry's earlier versions (the memory history): which to list, what each is
// called, and what differs from the page as it is now. No React and no API calls here (see historyLogic.test.ts).

import type { Entry, FactVersion, ID } from '@shared/types'
import type { FieldGroup } from '@shared/fields'

/** An entry version whose data is the entry as it was saved. */
export type EntryVersion = FactVersion & { factKind: 'entry' }

/** Adam's saves this close together count as one edit, so a burst of typing is one line, not dozens. */
const BURST_MS = 10 * 60 * 1000

/**
 * The versions worth listing as "Earlier versions", newest first: the entry's own versions (not its
 * changes'), without the newest (that is the page as it is now), and with a burst of Adam's saves
 * shown once, as it was at the end of the burst.
 */
export function earlierVersions(all: FactVersion[], entryId: ID): EntryVersion[] {
  const mine = all.filter((v): v is EntryVersion => v.factKind === 'entry' && v.factId === entryId).sort((a, b) => b.version - a.version)
  const out: EntryVersion[] = []
  for (let i = 1; i < mine.length; i++) {
    const v = mine[i]
    const newer = mine[i - 1]
    // Part of the same burst as the newer one: the newer one already shows how it ended.
    if (v.data && newer.data && v.origin === 'adam' && newer.origin === 'adam' && sameBurst(v, newer)) continue
    out.push(v)
  }
  return out
}

const sameBurst = (a: FactVersion, b: FactVersion): boolean => Math.abs(Date.parse(b.createdAt) - Date.parse(a.createdAt)) < BURST_MS

/**
 * What a version is, in plain words. `where` is the scene the memory read it from, when known.
 * "Changed by you", "Updated from Book 1, Ch 3, Sc 2", "Drafted by AI", "Created by you".
 */
export function versionLabel(v: Pick<FactVersion, 'origin' | 'version' | 'data'>, where: string | null): string {
  if (v.data == null)
    return v.origin === 'adam' ? 'Moved to Recently deleted by you' : 'Moved to Recently deleted when the story stopped mentioning it'
  if (v.origin === 'ai') return 'Drafted by AI'
  if (v.version === 1) return v.origin === 'adam' ? 'Created by you' : where ? `Found in ${where}` : 'Found in your story'
  return v.origin === 'adam' ? 'Changed by you' : where ? `Updated from ${where}` : 'Updated from your story'
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n: number): string => String(n).padStart(2, '0')

/** "Today, 14:02", "Yesterday, 09:15", "12 Oct, 14:02", "12 Oct 2025" (local time). */
export function whenLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const day = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((day(now) - day(d)) / 86_400_000)
  if (days === 0) return `Today, ${time}`
  if (days === 1) return `Yesterday, ${time}`
  if (d.getFullYear() !== now.getFullYear()) return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${time}`
}

export interface DiffRow {
  key: string
  label: string
  then: string
  now: string
}

const list = (xs: string[] | undefined): string => (xs ?? []).join(', ')
const text = (s: string | undefined | null): string => (s ?? '').trim()

/**
 * What differs between an earlier version and the page as it is now, in the page's order, with
 * the page's labels. `placeName` names the place an entry is inside.
 */
export function entryDiff(then: Entry, now: Entry, groups: FieldGroup[], placeName: (id: ID) => string): DiffRow[] {
  const rows: DiffRow[] = []
  const add = (key: string, label: string, a: string, b: string): void => {
    if (a !== b) rows.push({ key, label, then: a, now: b })
  }
  add('name', 'Name', text(then.name), text(now.name))
  add('aliases', 'Aliases', list(then.aliases), list(now.aliases))
  add('summary', 'Short summary', text(then.summary), text(now.summary))
  if (now.kind === 'place' || then.parentId) {
    add('parentId', 'Inside', then.parentId ? placeName(then.parentId) : '', now.parentId ? placeName(now.parentId) : '')
  }
  if (now.kind === 'lore') add('hardRule', 'Hard rule', then.hardRule ? 'Yes' : 'No', now.hardRule ? 'Yes' : 'No')
  add('description', 'Description', text(then.description), text(now.description))
  add('tags', 'Tags', list(then.tags), list(now.tags))
  const known = new Set<string>()
  for (const g of groups) {
    for (const f of g.fields) {
      known.add(f.key)
      add(f.key, f.label, text(then.fields?.[f.key]), text(now.fields?.[f.key]))
    }
  }
  // Fields no form shows any more still count, so a restore is never a surprise.
  const extra = new Set([...Object.keys(then.fields ?? {}), ...Object.keys(now.fields ?? {})].filter((k) => !known.has(k)))
  for (const k of extra) add(k, k, text(then.fields?.[k]), text(now.fields?.[k]))
  add('notes', 'Private notes', text(then.notes), text(now.notes))
  return rows
}

/** True when the version holds a whole entry we can compare and restore. */
export const isEntryData = (data: unknown): data is Entry =>
  !!data && typeof data === 'object' && typeof (data as Entry).id === 'string' && typeof (data as Entry).name === 'string'
