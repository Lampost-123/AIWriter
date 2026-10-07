// What story memory step 5 (src/main/retrieval/) reads from world.db: scenes' words to cut into passages, the cards
// and words of the scenes just before one, and the things said that the memory keeps word for word. Reads only:
// step 5 never writes to world.db (its search index is a file of its own beside it). No Electron imports.

import type Database from 'better-sqlite3'
import type { Change, ID, SaidPayload, SceneCard } from '@shared/types'
import { listAllChanges } from './memory'
import { linksForFacts } from './history'

type DB = Database.Database
type Row = Record<string, unknown>

/** Every live scene's words, by id (a scene in a deleted chapter or story is deleted with it). */
export function liveSceneTexts(db: DB): Map<ID, string> {
  const rows = db.prepare('SELECT id, text FROM scenes WHERE deleted_at IS NULL').all() as Row[]
  return new Map(rows.map((r) => [r.id as string, (r.text as string) ?? '']))
}

/** These live scenes' words now, by id (a scene deleted meanwhile is left out). */
export function sceneTextsOf(db: DB, ids: ID[]): Map<ID, string> {
  if (!ids.length) return new Map()
  const rows = db
    .prepare('SELECT id, text FROM scenes WHERE id IN (SELECT value FROM json_each(?)) AND deleted_at IS NULL')
    .all(JSON.stringify(ids)) as Row[]
  return new Map(rows.map((r) => [r.id as string, (r.text as string) ?? '']))
}

/** These scenes' cards and words (those still there), in the order asked. */
export function scenesCardsAndText(db: DB, ids: ID[]): { id: ID; card: Partial<SceneCard>; text: string }[] {
  if (!ids.length) return []
  const rows = db
    .prepare('SELECT id, card_json, text FROM scenes WHERE id IN (SELECT value FROM json_each(?)) AND deleted_at IS NULL')
    .all(JSON.stringify(ids)) as Row[]
  const byId = new Map(rows.map((r) => [r.id as string, r]))
  return ids.flatMap((id) => {
    const r = byId.get(id)
    if (!r) return []
    let card: Partial<SceneCard> = {}
    try {
      card = (JSON.parse((r.card_json as string) || '{}') as Partial<SceneCard>) ?? {}
    } catch {
      card = {}
    }
    return [{ id, card, text: (r.text as string) ?? '' }]
  })
}

/** A change that records something said, with the line as its words now read. */
export interface SaidChange {
  change: Change & { kind: 'knowledge' }
  said: SaidPayload
  /** The line as the scene now has it (its source link), else as it was first read. */
  words: string
}

/**
 * Every live change that records something said (KnowledgePayload.said), with the line as its words now read: the
 * latest source link still standing, else the words first read. A line whose words are all gone is left out.
 */
export function saidChanges(db: DB, changes: Change[] = listAllChanges(db)): SaidChange[] {
  const said = changes.filter((c): c is Change & { kind: 'knowledge' } => c.kind === 'knowledge' && !!c.payload.said && !c.payload.forgets)
  const links = linksForFacts(
    db,
    'change',
    said.map((c) => c.id)
  )
  const out: SaidChange[] = []
  for (const c of said) {
    const ls = links.get(c.id) ?? []
    const standing = ls.filter((l) => l.state !== 'gone')
    if (ls.length && !standing.length) continue
    const latest = [...standing].reverse().find((l) => l.state === 'ok') ?? standing[standing.length - 1]
    out.push({ change: c, said: c.payload.said!, words: (latest?.quote ?? c.payload.said!.words).trim() })
  }
  return out
}
