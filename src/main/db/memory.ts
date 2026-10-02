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

/** A payload as stored, with the lists a kind always has filled in (so a damaged row can't break the memory). */
function cleanPayload(kind: ChangeData['kind'], raw: unknown): ChangeData['payload'] {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (kind === 'full') return { ...p, description: p.description ?? '', knows: Array.isArray(p.knows) ? p.knows : [], relationships: Array.isArray(p.relationships) ? p.relationships : [] } as ChangeData['payload']
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
        ? db.prepare("SELECT MAX(position) AS p FROM changes WHERE story_id = ? AND anchor = 'story-start' AND deleted_at IS NULL").get(storyId)
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
  ).run(
    id,
    c.entryId,
    c.anchor,
    storyId,
    sceneId,
    c.kind,
    JSON.stringify(c.payload ?? {}),
    position,
    c.origin,
    c.runId ?? null,
    t,
    t
  )
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
  if (!liveEntry(db, input.entryId)) throw new UserError('That entry no longer exists.')
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
      const relationships = (p.relationships ?? []).filter((r) => r.otherId && r.otherId !== input.entryId).map((r) => ({ ...r, otherId: other(r.otherId) }))
      return { ...base, kind: 'full', payload: { ...p, description: p.description, knows, relationships } }
    }
    case 'relationship': {
      const p = input.payload
      return { ...base, kind: 'relationship', payload: { ...p, otherId: other(p?.otherId), type: text(p?.type), feels: p?.feels ?? '', otherFeels: p?.otherFeels ?? '' } }
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
 */
export function firstStoryId(db: DB): ID | null {
  const r = db
    .prepare(
      `SELECT id FROM stories WHERE deleted_at IS NULL AND start_story_id IS NULL AND kind <> 'own'
       ORDER BY created_order, created_at LIMIT 1`
    )
    .get() as Row | undefined
  return r ? (r.id as string) : null
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
 * Points Adam set by hand are kept, and an entry with only his points is left alone. Returns the
 * entries whose points changed.
 */
export function refreshDefaultExistsPoints(db: DB): ID[] {
  const first = firstStoryId(db)
  const points = new Map<ID, ExistsPoint[]>()
  for (const p of listExistsPoints(db)) points.set(p.entryId, [...(points.get(p.entryId) ?? []), p])
  const rows = db
    .prepare('SELECT id, kind, origin, origin_story_id, origin_scene_id, origin_start FROM entries WHERE deleted_at IS NULL')
    .all() as Row[]
  const same = (a: Omit<ExistsPoint, 'id' | 'entryId' | 'byHand'>, b: Omit<ExistsPoint, 'id' | 'entryId' | 'byHand'>): boolean =>
    a.kind === b.kind && (a.storyId ?? null) === (b.storyId ?? null) && (a.sceneId ?? null) === (b.sceneId ?? null)
  const changed: ID[] = []
  db.transaction(() => {
    for (const r of rows) {
      const id = r.id as string
      const mine = points.get(id) ?? []
      const defaults = mine.filter((p) => !p.byHand)
      if (mine.length && !defaults.length) continue
      const want = defaultExistsPoint(
        db,
        {
          kind: r.kind as Entry['kind'],
          origin: ((r.origin as string) ?? 'adam') as Origin,
          originStoryId: (r.origin_story_id as string) ?? null,
          originSceneId: (r.origin_scene_id as string) ?? null,
          originStart: !!r.origin_start
        },
        first
      )
      if (defaults.length === 1 && same(defaults[0], want)) continue
      setDefaultExistsPoints(db, id, [want])
      changed.push(id)
    }
  })()
  return changed
}

// ---------- Story placement and the shape of a world's stories ----------

/**
 * Sets what a story is and where it starts (and ends, for a side story), after checking the rules
 * (placementProblem: never a story following on from itself, an end before its start, and so on).
 * A prequel with no book named leads into the book it comes before. Then works out the default
 * first-exists points again. Returns the entries whose points changed.
 */
export function setStoryPlacement(db: DB, id: ID, placement: StoryPlacement): ID[] {
  const problem = placementProblem(loadShape(db), id, placement)
  if (problem) throw new UserError(problem)
  const start = placement.startStoryId ?? null
  const startAt = start ? placement.startAt : 'end'
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
  const chapterRows = db.prepare('SELECT id, story_id, title, position, deleted_at FROM chapters ORDER BY story_id, position, created_at').all() as Row[]
  const sceneRows = db.prepare('SELECT id, chapter_id, title, position, deleted_at FROM scenes ORDER BY chapter_id, position, created_at').all() as Row[]

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
    if (live(r) && nodes.has(storyId)) chaptersOf.set(storyId, [...(chaptersOf.get(storyId) ?? []), r])
  }
  const scenesOf = new Map<ID, Row[]>()
  for (const r of sceneRows) if (live(r)) scenesOf.set(r.chapter_id as string, [...(scenesOf.get(r.chapter_id as string) ?? []), r])
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
  recordVersion(db, { factKind: 'summary', factId: `${s.level}:${s.targetId}`, entryId: null, data: summary, origin: s.origin, runId: s.runId })
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
  if (scope !== 'scene' && scope !== 'story' && scope !== 'world') throw new UserError('Pin it to this scene, this story or the whole world.')
  if (action !== null && action !== 'pin' && action !== 'hide') throw new UserError("That briefing choice isn't known.")
  const sid = scope === 'world' ? '' : (scopeId ?? '')
  if (scope !== 'world' && !sid) throw new UserError('Pick the scene or story to pin this to.')
  if (action !== null && !liveEntry(db, entryId)) throw new UserError('That entry no longer exists.')
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
  if (mode !== 'auto' && mode !== 'full' && mode !== 'short') throw new UserError('Choose full, short or automatic for that part of the briefing.')
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
