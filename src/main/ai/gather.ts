// Reads what context assembly needs from the open world's database: what counts at the scene
// (the memory engine's SceneMemory), the scene's pins and block modes, and the style and themes.
// No Electron imports, so it can be tested against an in-memory database.

import type Database from 'better-sqlite3'
import type { DraftOptions, ID, WritingPrefs } from '@shared/types'
import { cardLength, CREATIVITY_PRESETS } from '@shared/defaults'
import { effectiveStyle } from '@shared/style'
import * as repo from '../db/repo'
import { getBlockModes, pinsForScene } from '../db/memory'
import { sceneMemory } from '../memory/scene'
import type { ContextInput } from './context'

type DB = Database.Database

export const MIN_TARGET_WORDS = 100
export const MAX_TARGET_WORDS = 12_000

/**
 * Makes draft options safe to use: a sensible length, a known creativity preset, a trimmed direction.
 * A length of null is Auto (the AI picks it); a missing or unreadable one takes the fallback (the scene
 * card's length, which may itself be Auto).
 */
export function cleanOptions(
  o: Partial<DraftOptions> | undefined,
  fallback: { targetWords: number | null; creativity: DraftOptions['creativity'] }
): DraftOptions {
  const words = Math.round(Number(o?.targetWords))
  const targetWords =
    o?.targetWords === null
      ? null
      : o?.targetWords != null && Number.isFinite(words) && words > 0
        ? Math.min(MAX_TARGET_WORDS, Math.max(MIN_TARGET_WORDS, words))
        : fallback.targetWords
  const creativity = o?.creativity && o.creativity in CREATIVITY_PRESETS ? o.creativity : fallback.creativity
  const direction = typeof o?.direction === 'string' ? o.direction.trim().slice(0, 4000) : ''
  return { targetWords, creativity, direction }
}

/**
 * Everything the briefing for this scene is built from. Options left out fall
 * back to the scene card's length (Auto unless Adam set one) and the default creativity preset.
 */
export function gatherContextInput(
  db: DB,
  sceneId: ID,
  options: Partial<DraftOptions> | undefined,
  extra: { prefs: WritingPrefs; contextLength: number | null; creativity: DraftOptions['creativity']; maxOutput?: number | null }
): ContextInput {
  const scene = repo.getScene(db, sceneId)
  const { story } = repo.sceneLocation(db, sceneId)
  const series = story.seriesId ? repo.listSeries(db).find((s) => s.id === story.seriesId) : undefined
  return {
    style: effectiveStyle(extra.prefs, repo.getWorldStyle(db), story.style),
    scene: { title: scene.title, card: scene.card },
    memory: sceneMemory(db, sceneId),
    pins: pinsForScene(db, sceneId),
    blockModes: getBlockModes(db, sceneId),
    world: { themes: repo.getMeta(db, 'themes') ?? '', tone: repo.getMeta(db, 'tone') ?? '' },
    series: series ? { name: series.name, themes: series.themes, tone: series.tone } : null,
    story: { title: story.title, premise: story.premise, themes: story.themes, tone: story.tone },
    options: cleanOptions(options, { targetWords: cardLength(scene.card), creativity: extra.creativity }),
    contextLength: extra.contextLength,
    maxOutput: extra.maxOutput ?? null
  }
}

// ---------- Catching the memory up before a draft ----------
// Spec, Memory upkeep: "Before a draft is generated, any queued or failed runs for earlier scenes on
// the story's line run first." The memory keeper registers how (setBeforeDraft); drafting waits for
// it, but never for long, and drafts anyway with what the memory has if it fails.

export type BeforeDraft = (db: DB, sceneId: ID) => Promise<unknown> | unknown

let beforeDraft: BeforeDraft | null = null

/** Registers what brings the memory up to date before a draft of a scene (the memory keeper's catch-up). */
export function setBeforeDraft(fn: BeforeDraft | null): void {
  beforeDraft = fn
}

/** How long a draft waits for the memory to catch up before going ahead with what it has. */
export const CATCH_UP_LIMIT_MS = 60_000

/**
 * Brings the memory up to date for earlier scenes; resolves when done, on failure, after `limitMs`,
 * or at once when `signal` is aborted (Adam stopped the draft before it began). Whatever happens,
 * the memory goes on catching up in the background.
 */
export async function catchUpBeforeDraft(
  db: DB,
  sceneId: ID,
  limitMs = CATCH_UP_LIMIT_MS,
  signal?: AbortSignal
): Promise<'done' | 'failed' | 'timed-out' | 'cancelled' | 'none'> {
  if (signal?.aborted) return 'cancelled'
  const fn = beforeDraft
  if (!fn) return 'none'
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const late = new Promise<'timed-out'>((resolve) => {
    timer = setTimeout(() => resolve('timed-out'), limitMs)
  })
  const stopped = new Promise<'cancelled'>((resolve) => {
    onAbort = () => resolve('cancelled')
    signal?.addEventListener('abort', onAbort, { once: true })
  })
  // A failure is noted even when it comes after the wait is over (timed out or stopped).
  const run = Promise.resolve()
    .then(() => fn(db, sceneId))
    .then(
      () => 'done' as const,
      (e: unknown) => {
        console.warn('The memory could not catch up before this draft; drafting with what it has', e)
        return 'failed' as const
      }
    )
  try {
    return await Promise.race([run, late, stopped])
  } finally {
    clearTimeout(timer)
    if (onAbort) signal?.removeEventListener('abort', onAbort)
  }
}
