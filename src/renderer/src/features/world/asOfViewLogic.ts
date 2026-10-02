// Pure helpers for an entry page's "as of a scene" view (milestone 3): what the entry is like at a
// point in the story, read-only, with what has changed by then marked. Tested in asOfViewLogic.test.ts.

import { FIELD_GROUPS } from '@shared/fields'
import type { AsOf, AsOfStop, ChangeView, EntryKind, EntryState, ID, Origin, RelationshipState } from '@shared/types'
import { stopForScene, stopIndex } from '@/features/views/asOfLogic'
import { allAdams, relationPhrase, sourceNote, upperFirst, type SourceNote } from './memoryLogic'

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
 * entry that is all Adam's writing (`allAdams`), that he wrote it. Always one line, so the page
 * doesn't move as the slider does.
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
 * written (a change hasn't set it by then: those are marked "Changed"). An entry that is all Adam's
 * writing says once that he wrote it (see asOfLead), so his own values there need no note; on one
 * with fields drafted by AI (a builder's), his values say so beside those.
 */
export function asOfOrigins(state: Pick<EntryState, 'origin' | 'fieldOrigins' | 'changed'>, p: AsOfProfile): Map<string, Origin> {
  const out = new Map<string, Origin>()
  const mine = allAdams(state)
  for (const r of [p.summary, p.description, ...p.groups.flatMap((g) => g.rows)]) {
    if (!r || r.changed) continue
    const origin = state.fieldOrigins?.[r.key] ?? state.origin
    if (origin !== 'adam' || !mine) out.set(r.key, origin)
  }
  return out
}

export interface AsOfHappening {
  changeId: ID
  /** "Book 1, Ch 2, Sc 1", "The start of Book 2", or "Before any story". */
  where: string
  /** "Lost her left hand". */
  note: string
}

/** What has happened to the entry by a point, oldest first, in the same words as its Changes over time. */
export function asOfHappened(happened: EntryState['happened']): AsOfHappening[] {
  return happened.map((h) => ({
    changeId: h.changeId,
    where: h.where.trim() ? upperFirst(h.where.trim()) : 'Before any story',
    note: upperFirst(h.note.trim())
  }))
}

/** Who made a relationship or fact that holds at a point, and the words it came from: the change that set it. */
export type AsOfSource = Pick<ChangeView, 'origin' | 'links'>

/** Whether a change was made at a place, as a relationship's "where" names it ('' for before any story). */
const madeAt = (c: Pick<ChangeView, 'anchor' | 'where'>, where: string): boolean =>
  c.anchor === 'baseline' ? !where.trim() : c.where.trim() === where.trim()

/**
 * The change that set a relationship as it is at a point: written on the entry it is read from
 * (`aId`), about the other one, at the place it last changed, saying just what it says there. The
 * last such change when there are several (the one that counts). Null when none is found.
 */
export function relationSource(r: RelationshipState, changes: ChangeView[]): AsOfSource | null {
  const same = (x: { otherId: ID; type?: string; feels?: string; otherFeels?: string }): boolean =>
    x.otherId === r.bId && (x.type ?? '') === r.type && (x.feels ?? '') === r.aFeels && (x.otherFeels ?? '') === r.bFeels
  let found: ChangeView | null = null
  for (const c of changes) {
    if (c.entryId !== r.aId || !madeAt(c, r.where)) continue
    if (c.kind === 'relationship' ? !c.payload.ended && same(c.payload) : c.kind === 'full' && (c.payload.relationships ?? []).some(same)) {
      found = c
    }
  }
  return found
}

/**
 * The change by which a character knows a fact: the only one where it learns it, or the last of
 * several made the same way, by Adam or by the AI. Null when several were read from the story or
 * made in different ways, as it can't be told here which one counts.
 */
export function knowsSource(entryId: ID, factId: ID, changes: ChangeView[]): AsOfSource | null {
  const learned = changes.filter(
    (c) =>
      c.entryId === entryId &&
      ((c.kind === 'knowledge' && c.payload.factId === factId && !c.payload.forgets) ||
        (c.kind === 'full' && (c.payload.knows ?? []).some((k) => k.factId === factId)))
  )
  const origins = new Set(learned.map((c) => c.origin))
  return learned.length === 1 || (origins.size === 1 && !origins.has('text')) ? (learned[learned.length - 1] ?? null) : null
}

/** The quiet line under a relationship or fact as of a point. Adam's own need none on an entry that is all his (see asOfLead). */
export function asOfNote(source: AsOfSource | null, adamsEntry: boolean): SourceNote | null {
  if (!source || (source.origin === 'adam' && adamsEntry)) return null
  return sourceNote(source.origin, source.links)
}

export interface AsOfRelation {
  otherId: ID
  /** "Rival of Tobin", or written from the other side, "Tobin: sister of Mara". */
  text: string
  /** "Mara feels: wary · Tobin feels: trusting" (this entry first); null when neither is said. */
  feels: string | null
  /** Where it last changed ("Book 1, Ch 2, Sc 1"); '' when it is as it was from the start. */
  where: string
  /** Who made it as it is here, from the entry's changes (see relationSource). */
  source: AsOfSource | null
}

/**
 * The entry's relationships at a point, from its side, with who made each as it is there (from
 * `changes`, the entry's changes as its page lists them). Ones with an entry that no longer exists
 * are left out.
 */
export function asOfRelations(
  rows: RelationshipState[],
  selfId: ID,
  nameOf: (id: ID) => string | null,
  changes: ChangeView[] = []
): AsOfRelation[] {
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
    out.push({ otherId, text, feels, where: r.where.trim(), source: relationSource(r, changes) })
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
