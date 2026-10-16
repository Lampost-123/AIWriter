// What a scene's words call its characters (long story memory fix 12, 2026-10-15): "the Captain", "her brother", read by
// the memory keeper (keeper/names.ts), kept in the world's meta table (one row a scene, `called:<scene id>`), so the
// writer's briefing (ai/gather.ts) and the page's underlines (manuscript/sceneNames.ts) find the character by them in
// that scene and at the end of it. No migration: the meta table is the world's own key-value store (as beats/marks.ts
// uses). Words no longer in the scene's text stop counting at its next read (forgetCalledNotIn); a scene emptied from
// Recently deleted takes its row with it (db/trash.ts).

import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'
import { foldApostrophes, namedInProse, type CalledName } from '@shared/names'
import * as repo from './repo'

type DB = Database.Database

export const CALLED_PREFIX = 'called:'
const key = (sceneId: ID): string => `${CALLED_PREFIX}${sceneId}`

/** The most kept for one scene: the newest stay. */
export const MOST_CALLED = 30
/** The longest words kept. */
const LONGEST = 60

const plain = (s: string): string => foldApostrophes(s.toLocaleLowerCase()).replace(/\s+/g, ' ').trim()

function cleanList(v: unknown): CalledName[] {
  const out: CalledName[] = []
  for (const x of Array.isArray(v) ? v : []) {
    const c = x as Partial<CalledName> | null
    const words = typeof c?.words === 'string' ? c.words.replace(/\s+/g, ' ').trim() : ''
    if (typeof c?.entryId !== 'string' || !c.entryId || words.length < 2 || words.length > LONGEST) continue
    out.push({ entryId: c.entryId, words })
  }
  return out.slice(-MOST_CALLED)
}

/** What a scene's words call its characters, oldest first; empty when the memory has read none there. */
export function calledIn(db: DB, sceneId: ID | null | undefined): CalledName[] {
  if (!sceneId) return []
  const raw = repo.getMeta(db, key(sceneId))
  if (!raw) return []
  try {
    return cleanList(JSON.parse(raw))
  } catch {
    return []
  }
}

/**
 * Keeps what a read found a scene's words call its characters. The same words for someone else take the place of the
 * old (the newest read wins, as the words may have changed); the newest MOST_CALLED are kept.
 */
export function keepCalled(db: DB, sceneId: ID, found: CalledName[]): void {
  const fresh = cleanList(found)
  if (!fresh.length) return
  const words = new Set(fresh.map((c) => plain(c.words)))
  const next = cleanList([...calledIn(db, sceneId).filter((c) => !words.has(plain(c.words))), ...fresh])
  repo.setMeta(db, key(sceneId), JSON.stringify(next))
}

/** Keeps only those of a scene's that `keep` says to (the row goes when none are left). */
function keepOnly(db: DB, sceneId: ID, keep: (c: CalledName) => boolean): void {
  const before = calledIn(db, sceneId)
  const next = before.filter(keep)
  if (next.length === before.length) return
  if (next.length) repo.setMeta(db, key(sceneId), JSON.stringify(next))
  else db.prepare('DELETE FROM meta WHERE key = ?').run(key(sceneId))
}

/** Forgets what the words call one character in a scene (Adam ignored or dismissed it). */
export function forgetCalled(db: DB, sceneId: ID, entryId: ID, words: string): void {
  keepOnly(db, sceneId, (c) => !(c.entryId === entryId && plain(c.words) === plain(words)))
}

/** Forgets what the words call someone where those words are no longer in the scene's text (read as names are read). */
export function forgetCalledNotIn(db: DB, sceneId: ID, text: string): void {
  keepOnly(db, sceneId, (c) => namedInProse(text, c.words))
}

/** Rows of scenes that are gone for good (called when the Trash is emptied). */
export function dropCalledOfGoneScenes(db: DB): void {
  db.prepare(`DELETE FROM meta WHERE substr(key, 1, ${CALLED_PREFIX.length}) = ? AND substr(key, ${CALLED_PREFIX.length + 1}) NOT IN (SELECT id FROM scenes)`).run(
    CALLED_PREFIX
  )
}
