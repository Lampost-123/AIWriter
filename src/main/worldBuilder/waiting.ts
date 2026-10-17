// The stories whose world is waiting to be built (2026-10-17): a kept outline builds its story's world a few seconds
// later, or once the build running ends. That wait was held only in the window, so closing the app lost it. It is
// kept in the world's meta table instead, and the window starts what is waiting when the world next opens. Only the
// world's own live stories are ever kept or given back. No Electron imports.

import type Database from 'better-sqlite3'
import type { StoryBuildWaiting } from '@shared/contracts/worldBuilder'
import * as repo from '../db/repo'

type DB = Database.Database

/** Where the waiting stories are kept, as JSON. */
export const WAITING_KEY = 'story_builds_waiting'

/** The waiting list read from anything: each live story of this world once, in order. */
export function cleanWaiting(db: DB, value: unknown): StoryBuildWaiting[] {
  const live = new Set(repo.listStories(db).map((s) => s.id))
  const out: StoryBuildWaiting[] = []
  for (const w of Array.isArray(value) ? value : []) {
    const storyId = w && typeof w === 'object' ? (w as { storyId?: unknown }).storyId : null
    if (typeof storyId !== 'string' || !live.has(storyId) || out.some((x) => x.storyId === storyId)) continue
    const recipeId = (w as { recipeId?: unknown }).recipeId
    out.push({ storyId, recipeId: typeof recipeId === 'string' && recipeId ? recipeId : null })
  }
  return out
}

export function readWaiting(db: DB): StoryBuildWaiting[] {
  try {
    return cleanWaiting(db, JSON.parse(repo.getMeta(db, WAITING_KEY) ?? '[]'))
  } catch {
    return []
  }
}

export function keepWaiting(db: DB, value: unknown): void {
  const list = cleanWaiting(db, value)
  const text = list.length ? JSON.stringify(list) : ''
  if ((repo.getMeta(db, WAITING_KEY) ?? '') === text) return
  repo.setMeta(db, WAITING_KEY, text)
}
