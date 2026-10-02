// Reading each story flow's reply. Its shape is checked first (what is wrong is said in a few words,
// so the model can be asked once more); then each item is read leniently, and one that can't be used
// (an id that wasn't given, an empty description) is skipped on its own. Pure.

import type { ChangeData, EntryKind, EntryState, FullPayload, ID, RelationshipPayload } from '@shared/types'
import { bool, str, strList } from '../keeper/json'
import { fieldKeys } from '../keeper/prompts'
import { newId } from '../util'
import type { ShortIds } from './context'

type Obj = Record<string, unknown>
type Checked<T> = { ok: true; value: T } | { ok: false; why: string }

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** The first of these keys the object has, as a list of objects (or of anything, with `any`). */
function list(value: Obj, names: string[], key: string, any = false): Checked<unknown[]> | null {
  const name = names.find((n) => n in value)
  if (!name) return null
  const v = value[name]
  if (v == null) return { ok: true, value: [] }
  if (!Array.isArray(v)) return { ok: false, why: `its "${key}" was not a list` }
  return { ok: true, value: any ? v : v.filter(isObj) }
}

/** Fields a reply may set for this kind of entry, with their values tidied; empty ones are left out. */
function cleanFields(kind: EntryKind, v: unknown): Record<string, string> {
  if (!isObj(v)) return {}
  const allowed = new Set(fieldKeys(kind))
  const out: Record<string, string> = {}
  for (const [k, raw] of Object.entries(v)) {
    const value = str(raw, 300)
    if (allowed.has(k) && value) out[k] = value
  }
  return out
}

// ---------- What changed in a time gap ----------

export interface GapReply {
  changes: Obj[]
  closed: unknown[]
}

export function gapShape(value: unknown): Checked<GapReply> {
  if (!isObj(value)) return { ok: false, why: 'it was not a JSON object' }
  const changes = list(value, ['changes', 'items'], 'changes')
  const closed = list(value, ['closed', 'threads'], 'closed', true)
  if (!changes && !closed) return { ok: false, why: 'it had neither the "changes" nor the "closed" list' }
  if (changes && !changes.ok) return changes
  if (closed && !closed.ok) return closed
  return { ok: true, value: { changes: (changes?.value ?? []) as Obj[], closed: closed?.value ?? [] } }
}

export interface GapPlan {
  /** Changes at the story's start, each for one entry. */
  changes: { entryId: ID; data: Extract<ChangeData, { kind: 'update' | 'relationship' }> }[]
  /** Open plot threads left unanswered. */
  closed: ID[]
}

/** What the reply asks for, about the entries and threads the request listed only. */
export function readGap(reply: GapReply, ids: ShortIds, kinds: Map<ID, EntryKind>, threads: Set<ID>): GapPlan {
  const plan: GapPlan = { changes: [], closed: [] }
  const seen = new Set<string>()
  for (const v of reply.changes) {
    const entryId = ids.get(v.entry ?? v.id)
    const kind = entryId ? kinds.get(entryId) : undefined
    if (!entryId || !kind) continue
    const otherId = ids.get(v.other)
    const type = str(v.type, 20).toLowerCase()
    let data: GapPlan['changes'][number]['data'] | null = null
    if (type === 'relationship' || (!type && otherId)) {
      if (!otherId || otherId === entryId || !kinds.has(otherId)) continue
      const payload: RelationshipPayload = {
        otherId,
        type: str(v.rel ?? v.relationship ?? v.kind, 80) || 'linked',
        feels: str(v.feels, 200),
        otherFeels: str(v.otherFeels, 200)
      }
      if (bool(v.ended)) payload.ended = true
      data = { kind: 'relationship', payload }
    } else {
      const note = str(v.note, 200).replace(/[.;]+$/, '')
      const fields = cleanFields(kind, v.fields)
      if (!note && !Object.keys(fields).length) continue
      data = { kind: 'update', payload: Object.keys(fields).length ? { note, fields } : { note } }
    }
    const key = `${entryId}:${JSON.stringify(data)}`
    if (seen.has(key)) continue
    seen.add(key)
    plan.changes.push({ entryId, data })
  }
  for (const v of reply.closed) {
    const id = ids.get(isObj(v) ? (v.thread ?? v.entry ?? v.id) : v)
    if (id && threads.has(id) && !plan.closed.includes(id)) plan.closed.push(id)
  }
  return plan
}

