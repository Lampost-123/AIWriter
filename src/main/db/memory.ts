// All SQL for memory over time (milestone 2): changes, first-exists points, summaries, pins,
// per-scene block modes, Adam's answers, story placement and the shape of a world's stories.
// Pure functions over a better-sqlite3 handle, no Electron imports, so they can be unit-tested in
// plain Node. Which changes count where is worked out in src/main/memory (the line and state),
// never here.

import type Database from 'better-sqlite3'
import type {
  Answer,
  AnswerKind,
  BlockMode,
  Change,
  ChangeAnchor,
  ChangeData,
  ChangeInput,
  Entry,
  ExistsKind,
  ExistsPoint,
  ID,
  Origin,
  Pin,
  PinScope,
  StartAt,
  Summary,
  SummaryLevel
} from '@shared/types'
import type { StoryPlacement } from '@shared/api'
import { newId, now, UserError } from '../util'
import { recordVersion } from './history'
import type { StoryNode, WorldShape } from '../memory/types'
import { placementProblem } from '../memory/line'

type DB = Database.Database
type Row = Record<string, unknown>

const json = <T>(s: unknown, fallback: T): T => {
  if (typeof s !== 'string' || s === '') return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

// ---------- Changes ----------

/** Adds a value to a list in a map of lists. */
function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

/** A payload as stored, with the lists a kind always has filled in (so a damaged row can't break the memory). */
function cleanPayload(kind: ChangeData['kind'], raw: unknown): ChangeData['payload'] {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (kind === 'full')
    return {
      ...p,
      description: p.description ?? '',
      knows: Array.isArray(p.knows) ? p.knows : [],
      relationships: Array.isArray(p.relationships) ? p.relationships : []
    } as ChangeData['payload']
  if (kind === 'update') return { ...p, note: p.note ?? '' } as ChangeData['payload']
  return p as unknown as ChangeData['payload']
}

const toChange = (r: Row): Change =>
  ({
    id: r.id as string,
    entryId: r.entry_id as string,
    anchor: r.anchor as ChangeAnchor,
    storyId: (r.story_id as string) ?? null,
    sceneId: (r.scene_id as string) ?? null,
    kind: r.kind as ChangeData['kind'],
    payload: cleanPayload(r.kind as ChangeData['kind'], json<unknown>(r.payload_json, {})),
    position: r.position as number,
    origin: r.origin as Origin,
    runId: (r.run_id as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string
  }) as Change

const ANCHORS: ChangeAnchor[] = ['baseline', 'story-start', 'scene']
const KINDS: ChangeData['kind'][] = ['update', 'full', 'relationship', 'knowledge', 'thread']

/** The story a scene is in (live or not), or null. */
function sceneStory(db: DB, sceneId: ID): ID | null {
  const r = db.prepare('SELECT c.story_id FROM scenes s JOIN chapters c ON c.id = s.chapter_id WHERE s.id = ?').get(sceneId) as
    | Row
    | undefined
  return r ? (r.story_id as string) : null
}

/** Checks an anchor and fills in the story for a scene change. */
function anchorFor(
  db: DB,
  input: Pick<ChangeInput, 'anchor' | 'storyId' | 'sceneId' | 'kind'>
): { storyId: ID | null; sceneId: ID | null } {
  if (!ANCHORS.includes(input.anchor)) throw new UserError('That change has no place in the story.')
  if (!KINDS.includes(input.kind)) throw new UserError("That kind of change isn't known.")
  if (input.anchor === 'baseline') return { storyId: null, sceneId: null }
  if (input.anchor === 'story-start') {
    if (!input.storyId) throw new UserError('A change at the start of a story needs its story.')
    if (!db.prepare('SELECT 1 FROM stories WHERE id = ? AND deleted_at IS NULL').get(input.storyId)) {
      throw new UserError('That story no longer exists.')
    }
    return { storyId: input.storyId, sceneId: null }
  }
  if (!input.sceneId) throw new UserError('A change in a scene needs its scene.')
  const storyId = sceneStory(db, input.sceneId)
  if (!storyId) throw new UserError('That scene no longer exists.')
  return { storyId, sceneId: input.sceneId }
}

export type NewChange = ChangeInput & {
  origin: Origin
  /** The memory keeper run that makes it (text- and ai-origin changes). */
  runId?: ID | null
  /** Order among changes at the same anchor; after the others when left out. */
  position?: number
}

/** After the other changes at the same place (each query uses the place's index). */
function nextPosition(db: DB, anchor: ChangeAnchor, storyId: ID | null, sceneId: ID | null): number {
  const r =
    anchor === 'scene'
      ? db.prepare("SELECT MAX(position) AS p FROM changes WHERE scene_id = ? AND anchor = 'scene' AND deleted_at IS NULL").get(sceneId)
      : anchor === 'story-start'
        ? db
            .prepare("SELECT MAX(position) AS p FROM changes WHERE story_id = ? AND anchor = 'story-start' AND deleted_at IS NULL")
            .get(storyId)
        : db.prepare("SELECT MAX(position) AS p FROM changes WHERE anchor = 'baseline' AND deleted_at IS NULL").get()
  const p = (r as Row | undefined)?.p
  return typeof p === 'number' ? p + 1 : 0
}

export function getChange(db: DB, id: ID): Change {
  const r = db.prepare('SELECT * FROM changes WHERE id = ? AND deleted_at IS NULL').get(id) as Row | undefined
  if (!r) throw new UserError('That change no longer exists.')
  return toChange(r)
}

export function insertChange(db: DB, c: NewChange): Change {
  const { storyId, sceneId } = anchorFor(db, c)
  const t = now()
  const id = newId()
  const position = c.position ?? nextPosition(db, c.anchor, storyId, sceneId)
  db.prepare(
    `INSERT INTO changes (id, entry_id, anchor, story_id, scene_id, kind, payload_json, position, origin, run_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, c.entryId, c.anchor, storyId, sceneId, c.kind, JSON.stringify(c.payload ?? {}), position, c.origin, c.runId ?? null, t, t)
  const change = getChange(db, id)
  recordVersion(db, { factKind: 'change', factId: id, entryId: change.entryId, data: change, origin: c.origin, runId: c.runId })
  return change
}

/**
 * Replaces a change's anchor, kind and payload. `origin` says who: Adam editing a text-origin change
 * makes it his ('adam'); the memory keeper passes 'text' or 'ai' with its run.
 */
export function replaceChange(db: DB, id: ID, c: ChangeInput & { origin: Origin; runId?: ID | null }): Change {
  const old = getChange(db, id)
  const { storyId, sceneId } = anchorFor(db, c)
  // Moved to another place: it goes after the changes already there.
  const moved = old.anchor !== c.anchor || old.storyId !== storyId || old.sceneId !== sceneId
  db.prepare(
    `UPDATE changes SET entry_id = ?, anchor = ?, story_id = ?, scene_id = ?, kind = ?, payload_json = ?, position = ?, run_id = ?, origin = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    c.entryId,
    c.anchor,
    storyId,
    sceneId,
    c.kind,
    JSON.stringify(c.payload ?? {}),
    moved ? nextPosition(db, c.anchor, storyId, sceneId) : old.position,
    c.runId !== undefined ? c.runId : old.runId,
    c.origin,
    now(),
    id
  )
  const change = getChange(db, id)
  recordVersion(db, { factKind: 'change', factId: id, entryId: change.entryId, data: change, origin: c.origin, runId: c.runId })
  return change
}

/** Removes a change (it stays restorable). `by` says who removed it, for the memory history. */
export function deleteChange(db: DB, id: ID, by: { origin: Origin; runId?: ID | null } = { origin: 'adam' }): void {
  const r = db.prepare('SELECT entry_id FROM changes WHERE id = ? AND deleted_at IS NULL').get(id) as Row | undefined
  if (!r) return
  db.prepare('UPDATE changes SET deleted_at = ? WHERE id = ?').run(now(), id)
  recordVersion(db, { factKind: 'change', factId: id, entryId: r.entry_id as string, data: null, origin: by.origin, runId: by.runId })
}

export function restoreChange(db: DB, id: ID, by: { origin: Origin; runId?: ID | null } = { origin: 'adam' }): void {
  const r = db.prepare('SELECT id FROM changes WHERE id = ?').get(id) as Row | undefined
  if (!r) throw new UserError('That change could not be found to restore.')
  db.prepare('UPDATE changes SET deleted_at = NULL WHERE id = ?').run(id)
  const change = getChange(db, id)
  recordVersion(db, { factKind: 'change', factId: id, entryId: change.entryId, data: change, origin: by.origin, runId: by.runId })
}

const liveEntry = (db: DB, id: ID): boolean => !!db.prepare('SELECT 1 FROM entries WHERE id = ? AND deleted_at IS NULL').get(id)

/**
 * Checks a change Adam made on an entry page and tidies it, with plain-words reasons when it can't be
 * saved. A fact without an id gets a new one (a new fact); empty rows in a full description are dropped.
 */
export function cleanChangeInput(db: DB, input: ChangeInput): ChangeInput {
  if (!input || typeof input !== 'object') throw new UserError('That change is empty.')
  if (!liveEntry(db, input.entryId)) throw new UserError('That page no longer exists. It may have been deleted.')
  const other = (otherId: ID | undefined): ID => {
    if (!otherId) throw new UserError('Pick who or what this relationship is with.')
    if (otherId === input.entryId) throw new UserError('A relationship needs two different entries.')
    if (!liveEntry(db, otherId)) throw new UserError('The other entry in this relationship no longer exists.')
    return otherId
  }
  const text = (s: unknown): string => (typeof s === 'string' ? s.trim() : '')
  const base = { entryId: input.entryId, anchor: input.anchor, storyId: input.storyId ?? null, sceneId: input.sceneId ?? null }
  switch (input.kind) {
    case 'update': {
      const p = input.payload ?? { note: '' }
      const fields = Object.fromEntries(Object.entries(p.fields ?? {}).map(([k, v]) => [k, typeof v === 'string' ? v : '']))
      const payload = { note: text(p.note), ...(p.fields ? { fields } : {}) } as Extract<ChangeData, { kind: 'update' }>['payload']
      if (p.description !== undefined) payload.description = p.description
      if (p.summary !== undefined) payload.summary = p.summary
      if (!payload.note && !Object.keys(fields).length && payload.description === undefined && payload.summary === undefined) {
        throw new UserError('Write what changed first.')
      }
      return { ...base, kind: 'update', payload }
    }
    case 'full': {
      const p = input.payload
      if (!p || !text(p.description)) throw new UserError('Write the starting description first.')
      const knows = (p.knows ?? []).filter((k) => text(k.fact)).map((k) => ({ factId: k.factId || newId(), fact: text(k.fact) }))
      const relationships = (p.relationships ?? [])
        .filter((r) => r.otherId && r.otherId !== input.entryId)
        .map((r) => ({ ...r, otherId: other(r.otherId) }))
      return { ...base, kind: 'full', payload: { ...p, description: p.description, knows, relationships } }
    }
    case 'relationship': {
      const p = input.payload
      return {
        ...base,
        kind: 'relationship',
        payload: { ...p, otherId: other(p?.otherId), type: text(p?.type), feels: p?.feels ?? '', otherFeels: p?.otherFeels ?? '' }
      }
    }
    case 'knowledge': {
      const p = input.payload
      const fact = text(p?.fact)
      if (!fact && !p?.factId) throw new UserError('Write what they learn first.')
      return { ...base, kind: 'knowledge', payload: { factId: p.factId || newId(), fact, ...(p.forgets ? { forgets: true } : {}) } }
    }
    case 'thread': {
      const p = input.payload
      return { ...base, kind: 'thread', payload: { status: p?.status === 'resolved' ? 'resolved' : 'open', note: text(p?.note) } }
    }
    default:
      throw new UserError("That kind of change isn't known.")
  }
}

/** The entries a change is about: its own, and the other side of each relationship it sets. */
export function entriesTouched(c: ChangeData & { entryId: ID }): ID[] {
  const ids = new Set<ID>([c.entryId])
  if (c.kind === 'relationship' && c.payload.otherId) ids.add(c.payload.otherId)
  if (c.kind === 'full') for (const r of c.payload.relationships ?? []) if (r.otherId) ids.add(r.otherId)
  return [...ids]
}

/** Every live change, in a stable order (the line decides which count where). */
export function listAllChanges(db: DB): Change[] {
  return (db.prepare('SELECT * FROM changes WHERE deleted_at IS NULL ORDER BY position, created_at, rowid').all() as Row[]).map(toChange)
}

/** An entry's changes, and changes on other entries that point at it (relationships from the other side). */
export function changesForEntry(db: DB, entryId: ID): Change[] {
  return (
    db
      .prepare(
        `SELECT * FROM changes WHERE deleted_at IS NULL
         AND (entry_id = ? OR (kind IN ('relationship', 'full') AND payload_json LIKE ?))
         ORDER BY position, created_at, rowid`
      )
      .all(entryId, `%${entryId}%`) as Row[]
  )
    .map(toChange)
    .filter(
      (c) =>
        c.entryId === entryId ||
        (c.kind === 'relationship' && c.payload.otherId === entryId) ||
        (c.kind === 'full' && c.payload.relationships.some((r) => r.otherId === entryId))
    )
}

export function changesInScene(db: DB, sceneId: ID): Change[] {
  return (
    db.prepare('SELECT * FROM changes WHERE scene_id = ? AND deleted_at IS NULL ORDER BY position, created_at, rowid').all(sceneId) as Row[]
  ).map(toChange)
}

/** Every fact any character knows (or knew), once each, for picking the same fact again. */
export function listFacts(db: DB): { factId: ID; fact: string }[] {
  const out = new Map<ID, string>()
  // Oldest first, so a fact's latest wording wins; facts only deleted entries knew are left out.
  for (const c of db
    .prepare(
      `SELECT c.kind, c.payload_json FROM changes c JOIN entries e ON e.id = c.entry_id AND e.deleted_at IS NULL
       WHERE c.deleted_at IS NULL AND c.kind IN ('knowledge', 'full') ORDER BY c.updated_at, c.rowid`
    )
    .all() as Row[]) {
    if (c.kind === 'knowledge') {
      const p = json<{ factId?: ID; fact?: string }>(c.payload_json, {})
      if (p.factId && p.fact) out.set(p.factId, p.fact)
    } else {
      for (const k of json<{ knows?: { factId: ID; fact: string }[] }>(c.payload_json, {}).knows ?? [])
        if (k.factId && k.fact) out.set(k.factId, k.fact)
    }
  }
  return [...out].map(([factId, fact]) => ({ factId, fact })).sort((a, b) => a.fact.localeCompare(b.fact))
}

// ---------- Where entries first exist ----------

const toExists = (r: Row): ExistsPoint => ({
  id: r.id as string,
  entryId: r.entry_id as string,
  kind: r.kind as ExistsKind,
  storyId: (r.story_id as string) ?? null,
  sceneId: (r.scene_id as string) ?? null,
  byHand: !!r.by_hand
})

export function listExistsPoints(db: DB, entryId?: ID): ExistsPoint[] {
  const rows = entryId
    ? db.prepare('SELECT * FROM exists_points WHERE entry_id = ? ORDER BY created_at, rowid').all(entryId)
    : db.prepare('SELECT * FROM exists_points ORDER BY created_at, rowid').all()
  return (rows as Row[]).map(toExists)
}

export function addExistsPoint(db: DB, p: Omit<ExistsPoint, 'id'>): ExistsPoint {
  const id = newId()
  db.prepare('INSERT INTO exists_points (id, entry_id, kind, story_id, scene_id, by_hand, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id,
    p.entryId,
    p.kind,
    p.storyId,
    p.sceneId,
    p.byHand ? 1 : 0,
    now()
  )
  return toExists(db.prepare('SELECT * FROM exists_points WHERE id = ?').get(id) as Row)
}

/**
 * For first-exists points at scenes that are deleted (the scene or its chapter; not its story):
 * the place just before each such scene that is still there, as loadShape moves a start point.
 * The scene before it in its chapter, else the end of the chapter before, else the story's start
 * after its start-of-story changes. One query when none are deleted, which is nearly always.
 */
export function placesBeforeDeletedScenes(
  db: DB,
  sceneIds: ID[]
): Map<ID, { storyId: ID; at: 'post' | 'chapter' | 'scene'; refId: ID | null }> {
  const out = new Map<ID, { storyId: ID; at: 'post' | 'chapter' | 'scene'; refId: ID | null }>()
  if (!sceneIds.length) return out
  const gone = db
    .prepare(
      `SELECT s.id, s.chapter_id, s.position, c.story_id, c.position AS chapter_position, c.deleted_at AS chapter_deleted
       FROM scenes s JOIN chapters c ON c.id = s.chapter_id JOIN stories st ON st.id = c.story_id AND st.deleted_at IS NULL
       WHERE s.id IN (SELECT value FROM json_each(?)) AND (s.deleted_at IS NOT NULL OR c.deleted_at IS NOT NULL)`
    )
    .all(JSON.stringify(sceneIds)) as Row[]
  if (!gone.length) return out
  const sceneBefore = db.prepare(
    'SELECT id FROM scenes WHERE chapter_id = ? AND deleted_at IS NULL AND position < ? ORDER BY position DESC, created_at DESC LIMIT 1'
  )
  const chapterBefore = db.prepare(
    'SELECT id FROM chapters WHERE story_id = ? AND deleted_at IS NULL AND position < ? ORDER BY position DESC, created_at DESC LIMIT 1'
  )
  for (const r of gone) {
    const storyId = r.story_id as string
    const scene = r.chapter_deleted ? undefined : (sceneBefore.get(r.chapter_id, r.position) as Row | undefined)
    const chapter = scene ? undefined : (chapterBefore.get(storyId, r.chapter_position) as Row | undefined)
    out.set(
      r.id as string,
      scene
        ? { storyId, at: 'scene', refId: scene.id as string }
        : chapter
          ? { storyId, at: 'chapter', refId: chapter.id as string }
          : { storyId, at: 'post', refId: null }
    )
  }
  return out
}

/** A live story that takes over a deleted story's start, and where in the deleted story it (or the deleted story it is in) started. */
export interface TakeOver {
  storyId: ID
  at: StartAt
  refId: ID | null
}

/**
 * For each deleted story, the live stories that take over its start (they started in it, or in a
 * deleted story that did), as loadShape has them. A first-exists point in a deleted story counts at
 * the start of each of these that started after it, so deleting Kell's Road doesn't make Kell vanish
 * from Kell's Return.
 */
export function storiesTakingOver(db: DB): Map<ID, TakeOver[]> {
  const rows = db.prepare('SELECT id, start_story_id, start_at, start_ref_id, deleted_at FROM stories').all() as Row[]
  const byId = new Map(rows.map((r) => [r.id as string, r]))
  const out = new Map<ID, TakeOver[]>()
  for (const r of rows) {
    if (r.deleted_at) continue
    const seen = new Set<ID>([r.id as string])
    let from = r
    let start = (r.start_story_id as string) ?? null
    while (start && !seen.has(start)) {
      const gone = byId.get(start)
      if (!gone?.deleted_at) break
      seen.add(start)
      pushTo(out, start, {
        storyId: r.id as string,
        at: ((from.start_at as string) ?? 'end') as StartAt,
        refId: (from.start_ref_id as string) ?? null
      })
      from = gone
      start = (gone.start_story_id as string) ?? null
    }
  }
  return out
}

/**
 * Whether each start point (in a story) comes at or after a scene in that story, by chapter and
 * scene order, deleted ones included: so a story that took over a deleted story's start only gets
 * what first existed in that story before it started there.
 */
export function startsAfterScene(db: DB, sceneId: ID, starts: Pick<TakeOver, 'at' | 'refId'>[]): boolean[] {
  const place = (sql: string, id: ID | null): [number, number] | null => {
    const r = id ? (db.prepare(sql).get(id) as Row | undefined) : undefined
    return r ? [r.chapter as number, r.scene as number] : null
  }
  const sceneSql = 'SELECT c.position AS chapter, s.position AS scene FROM scenes s JOIN chapters c ON c.id = s.chapter_id WHERE s.id = ?'
  const scene = place(sceneSql, sceneId)
  return starts.map(({ at, refId }) => {
    if (at === 'end') return true
    if (at === 'pre' || at === 'post' || !scene) return false
    const p =
      at === 'chapter' ? place('SELECT position AS chapter, 1e9 AS scene FROM chapters WHERE id = ?', refId) : place(sceneSql, refId)
    return !!p && (scene[0] < p[0] || (scene[0] === p[0] && scene[1] <= p[1]))
  })
}

/** Replaces an entry's default points (Adam's own are kept). */
export function setDefaultExistsPoints(db: DB, entryId: ID, points: Omit<ExistsPoint, 'id' | 'entryId' | 'byHand'>[]): void {
  db.transaction(() => {
    db.prepare('DELETE FROM exists_points WHERE entry_id = ? AND by_hand = 0').run(entryId)
    for (const p of points) addExistsPoint(db, { ...p, entryId, byHand: false })
  })()
}

/**
 * The world's first story: entries Adam makes in it exist from the beginning of the world. It is the
 * earliest-made story that starts at the beginning of the world and isn't its own version of events
 * (an own version shares nothing with the rest, and a story placed during another can't be first).
 * So it can change when a story's kind or start changes, and defaults are then worked out again.
 * A story whose start story is deleted takes over its start (as in loadShape), so deleting Book 1
 * makes the book after it first.
 */
export function firstStoryId(db: DB): ID | null {
  const rows = db
    .prepare('SELECT id, kind, start_story_id, deleted_at FROM stories ORDER BY created_order, created_at, rowid')
    .all() as Row[]
  const byId = new Map(rows.map((r) => [r.id as string, r]))
  const startsAtBeginning = (r: Row): boolean => {
    const seen = new Set<ID>([r.id as string])
    let start = (r.start_story_id as string) ?? null
    while (start) {
      const s = byId.get(start)
      if (!s || seen.has(start)) return true
      if (!s.deleted_at) return false
      seen.add(start)
      start = (s.start_story_id as string) ?? null
    }
    return true
  }
  const first = rows.find((r) => !r.deleted_at && r.kind !== 'own' && startsAtBeginning(r))
  return first ? (first.id as string) : null
}

/** Kinds of entry found in a scene's text that first exist at that scene (the rest exist from that story's start). */
const FOUND_AT_SCENE: Entry['kind'][] = ['character', 'item', 'event', 'thread']

/**
 * Where an entry first exists by default (spec, Multi-story rules: "Where entries first exist"):
 * - made by a start-of-story change: that story's start, after its start-of-story changes;
 * - read from a scene's text: characters and items at that scene (events and plot threads too, so
 *   earlier scenes never hear of them), places, groups, lore and glossary terms at that story's start;
 * - made by Adam (or drafted by the AI from his page) outside any story or in the world's first story:
 *   the beginning of the world; in any other story: that story's start.
 * "A story's start" is before its start-of-story changes, so a prequel to that story sees the entry too.
 * `firstId` saves a query when working out many entries at once.
 */
export function defaultExistsPoint(
  db: DB,
  e: Pick<Entry, 'kind' | 'origin' | 'originStoryId' | 'originSceneId' | 'originStart'>,
  firstId: ID | null | undefined = undefined
): Omit<ExistsPoint, 'id' | 'entryId' | 'byHand'> {
  const world = { kind: 'world' as const, storyId: null, sceneId: null }
  if (e.originStart && e.originStoryId) return { kind: 'story-post', storyId: e.originStoryId, sceneId: null }
  if (e.origin === 'text') {
    if (FOUND_AT_SCENE.includes(e.kind) && e.originSceneId) {
      return { kind: 'scene', storyId: e.originStoryId ?? sceneStory(db, e.originSceneId), sceneId: e.originSceneId }
    }
    const storyId = e.originStoryId ?? (e.originSceneId ? sceneStory(db, e.originSceneId) : null)
    return storyId ? { kind: 'story-pre', storyId, sceneId: null } : world
  }
  const first = firstId === undefined ? firstStoryId(db) : firstId
  if (!e.originStoryId || e.originStoryId === first) return world
  return { kind: 'story-pre', storyId: e.originStoryId, sceneId: null }
}

/**
 * Works out every entry's default first-exists point again (after a story's kind or start changed).
 * The default is the first point the app gave the entry; it is changed in place, so it stays first.
 * Points Adam set by hand are kept, and so are points the memory keeper added later ("first seen
 * elsewhere": a scene other than the one the entry was found in), which are not defaults. An entry
 * with no default left is left alone. Returns the entries whose points changed.
 */
export function refreshDefaultExistsPoints(db: DB): ID[] {
  const first = firstStoryId(db)
  const points = new Map<ID, ExistsPoint[]>()
  for (const p of listExistsPoints(db)) pushTo(points, p.entryId, p)
  // An entry whose story or scene of origin was removed for good has no default to work out (its
  // points were moved when that happened: settlePlacements), so it is left alone.
  const rows = db
    .prepare(
      `SELECT e.id, e.kind, e.origin, e.origin_story_id, e.origin_scene_id, e.origin_start FROM entries e
       WHERE e.deleted_at IS NULL
         AND (e.origin_story_id IS NULL OR EXISTS (SELECT 1 FROM stories st WHERE st.id = e.origin_story_id))
         AND (e.origin_scene_id IS NULL OR EXISTS (SELECT 1 FROM scenes s WHERE s.id = e.origin_scene_id))`
    )
    .all() as Row[]
  const same = (a: Omit<ExistsPoint, 'id' | 'entryId' | 'byHand'>, b: Omit<ExistsPoint, 'id' | 'entryId' | 'byHand'>): boolean =>
    a.kind === b.kind && (a.storyId ?? null) === (b.storyId ?? null) && (a.sceneId ?? null) === (b.sceneId ?? null)
  const move = db.prepare('UPDATE exists_points SET kind = ?, story_id = ?, scene_id = ? WHERE id = ?')
  const remove = db.prepare('DELETE FROM exists_points WHERE id = ?')
  const changed: ID[] = []
  db.transaction(() => {
    for (const r of rows) {
      const id = r.id as string
      const foundIn = (r.origin_scene_id as string) ?? null
      const mine = points.get(id) ?? []
      // Oldest first: the default, unless Adam set it by hand or the keeper added it at another scene.
      const current = mine.find((p) => !p.byHand && (p.kind !== 'scene' || p.sceneId === foundIn))
      if (mine.length && !current) continue
      const want = defaultExistsPoint(
        db,
        {
          kind: r.kind as Entry['kind'],
          origin: ((r.origin as string) ?? 'adam') as Origin,
          originStoryId: (r.origin_story_id as string) ?? null,
          originSceneId: foundIn,
          originStart: !!r.origin_start
        },
        first
      )
      if (current && same(current, want)) continue
      if (!current) addExistsPoint(db, { ...want, entryId: id, byHand: false })
      else if (mine.some((p) => p !== current && same(p, want))) remove.run(current.id)
      else move.run(want.kind, want.storyId, want.sceneId, current.id)
      changed.push(id)
    }
  })()
  return changed
}

// ---------- Story placement and the shape of a world's stories ----------

/**
 * Sets what a story is and where it starts (and ends, for a side story), after checking the rules
 * (placementProblem: never a story following on from itself, an end before its start, and so on).
 * A prequel starts at its book's start, before that book's start-of-story changes; it is the only
 * kind that does (spec: "A prequel is the exception"), so any other story asked to start there
 * starts after them. A prequel with no book named leads into the book it comes before. Then works
 * out the default first-exists points again. Returns the entries whose points changed.
 */
export function setStoryPlacement(db: DB, id: ID, asked: StoryPlacement): ID[] {
  const start = asked.startStoryId ?? null
  const startAt: StartAt = !start ? 'end' : asked.kind === 'prequel' ? 'pre' : asked.startAt === 'pre' ? 'post' : asked.startAt
  const placement: StoryPlacement = { ...asked, startAt }
  const problem = placementProblem(loadShape(db), id, placement)
  if (problem) throw new UserError(problem)
  const startRefId = start && (startAt === 'chapter' || startAt === 'scene') ? placement.startRefId : null
  const endAt = placement.kind === 'side' ? (placement.endAt ?? 'end') : null
  const endRefId = endAt === 'chapter' ? placement.endRefId : null
  const leadsIntoId = placement.leadsIntoId ?? (placement.kind === 'prequel' ? start : null)
  return db.transaction(() => {
    db.prepare(
      `UPDATE stories SET kind = ?, start_story_id = ?, start_at = ?, start_ref_id = ?, end_at = ?, end_ref_id = ?, leads_into_id = ?,
         updated_at = ? WHERE id = ?`
    ).run(placement.kind, start, startAt, startRefId, endAt, endRefId, leadsIntoId, now(), id)
    return refreshDefaultExistsPoints(db)
  })()
}

/** Stories, chapters and scenes about to be removed for good (a purged story's chapters and scenes included). */
export interface Purging {
  stories: ReadonlySet<ID>
  chapters: ReadonlySet<ID>
  scenes: ReadonlySet<ID>
}

/**
 * Call just before stories, chapters or scenes in Recently deleted are removed for good. While they
 * are only deleted, loadShape keeps every story that starts or ends in them where it was (a story
 * whose start story is deleted takes over its start point; a deleted chapter or scene moves to the
 * one before it), and restoring them puts things back. Once they are gone that can no longer be
 * worked out, so the same safe points are written down here: otherwise a story that followed a
 * removed story would start at the beginning of the world and forget every story before it.
 * Covers stories that are only deleted too, as they can still be restored. Points at things that
 * stay (even deleted ones) are kept, so loadShape still follows them. First-exists points in what is
 * going are written down the same way (settleExistsPoints), or the entries would vanish from every
 * briefing. Returns the stories moved and the entries whose first-exists points moved.
 */
export function settlePlacements(db: DB, gone: Purging): { stories: ID[]; entries: ID[] } {
  const stories = db
    .prepare('SELECT id, kind, start_story_id, start_at, start_ref_id, end_at, end_ref_id, leads_into_id FROM stories')
    .all() as Row[]
  const chapters = db.prepare('SELECT id, story_id, position FROM chapters ORDER BY story_id, position, created_at').all() as Row[]
  const scenes = db.prepare('SELECT id, chapter_id, position FROM scenes ORDER BY chapter_id, position, created_at').all() as Row[]
  const storyRow = new Map(stories.map((r) => [r.id as string, r]))
  const chapterRow = new Map(chapters.map((r) => [r.id as string, r]))
  const sceneRow = new Map(scenes.map((r) => [r.id as string, r]))
  const str = (v: unknown): ID | null => (v as string) ?? null

  type Point = { at: StartAt; refId: ID | null }
  const atStart: Point = { at: 'post', refId: null }
  /** The last chapter of a story before a position that stays. */
  const chapterBefore = (storyId: ID, position: number): ID | null => {
    let found: ID | null = null
    for (const c of chapters) {
      if (c.story_id === storyId && (c.position as number) < position && !gone.chapters.has(c.id as string)) found = c.id as string
    }
    return found
  }
  /** A point in a story, with a chapter or scene that is going moved to the one before it that stays. */
  const keep = (storyId: ID, at: StartAt, refId: ID | null): Point => {
    if (at !== 'chapter' && at !== 'scene') return { at, refId: null }
    if (at === 'chapter') {
      const row = refId ? chapterRow.get(refId) : undefined
      if (!row || row.story_id !== storyId) return atStart
      if (!gone.chapters.has(refId!)) return { at, refId }
      const prev = chapterBefore(storyId, row.position as number)
      return prev ? { at: 'chapter', refId: prev } : atStart
    }
    const row = refId ? sceneRow.get(refId) : undefined
    const chapter = row ? chapterRow.get(row.chapter_id as string) : undefined
    if (!row || !chapter || chapter.story_id !== storyId) return atStart
    if (!gone.scenes.has(refId!)) return { at, refId }
    if (!gone.chapters.has(chapter.id as string)) {
      let earlier: ID | null = null
      for (const s of scenes) {
        if (s.chapter_id === chapter.id && (s.position as number) < (row.position as number) && !gone.scenes.has(s.id as string)) {
          earlier = s.id as string
        }
      }
      if (earlier) return { at: 'scene', refId: earlier }
    }
    const prev = chapterBefore(storyId, chapter.position as number)
    return prev ? { at: 'chapter', refId: prev } : atStart
  }

  const update = db.prepare(
    'UPDATE stories SET start_story_id = ?, start_at = ?, start_ref_id = ?, end_at = ?, end_ref_id = ?, leads_into_id = ? WHERE id = ?'
  )
  const moved: ID[] = []
  const entries: ID[] = []
  db.transaction(() => {
    for (const r of stories) {
      const id = r.id as string
      if (gone.stories.has(id)) continue
      const was = { start: str(r.start_story_id), at: (str(r.start_at) ?? 'end') as StartAt, ref: str(r.start_ref_id) }
      // A start story that is going: take over its start point (and its start story's, if that is going too).
      let start = was.start
      let point: Point = { at: was.at, refId: was.ref }
      let tookOver = false
      const seen = new Set<ID>([id])
      while (start && gone.stories.has(start) && !seen.has(start)) {
        seen.add(start)
        const g = storyRow.get(start)
        if (!g) break
        tookOver = true
        start = str(g.start_story_id)
        point = { at: (str(g.start_at) ?? 'end') as StartAt, refId: str(g.start_ref_id) }
      }
      if (start && (gone.stories.has(start) || !storyRow.has(start))) start = null
      const safe: Point = start ? keep(start, point.at, point.refId) : { at: 'end', refId: null }

      let endAt = str(r.end_at) as 'end' | 'chapter' | null
      let endRef = str(r.end_ref_id)
      if (r.kind === 'side' && tookOver) {
        // A side story whose host is going ends where it now starts, as loadShape has it.
        const chapterOf = (sceneId: ID | null): ID | null => (sceneId ? str(sceneRow.get(sceneId)?.chapter_id) : null)
        endAt = safe.at === 'end' || !start ? 'end' : 'chapter'
        endRef = !start ? null : safe.at === 'chapter' ? safe.refId : safe.at === 'scene' ? chapterOf(safe.refId) : null
      } else if (r.kind === 'side' && start && endAt === 'chapter' && endRef && gone.chapters.has(endRef)) {
        const end = keep(start, 'chapter', endRef)
        endRef = end.at === 'chapter' ? end.refId : null
      }
      const leadsInto = str(r.leads_into_id) && gone.stories.has(r.leads_into_id as string) ? null : str(r.leads_into_id)

      const same =
        start === was.start &&
        safe.at === was.at &&
        safe.refId === was.ref &&
        endAt === str(r.end_at) &&
        endRef === str(r.end_ref_id) &&
        leadsInto === str(r.leads_into_id)
      if (same) continue
      update.run(start, safe.at, safe.refId, endAt, endRef, leadsInto, id)
      moved.push(id)
    }
    entries.push(...settleExistsPoints(db, gone, { stories, chapters, scenes }))
  })()
  return { stories: moved, entries: [...new Set(entries)] }
}

/**
 * settlePlacements' part for first-exists points, written down as loadMemoryData counts them while
 * what they are in is only deleted. A point in a story that is going moves to the start of each
 * story that takes over its start and started after it. A point at a scene that is going (in a story
 * that stays) moves to the next scene that stays, or with none to the last one before it, or the
 * story's start after its start-of-story changes. Returns the entries whose points moved.
 */
function settleExistsPoints(db: DB, gone: Purging, rows: { stories: Row[]; chapters: Row[]; scenes: Row[] }): ID[] {
  const str = (v: unknown): ID | null => (v as string) ?? null
  const storyRow = new Map(rows.stories.map((r) => [r.id as string, r]))
  const chapterRow = new Map(rows.chapters.map((r) => [r.id as string, r]))
  const sceneRow = new Map(rows.scenes.map((r) => [r.id as string, r]))
  /** A scene's place in its story: [chapter position, scene position]. */
  const order = (sceneId: ID | null): [number, number] | null => {
    const s = sceneId ? sceneRow.get(sceneId) : undefined
    const c = s ? chapterRow.get(s.chapter_id as string) : undefined
    return s && c ? [c.position as number, s.position as number] : null
  }
  const before = (a: [number, number], b: [number, number]): boolean => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1])
  const storyOf = (p: ExistsPoint): ID | null =>
    p.kind === 'scene' && p.sceneId
      ? (str(chapterRow.get(str(sceneRow.get(p.sceneId)?.chapter_id) ?? '')?.story_id) ?? p.storyId)
      : p.storyId

  // The stories that stay and take over each story that is going, with where they (or the story they are in) started in it.
  const takers = new Map<ID, TakeOver[]>()
  for (const r of rows.stories) {
    if (gone.stories.has(r.id as string)) continue
    const seen = new Set<ID>([r.id as string])
    let from = r
    let start = str(r.start_story_id)
    while (start && gone.stories.has(start) && !seen.has(start)) {
      seen.add(start)
      const g = storyRow.get(start)
      if (!g) break
      pushTo(takers, start, { storyId: r.id as string, at: (str(from.start_at) ?? 'end') as StartAt, refId: str(from.start_ref_id) })
      from = g
      start = str(g.start_story_id)
    }
  }
  /** Whether a story that took over started after the point. */
  const sees = (p: ExistsPoint, t: TakeOver): boolean => {
    if (p.kind === 'story-pre' || t.at === 'end') return true
    if (p.kind === 'story-post') return t.at !== 'pre'
    if (t.at !== 'chapter' && t.at !== 'scene') return false
    const x = order(p.sceneId)
    const chapter = t.refId ? chapterRow.get(t.refId) : undefined
    const s: [number, number] | null = t.at === 'scene' ? order(t.refId) : chapter ? [chapter.position as number, Infinity] : null
    return !!x && !!s && !before(s, x)
  }
  /** Where a point at a scene that is going moves to, in its story. */
  const instead = (storyId: ID, sceneId: ID): Omit<ExistsPoint, 'id' | 'entryId' | 'byHand'> => {
    const x = order(sceneId)
    const staying = rows.scenes
      .filter((s) => !gone.scenes.has(s.id as string) && str(chapterRow.get(s.chapter_id as string)?.story_id) === storyId)
      .map((s) => ({ id: s.id as string, at: order(s.id as string)! }))
      .sort((a, b) => (before(a.at, b.at) ? -1 : before(b.at, a.at) ? 1 : 0))
    const next = x ? staying.find((s) => before(x, s.at)) : undefined
    const prev = x ? staying.filter((s) => before(s.at, x)).pop() : undefined
    const to = next ?? prev
    return to ? { kind: 'scene', storyId, sceneId: to.id } : { kind: 'story-post', storyId, sceneId: null }
  }

  const points = listExistsPoints(db)
  const key = (p: { entryId: ID; kind: ExistsKind; storyId: ID | null; sceneId: ID | null }): string =>
    [p.entryId, p.kind, p.storyId ?? '', p.sceneId ?? ''].join('|')
  const have = new Set(points.map(key))
  const remove = db.prepare('DELETE FROM exists_points WHERE id = ?')
  const moved: ID[] = []
  for (const p of points) {
    const storyId = storyOf(p)
    let to: Omit<ExistsPoint, 'id' | 'entryId' | 'byHand'>[]
    if (p.kind !== 'world' && storyId && gone.stories.has(storyId)) {
      to = (takers.get(storyId) ?? []).filter((t) => sees(p, t)).map((t) => ({ kind: 'story-pre', storyId: t.storyId, sceneId: null }))
      // Nothing took it over: the point stays, on no story's way, rather than leave the entry with none (which counts everywhere).
      if (!to.length) continue
    } else if (p.kind === 'scene' && p.sceneId && storyId && gone.scenes.has(p.sceneId)) {
      to = [instead(storyId, p.sceneId)]
    } else continue
    for (const q of to) {
      const k = key({ ...q, entryId: p.entryId })
      if (have.has(k)) continue
      have.add(k)
      addExistsPoint(db, { ...q, entryId: p.entryId, byHand: p.byHand })
    }
    remove.run(p.id)
    moved.push(p.entryId)
  }
  return moved
}

