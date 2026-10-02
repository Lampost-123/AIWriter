// What a world keeps for reading aloud, and the cast a scene is read with. Character voices and "Say it as"
// pronunciations live in the world's `meta` key `read_aloud`, by entry id (no data model change), so they go with
// the world and its backups; nothing else of reading aloud does.
import type Database from 'better-sqlite3'
import type { EntryReadAloud } from '@shared/contracts/readAloud'
import type { Entry, ID } from '@shared/types'
import * as repo from '../db/repo'
import { getWritingPrefs } from '../settings'
import { castOf, namedIn, type CastMember, type SceneCast } from './cast'
import { lexiconOf, type SayRule } from './say'

type DB = Database.Database

export const META_KEY = 'read_aloud'

interface Stored {
  v: 1
  entries: Record<ID, EntryReadAloud>
}

export const emptyReadAloud = (): EntryReadAloud => ({ voice: { design: '', voice: '' }, say: '' })

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** A value as it is kept: trimmed, cut to size, and every part present. */
export function cleanReadAloud(value: unknown): EntryReadAloud {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<EntryReadAloud>
  const voice = (v.voice && typeof v.voice === 'object' ? v.voice : {}) as Partial<EntryReadAloud['voice']>
  return { voice: { design: text(voice.design, 600), voice: text(voice.voice, 120) }, say: text(v.say, 200) }
}

const isEmpty = (v: EntryReadAloud): boolean => !v.voice.design && !v.voice.voice && !v.say

/** Everything the world keeps for reading aloud, by entry id. */
export function readAloudOf(db: DB): Record<ID, EntryReadAloud> {
  try {
    const raw = JSON.parse(repo.getMeta(db, META_KEY) ?? '{}') as Partial<Stored>
    const entries = raw.entries && typeof raw.entries === 'object' ? raw.entries : {}
    return Object.fromEntries(Object.entries(entries).map(([id, v]) => [id, cleanReadAloud(v)]))
  } catch {
    return {}
  }
}

export function getEntryReadAloud(db: DB, entryId: ID): EntryReadAloud {
  return readAloudOf(db)[entryId] ?? emptyReadAloud()
}

/** Saves one entry's voice and "Say it as"; an empty one is removed. Returns what was saved. */
export function setEntryReadAloud(db: DB, entryId: ID, value: unknown): EntryReadAloud {
  repo.getEntry(db, entryId) // A plain-words error when the page has gone.
  const clean = cleanReadAloud(value)
  const all = readAloudOf(db)
  if (isEmpty(clean)) delete all[entryId]
  else all[entryId] = clean
  const stored: Stored = { v: 1, entries: all }
  repo.setMeta(db, META_KEY, JSON.stringify(stored))
  return clean
}

/** A character as reading aloud knows them: names, a line about them, their voice and how their name is said. */
function member(e: Entry, kept: EntryReadAloud | undefined): CastMember | undefined {
  return castOf([{ id: e.id, name: e.name, aliases: e.aliases, about: e.summary, voice: kept?.voice, say: kept?.say }])[0]
}

/** "Say it as" for every entry in the world (characters, places, items...), longest name first. */
export function worldLexicon(db: DB, kept = readAloudOf(db)): SayRule[] {
  const entries = repo.listEntries(db).filter((e) => kept[e.id]?.say)
  return lexiconOf(entries.map((e) => ({ name: e.name, say: kept[e.id]?.say })))
}

export interface ReadingCast {
  cast: SceneCast
  lexicon: SayRule[]
  /** The characters the AI is told about for this scene. */
  forAi(sceneText: string): CastMember[]
  /** Who tells the story when it is told in the first person (for the AI's marks). */
  narrator?: string
}

/**
 * The cast a scene is read with: its card's people (and viewpoint character) when it lists any, else the characters
 * its words name (`sceneText`) and the viewpoint character, else everyone in the world.
 */
export function readingCast(db: DB, sceneId: ID | null, sceneText = ''): ReadingCast {
  const kept = readAloudOf(db)
  const characters = repo.listEntries(db, 'character')
  const all = characters.flatMap((e) => member(e, kept[e.id]) ?? [])
  // Who the scene's words name, worked out once (the AI is told about them too).
  const namedNow = sceneText ? all.filter((c) => namedIn(c, sceneText)) : []
  let scene = all
  let pov: CastMember | null = null
  if (sceneId) {
    try {
      const card = repo.getScene(db, sceneId).card
      pov = all.find((c) => c.id === card.povId) ?? null
      const present = new Set(card.presentIds)
      const named = all.filter((c) => c === pov || namedNow.includes(c))
      if (all.some((c) => present.has(c.id))) scene = all.filter((c) => present.has(c.id) || c === pov)
      else if (named.length) scene = named
    } catch {
      /* The scene has gone: everyone in the world it is. */
    }
  }
  // The world's style guide says how its stories are told, else Adam's own preferences do.
  const firstPerson = /\bfirst\b/i.test(repo.getWorldStyle(db).pov || getWritingPrefs().pov || '')
  return {
    cast: { all, scene, pov },
    lexicon: worldLexicon(db, kept),
    narrator: firstPerson && pov ? pov.name : undefined,
    forAi: (text) => {
      // The scene's own people (when its card lists them or its words name them), and anyone else its words name, up to
      // a list the AI can take in.
      const own = scene === all ? [] : scene
      const named = text === sceneText ? namedNow : all.filter((c) => namedIn(c, text))
      return [...own, ...named.filter((c) => !own.includes(c))].slice(0, 40)
    }
  }
}
