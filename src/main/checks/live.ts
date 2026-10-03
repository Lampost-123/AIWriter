// The live checks' side in the main process (milestone 5): what the page needs to check a scene as Adam
// types (the world's names and the phrases to avoid for the scene's story), and the flags he ignored.
// The checking itself happens in the window (src/shared/liveChecks.ts); the SQL is in db/checksLive.ts.
import type Database from 'better-sqlite3'
import type { ID, WritingPrefs } from '@shared/types'
import type { CheckWords, LiveIgnore } from '@shared/contracts/checks'
import { effectiveStyle } from '@shared/style'
import { liveKey } from '@shared/liveChecks'
import * as repo from '../db/repo'
import { ignoreLiveFlag, liveEntryNames, liveIgnores, unignoreLiveFlag } from '../db/checksLive'
import { UserError } from '../util'

type DB = Database.Database

const KINDS: LiveIgnore['kind'][] = ['phrase', 'repetition', 'spelling']

/**
 * Every name and alias in the world (the glossary's terms are entries too), and the phrases to avoid for
 * the scene's story: Adam's writing preferences, then the world's and the story's style guides, combined
 * as the briefing combines them; and whether common AI phrases are underlined (Adam's preference).
 */
export function checkWords(db: DB, sceneId: ID, prefs: WritingPrefs): CheckWords {
  const { story } = repo.sceneLocation(db, sceneId)
  const names: CheckWords['names'] = []
  for (const e of liveEntryNames(db)) {
    const seen = new Set<string>()
    for (const raw of [e.name, ...e.aliases]) {
      const name = raw.trim()
      if (!name || seen.has(name.toLowerCase())) continue
      seen.add(name.toLowerCase())
      names.push({ entryId: e.id, name, kind: e.kind })
    }
  }
  const style = effectiveStyle(prefs, repo.getWorldStyle(db), story.style)
  return { names, avoid: style.avoidPhrases, aiPhrases: style.avoidAiPhrases }
}

export function listLiveIgnores(db: DB, sceneId: ID): LiveIgnore[] {
  return liveIgnores(db, sceneId)
}

/** Marks a live flag as intended, so it isn't raised again. */
export function ignoreLive(db: DB, sceneId: ID, flag: LiveIgnore & { quote: string; message: string }): void {
  const key = String(flag?.key ?? '').trim()
  if (!KINDS.includes(flag?.kind) || !key.startsWith(`${flag.kind}:`)) throw new UserError('That can’t be ignored. Try again.')
  const { story } = repo.sceneLocation(db, sceneId)
  // A spelling's key is the same in every scene, whatever its case.
  const k = flag.kind === 'spelling' ? liveKey('spelling', key.slice('spelling:'.length)) : key
  ignoreLiveFlag(db, {
    sceneId,
    storyId: story.id,
    kind: flag.kind,
    key: k,
    quote: String(flag.quote ?? '').slice(0, 500),
    message: String(flag.message ?? '').slice(0, 500)
  })
}

export function unignoreLive(db: DB, sceneId: ID, key: string): boolean {
  return unignoreLiveFlag(db, sceneId, String(key ?? '')) > 0
}