/**
 * Every live story with its live chapters and scenes (no text), and Adam's answers: the shape the
 * line is built over. A handful of queries however big the world. Start and end points are made
 * safe here: a story whose start story was deleted takes over that story's start point, and a
 * chapter or scene a story starts or ends after that was deleted moves to the one before it (the
 * previous scene, or the previous chapter's end; with none, the story's start after its
 * start-of-story changes). A side story whose host was deleted ends where it now starts.
 */
export function loadShape(db: DB): WorldShape {
  const storyRows = db
    .prepare(
      `SELECT id, title, kind, series_id, start_story_id, start_at, start_ref_id, end_at, end_ref_id, leads_into_id, leads_in,
         position, created_order, deleted_at FROM stories`
    )
    .all() as Row[]
  const chapterRows = db
    .prepare('SELECT id, story_id, title, position, deleted_at FROM chapters ORDER BY story_id, position, created_at')
    .all() as Row[]
  const sceneRows = db
    .prepare('SELECT id, chapter_id, title, position, deleted_at FROM scenes ORDER BY chapter_id, position, created_at')
    .all() as Row[]

  const rowOf = new Map(storyRows.map((r) => [r.id as string, r]))
  const live = (r: Row | undefined): boolean => !!r && !r.deleted_at
  const nodes = new Map<ID, StoryNode>()
  for (const r of storyRows) {
    if (!live(r)) continue
    nodes.set(r.id as string, {
      id: r.id as string,
      title: r.title as string,
      kind: r.kind as StoryNode['kind'],
      seriesId: (r.series_id as string) ?? null,
      startStoryId: (r.start_story_id as string) ?? null,
      startAt: ((r.start_at as string) ?? 'end') as StoryNode['startAt'],
      startRefId: (r.start_ref_id as string) ?? null,
      endAt: ((r.end_at as string) ?? null) as StoryNode['endAt'],
      endRefId: (r.end_ref_id as string) ?? null,
      leadsIntoId: (r.leads_into_id as string) ?? null,
      leadsIn: !!r.leads_in,
      position: r.position as number,
      createdOrder: r.created_order as number,
      chapters: []
    })
  }

  // Live chapters and scenes in order; every row is kept for moving refs to deleted ones.
  const chapterRow = new Map(chapterRows.map((r) => [r.id as string, r]))
  const sceneRow = new Map(sceneRows.map((r) => [r.id as string, r]))
  const chaptersOf = new Map<ID, Row[]>()
  for (const r of chapterRows) {
    const storyId = r.story_id as string
    if (live(r) && nodes.has(storyId)) pushTo(chaptersOf, storyId, r)
  }
  const scenesOf = new Map<ID, Row[]>()
  for (const r of sceneRows) if (live(r)) pushTo(scenesOf, r.chapter_id as string, r)
  for (const [storyId, rows] of chaptersOf) {
    nodes.get(storyId)!.chapters = rows.map((c) => ({
      id: c.id as string,
      title: c.title as string,
      scenes: (scenesOf.get(c.id as string) ?? []).map((s) => ({ id: s.id as string, title: s.title as string }))
    }))
  }

  /** The live chapter before a position in a story, or null. */
  const chapterBefore = (storyId: ID, position: number): ID | null => {
    const before = (chaptersOf.get(storyId) ?? []).filter((c) => (c.position as number) < position)
    return before.length ? (before[before.length - 1].id as string) : null
  }
  type Point = { at: StoryNode['startAt']; refId: ID | null }
  /** A point in a story, made safe: a deleted chapter or scene moves to the one before it. */
  const safePoint = (storyId: ID, at: StoryNode['startAt'], refId: ID | null): Point => {
    if (at !== 'chapter' && at !== 'scene') return { at, refId: null }
    const node = nodes.get(storyId)!
    const atStart: Point = { at: 'post', refId: null }
    if (at === 'chapter') {
      if (refId && node.chapters.some((c) => c.id === refId)) return { at, refId }
      const row = refId ? chapterRow.get(refId) : undefined
      const prev = row && row.story_id === storyId ? chapterBefore(storyId, row.position as number) : null
      return prev ? { at: 'chapter', refId: prev } : atStart
    }
    if (refId && node.chapters.some((c) => c.scenes.some((s) => s.id === refId))) return { at, refId }
    const row = refId ? sceneRow.get(refId) : undefined
    const chapter = row ? chapterRow.get(row.chapter_id as string) : undefined
    if (!row || !chapter || chapter.story_id !== storyId) return atStart
    if (live(chapter)) {
      const earlier = (scenesOf.get(chapter.id as string) ?? []).filter((s) => (s.position as number) < (row.position as number))
      if (earlier.length) return { at: 'scene', refId: earlier[earlier.length - 1].id as string }
    }
    const prev = chapterBefore(storyId, chapter.position as number)
    return prev ? { at: 'chapter', refId: prev } : atStart
  }

  for (const node of nodes.values()) {
    // A deleted start story: take over its start point (and its start story's, if that is gone too).
    let start = node.startStoryId
    let point: Point = { at: node.startAt, refId: node.startRefId }
    let tookOver = false
    const seen = new Set<ID>([node.id])
    while (start && !nodes.has(start) && !seen.has(start)) {
      seen.add(start)
      const gone = rowOf.get(start)
      if (!gone) break
      tookOver = true
      start = (gone.start_story_id as string) ?? null
      point = { at: ((gone.start_at as string) ?? 'end') as StoryNode['startAt'], refId: (gone.start_ref_id as string) ?? null }
    }
    if (start && !nodes.has(start)) start = null
    node.startStoryId = start
    const safe = start ? safePoint(start, point.at, point.refId) : { at: 'end' as const, refId: null }
    node.startAt = safe.at
    node.startRefId = safe.refId
    if (node.kind !== 'side' || !start) {
      node.endAt = node.kind === 'side' ? 'end' : null
      node.endRefId = null
    } else if (tookOver) {
      const chapterOf = (sceneId: ID | null): ID | null =>
        nodes.get(start!)!.chapters.find((c) => c.scenes.some((s) => s.id === sceneId))?.id ?? null
      node.endAt = safe.at === 'end' ? 'end' : 'chapter'
      node.endRefId = safe.at === 'chapter' ? safe.refId : safe.at === 'scene' ? chapterOf(safe.refId) : null
    } else if (node.endAt === 'chapter') {
      const end = safePoint(start, 'chapter', node.endRefId)
      node.endRefId = end.at === 'chapter' ? end.refId : null
    } else node.endAt = 'end'
    if (node.leadsIntoId && !nodes.has(node.leadsIntoId)) node.leadsIntoId = null
  }

  const stories = [...nodes.values()].sort((a, b) => a.position - b.position || a.createdOrder - b.createdOrder)
  return { stories, answers: listAnswers(db) }
}

