// One reading of a scene (overhaul phase 1, 2026-10-19). The memory keeper, where things stand (continuity/tracker.ts)
// and the scene's summary each sent the same scene to the memory model on their own: about four fifths of the tokens a
// writing session sent went on that upkeep. Now the keeper's reading of a scene says, in the same call:
// - where things stand at the end of the words it reads, when those are exactly the words the tracker would read next
//   (the whole scene from its start, or everything after its latest checkpoint) and the scenes before are kept from their
//   words as they are now (tracker.ts stageToRead), so the tracker's own call is skipped; and
// - the scene's summary, when the whole scene is read in that one request and its summary is due (sceneChange.ts
//   summaryDue, as the engine reckons it), so the summary's own call is skipped too.
// Only in one request: a scene read in parts, a reading whose extra parts wouldn't fit the model's window or reply limit,
// and every other case go on as before (the tracker and the summary make their own calls). The reading's facts are
// applied exactly as before; what it says of where things stand is kept by the tracker's own rules (keepStageRead: only
// values with words from what was read, never on a start that has changed since), and its summary by the summaries' own
// (keepSceneSummary: only while the scene's words are those it was written from, never over Adam's own). Pure but for
// the reads in stageToRead; no Electron imports.

import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'
import { countWords } from '@shared/defaults'
import { looksLikeRefusalReply } from '../ai/errors'
import { stageToRead, type StageAsk } from '../continuity/tracker'
import type { MemoryModel } from './model'
import { cleanSummary } from './prompts'
import type { ReadingChunk } from './request'
import { sceneSourceHash } from './sceneChange'
import type { Para } from './text'
import type { KeeperScene } from '../db/keeper'

type DB = Database.Database

/** What a reading also asks for: where things stand at the end of what it reads, and the scene's summary. */
export interface OneReading {
  stage: StageAsk | null
  summary: { words: number; sourceHash: string } | null
}

/** The scene's summary as a reading wrote it, from the scene's words as they were then (`sourceHash`). */
export interface SummaryRead {
  text: string
  sourceHash: string
  generationId: ID
}

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim()
const wordsOf = (paras: Pick<Para, 'text'>[]): string => squash(paras.map((p) => p.text).join(' '))

/**
 * What the one request reading `chunk` (a scene's only chunk) should also ask for, or null for the reading alone.
 * `summaryDue`: whether the scene's summary is due now (the engine's reckoning: summaries on, sceneSummaryDue). Never throws.
 */
export function oneReadingFor(
  db: DB,
  scene: KeeperScene,
  paras: Para[],
  chunk: ReadingChunk,
  model: MemoryModel,
  summaryDue: () => boolean
): OneReading | null {
  const read = wordsOf(chunk.paras)
  if (!read) return null
  let stage: StageAsk | null = null
  try {
    const ask = stageToRead(db, scene.sceneId, model)
    // Only the very words the tracker would read: a reading that leaves some of them out, or reads more, can't say where
    // things stand as the tracker would.
    if (ask && squash(ask.words) === read) stage = ask
  } catch (e) {
    console.warn('Could not tell whether the reading can say where things stand', e)
  }
  let summary: OneReading['summary'] = null
  try {
    // The summary is of the whole scene, written from its words: only when this request reads every paragraph.
    if (wordsOf(paras) === read && summaryDue()) summary = { words: countWords(scene.text), sourceHash: sceneSourceHash(scene.text, scene.doc) }
  } catch (e) {
    console.warn('Could not tell whether the reading can write the summary', e)
  }
  return stage || summary ? { stage, summary } : null
}

/** The reply's summary, tidied as a summary's own reply is; undefined when there is none, or it is a refusal. */
export function summaryFromReply(value: unknown, asked: OneReading['summary'], generationId: ID): SummaryRead | undefined {
  if (!asked || !value || typeof value !== 'object') return undefined
  const raw = (value as { summary?: unknown }).summary
  if (typeof raw !== 'string' || !raw.trim() || looksLikeRefusalReply(raw)) return undefined
  const text = cleanSummary(raw)
  return text ? { text, sourceHash: asked.sourceHash, generationId } : undefined
}

/** The reply's "stage" (where things stand), as the tracker reads its own reply; undefined when there is none. */
export function stageFromReply(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const stage = (value as { stage?: unknown }).stage
  return stage && typeof stage === 'object' && !Array.isArray(stage) ? (stage as Record<string, unknown>) : undefined
}
