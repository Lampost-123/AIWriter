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
import { readAloudOf } from './voiceStore'

type DB = Database.Database

export { META_KEY, cleanReadAloud, emptyReadAloud, getEntryReadAloud, readAloudOf, setEntryReadAloud } from './voiceStore'

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

/** True when this entry has a read-aloud voice of its own (a description, or a voice from the list). */
const voiced = (kept: EntryReadAloud | undefined): boolean => !!(kept?.voice.design || kept?.voice.voice)

/**
 * Everyone reading aloud can give a line to: every character, and anything else in the world that talks and has a
 * voice of its own (Adam, 2026-10-04: a ring with its own personality and voice; its page is an item, not a
 * character). A thing with no voice is left out, so a place named in the narration is never taken for a speaker.
 */
export function speakersOf(db: DB, kept = readAloudOf(db)): CastMember[] {
  const entries = repo.listEntries(db).filter((e) => e.kind === 'character' || voiced(kept[e.id]))
  // Characters first, as before; the things that talk after them.
  const ordered = [...entries.filter((e) => e.kind === 'character'), ...entries.filter((e) => e.kind !== 'character')]
  return ordered.flatMap((e) => member(e, kept[e.id]) ?? [])
}

/**
 * The cast a scene is read with: its card's people (and viewpoint character) when it lists any, else the characters
 * its words name (`sceneText`) and the viewpoint character, else everyone in the world.
 */
export function readingCast(db: DB, sceneId: ID | null, sceneText = ''): ReadingCast {
  const kept = readAloudOf(db)
  const all = speakersOf(db, kept)
  // Who the scene's words name, worked out once (the AI is told about them too).
  const namedNow = sceneText ? all.filter((c) => namedIn(c, sceneText)) : []
  let scene = all
  let pov: CastMember | null = null
  let onCard = false
  if (sceneId) {
    try {
      const card = repo.getScene(db, sceneId).card
      pov = all.find((c) => c.id === card.povId) ?? null
      const present = new Set(card.presentIds)
      const named = all.filter((c) => c === pov || namedNow.includes(c))
      if (all.some((c) => present.has(c.id))) {
        scene = all.filter((c) => present.has(c.id) || c === pov)
        onCard = true
      } else if (named.length) scene = named
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
      // Those on the card are said to be in the scene: the AI is told someone only mentioned isn't speaking.
      const own = scene === all ? [] : onCard ? scene.map((c) => ({ ...c, here: true })) : scene
      const named = text === sceneText ? namedNow : all.filter((c) => namedIn(c, text))
      return [...own, ...named.filter((c) => !own.some((o) => o.id === c.id))].slice(0, 40)
    }
  }
}
