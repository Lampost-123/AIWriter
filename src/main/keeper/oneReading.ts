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
// (keepSceneSummary: only while the scene's words are those it was written from, never over Adam's own). Since
// 2026-10-19 every reading also gives a verdict on the pay-off of each open thread due here (payoffAsks, below). Pure but
// for the reads in stageToRead and payoffAsks; no Electron imports.

import type Database from 'better-sqlite3'
import type { ID, SceneCard } from '@shared/types'
import { countWords } from '@shared/defaults'
import * as mem from '../db/memory'
import type { SceneMemory } from '../memory/types'
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

// ---------- A verdict on each pay-off due here (overhaul, 2026-10-19) ----------
// Live (16 Oct, DeepSeek Flash): threads stayed open after their payoff was on the page, the model reading the payoff as a
// step on. Now the reading is asked, for each open thread this scene's card says it pays off ("Pays off") or that is due
// now (by the end of this chapter, or overdue), whether the words read pay it off, move it on or leave it untouched, with
// the quote: a few lines at the end of the request it already sends (request.ts), answered in its "payoffs" list
// (apply.ts settlePayoffs).

/** A plot thread the reading must give a verdict on. */
export interface PayoffAsk {
  threadId: ID
  /** 'card': this scene's card plans its pay-off here; 'due': due by the end of this chapter ('now') or overdue. */
  why: 'card' | 'due'
  /** For 'due': whether it is overdue, and the chapter it was due by ("Ch 4"). */
  overdue?: boolean
  dueBy?: string
}

/** The most threads one reading is asked about (the card's first). */
export const PAYOFF_ASKS = 4

/** What a verdict says of a thread. */
export type PayoffVerdict = 'paid' | 'moved' | 'untouched'

/**
 * The threads to ask about as this scene is read: open (not dropped, and not already resolved in this scene), this scene's
 * card planning the pay-off here first (a planned one too: the card is Adam's plan), then those overdue, then those due by
 * the end of this chapter. At most PAYOFF_ASKS. Never throws.
 */
export function payoffAsks(
  db: DB,
  sceneId: ID,
  card: Pick<SceneCard, 'paysOffIds'>,
  memory: Pick<SceneMemory, 'threads' | 'entries'> | null
): PayoffAsk[] {
  try {
    const threads = memory?.threads ?? []
    if (!threads.length) return []
    const kinds = new Map(memory!.entries.map((e) => [e.id, e.kind]))
    const resolvedHere = new Set(
      mem
        .changesInScene(db, sceneId)
        .filter((c) => c.kind === 'thread' && c.payload.status === 'resolved')
        .map((c) => c.entryId)
    )
    const onCard = new Set(card.paysOffIds ?? [])
    const asks: (PayoffAsk & { order: number })[] = []
    threads.forEach((t, i) => {
      if (t.status !== 'open' || t.standing === 'dropped' || kinds.get(t.entryId) !== 'thread' || resolvedHere.has(t.entryId)) return
      if (onCard.has(t.entryId)) asks.push({ threadId: t.entryId, why: 'card', order: i })
      else if (!t.planned && (t.due?.state === 'overdue' || t.due?.state === 'now'))
        asks.push({ threadId: t.entryId, why: 'due', overdue: t.due.state === 'overdue', dueBy: t.due.label, order: threads.length * (t.due.state === 'overdue' ? 1 : 2) + i })
    })
    return asks
      .sort((a, b) => a.order - b.order)
      .slice(0, PAYOFF_ASKS)
      .map(({ order: _, ...a }) => a)
  } catch (e) {
    console.warn('Could not tell which plot threads are due here', e)
    return []
  }
}

/** The verdict a reply gives, read forgivingly ("paid off", "advanced", "none"); null when it says nothing usable. */
export function payoffVerdict(v: unknown): PayoffVerdict | null {
  const s = String(v ?? '')
    .toLowerCase()
    .replace(/[^a-z ]+/g, ' ')
    .trim()
  if (/^(paid|paid off|pays off|pays it off|resolved|closed|answered)$/.test(s)) return 'paid'
  if (/^(moved|moved on|moves on|advanced|developing|closer|progress)$/.test(s)) return 'moved'
  if (/^(untouched|none|no|not touched|nothing)$/.test(s)) return 'untouched'
  return null
}

/** The reply's "stage" (where things stand), as the tracker reads its own reply; undefined when there is none. */
export function stageFromReply(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const stage = (value as { stage?: unknown }).stage
  return stage && typeof stage === 'object' && !Array.isArray(stage) ? (stage as Record<string, unknown>) : undefined
}