/** A scene's title and text, for block 3 (null when it no longer exists). */
export function sceneText(db: DB, sceneId: ID): { title: string; text: string } | null {
  const r = db.prepare('SELECT title, text FROM scenes WHERE id = ? AND deleted_at IS NULL').get(sceneId) as Row | undefined
  return r ? { title: r.title as string, text: r.text as string } : null
}

/** Every series, for story-so-far roll-ups. */
export function seriesNames(db: DB): Map<ID, string> {
  return new Map((db.prepare('SELECT id, name FROM series').all() as Row[]).map((r) => [r.id as string, r.name as string]))
}

// ---------- Summaries ----------

const toSummary = (r: Row): Summary => ({
  level: r.level as SummaryLevel,
  targetId: r.target_id as string,
  text: r.text as string,
  origin: r.origin as Origin,
  stale: !!r.stale,
  updatedAt: r.updated_at as string
})

export function getSummary(db: DB, level: SummaryLevel, targetId: ID): Summary | null {
  const r = db.prepare('SELECT * FROM summaries WHERE level = ? AND target_id = ?').get(level, targetId) as Row | undefined
  return r ? toSummary(r) : null
}

export function listSummaries(db: DB): Summary[] {
  return (db.prepare('SELECT * FROM summaries').all() as Row[]).map(toSummary)
}

