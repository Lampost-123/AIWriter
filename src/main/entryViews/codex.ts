// The codex's cards (milestone 3): every entry with its portrait address, one-liner and tags, how
// important it is and where it first and last appears (from where it appears), and the stories it belongs to.
// No Electron imports.

import type Database from 'better-sqlite3'
import type { Entry, ExistsPoint, ID } from '@shared/types'
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

/**
 * Drafted by AI (2026-10-17), from its field origins: the AI wrote some of it, and Adam hasn't
 * edited it since (each field he changes becomes his). Not `byHand`: the builders make their
 * entries as Adam's, so that is set from the start.
 */
export function aiDrafted(e: Pick<Entry, 'origin' | 'fieldOrigins'>): boolean {
  const origins = Object.values(e.fieldOrigins)
  return (e.origin === 'ai' || origins.includes('ai')) && !origins.includes('adam')
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
    // Its scenes come in reading order.
    const where = w.byEntry.get(e.id) ?? { at: [], how: [] }
    let importance = 0
    const stories = new Set(homes.get(e.id) ?? [])
    where.at.forEach((i, k) => {
      importance += sceneWeight(where.how[k])
      stories.add(w.scenes[i].storyId)
    })
    const place = (i: number | undefined): CodexCard['last'] => {
      const s = i === undefined ? undefined : w.scenes[i]
      return s ? { sceneId: s.id, storyId: s.storyId, label: s.label, order: s.order } : null
    }
    const last = place(where.at[where.at.length - 1])
    const firstSeen = place(where.at[0])
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
      aiDrafted: aiDrafted(e),
      scenes: where.at.length,
      importance,
      last,
      first: firstSeen,
      storyIds: [...stories]
    }
  })
}
