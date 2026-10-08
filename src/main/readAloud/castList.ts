// Settings › Read aloud › Cast: every character in the open world with the voice they are read in now, and the ones
// "Give everyone without a voice a voice" is for. Only the database and the studio voices' list (no settings or
// Electron), so it is tested on its own. Owned by the Read aloud part.
import type Database from 'better-sqlite3'
import type { CastEntry } from '@shared/contracts/readAloud'
import type { ID } from '@shared/types'
import * as repo from '../db/repo'
import { studioIdOf, type StudioVoice } from './studio'
import { autoVoicesOf, emptyReadAloud, readAloudOf } from './voiceStore'

type DB = Database.Database

/** Every character in the world, by name, with their voice, whether the app gave it, and the studio voice's name. */
export function castList(db: DB, studio: readonly StudioVoice[]): CastEntry[] {
  const kept = readAloudOf(db)
  const auto = autoVoicesOf(db)
  const names = new Map(studio.map((v) => [v.id, v.name ?? v.id]))
  return repo
    .listEntries(db, 'character')
    .map((e): CastEntry => {
      const value = kept[e.id] ?? emptyReadAloud()
      const sid = studioIdOf(value.voice.voice)
      return {
        id: e.id,
        name: e.name.trim() || 'Unnamed',
        image: e.image ?? null,
        value,
        auto: !!value.voice.voice && auto[e.id] === value.voice.voice,
        studioName: sid ? (names.get(sid) ?? sid) : null
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'en-GB', { sensitivity: 'base' }))
}

/** The characters with no voice of their own at all: none picked from the list and nothing in How they sound. */
export function voicelessCharacters(db: DB): ID[] {
  const kept = readAloudOf(db)
  return repo
    .listEntries(db, 'character')
    .filter((e) => {
      const v = kept[e.id]?.voice
      return !v?.voice.trim() && !v?.design.trim()
    })
    .map((e) => e.id)
}
