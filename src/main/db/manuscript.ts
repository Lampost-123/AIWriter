// SQL for the Manuscript part (milestone 3): the little the page and the scene panel read that the
// memory engine doesn't already. Pure functions over a better-sqlite3 handle, no Electron imports.
import type Database from 'better-sqlite3'
import type { ID, SceneCard } from '@shared/types'
import { UserError } from '../util'

type DB = Database.Database

/** Who the scene card says is in a scene: its point of view, the characters present and its location. */
export function sceneCast(db: DB, sceneId: ID): Pick<SceneCard, 'povId' | 'presentIds' | 'locationId'> {
  const r = db.prepare('SELECT card_json FROM scenes WHERE id = ? AND deleted_at IS NULL').get(sceneId) as { card_json: string } | undefined
  if (!r) throw new UserError('That scene no longer exists.')
  let card: Partial<SceneCard> = {}
  try {
    card = JSON.parse(r.card_json) as Partial<SceneCard>
  } catch {
    // A damaged card reads as an empty one.
  }
  const id = (v: unknown): ID | null => (typeof v === 'string' && v ? v : null)
  return {
    povId: id(card.povId),
    presentIds: Array.isArray(card.presentIds) ? card.presentIds.filter((v): v is ID => typeof v === 'string' && !!v) : [],
    locationId: id(card.locationId)
  }
}
