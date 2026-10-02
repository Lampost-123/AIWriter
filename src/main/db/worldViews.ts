// SQL for the timeline, relationship map and plot threads board (milestone 3). The views work out the
// in-world order themselves and never write it into the scene cards; the only thing they keep is where
// each character sits on the relationship map (in `meta`, so no table of their own).
import type Database from 'better-sqlite3'
import type { ID, SceneCard } from '@shared/types'
import { getMeta, setMeta } from './repo'

type DB = Database.Database
type Row = Record<string, unknown>

/**
 * How many rows this connection has changed since the world was opened. The views keep what they read
 * until it moves: the open world has a single connection, so an unchanged count means nothing changed.
 */
export const changesMade = (db: DB): number => (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n

/** Each live story's time gap since the story before ("200 years"), for the stories that have one. */
export function storyGaps(db: DB): Map<ID, string> {
  const rows = db.prepare("SELECT id, time_gap FROM stories WHERE deleted_at IS NULL AND trim(time_gap) != ''").all() as Row[]
  return new Map(rows.map((r) => [r.id as ID, (r.time_gap as string).trim()]))
}

/** The parts of a scene card the views use. */
export type CardInfo = Pick<SceneCard, 'when' | 'povId' | 'presentIds' | 'locationId' | 'setsUpIds' | 'paysOffIds'> & { title: string }

const ids = (v: unknown): ID[] => (Array.isArray(v) ? v.filter((x): x is ID => typeof x === 'string' && x !== '') : [])
const id = (v: unknown): ID | null => (typeof v === 'string' && v ? v : null)

type CardFields = Omit<CardInfo, 'title'>

// Cards read before, by scene, with the text each was read from: most cards are the same from one
// visit to the next, so only the ones that changed are read again.
const read = new WeakMap<DB, Map<ID, { json: string; fields: CardFields }>>()

function fieldsOf(json: string): CardFields {
  let card: Partial<Record<keyof SceneCard, unknown>> = {}
  try {
    card = json ? (JSON.parse(json) as typeof card) : {}
  } catch {
    // A damaged card shows as an empty one rather than hiding the scene.
  }
  return {
    when: typeof card.when === 'string' ? card.when : '',
    povId: id(card.povId),
    presentIds: ids(card.presentIds),
    locationId: id(card.locationId),
    setsUpIds: ids(card.setsUpIds),
    paysOffIds: ids(card.paysOffIds)
  }
}

/** Every live scene's card, by scene id: one query however many scenes. */
export function sceneCards(db: DB): Map<ID, CardInfo> {
  const rows = db.prepare('SELECT id, title, card_json FROM scenes WHERE deleted_at IS NULL').all() as Row[]
  const before = read.get(db)
  const now = new Map<ID, { json: string; fields: CardFields }>()
  const out = new Map<ID, CardInfo>()
  for (const r of rows) {
    const sceneId = r.id as string
    const json = typeof r.card_json === 'string' ? r.card_json : ''
    const last = before?.get(sceneId)
    const fields = last && last.json === json ? last.fields : fieldsOf(json)
    now.set(sceneId, { json, fields })
    out.set(sceneId, { ...fields, title: (r.title as string) ?? '' })
  }
  read.set(db, now)
  return out
}

/** The `meta` key holding where each character sits on the relationship map: JSON of id to [x, y]. */
export const MAP_LAYOUT_KEY = 'map_layout'

/** Where each character sat on the relationship map when it was last laid out; null when it never was. */
export function readMapLayout(db: DB): Map<ID, { x: number; y: number }> | null {
  let saved: unknown
  try {
    saved = JSON.parse(getMeta(db, MAP_LAYOUT_KEY) ?? 'null')
  } catch {
    return null
  }
  if (!saved || typeof saved !== 'object') return null
  const out = new Map<ID, { x: number; y: number }>()
  for (const [id, p] of Object.entries(saved as Record<string, unknown>)) {
    if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) out.set(id, { x: p[0] as number, y: p[1] as number })
  }
  return out
}

/** Keeps where each character sits on the relationship map, so it looks the same after a restart. */
export function writeMapLayout(db: DB, positions: Map<ID, { x: number; y: number }>): void {
  const out: Record<string, [number, number]> = {}
  for (const [id, p] of positions) out[id] = [p.x, p.y]
  setMeta(db, MAP_LAYOUT_KEY, JSON.stringify(out))
}
