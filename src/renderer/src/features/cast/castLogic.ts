// Who the Cast tab lists for a scene, in its order: the point of view, the others the scene card says
// are present, where it happens, then (quieter) anyone else the text names. Pure, so it is unit-tested.
import type { ID } from '@shared/types'
import type { NamedEntry, SceneNames } from '@shared/contracts/manuscript'

export type CastGroupKey = 'pov' | 'present' | 'location' | 'named'

export interface CastGroup {
  key: CastGroupKey
  title: string
  entries: NamedEntry[]
}

const TITLES: Record<CastGroupKey, string> = {
  pov: 'Point of view',
  present: 'Also in the scene',
  location: 'Where',
  named: 'Named in the text'
}

/**
 * The Cast tab's groups, leaving out empty ones. Each entry shows once, in the first group it is in;
 * plot threads are never listed (they aren't people, places or things).
 */
export function castGroups(names: Pick<SceneNames, 'entries' | 'cast'>, namedIds: ID[]): CastGroup[] {
  const byId = new Map(names.entries.map((e) => [e.id, e]))
  const seen = new Set<ID>()
  const take = (ids: (ID | null)[]): NamedEntry[] => {
    const out: NamedEntry[] = []
    for (const id of ids) {
      const e = id ? byId.get(id) : undefined
      if (!e || e.kind === 'thread' || seen.has(e.id)) continue
      seen.add(e.id)
      out.push(e)
    }
    return out
  }
  const groups: CastGroup[] = [
    { key: 'pov', title: TITLES.pov, entries: take([names.cast.povId]) },
    { key: 'present', title: TITLES.present, entries: take(names.cast.presentIds) },
    { key: 'location', title: TITLES.location, entries: take([names.cast.locationId]) },
    { key: 'named', title: TITLES.named, entries: take(namedIds) }
  ]
  return groups.filter((g) => g.entries.length)
}

/** True when the scene card names no one (no point of view, no one present, nowhere). */
export const cardHasNoCast = (cast: SceneNames['cast']): boolean => !cast.povId && !cast.presentIds.length && !cast.locationId
