// Reads what context assembly needs from the open world's database.
// No Electron imports, so it can be tested against an in-memory database.

import type Database from 'better-sqlite3'
import type { DraftOptions, ID, WritingPrefs } from '@shared/types'
import { CREATIVITY_PRESETS } from '@shared/defaults'
import * as repo from '../db/repo'
import type { ContextInput } from './context'
import { effectiveStyle } from './style'

export const MIN_TARGET_WORDS = 100
export const MAX_TARGET_WORDS = 12_000

/** Makes draft options safe to use: a sensible length, a known creativity preset, a trimmed direction. */
export function cleanOptions(o: Partial<DraftOptions> | undefined, fallback: { targetWords: number; creativity: DraftOptions['creativity'] }): DraftOptions {
  const words = Math.round(Number(o?.targetWords))
  const targetWords = Number.isFinite(words) && words > 0 ? Math.min(MAX_TARGET_WORDS, Math.max(MIN_TARGET_WORDS, words)) : fallback.targetWords
  const creativity = o?.creativity && o.creativity in CREATIVITY_PRESETS ? o.creativity : fallback.creativity
  const direction = typeof o?.direction === 'string' ? o.direction.trim().slice(0, 4000) : ''
  return { targetWords, creativity, direction }
}

/**
 * Everything the briefing for this scene is built from. Options left out fall
 * back to the scene card's target length and the default creativity preset.
 */
export function gatherContextInput(
  db: Database.Database,
  sceneId: ID,
  options: Partial<DraftOptions> | undefined,
  extra: { prefs: WritingPrefs; contextLength: number | null; creativity: DraftOptions['creativity'] }
): ContextInput {
  const scene = repo.getScene(db, sceneId)
  const { story } = repo.sceneLocation(db, sceneId)
  const previous = repo.previousScene(db, sceneId)
  return {
    style: effectiveStyle(extra.prefs, repo.getWorldStyle(db), story.style),
    scene: { title: scene.title, card: scene.card },
    previousText: previous?.text ?? null,
    entries: repo.listEntries(db),
    world: { themes: repo.getMeta(db, 'themes') ?? '', tone: repo.getMeta(db, 'tone') ?? '' },
    story: { title: story.title, premise: story.premise, themes: story.themes, tone: story.tone },
    options: cleanOptions(options, { targetWords: scene.card.targetWords || 1500, creativity: extra.creativity }),
    contextLength: extra.contextLength
  }
}
