// Pure helpers for an entry page's "as of a scene" view (milestone 3): what the entry is like at a
// point in the story, read-only, with what has changed by then marked. Tested in asOfViewLogic.test.ts.

import { FIELD_GROUPS } from '@shared/fields'
import type { AsOf, AsOfStop, EntryKind, EntryState, ID, Origin, RelationshipState } from '@shared/types'
import { stopForScene, stopIndex } from '@/features/views/asOfLogic'
import { relationPhrase, upperFirst } from './memoryLogic'

export interface AsOfValue {
  key: string
  label: string
  value: string
  /** Set by a change at or before this point, so it isn't as Adam first wrote it. */
  changed: boolean
}

export interface AsOfGroup {
  id: string
  label: string
  rows: AsOfValue[]
}

export interface AsOfProfile {
  summary: AsOfValue | null
  description: AsOfValue | null
  /** The kind's field groups, with only the fields that have something in them (groups with none are left out). */
  groups: AsOfGroup[]
  /** How many of the shown values have changed by this point. */
  changedCount: number
}

/** The entry as it is at a point, as rows to show: only what has something in it. */
export function asOfProfile(state: Pick<EntryState, 'summary' | 'description' | 'fields' | 'changed'>, kind: EntryKind): AsOfProfile {
  const changed = new Set(state.changed)
  const row = (key: string, label: string, value: string): AsOfValue | null =>
    value.trim() ? { key, label, value: value.trim(), changed: changed.has(key) } : null
  const groups: AsOfGroup[] = []
  for (const g of FIELD_GROUPS[kind] ?? []) {
    // A role is chosen from a list ("protagonist"), and reads as it does there.
    const rows = g.fields
      .map((f) => row(f.key, f.label, f.key === 'role' ? upperFirst(state.fields[f.key] ?? '') : (state.fields[f.key] ?? '')))
      .filter((r): r is AsOfValue => !!r)
    if (rows.length) groups.push({ id: g.id, label: g.label, rows })
  }
  const summary = row('summary', 'Short summary', state.summary)
  const description = row('description', 'Description', state.description)
  const all = [summary, description, ...groups.flatMap((g) => g.rows)]
  return { summary, description, groups, changedCount: all.filter((r) => r?.changed).length }
}

/**
 * The line above the entry as of a point: whether what is shown has changed by then, and for an
 * entry Adam made, that he wrote it. Always one line, so the page doesn't move as the slider does.
 */
export function asOfLead(p: Pick<AsOfProfile, 'changedCount'>, happened: number, mine: boolean): string {
  if (mine) {
    return p.changedCount
      ? 'You wrote this. What has changed by this point is marked.'
      : 'You wrote this, and none of it has changed by this point.'
  }
  if (p.changedCount) return 'What has changed by this point is marked.'
  return happened ? 'Nothing written here has changed by this point.' : 'Nothing has changed by this point.'
}

/**
 * Who each value shown as of a point came from, for a quiet note beside it, when it is still as
 * written (a change hasn't set it by then: those are marked "Changed"). An entry Adam made says once
 * that he wrote it (see asOfLead), so his own values there need no note.
 */
export function asOfOrigins(state: Pick<EntryState, 'origin' | 'fieldOrigins' | 'changed'>, p: AsOfProfile): Map<string, Origin> {
  const out = new Map<string, Origin>()
  for (const r of [p.summary, p.description, ...p.groups.flatMap((g) => g.rows)]) {
    if (!r || r.changed) continue
    const origin = state.fieldOrigins?.[r.key] ?? state.origin
    if (origin !== 'adam' || state.origin !== 'adam') out.set(r.key, origin)
  }
  return out
}

export interface AsOfRelation {
  otherId: ID
  /** "Rival of Tobin", or written from the other side, "Tobin: sister of Mara". */
  text: string
  /** "Mara feels: wary · Tobin feels: trusting" (this entry first); null when neither is said. */
  feels: string | null
  /** Where it last changed ("Book 1, Ch 2, Sc 1"); '' when it is as it was from the start. */
  where: string
}

/** The entry's relationships at a point, from its side. Ones with an entry that no longer exists are left out. */
export function asOfRelations(rows: RelationshipState[], selfId: ID, nameOf: (id: ID) => string | null): AsOfRelation[] {
  const self = nameOf(selfId) ?? 'This entry'
  const out: AsOfRelation[] = []
  for (const r of rows) {
    const mine = r.aId === selfId
    if (!mine && r.bId !== selfId) continue
    const otherId = mine ? r.bId : r.aId
    const other = nameOf(otherId)
    if (!other) continue
    const type = r.type.trim()
    const text = mine
      ? type
        ? upperFirst(relationPhrase(type, other))
        : `Linked to ${other}`
      : type
        ? `${other}: ${relationPhrase(type, self)}`
        : `${other}: linked to ${self}`
    const selfFeels = (mine ? r.aFeels : r.bFeels).trim()
    const otherFeels = (mine ? r.bFeels : r.aFeels).trim()
    const feels =
      [selfFeels && `${self} feels: ${selfFeels}`, otherFeels && `${other} feels: ${otherFeels}`].filter(Boolean).join(' · ') || null
    out.push({ otherId, text, feels, where: r.where.trim() })
  }
  return out
}

/**
 * The stop the view shows: the one Adam chose if it is still on the slider, otherwise the scene he
 * is working in (or the end of the story when that scene isn't on this story's line). Null with no stops.
 */
export function chosenStop(stops: AsOfStop[], chosen: AsOf | null, sceneId: ID | null): AsOfStop | null {
  const i = chosen ? stopIndex(stops, chosen) : -1
  return i >= 0 ? stops[i] : stopForScene(stops, sceneId)
}
