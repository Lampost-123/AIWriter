// The critic's rows in the world's `meta` (contracts/critique.ts; no migration): the latest critique of each scene and
// chapter (`critique:scene:<id>`, `critique:chapter:<id>`, critique/store.ts) and what Adam said isn't for a story
// (`critique_wants:<story id>`, critique/memory.ts). They go with their scene, chapter or story when it goes for good
// (purgeTrash, or another way: the outline helper's Undo, an imported story taking the empty first one's place).

import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'

type DB = Database.Database

export const CRITIQUE_WANTS_PREFIX = 'critique_wants:'

const wantsKey = (storyId: ID): string => `${CRITIQUE_WANTS_PREFIX}${storyId}`

/** What Adam said isn't for the story, as kept (JSON), or null for none. */
export function getCritiqueWants(db: DB, storyId: ID): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(wantsKey(storyId)) as { value: string } | undefined
  return row?.value ?? null
}

/** Keeps it (JSON); null leaves no row. */
export function setCritiqueWants(db: DB, storyId: ID, json: string | null): void {
  if (json === null) db.prepare('DELETE FROM meta WHERE key = ?').run(wantsKey(storyId))
  else db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(wantsKey(storyId), json)
}

/** Drops the critic's rows of scenes, chapters and stories that are gone for good (one in Recently deleted keeps its own). */
export function dropCritiquesOfGone(db: DB): void {
  const drop = (prefix: string, table: 'scenes' | 'chapters' | 'stories'): void => {
    db.prepare(`DELETE FROM meta WHERE substr(key, 1, ${prefix.length}) = ? AND substr(key, ${prefix.length + 1}) NOT IN (SELECT id FROM ${table})`).run(prefix)
  }
  drop('critique:scene:', 'scenes')
  drop('critique:chapter:', 'chapters')
  drop(CRITIQUE_WANTS_PREFIX, 'stories')
}
