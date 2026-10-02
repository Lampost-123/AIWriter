// SQL for the timeline, relationship map and plot threads board (milestone 3). Read-only: the views
// work out the in-world order themselves and never write it into the scene cards.
import type Database from 'better-sqlite3'
import type { ID, SceneCard } from '@shared/types'

type DB = Database.Database
type Row = Record<string, unknown>

/** The parts of a scene card the views use. */
export type CardInfo = Pick<SceneCard, 'when' | 'povId' | 'presentIds' | 'locationId' | 'setsUpIds' | 'paysOffIds'> & { title: string }

const ids = (v: unknown): ID[] => (Array.isArray(v) ? v.filter((x): x is ID => typeof x === 'string' && x !== '') : [])
const id = (v: unknown): ID | null => (typeof v === 'string' && v ? v : null)

/** Every live scene's card, by scene id: one query however many scenes. */
export function sceneCards(db: DB): Map<ID, CardInfo> {
  const rows = db.prepare('SELECT id, title, card_json FROM scenes WHERE deleted_at IS NULL').all() as Row[]
  const out = new Map<ID, CardInfo>()
  for (const r of rows) {
    let card: Partial<Record<keyof SceneCard, unknown>> = {}
    try {
      card = typeof r.card_json === 'string' && r.card_json ? (JSON.parse(r.card_json) as typeof card) : {}
    } catch {
      // A damaged card shows as an empty one rather than hiding the scene.
    }
    out.set(r.id as string, {
      title: (r.title as string) ?? '',
      when: typeof card.when === 'string' ? card.when : '',
      povId: id(card.povId),
      presentIds: ids(card.presentIds),
      locationId: id(card.locationId),
      setsUpIds: ids(card.setsUpIds),
      paysOffIds: ids(card.paysOffIds)
    })
  }
  return out
}
