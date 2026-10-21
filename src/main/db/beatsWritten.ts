// The scene card's beats a draft of the whole scene was written from (Adam, 2026-10-21: Write the whole chapter left
// every beat unticked, and the desk's Mark done never came, since the AI says a beat in its own words and the app found
// them by the beat's words alone: shared/beats.ts beatsOnPage). Noted when such a draft comes in full (ai/drafts.ts),
// with a sample of the draft's own words, and read with the page by beatsDone: the desk's chip and card, Add below and
// Continue. Kept in the world's meta table (one row a scene, `beats_written:<scene id>`); no migration (as db/called.ts).
// A scene emptied from Recently deleted takes its row with it (db/trash.ts).

import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'
import { cardBeatsOf, DRAFT_WORDS, draftWords, type BeatsWritten } from '@shared/beats'
import * as repo from './repo'

type DB = Database.Database

export const BEATS_WRITTEN_PREFIX = 'beats_written:'
const key = (sceneId: ID): string => `${BEATS_WRITTEN_PREFIX}${sceneId}`

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** What the last draft of the whole scene wrote, or null when none noted any (or the row can't be read). */
export function beatsWrittenIn(db: DB, sceneId: ID | null | undefined): BeatsWritten | null {
  if (!sceneId) return null
  const raw = repo.getMeta(db, key(sceneId))
  if (!raw) return null
  try {
    const x = JSON.parse(raw) as Partial<Record<keyof BeatsWritten, unknown>> | null
    const beats = cardBeatsOf(strings(x?.beats))
    const words = strings(x?.words).slice(0, DRAFT_WORDS)
    return beats.length && words.length ? { beats, words } : null
  } catch {
    return null
  }
}

/** Notes the card's beats as written by `text` (the newest draft's take the place of the last); none takes the row away. */
export function noteBeatsWritten(db: DB, sceneId: ID, beats: readonly string[], text: string): void {
  const list = cardBeatsOf(beats)
  const words = draftWords(text)
  if (list.length && words.length) repo.setMeta(db, key(sceneId), JSON.stringify({ beats: list, words } satisfies BeatsWritten))
  else db.prepare('DELETE FROM meta WHERE key = ?').run(key(sceneId))
}

/** Clears the rows of scenes gone for good (purgeTrash). */
export function dropBeatsWrittenOfGoneScenes(db: DB): void {
  db.prepare(
    `DELETE FROM meta WHERE substr(key, 1, ${BEATS_WRITTEN_PREFIX.length}) = ? AND substr(key, ${BEATS_WRITTEN_PREFIX.length + 1}) NOT IN (SELECT id FROM scenes)`
  ).run(BEATS_WRITTEN_PREFIX)
}
