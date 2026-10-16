// Reads what context assembly needs from the open world's database: what counts at the scene
// (the memory engine's SceneMemory), the scene's pins and block modes, and the style and themes.
// No Electron imports, so it can be tested against an in-memory database.

import type Database from 'better-sqlite3'
import { keptStateBefore, storedStateAt, type SceneState } from '../continuity/tracker'
import type { DraftOptions, ID, WritingPrefs } from '@shared/types'
import { cardLength, CREATIVITY_PRESETS } from '@shared/defaults'
import { effectiveStyle } from '@shared/style'
import * as repo from '../db/repo'
import { getBlockModes, pinsForScene } from '../db/memory'
import { calledIn } from '../db/called'
import { sceneMemory } from '../memory/scene'
import { loadShapeSafe, sceneWords } from '../keeper/places'
import { lessonsBefore } from '../checks/lessons'
import { sceneCalendar, type SceneCalendar } from '../memory/storyCalendar'
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
  return {
    targetWords,
    creativity,
    direction,
    ...(o?.fresh === true ? { fresh: true } : {}),
    ...(o?.addBelow === true ? { addBelow: true } : {})
  }
}

/**
 * Everything the briefing for this scene is built from. Options left out fall
 * back to the scene card's length (Auto unless Adam set one) and the default creativity preset.
 * `soFar`: the words already in the scene a draft carries on from (Add below, a later beat): what the memory read from
 * them counts too (memory/scene.ts sceneStart), so a secret told or a thing handed over there is no longer kept or held.
 */
export function gatherContextInput(
  db: DB,
  sceneId: ID,
  options: Partial<DraftOptions> | undefined,
  extra: { prefs: WritingPrefs; contextLength: number | null; creativity: DraftOptions['creativity']; maxOutput?: number | null; soFar?: string }
): ContextInput {
  const scene = repo.getScene(db, sceneId)
  const { story } = repo.sceneLocation(db, sceneId)
  const series = story.seriesId ? repo.listSeries(db).find((s) => s.id === story.seriesId) : undefined
  const stand = keptStateBefore(db, sceneId)
  const memory = sceneMemory(db, sceneId, { forWriter: true, ...(extra.soFar?.trim() ? { soFar: extra.soFar } : {}) })
  return {
    style: effectiveStyle(extra.prefs, repo.getWorldStyle(db), story.style),
    scene: { title: scene.title, card: scene.card },
    memory,
    // What this scene's words and the previous scene's call their characters (long story memory fix 12).
    called: { here: calledIn(db, sceneId), previous: calledIn(db, memory.previous?.sceneId) },
    pins: pinsForScene(db, sceneId),
    blockModes: getBlockModes(db, sceneId),
    world: { themes: repo.getMeta(db, 'themes') ?? '', tone: repo.getMeta(db, 'tone') ?? '' },
    series: series ? { name: series.name, themes: series.themes, tone: series.tone } : null,
    story: { title: story.title, premise: story.premise, themes: story.themes, tone: story.tone },
    options: cleanOptions(options, { targetWords: cardLength(scene.card), creativity: extra.creativity }),
    contextLength: extra.contextLength,
    maxOutput: extra.maxOutput ?? null,
    // Where things stand as the previous scene ended, if it still stands (brought up to date before a draft).
    continuity: stand,
    stageWhere: stageWhere(db, stand),
    // Slips the checks found in earlier scenes and that were put right: what must stay true warns of those about the people here.
    slips: lessonsBefore(db, sceneId).slips,
    // The story calendar (long story memory fix 11): the scene's date, the sums since the scene before and earlier days,
    // and the ages of those on its card.
    calendar: calendarFor(db, sceneId, memory, scene.card)
  }
}

/** The story calendar at a scene for its briefing (memory/storyCalendar.ts sceneCalendar); null rather than stopping a draft. */
export function calendarFor(db: DB, sceneId: ID, memory: Parameters<typeof sceneCalendar>[2], card: Parameters<typeof sceneCalendar>[3]): SceneCalendar | null {
  try {
    return sceneCalendar(db, sceneId, memory, card)
  } catch (e) {
    console.warn('Could not work out the story calendar; the briefing goes by the scene cards’ When', e)
    return null
  }
}

/**
 * Where each scene the stage's words come from is, in plain words ("Book 1, Ch 3, Sc 2"), by id: the "must stay true"
 * list says since when each value holds (ai/mustStay.ts). Empty when nothing is known.
 */
export function stageWhere(db: DB, state: SceneState | null | undefined): Record<ID, string> {
  const ids = [...new Set(Object.values(state?.said ?? {}).map((s) => s.sceneId))]
  if (!ids.length) return {}
  const shape = loadShapeSafe(db)
  const out: Record<ID, string> = {}
  for (const id of ids) {
    const where = sceneWords(db, shape, id)
    if (where) out[id] = where
  }
  return out
}

// ---------- Catching the memory up before a draft ----------
// Spec, Memory upkeep: "Before a draft is generated, any queued or failed runs for earlier scenes on
// the story's line run first." The memory keeper registers how (setBeforeDraft); drafting waits for
// it, but never for long, and drafts anyway with what the memory has if it fails.

/** `limitMs`: how long the draft waits for it at most, so the memory can keep to it (the summaries a draft needs). */
export type BeforeDraft = (db: DB, sceneId: ID, limitMs?: number) => Promise<unknown> | unknown

let beforeDraft: BeforeDraft | null = null

