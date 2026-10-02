// Reads the open world's database and works out what counts for one scene: the SceneMemory the
// briefing (src/main/ai/context.ts) and the memory keeper (src/main/keeper) are given.
// No Electron imports, so it can be tested against an in-memory database.

import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'
import type { MemoryData, SceneMemory, WorldShape } from './types'

type DB = Database.Database

/** Every live story with its live chapters and scenes (no text), and Adam's answers. */
export function loadShape(_db: DB): WorldShape {
  throw new Error('Not built yet')
}

/** Every live entry, change and first-exists point. */
export function loadMemoryData(_db: DB): MemoryData {
  throw new Error('Not built yet')
}

/** What counts for drafting (or reading) this scene. */
export function sceneMemory(_db: DB, _sceneId: ID): SceneMemory {
  throw new Error('Not built yet')
}