/**
 * Writes a summary and its memory-history version. `origin` 'adam' marks Adam's own words (never
 * replaced automatically); `sourceHash` records what an automatic one was made from.
 */
export function putSummary(
  db: DB,
  s: {
    level: SummaryLevel
    targetId: ID
    text: string
    origin: Origin
    sourceHash?: string
    generationId?: ID | null
    runId?: ID | null
  }
): Summary {
  db.prepare(
    `INSERT INTO summaries (level, target_id, text, origin, stale, source_hash, generation_id, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?)
     ON CONFLICT(level, target_id) DO UPDATE SET text = excluded.text, origin = excluded.origin, stale = 0,
       source_hash = excluded.source_hash, generation_id = excluded.generation_id, updated_at = excluded.updated_at`
  ).run(s.level, s.targetId, s.text, s.origin, s.sourceHash ?? '', s.generationId ?? null, now())
  const summary = getSummary(db, s.level, s.targetId)!
  recordVersion(db, {
    factKind: 'summary',
    factId: `${s.level}:${s.targetId}`,
    entryId: null,
    data: summary,
    origin: s.origin,
    runId: s.runId
  })
  return summary
}

/** True when the scene, chapter, story or series a summary is for still exists. */
export function summaryTargetExists(db: DB, level: SummaryLevel, targetId: ID): boolean {
  const table = { scene: 'scenes', chapter: 'chapters', story: 'stories', series: 'series' }[level]
  if (!table) return false
  const live = level === 'series' ? '' : ' AND deleted_at IS NULL'
  return !!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?${live}`).get(targetId)
}

export function markSummaryStale(db: DB, level: SummaryLevel, targetId: ID): void {
  db.prepare('UPDATE summaries SET stale = 1 WHERE level = ? AND target_id = ?').run(level, targetId)
}

/** A story's scene and chapter summaries and its own. */
export function storySummaries(db: DB, storyId: ID): Summary[] {
  return (
    db
      .prepare(
        `SELECT su.* FROM summaries su WHERE
           (su.level = 'story' AND su.target_id = ?)
           OR (su.level = 'chapter' AND su.target_id IN (SELECT id FROM chapters WHERE story_id = ? AND deleted_at IS NULL))
           OR (su.level = 'scene' AND su.target_id IN (
                SELECT s.id FROM scenes s JOIN chapters c ON c.id = s.chapter_id
                WHERE c.story_id = ? AND s.deleted_at IS NULL AND c.deleted_at IS NULL))`
      )
      .all(storyId, storyId, storyId) as Row[]
  ).map(toSummary)
}

// ---------- Pins and block modes ----------

const toPin = (r: Row): Pin => ({
  id: r.id as string,
  scope: r.scope as PinScope,
  scopeId: (r.scope_id as string) || null,
  entryId: r.entry_id as string,
  action: r.action as Pin['action']
})

export function setPin(db: DB, entryId: ID, scope: PinScope, scopeId: ID | null, action: Pin['action'] | null): void {
  if (scope !== 'scene' && scope !== 'story' && scope !== 'world')
    throw new UserError('Pin it to this scene, this story or the whole world.')
  if (action !== null && action !== 'pin' && action !== 'hide') throw new UserError("That briefing choice isn't known.")
  const sid = scope === 'world' ? '' : (scopeId ?? '')
  if (scope !== 'world' && !sid) throw new UserError('Pick the scene or story to pin this to.')
  if (action !== null && !liveEntry(db, entryId)) throw new UserError('That page no longer exists. It may have been deleted.')
  if (action === null) {
    db.prepare('DELETE FROM pins WHERE scope = ? AND scope_id = ? AND entry_id = ?').run(scope, sid, entryId)
    return
  }
  db.prepare(
    `INSERT INTO pins (id, scope, scope_id, entry_id, action, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(scope, scope_id, entry_id) DO UPDATE SET action = excluded.action`
  ).run(newId(), scope, sid, entryId, action, now())
}

/** The pins that apply to a scene: its own, its story's and the world's. */
export function pinsForScene(db: DB, sceneId: ID): Pin[] {
  const storyId = sceneStory(db, sceneId) ?? ''
  return (
    db
      .prepare(
        `SELECT p.* FROM pins p JOIN entries e ON e.id = p.entry_id AND e.deleted_at IS NULL
         WHERE (p.scope = 'scene' AND p.scope_id = ?) OR (p.scope = 'story' AND p.scope_id = ?) OR p.scope = 'world'
         ORDER BY p.created_at, p.rowid`
      )
      .all(sceneId, storyId) as Row[]
  ).map(toPin)
}

interface SceneContextPrefs {
  blockModes?: Record<string, BlockMode>
}

export function getBlockModes(db: DB, sceneId: ID): Record<string, BlockMode> {
  const r = db.prepare('SELECT context_json FROM scenes WHERE id = ?').get(sceneId) as Row | undefined
  return json<SceneContextPrefs>(r?.context_json, {}).blockModes ?? {}
}

export function setBlockMode(db: DB, sceneId: ID, blockId: string, mode: BlockMode): void {
  const r = db.prepare('SELECT context_json FROM scenes WHERE id = ? AND deleted_at IS NULL').get(sceneId) as Row | undefined
  if (!r) throw new UserError('That scene no longer exists.')
  if (mode !== 'auto' && mode !== 'full' && mode !== 'short')
    throw new UserError('Choose full, short or automatic for that part of the briefing.')
  const prefs = json<SceneContextPrefs>(r.context_json, {})
  const modes = { ...(prefs.blockModes ?? {}) }
  if (mode === 'auto') delete modes[blockId]
  else modes[blockId] = mode
  db.prepare('UPDATE scenes SET context_json = ? WHERE id = ?').run(JSON.stringify({ ...prefs, blockModes: modes }), sceneId)
}

// ---------- Adam's answers ----------

const toAnswer = (r: Row): Answer => ({
  id: r.id as string,
  kind: r.kind as AnswerKind,
  key: r.key as string,
  value: json<unknown>(r.value_json, null)
})

export function listAnswers(db: DB): Answer[] {
  return (db.prepare('SELECT * FROM answers ORDER BY created_at, rowid').all() as Row[]).map(toAnswer)
}

export function setAnswer(db: DB, kind: AnswerKind, key: string, value: unknown): void {
  const t = now()
  db.prepare(
    `INSERT INTO answers (id, kind, key, value_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(kind, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
  ).run(newId(), kind, key, JSON.stringify(value), t, t)
}

export function clearAnswer(db: DB, kind: AnswerKind, key: string): void {
  db.prepare('DELETE FROM answers WHERE kind = ? AND key = ?').run(kind, key)
}