// ---------- A prequel's starting cast ----------

export interface CastReply {
  cast: Obj[]
}

export function castShape(value: unknown): Checked<CastReply> {
  if (!isObj(value)) return { ok: false, why: 'it was not a JSON object' }
  const cast = list(value, ['cast', 'entries', 'drafts'], 'cast')
  if (!cast) return { ok: false, why: 'it had no "cast" list' }
  if (!cast.ok) return cast
  return { ok: true, value: { cast: cast.value as Obj[] } }
}

/** A starting description for each entry asked for (the first one the reply gives for it). */
export function readCast(reply: CastReply, ids: ShortIds, drafting: EntryState[]): { entryId: ID; payload: FullPayload }[] {
  const asked = new Map(drafting.map((e) => [e.id, e]))
  const out: { entryId: ID; payload: FullPayload }[] = []
  for (const v of reply.cast) {
    const entryId = ids.get(v.entry ?? v.id)
    const e = entryId ? asked.get(entryId) : undefined
    if (!entryId || !e || out.some((d) => d.entryId === entryId)) continue
    const description = typeof v.description === 'string' ? v.description.trim().slice(0, 4000) : ''
    if (!description) continue
    const payload: FullPayload = { description, knows: [], relationships: [] }
    const summary = str(v.summary, 300)
    if (summary) payload.summary = summary
    const fields = cleanFields(e.kind, v.fields)
    if (Object.keys(fields).length) payload.fields = fields
    for (const r of Array.isArray(v.relationships) ? v.relationships.filter(isObj) : []) {
      const otherId = ids.get(r.other ?? r.entry)
      if (!otherId || otherId === entryId || payload.relationships.some((x) => x.otherId === otherId)) continue
      payload.relationships.push({
        otherId,
        type: str(r.rel ?? r.type ?? r.relationship, 80) || 'linked',
        feels: str(r.feels, 200),
        otherFeels: str(r.otherFeels, 200)
      })
    }
    if (e.kind === 'character') payload.knows = strList(v.knows, 8).map((fact) => ({ factId: newId(), fact }))
    out.push({ entryId, payload })
  }
  return out
}

// ---------- When did these happen? ----------

export type WhenPick = 'before' | 'after' | 'in'

export interface WhenReply {
  changes: Obj[]
}

export function whenShape(value: unknown): Checked<WhenReply> {
  if (!isObj(value)) return { ok: false, why: 'it was not a JSON object' }
  const changes = list(value, ['changes', 'sorted', 'items'], 'changes')
  if (!changes) return { ok: false, why: 'it had no "changes" list' }
  if (!changes.ok) return changes
  return { ok: true, value: { changes: changes.value as Obj[] } }
}

const PICKS: [RegExp, WhenPick][] = [
  [/^(in|during)\b|happens in/i, 'in'],
  [/^before\b/i, 'before'],
  [/^after\b/i, 'after']
]

/**
 * The model's pick for each change it was given; "after" (left where it is) for any it skipped or
 * was unsure of. "In the new story" needs one of the new story's scenes, so without one it is "after".
 */
export function readWhen(reply: WhenReply, changeIds: ShortIds, sceneIds: ShortIds): Map<ID, { pick: WhenPick; sceneId: ID | null }> {
  const out = new Map<ID, { pick: WhenPick; sceneId: ID | null }>()
  for (const v of reply.changes) {
    const changeId = changeIds.get(v.change ?? v.id)
    if (!changeId || out.has(changeId)) continue
    const said = str(v.when ?? v.pick, 40)
    const pick = PICKS.find(([re]) => re.test(said))?.[1] ?? 'after'
    const sceneId = sceneIds.get(v.scene) ?? null
    out.set(changeId, pick === 'in' && !sceneId ? { pick: 'after', sceneId: null } : { pick, sceneId: pick === 'in' ? sceneId : null })
  }
  return out
}
