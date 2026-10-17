// Which recipe each story was planned from (2026-10-17), so the story's world build gets the recipe's cast roles and
// devices whichever keep starts it (the outline helper's keep can't say). Kept in the world's meta as JSON
// (story id -> recipe id): only ids, never the recipe's words. No Electron imports.

import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'
import * as repo from '../db/repo'

const KEY = 'story_recipes'

function read(db: Database.Database): Record<ID, ID> {
  try {
    const v = JSON.parse(repo.getMeta(db, KEY) ?? '{}') as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<ID, ID>) : {}
  } catch {
    return {}
  }
}

/** Notes that a story is being planned from a recipe. */
export function noteStoryRecipe(db: Database.Database, storyId: ID, recipeId: ID): void {
  const all = read(db)
  if (all[storyId] === recipeId) return
  all[storyId] = recipeId
  repo.setMeta(db, KEY, JSON.stringify(all))
}

/** The recipe a story was planned from, or null. */
export function storyRecipe(db: Database.Database, storyId: ID): ID | null {
  const id = read(db)[storyId]
  return typeof id === 'string' && id ? id : null
}