/** Registers what brings the memory up to date before a draft of a scene (the memory keeper's catch-up). */
export function setBeforeDraft(fn: BeforeDraft | null): void {
  beforeDraft = fn
}

/**
 * What the memory keeper registers (keeper/index.ts): its own catch-up and where things stand as the previous scene ended
 * brought up to date (`stage`), at the same time. The stage is read from the scenes' own words, not the memory, so it
 * needn't wait; run after the catch-up within the same wait, the summaries a draft needs first (fix 15) could take it all
 * and leave the writer with no "Where things stand" (review, 2026-10-16).
 */
export const withStageRead =
  (catchUp: BeforeDraft, stage: (db: DB, sceneId: ID) => Promise<unknown>): BeforeDraft =>
  async (db, sceneId, limitMs) => {
    await Promise.all([Promise.resolve().then(() => catchUp(db, sceneId, limitMs)), stage(db, sceneId)])
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
    .then(() => fn(db, sceneId, limitMs))
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

/**
 * Where things stand for a draft that carries on from words already in the scene (Add below, a later beat): at the end
 * of those words when that was worked out (`stand`), in place of where the previous scene ended. When it wasn't (its
 * reading timed out or failed), nothing of it, and the scene's contract has nothing for the start (review, 2026-10-16:
 * the previous scene's end was told as the start, the contract said "blue dress, on" after the scene so far took it off,
 * and the check as the draft landed then held the new words to it). Call after the contract is set.
 */
export function carryOnFrom(db: DB, input: ContextInput, stand: SceneState | null): void {
  if (stand) {
    input.continuity = stand
    input.continuityAtSoFar = true
    input.stageWhere = stageWhere(db, stand)
    return
  }
  input.continuity = null
  input.continuityAtSoFar = false
  input.stageWhere = {}
  if (input.contract) input.contract = { ...input.contract, noStart: true }
}

/** Said to Adam when a draft went ahead without where things stood as the scene before ended (stageNote). */
export const STAGE_LATE =
  "The memory hadn't finished working out where everyone was as the scene before ended, so the AI wrote without it. Check that the opening follows on: who is where, and what they wear and hold."
/** Said to Adam when Add below went ahead without where things stand at the end of the words so far (stageNote). */
export const STAGE_LATE_SO_FAR =
  "The memory couldn't work out in time where everyone is at the end of the words so far, so the AI carried on without it. Check that the new words follow on: who is where, and what they wear and hold."

/**
 * What Adam is told when a draft went ahead without where things stand (review, 2026-10-16: nobody was told, and the
 * writer had no "Where things stand" block): carrying on from the scene so far (`soFar`), when its stage wasn't worked
 * out in time; otherwise when there is a scene before in this story to start from and its stage still isn't kept, even
 * after the plan's wait. Null when it was told, when there is nothing to start from, or when the memory can't work (no
 * memory model, or this month's spending limit: the top bar says so already).
 */
export function stageNote(input: Pick<ContextInput, 'continuity' | 'memory'>, o: { soFar: boolean; memoryReady: boolean }): string | null {
  if (!o.memoryReady || input.continuity) return null
  if (o.soFar) return STAGE_LATE_SO_FAR
  const prev = input.memory.previous
  return prev && !prev.otherStory ? STAGE_LATE : null
}

// ---------- Where things stand at the end of the scene so far ----------
// Add below, a later beat and Continue carry on from words already in the scene, so the writer is told where things
// stand at the end of those words, not as the previous scene ended. The memory keeper registers how (setStandAt).

export type StandAt = (db: DB, sceneId: ID, text: string, signal?: AbortSignal) => Promise<SceneState | null>

let standAt: StandAt | null = null

/** Registers how where things stand at the end of a scene so far is worked out (the memory keeper's continuityAt). */
export function setStandAt(fn: StandAt | null): void {
  standAt = fn
}

/**
 * Where things stand at the end of `text` (the words before an AI edit's selection) as already kept, with no call to
 * the memory model: a checkpoint worked out at exactly that point and still standing. Null otherwise, and at the very
 * start of a scene (how the scene before ended needn't hold there; an edit doesn't wait to find out).
 */
export function standKept(db: DB, sceneId: ID, text: string): SceneState | null {
  if (!text.trim()) return null
  const kept = storedStateAt(db, sceneId, text)
  return kept?.exact && kept.current ? kept.state : null
}

/** How long writing waits for where things stand in the scene so far before going ahead without it. */
export const STAND_LIMIT_MS = 30_000

/**
 * Where things stand at the end of `text`, the scene so far; null when it isn't known, takes longer than `limitMs`
 * (it goes on in the background and is kept for next time) or `signal` is aborted. Never throws.
 */
export async function standAtText(
  db: DB,
  sceneId: ID,
  text: string,
  limitMs = STAND_LIMIT_MS,
  signal?: AbortSignal
): Promise<SceneState | null> {
  const fn = standAt
  if (!fn || !text.trim() || signal?.aborted) return null
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), limitMs)
  })
  const stopped = new Promise<null>((resolve) => {
    onAbort = () => resolve(null)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
  const run = Promise.resolve()
    .then(() => fn(db, sceneId, text))
    .catch((e: unknown) => {
      console.warn('Could not work out where things stand in the scene so far', e)
      return null
    })
  try {
    return await Promise.race([run, late, stopped])
  } finally {
    clearTimeout(timer)
    if (onAbort) signal?.removeEventListener('abort', onAbort)
  }
}
