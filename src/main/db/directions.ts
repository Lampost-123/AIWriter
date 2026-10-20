// The direction composer's one query (contracts/direction.ts): the directions Adam gave before, read back from the
// generation records, where every draft, beat and AI edit already keeps the words it was given (`direction`, migration 1;
// a variant's own in params_json). Read-only: no migration, nothing written. Pure functions over a better-sqlite3 handle,
// no Electron imports.
import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'
import type { DirectionKind, DirectionSource, RecentDirection } from '@shared/contracts/direction'
import { beatDirections, directionKey, tidyDirection } from '@shared/directions'

type DB = Database.Database
type Row = Record<string, unknown>

/** How many directions are offered when the box doesn't say. */
export const RECENT_DEFAULT = 40
const RECENT_MOST = 200
/** Records read for each direction asked for (the same words given again, a set's variants, are many records). */
const ROWS_EACH = 6

const param = (path: string): string => `CASE WHEN json_valid(g.params_json) THEN json_extract(g.params_json, '${path}') END`

/**
 * Which records hold Adam's own words, by kind. Scene: Generate's drafts and Variants (never Write the whole chapter's,
 * whose directions the app writes), Beat by beat's beats, and Continue. Rewrite: the AI edits' Rewrite. Change tone's
 * direction is the tone's name, and the other edits have none.
 */
function kindSql(kind: DirectionKind): string {
  const scene = `((g.job = 'draft' AND ${param('$.chapterWriter')} IS NULL) OR g.job = 'beat' OR (g.job = 'edit' AND ${param('$.tool')} = 'continue'))`
  const rewrite = `(g.job = 'edit' AND ${param('$.tool')} = 'rewrite')`
  return kind === 'rewrite' ? rewrite : kind === 'all' ? `(${scene} OR ${rewrite})` : scene
}

/**
 * One record's directions, each with where it was given and the occasion it was given on (a set's variants share theirs,
 * as do a Beat by beat session's beats for the scene's direction), so the same words given once count once.
 */
function directionsOf(r: Row): { text: string; source: DirectionSource; once: string }[] {
  const direction = typeof r.direction === 'string' ? r.direction : ''
  const id = r.id as string
  const job = r.job as string
  if (job === 'beat') {
    const session = typeof r.session === 'string' ? r.session : id
    const [first, second] = beatDirections(direction)
    // With two, the first is the scene's (said with every beat of the session) and the second the beat's own note.
    if (second !== undefined) return [{ text: first, source: 'beat', once: `b:${session}` }, { text: second, source: 'beat', once: id }]
    const own = direction.includes('For this beat: ')
    return first ? [{ text: first, source: 'beat', once: own ? id : `b:${session}` }] : []
  }
  if (job === 'edit') return [{ text: direction, source: r.tool === 'rewrite' ? 'rewrite' : 'continue', once: id }]
  if (typeof r.setId === 'string') {
    // A variant: the set's direction, and its own beside it.
    const note = typeof r.note === 'string' ? r.note : ''
    return [
      { text: direction, source: 'variants', once: `v:${r.setId}` },
      { text: note, source: 'variants', once: id }
    ]
  }
  return [{ text: direction, source: 'draft', once: id }]
}

/**
 * The directions given in the open world, or in one story's scenes, newest first and each set of words once (with how
 * many times it was given and where it was given last). See DirectionApi.recentDirections.
 */
export function recentDirections(db: DB, o: { storyId?: ID | null; limit?: number; kind?: DirectionKind } = {}): RecentDirection[] {
  const limit = Math.max(1, Math.min(RECENT_MOST, Math.floor(o.limit ?? RECENT_DEFAULT)))
  const story = o.storyId ? 'JOIN scenes s ON s.id = g.scene_id JOIN chapters c ON c.id = s.chapter_id AND c.story_id = ?' : ''
  const rows = db
    .prepare(
      `SELECT g.id, g.direction, g.job, g.created_at,
              ${param('$.tool')} AS tool,
              ${param('$.variant.setId')} AS setId,
              ${param('$.variant.note')} AS note,
              ${param('$.beat.sessionId')} AS session
       FROM generations g ${story}
       WHERE ${kindSql(o.kind ?? 'scene')}
         AND (g.direction <> '' OR ${param('$.variant.note')} IS NOT NULL)
       ORDER BY g.created_at DESC, g.rowid DESC
       LIMIT ?`
    )
    .all(...(o.storyId ? [o.storyId] : []), limit * ROWS_EACH) as Row[]
  const seen = new Map<string, RecentDirection>()
  const counted = new Set<string>()
  for (const r of rows) {
    for (const d of directionsOf(r)) {
      const text = tidyDirection(d.text)
      const key = directionKey(text)
      if (!key) continue
      const occasion = `${key}|${d.once}`
      const first = !counted.has(occasion)
      counted.add(occasion)
      const had = seen.get(key)
      if (!had) seen.set(key, { text, at: r.created_at as string, source: d.source, uses: 1 })
      else if (first) had.uses++
    }
  }
  return [...seen.values()].slice(0, limit)
}
