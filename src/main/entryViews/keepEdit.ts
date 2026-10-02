// "Only from <story> on" (spec, Multi-story rules: "Edits that reach other stories"). An entry's
// profile is its baseline, so an edit to it changes the entry in every story. When Adam made the
// edit while working in a story other than the one where the entry first exists, he can turn it
// into a start-of-story change for that story instead: the change holds his new words, and the
// profile goes back to how it was, with who each of those fields came from. No Electron imports.

import type Database from 'better-sqlite3'
import type { ChangeView, Entry, ID, UpdatePayload } from '@shared/types'
import type { ProfileBefore } from '@shared/contracts/entryViews'
import { FIELD_GROUPS } from '@shared/fields'
import { changeViews, loadShape } from '../memory/scene'
import * as mem from '../db/memory'
import * as repo from '../db/repo'
import { restoreProfile, storyIsLive } from '../db/entryViews'
import { UserError } from '../util'

type DB = Database.Database

const excerpt = (s: string, max: number): string => {
  const t = s.trim().replace(/\s+/g, ' ')
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

/** What the change says happened, in the words the entry page uses for a change without a note ("Eyes: green"). */
export function noteFor(kind: Entry['kind'], p: Omit<UpdatePayload, 'note'>): string {
  const labels = new Map<string, string>()
  for (const g of FIELD_GROUPS[kind] ?? []) for (const f of g.fields) labels.set(f.key, f.label)
  const label = (k: string): string => labels.get(k) ?? k
  const parts = Object.entries(p.fields ?? {}).map(([k, v]) => (v.trim() ? `${label(k)}: ${excerpt(v, 60)}` : `${label(k)} left blank`))
  if (p.summary !== undefined) parts.unshift(p.summary.trim() ? `In short: ${excerpt(p.summary, 60)}` : 'No short summary')
  if (p.description !== undefined) parts.unshift('A new description')
  return parts.join('; ')
}

/** What changed between `before` and the entry as saved, as an update payload (without its note); null when nothing did. */
export function editSince(entry: Entry, before: ProfileBefore): Omit<UpdatePayload, 'note'> | null {
  const out: Omit<UpdatePayload, 'note'> = {}
  if (before.summary !== undefined && entry.summary !== before.summary) out.summary = entry.summary
  if (before.description !== undefined && entry.description !== before.description) out.description = entry.description
  const fields: Record<string, string> = {}
  for (const [k, v] of Object.entries(before.fields ?? {})) if ((entry.fields[k] ?? '') !== (v ?? '')) fields[k] = entry.fields[k] ?? ''
  if (Object.keys(fields).length) out.fields = fields
  return Object.keys(out).length ? out : null
}

export function keepEditFromStory(db: DB, entryId: ID, storyId: ID, before: ProfileBefore): { entry: Entry; change: ChangeView } {
  const entry = repo.getEntry(db, entryId)
  if (!storyIsLive(db, storyId)) throw new UserError('That story no longer exists, so the change can’t start there.')
  const edit = editSince(entry, before ?? { origins: {} })
  if (!edit) throw new UserError('Nothing has changed here since, so there is nothing to keep for that story.')
  return db.transaction(() => {
    const change = mem.insertChange(db, {
      entryId,
      anchor: 'story-start',
      storyId,
      kind: 'update',
      payload: { note: noteFor(entry.kind, edit), ...edit },
      origin: 'adam'
    })
    // Only the fields the change now holds go back, each to who it came from before the edit.
    const keys = [
      ...Object.keys(edit.fields ?? {}),
      ...(edit.summary !== undefined ? ['summary'] : []),
      ...(edit.description !== undefined ? ['description'] : [])
    ]
    const origins: Record<string, ProfileBefore['origins'][string]> = {}
    for (const k of keys) origins[k] = before.origins?.[k] ?? null
    const fields: Record<string, string> = {}
    for (const k of Object.keys(edit.fields ?? {})) fields[k] = before.fields?.[k] ?? ''
    const restored = restoreProfile(
      db,
      entryId,
      {
        ...(edit.summary !== undefined ? { summary: before.summary } : {}),
        ...(edit.description !== undefined ? { description: before.description } : {}),
        fields
      },
      origins
    )
    return { entry: restored, change: changeViews(db, [change], loadShape(db))[0] }
  })()
}
