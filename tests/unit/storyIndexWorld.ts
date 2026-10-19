// Helpers for the story index's tests (src/main/storyIndex): where things stand kept for scenes as the stage tracker
// keeps it (read from each scene's words as they are now), and scene cards changed in part.
import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { ID, SceneCard } from '../../src/shared/types'
import type { CharacterState, SceneState } from '../../src/shared/continuity'
import * as repo from '../../src/main/db/repo'

/** A character as where things stand keeps them, with nothing known but what is given. */
export const person = (name: string, more: Partial<CharacterState> = {}): CharacterState => ({
  name,
  where: '',
  posture: '',
  touching: '',
  sees: '',
  holding: '',
  condition: '',
  mood: '',
  lastAction: '',
  clothes: [],
  ...more
})

/** Where things stand as a scene ends, each value's words (`said`, by sourceKey) from that scene. */
export const stage = (sceneId: ID, characters: CharacterState[], said: Record<string, string> = {}): SceneState => ({
  time: '',
  weather: '',
  light: '',
  things: [],
  characters,
  said: Object.fromEntries(Object.entries(said).map(([k, quote]) => [k, { quote, sceneId }]))
})

/** Keeps where things stand at the end of each scene given, as read from its words as they are now. */
export function keepStages(db: Database.Database, states: Record<ID, SceneState>): void {
  const all = JSON.parse(repo.getMeta(db, 'continuity') ?? '{}') as Record<string, unknown>
  for (const [id, state] of Object.entries(states)) {
    const hash = createHash('sha1').update(repo.getScene(db, id).text).digest('hex').slice(0, 16)
    all[id] = { hash, base: '', state }
  }
  repo.setMeta(db, 'continuity', JSON.stringify(all))
}

/** Changes part of a scene's card. */
export function setCard(db: Database.Database, sceneId: ID, card: Partial<SceneCard>): void {
  repo.updateSceneCard(db, sceneId, { ...repo.getScene(db, sceneId).card, ...card })
}
