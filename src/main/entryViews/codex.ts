// The codex's cards (milestone 3): every entry with its portrait address, one-liner and tags, how
// important it is and where it last appears (from where it appears), and the stories it belongs to.
// No Electron imports.

import type Database from 'better-sqlite3'
import type { ExistsPoint, ID } from '@shared/types'
import type { CodexCard } from '@shared/contracts/entryViews'
import type { WorldShape } from '../memory/types'
import { loadShape } from '../memory/scene'
import * as mem from '../db/memory'
import * as repo from '../db/repo'
import { sceneWeight, worldAppearances } from './appearances'

type DB = Database.Database

/**
 * The story a first-exists point belongs to: its own story (a scene's story as it is now), or the
 * world's first story for the beginning of the world. Null when there is none.
 */
export function homeStory(
  p: Pick<ExistsPoint, 'kind' | 'storyId' | 'sceneId'>,
  firstStoryId: ID | null,
  sceneStory: Map<ID, ID>
): ID | null {
  if (p.kind === 'world') return firstStoryId
  if (p.kind === 'scene' && p.sceneId) return sceneStory.get(p.sceneId) ?? p.storyId
  return p.storyId
}

/** Every scene's story as it is now. */
export function sceneStories(shape: WorldShape): Map<ID, ID> {
  const out = new Map<ID, ID>()
  for (const s of shape.stories) for (const c of s.chapters) for (const sc of c.scenes) out.set(sc.id, s.id)
  return out
}

export function codexCards(db: DB): CodexCard[] {
  const shape = loadShape(db)
  const entries = repo.listEntries(db)
  const w = worldAppearances(db, entries, shape)
  const live = new Set(shape.stories.map((s) => s.id))
  const sceneStory = sceneStories(shape)
  const first = mem.firstStoryId(db)
  const homes = new Map<ID, Set<ID>>()
  for (const p of mem.listExistsPoints(db)) {
    const home = homeStory(p, first, sceneStory)
    if (!home || !live.has(home)) continue
    let set = homes.get(p.entryId)
    if (!set) homes.set(p.entryId, (set = new Set()))
    set.add(home)
  }
  return entries.map((e) => {
    const where = w.byEntry.get(e.id)
    let importance = 0
    let last: CodexCard['last'] = null
    const stories = new Set(homes.get(e.id) ?? [])
    for (const [sceneId, how] of where ?? []) {
      const s = w.sceneById.get(sceneId)
      if (!s) continue
      importance += sceneWeight(how)
      stories.add(s.storyId)
      if (!last || s.order > last.order) last = { sceneId, storyId: s.storyId, label: s.label, order: s.order }
    }
    return {
      id: e.id,
      kind: e.kind,
      name: e.name,
      aliases: e.aliases,
      summary: e.summary,
      tags: e.tags,
      image: e.image ?? null,
      role: (e.fields.role ?? '').trim(),
      hardRule: e.hardRule,
      scenes: where?.size ?? 0,
      importance,
      last,
      storyIds: [...stories]
    }
  })
}
