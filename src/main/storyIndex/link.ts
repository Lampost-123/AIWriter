// Where each fact in the story index stops being true (overhaul phase 1). A scene's build only says what starts or stops
// in it; the facts about one thing (one person's place, one piece they have on, one fact they know, one pair's
// relationship) make a chain in story order, and a fact stops at the first later row of its chain that says something
// else: a new value, or an end ('' value: taken off, forgotten, resolved, ended). The same value again carries it on. Worked
// out for a whole story after any scene's rows are written, so no scene's rows ever need patching. Pure.

import type { ID } from '@shared/types'
import type { IndexFact, PlacedFact } from './types'
import { sameValue } from './build'
import { placedEnds } from './placed'

/** The chain a fact belongs to. A relationship is one per pair, whichever side it was read from. */
export function chainKey(f: Pick<IndexFact, 'kind' | 'entryId' | 'slot'>): string {
  if (f.kind === 'relationship' && f.slot.startsWith('with:')) return `relationship|${[f.entryId ?? '', f.slot.slice(5)].sort().join('|')}`
  return `${f.kind}|${f.entryId ?? ''}|${f.slot}`
}

/**
 * Where each fact stops, for the facts whose stored end is different: the scene of the first later row in its chain that
 * says something else, or null while nothing does. `rows` in story order (db/storyIndex.ts storyFactsInOrder).
 */
export function factEnds(rows: readonly PlacedFact[]): { id: ID; untilSceneId: ID | null }[] {
  const chains = new Map<string, PlacedFact[]>()
  for (const r of rows) {
    // Things left in a place stop by their own rules (placed.ts): taken, moved or gone, whichever place it was.
    if (r.kind === 'placed') continue
    const key = chainKey(r)
    const list = chains.get(key)
    if (list) list.push(r)
    else chains.set(key, [r])
  }
  const out: { id: ID; untilSceneId: ID | null }[] = []
  for (const list of chains.values()) {
    // From the end back: a row's end is the next row's start when they differ, else the next row's own end.
    let next: { value: string; from: ID; until: ID | null } | null = null
    for (let i = list.length - 1; i >= 0; i--) {
      const r = list[i]
      const until: ID | null = !r.value || !next ? null : sameValue(next.value, r.value) ? next.until : next.from
      if (until !== r.untilSceneId) out.push({ id: r.id, untilSceneId: until })
      next = { value: r.value, from: r.fromSceneId, until }
    }
  }
  out.push(...placedEnds(rows))
  return out
}
