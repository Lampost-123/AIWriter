// Where things are, in plain words ("Book 1, Ch 2, Sc 3"), and what the keeper needs from the
// memory core: the world's shape, what counts at a scene, and where a side story and its host both
// change something. Each falls back to something simple if the memory core can't answer, so the
// keeper keeps working. No Electron imports.

import type Database from 'better-sqlite3'
import type { EntryState, ID } from '@shared/types'
import type { MemoryData, SceneMemory, WorldShape } from '../memory/types'
import * as scene from '../memory/scene'
import * as line from '../memory/line'
import * as state from '../memory/state'
import * as repo from '../db/repo'
import type { SideClashes } from './apply'

type DB = Database.Database

export function loadShapeSafe(db: DB): WorldShape | null {
  try {
    return scene.loadShape(db)
  } catch (e) {
    console.warn('The memory keeper could not load the stories', e)
    return null
  }
}

/** The simplest memory: every live entry exists, nothing else known. Used if the memory core can't answer. */
function plainMemory(db: DB, storyId: ID, sceneId: ID): SceneMemory {
  const entries: EntryState[] = repo.listEntries(db).map((e) => ({ ...e, happened: [], changed: [] }))
  return {
    storyId,
    sceneId,
    knows: '',
    previous: null,
    entries,
    firstHere: [],
    elsewhere: [],
    relationships: [],
    facts: [],
    threads: [],
    storySoFar: { scenes: [], chapters: [], stories: [], series: [], leadsInto: null },
    bringAbout: []
  }
}

/** What counts at this scene, for reading it. */
export function memoryAt(db: DB, storyId: ID, sceneId: ID): SceneMemory {
  try {
    return scene.sceneMemory(db, sceneId)
  } catch (e) {
    console.warn('The memory keeper could not work out the memory at a scene; reading it with every entry', e)
    return plainMemory(db, storyId, sceneId)
  }
}

/** Where a side story and its host both change something (the memory core's sideClashes). */
export function sideClashesFor(db: DB, shape: WorldShape | null): SideClashes | null {
  if (!shape) return null
  let data: MemoryData | null = null
  return (sideStoryId) => {
    data ??= scene.loadMemoryData(db)
    return state.sideClashes(data, shape, sideStoryId)
  }
}

/** The scenes whose changes count before this one, in order (the memory core's line). */
export function scenesBefore(db: DB, sceneId: ID): ID[] {
  const shape = loadShapeSafe(db)
  if (!shape) return []
  try {
    return line.scenesBefore(shape, sceneId)
  } catch (e) {
    console.warn('The memory keeper could not work out the scenes before this one', e)
    return []
  }
}

/** "Book 1, Ch 2, Sc 3", "Book 1, Ch 2", "Book 1". */
export function placeWords(db: DB, shape: WorldShape | null, place: { storyId: ID; chapterId?: ID | null; sceneId?: ID | null }): string {
  if (shape) {
    try {
      return line.placeLabel(shape, place)
    } catch {
      /* worked out below */
    }
  }
  try {
    const o = repo.getOutline(db, place.storyId)
    const parts = [o.story.title.trim() || 'Untitled story']
    const ci = place.chapterId ? o.chapters.findIndex((c) => c.id === place.chapterId) : -1
    if (ci >= 0) parts.push(`Ch ${ci + 1}`)
    if (place.sceneId && ci >= 0) {
      const si = o.scenes.filter((s) => s.chapterId === place.chapterId).findIndex((s) => s.id === place.sceneId)
      if (si >= 0) parts.push(`Sc ${si + 1}`)
    }
    return parts.join(', ')
  } catch {
    return ''
  }
}

/** Where a scene is, in plain words; '' when it no longer exists. */
export function sceneWords(db: DB, shape: WorldShape | null, sceneId: ID): string {
  try {
    const { chapter, story } = repo.sceneLocation(db, sceneId)
    return placeWords(db, shape, { storyId: story.id, chapterId: chapter.id, sceneId })
  } catch {
    return ''
  }
}
