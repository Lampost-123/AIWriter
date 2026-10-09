// Where each beat of a scene's latest beat by beat session is on the page (2026-10-08): the paragraph ids
// each beat wrote and the versions of it that went in, kept in the world's meta table (one row a scene,
// `beat_marks:<scene id>`), so the beat markers and the per-beat menu outlive Finish and a restart. No
// migration: the meta table is the world's own key-value store (as checks/report.ts and continuity use).
// The interface works out everything else from the page (features/beats/marks.ts).

import type { BeatMark, BeatVersion, SceneBeatMarks } from '@shared/contracts/beats'
import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'
import * as repo from '../db/repo'

type DB = Database.Database

const KEY = (sceneId: ID): string => `beat_marks:${sceneId}`

/** Kept to a sensible size, whatever is sent. */
export const MAX_BEATS = 100
export const MAX_PIDS = 2000
export const MAX_VERSIONS = 40

const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64

function cleanVersion(v: unknown): BeatVersion | null {
  const x = v as Partial<BeatVersion> | null
  if (!x || !isId(x.recordId) || typeof x.at !== 'number' || !Number.isFinite(x.at)) return null
  return { recordId: x.recordId, at: x.at, sig: typeof x.sig === 'string' ? x.sig.slice(0, 64) : '' }
}

function cleanBeat(v: unknown): BeatMark | null {
  const x = v as Partial<BeatMark> | null
  const index = Math.floor(Number(x?.index))
  if (!x || !Number.isFinite(index) || index < 1 || index > MAX_BEATS) return null
  const pids = [...new Set(Array.isArray(x.pids) ? x.pids.filter(isId) : [])].slice(-MAX_PIDS)
  const versions = (Array.isArray(x.versions) ? x.versions : [])
    .map(cleanVersion)
    .filter((y): y is BeatVersion => !!y)
    .slice(-MAX_VERSIONS)
  const out: BeatMark = { index, pids, versions }
  if (typeof x.keptAt === 'number' && Number.isFinite(x.keptAt)) out.keptAt = x.keptAt
  return out
}

/** The marks as sent (or as read back), tidied: null when they aren't marks of this scene, or have no beats and aren't open. */
export function cleanMarks(sceneId: ID, v: unknown): SceneBeatMarks | null {
  const x = v as Partial<SceneBeatMarks> | null
  if (!x || typeof x !== 'object' || !isId(x.sessionId)) return null
  const seen = new Set<number>()
  const beats = (Array.isArray(x.beats) ? x.beats : [])
    .map(cleanBeat)
    .filter((b): b is BeatMark => !!b && !seen.has(b.index) && !!seen.add(b.index))
    .sort((a, b) => a.index - b.index)
  // A session still on is kept with no beats too (its first beat hasn't put words on the page yet), so it can carry on.
  if (!beats.length && x.open !== true) return null
  const of = Math.max(1, Math.min(MAX_BEATS, Math.floor(Number(x.of)) || (beats.at(-1)?.index ?? 1)))
  const out: SceneBeatMarks = { sceneId, sessionId: x.sessionId, of, mode: x.mode === 'below' ? 'below' : 'whole', beats }
  if (x.open === true) out.open = true
  else if (x.left === true) out.left = true
  if (x.start === 'replace' || x.start === 'add') out.start = x.start
  return out
}

export function getBeatMarks(db: DB, sceneId: ID): SceneBeatMarks | null {
  const raw = repo.getMeta(db, KEY(sceneId))
  if (!raw) return null
  try {
    return cleanMarks(sceneId, JSON.parse(raw))
  } catch {
    return null
  }
}

export function saveBeatMarks(db: DB, sceneId: ID, marks: unknown): void {
  const clean = marks == null ? null : cleanMarks(sceneId, marks)
  if (!clean) db.prepare('DELETE FROM meta WHERE key = ?').run(KEY(sceneId))
  else repo.setMeta(db, KEY(sceneId), JSON.stringify(clean))
}
