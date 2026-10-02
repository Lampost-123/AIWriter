// Summaries the keeper writes: each scene's (100 to 250 words, a long scene in parts first), and the
// roll-ups (chapter from its scenes, story from its chapters, series from its books), each only when
// what it is made from has changed. Adam's own summaries are never replaced automatically: when the
// scene changes under one, a question-marked line offers a new one. Every summary written is listed
// in What changed with Undo. No Electron imports.

import type Database from 'better-sqlite3'
import type { ChatMessage, ContextBlock, ID, SummaryLevel } from '@shared/types'
import { countWords } from '@shared/defaults'
import * as mem from '../db/memory'
import * as repo from '../db/repo'
import * as kdb from '../db/keeper'
import { callModel, DEFAULT_MEMORY_CONTEXT, type CallResult, type MemoryModel } from './model'
import { SUMMARY_SYSTEM, cleanSummary, summaryPrompt, type SummaryAsk } from './prompts'
import { estimateTokens, firstWords, hashText, splitLong, textParas } from './text'
import type { Undo } from './apply'

type DB = Database.Database

export interface SummaryOptions {
  db: DB
  model: MemoryModel
  signal: AbortSignal
  closed: () => boolean
  onRecord?: (generationId: ID) => void
  fetchImpl?: typeof fetch
  retryDelays?: number[]
}

/** Too short to be worth a summary. */
const MIN_WORDS = 40
const SCENE_REPLY = 700
const ROLLUP_REPLY = 900

const summaryFingerprint = (level: SummaryLevel, targetId: ID): string => `summary:${level}:${targetId}`

/** What a scene summary stands for: the scene's words and how many there are. */
export const sceneSourceHash = (text: string): string => `${hashText(text)}|${countWords(text)}`

/** A summary Adam undid isn't written again from the same sources (stored as a suppression keyed by the summary's target). */
function suppressed(db: DB, level: SummaryLevel, targetId: ID, hash: string): boolean {
  return kdb.suppressionsInScene(db, targetId).some((s) => s.fingerprint === summaryFingerprint(level, targetId) && s.words === hash)
}

/** After an undo: this summary isn't written again until what it is made from changes. */
export function suppressSummary(db: DB, level: SummaryLevel, targetId: ID, sourceHash: string): void {
  if (sourceHash) kdb.addSuppression(db, summaryFingerprint(level, targetId), targetId, sourceHash)
}

/** True when a scene's summary should be (re)written now. */
export function sceneSummaryDue(db: DB, sceneId: ID, done: boolean): boolean {
  const scene = kdb.keeperScene(db, sceneId)
  if (!scene) return false
  const words = countWords(scene.text)
  const row = kdb.summaryRow(db, 'scene', sceneId)
  if (row?.origin === 'adam') return false
  if (words < MIN_WORDS) {
    if (words === 0 && row) kdb.deleteTextSummary(db, 'scene', sceneId)
    return false
  }
  const hash = sceneSourceHash(scene.text)
  if (suppressed(db, 'scene', sceneId, hash)) return false
  if (!row) return true
  if (row.sourceHash === hash) return false
  if (done || row.stale) return true
  // While Adam is still writing: only when the scene has grown or shrunk a good deal.
  const before = Number(row.sourceHash.split('|')[1])
  return !before || Math.abs(words - before) >= Math.max(150, before * 0.3)
}

/** Room for the text to summarise in one request. */
function textRoom(model: MemoryModel, reply: number): number {
  const ctx = model.choice.contextLength && model.choice.contextLength > 0 ? model.choice.contextLength : DEFAULT_MEMORY_CONTEXT
  return Math.max(300, Math.floor(ctx * 0.75) - reply - estimateTokens(SUMMARY_SYSTEM) - 200)
}

interface Written {
  text: string
  generationId: ID
}

/** One summary request. Null when it failed or was stopped (the old summary stays). */
async function ask(o: SummaryOptions, targetId: ID, a: SummaryAsk, reply: number, calls: CallResult[]): Promise<Written | null> {
  const prompt = summaryPrompt(a)
  const messages: ChatMessage[] = [
    { role: 'system', content: SUMMARY_SYSTEM },
    { role: 'user', content: prompt }
  ]
  const block = (id: string, priority: number, title: string, text: string): ContextBlock => ({
    id,
    priority,
    title,
    text,
    tokens: estimateTokens(text),
    entryIds: [],
    dropped: false
  })
  const call = await callModel({
    db: o.db,
    model: o.model,
    targetId,
    job: 'summary',
    messages,
    blocks: [
      block('instructions', 1, 'Instructions for the memory model', SUMMARY_SYSTEM),
      block('summary-source', 2, 'What to summarise', prompt)
    ],
    maxTokens: reply,
    signal: o.signal,
    closed: o.closed,
    onRecord: o.onRecord,
    fetchImpl: o.fetchImpl,
    retryDelays: o.retryDelays
  })
  calls.push(call)
  if (call.status !== 'complete') return null
  const text = cleanSummary(call.text)
  return text ? { text, generationId: call.generationId } : null
}

/** Starts a run record for summary calls and finishes it with their tokens and cost. */
function recordRun(db: DB, targetId: ID, version: number, model: MemoryModel, calls: CallResult[], ok: boolean): ID {
  const runId = kdb.startRun(db, targetId, version)
  const sum = (k: 'promptTokens' | 'completionTokens' | 'cost'): number | null =>
    calls.some((c) => c[k] != null) ? calls.reduce((n, c) => n + (c[k] ?? 0), 0) : null
  kdb.finishRun(db, runId, ok ? 'done' : 'failed', ok ? null : 'The summary could not be written this time.', {
    providerId: model.target.id,
    modelId: model.choice.modelId,
    promptTokens: sum('promptTokens'),
    completionTokens: sum('completionTokens'),
    cost: sum('cost'),
    generationIds: calls.map((c) => c.generationId)
  })
  return runId
}

const LEVEL_WORDS: Record<SummaryLevel, string> = {
  scene: 'Scene summary',
  chapter: 'Chapter summary',
  story: 'Story summary',
  series: 'Series summary'
}

/** Saves a summary the keeper wrote, unless Adam wrote his own meanwhile, and lists it in What changed. */
function save(
  o: SummaryOptions,
  s: {
    level: SummaryLevel
    targetId: ID
    text: string
    sourceHash: string
    generationId: ID
    calls: CallResult[]
    logRunId: ID | null
    sceneId: ID | null
    place: { storyId: ID | null; chapterId: ID | null }
    force?: boolean
  }
): boolean {
  const db = o.db
  if (o.closed() || !db.open) return false
  return db.transaction(() => {
    const row = kdb.summaryRow(db, s.level, s.targetId)
    if (row?.origin === 'adam' && !s.force) return false
    const factId = `${s.level}:${s.targetId}`
    const runId = recordRun(db, s.targetId, 0, o.model, s.calls, true)
    const version = kdb.latestVersion(db, 'summary', factId)
    mem.putSummary(db, {
      level: s.level,
      targetId: s.targetId,
      text: s.text,
      origin: 'text',
      sourceHash: s.sourceHash,
      generationId: s.generationId,
      runId
    })
    const undo: Undo = { op: 'summary', level: s.level, targetId: s.targetId, version, sourceHash: s.sourceHash, place: s.place }
    kdb.insertLog(db, {
      runId: s.logRunId ?? runId,
      sceneId: s.sceneId,
      entryName: '',
      text: row ? `${LEVEL_WORDS[s.level]} updated` : `${LEVEL_WORDS[s.level]} written`,
      before: '',
      after: firstWords(s.text, 30),
      action: row ? 'updated' : 'added',
      what: 'summary',
      entryId: null,
      factId,
      quote: '',
      question: null,
      undo: undo as unknown as Record<string, unknown>
    })
    return true
  })()
}

/**
 * Writes a scene's summary from its text (a long scene in parts, then joined). `logRunId` puts the
 * line in the same group as the run that read the scene. `force` replaces Adam's own (he asked for it).
 */
export async function writeSceneSummary(
  o: SummaryOptions,
  sceneId: ID,
  logRunId: ID | null,
  where: string,
  force = false
): Promise<boolean> {
  const scene = kdb.keeperScene(o.db, sceneId)
  if (!scene || !scene.text.trim()) return false
  const text = scene.text
  const words = countWords(text)
  const sourceHash = sceneSourceHash(text)
  const room = textRoom(o.model, SCENE_REPLY)
  const calls: CallResult[] = []
  let written: Written | null = null
  if (estimateTokens(text) <= room) {
    written = await ask(o, sceneId, { level: 'scene', where, title: scene.title, text, words }, SCENE_REPLY, calls)
  } else {
    // A long scene: summarise it in parts, then join the parts.
    const parts: string[] = []
    let cur = ''
    for (const p of textParas(text).flatMap((x) => splitLong(x.text, room))) {
      if (cur && estimateTokens(`${cur}\n\n${p}`) > room) {
        parts.push(cur)
        cur = ''
      }
      cur = cur ? `${cur}\n\n${p}` : p
    }
    if (cur) parts.push(cur)
    const summaries: string[] = []
    for (let i = 0; i < parts.length; i++) {
      const part = await ask(
        o,
        sceneId,
        { level: 'scene-part', where, title: scene.title, part: i + 1, parts: parts.length, text: parts[i] },
        400,
        calls
      )
      if (!part) break
      summaries.push(part.text)
    }
    if (summaries.length === parts.length) {
      written = await ask(o, sceneId, { level: 'scene-parts', where, title: scene.title, summaries, words }, SCENE_REPLY, calls)
    }
  }
  if (!written) {
    if (!o.closed() && o.db.open && calls.length) recordRun(o.db, sceneId, scene.textVersion, o.model, calls, false)
    return false
  }
  const ch = kdb.keeperScene(o.db, sceneId)
  return save(o, {
    level: 'scene',
    targetId: sceneId,
    text: written.text,
    sourceHash,
    generationId: written.generationId,
    calls,
    logRunId,
    sceneId,
    place: { storyId: ch?.storyId ?? scene.storyId, chapterId: ch?.chapterId ?? scene.chapterId },
    force
  })
}

/** Adam's scene summary is kept when the scene changes; a question-marked line offers a new one (once per version of his). */
export function askSummaryRefresh(db: DB, runId: ID, sceneId: ID): boolean {
  const row = kdb.summaryRow(db, 'scene', sceneId)
  if (row?.origin !== 'adam') return false
  const version = kdb.latestVersion(db, 'summary', `scene:${sceneId}`)
  const key = `summary-refresh:${sceneId}:${version}`
  if (kdb.questionAsked(db, key)) return false
  const undo: Undo = { op: 'summary-refresh', key, sceneId, version }
  kdb.insertLog(db, {
    runId,
    sceneId,
    entryName: '',
    text: 'Scene summary: yours is kept, but the scene has changed since you wrote it',
    before: '',
    after: '',
    action: 'updated',
    what: 'summary',
    entryId: null,
    factId: `scene:${sceneId}`,
    quote: '',
    question: {
      text: 'Keep your summary?',
      options: [
        { id: 'keep', label: 'Keep mine' },
        { id: 'refresh', label: 'Write a new one' }
      ],
      answer: 'keep'
    },
    undo: undo as unknown as Record<string, unknown>
  })
  return true
}

// ---------- Roll-ups ----------

/** Stories that are prequels or own versions, or follow on from one: never in a series roll-up (as the memory core reads it). */
function apartFromBooks(stories: { id: ID; kind: string; startStoryId: ID | null }[]): (id: ID) => boolean {
  const byId = new Map(stories.map((s) => [s.id, s]))
  return (id) => {
    const seen = new Set<ID>()
    for (let cur = byId.get(id); cur && !seen.has(cur.id); cur = cur.startStoryId ? byId.get(cur.startStoryId) : undefined) {
      seen.add(cur.id)
      if (cur.kind === 'prequel' || cur.kind === 'own') return true
    }
    return false
  }
}

export interface RollUp {
  level: 'chapter' | 'story' | 'series'
  targetId: ID
  /** The latest scene it is made from: its model calls are recorded against that scene, never against a chapter, story or series id. */
  sceneId: ID
  ask: SummaryAsk
  sourceHash: string
  place: { storyId: ID | null; chapterId: ID | null }
}

/** Fits a list of summaries into the room, cutting each down evenly when they don't fit. */
function fit(items: { label: string; text: string }[], room: number): { label: string; text: string }[] {
  const total = estimateTokens(items.map((i) => `${i.label}: ${i.text}`).join('\n\n'))
  if (total <= room) return items
  const words = Math.max(25, Math.floor(((room / total) * items.reduce((n, i) => n + countWords(i.text), 0)) / Math.max(1, items.length)))
  return items.map((i) => ({ label: i.label, text: firstWords(i.text, words) }))
}

const changedSince = (db: DB, level: SummaryLevel, targetId: ID, hash: string, skip: (key: string) => boolean): boolean => {
  if (skip(`${level}:${targetId}:${hash}`) || suppressed(db, level, targetId, hash)) return false
  const row = kdb.summaryRow(db, level, targetId)
  if (row?.origin === 'adam') return false
  return !row || row.sourceHash !== hash
}

/** The key a roll-up attempt is remembered by (so one that failed isn't tried again until its sources change). */
export const rollUpKey = (r: Pick<RollUp, 'level' | 'targetId' | 'sourceHash'>): string => `${r.level}:${r.targetId}:${r.sourceHash}`

/** The next roll-up whose sources changed, for these stories (chapters first, then the story, then its series), or null. */
export function nextRollUp(
  db: DB,
  storyIds: Iterable<ID>,
  label: (place: { storyId: ID; chapterId?: ID | null }) => string,
  model: MemoryModel,
  skip: (key: string) => boolean = () => false
): RollUp | null {
  const room = textRoom(model, ROLLUP_REPLY)
  const stories = repo.listStories(db)
  const apart = apartFromBooks(stories)
  const seriesToCheck = new Set<ID>()
  /** A story's last scene with a summary (or its last scene). */
  const lastScene = (storyId: ID): ID | null => {
    const scenes = repo.getOutline(db, storyId).scenes
    return [...scenes].reverse().find((s) => kdb.summaryRow(db, 'scene', s.id))?.id ?? scenes.at(-1)?.id ?? null
  }
  for (const storyId of storyIds) {
    const story = stories.find((s) => s.id === storyId)
    if (!story) continue
    if (story.seriesId && !apart(story.id)) seriesToCheck.add(story.seriesId)
    const outline = repo.getOutline(db, storyId)
    const chapterTexts: { label: string; text: string }[] = []
    for (const ch of outline.chapters) {
      const scenes = outline.scenes.filter((s) => s.chapterId === ch.id)
      const items = scenes
        .map((s, i) => ({
          label: `Scene ${i + 1}${s.title.trim() ? ` "${s.title.trim()}"` : ''}`,
          text: kdb.summaryRow(db, 'scene', s.id)?.text.trim() ?? ''
        }))
        .filter((x) => x.text)
      if (items.length) {
        const hash = hashText(items.map((x) => x.text).join('\n'))
        if (changedSince(db, 'chapter', ch.id, hash, skip)) {
          return {
            level: 'chapter',
            targetId: ch.id,
            sceneId: [...scenes].reverse().find((s) => kdb.summaryRow(db, 'scene', s.id))!.id,
            ask: { level: 'chapter', where: label({ storyId, chapterId: ch.id }), title: ch.title, summaries: fit(items, room) },
            sourceHash: hash,
            place: { storyId, chapterId: ch.id }
          }
        }
      }
      const text = kdb.summaryRow(db, 'chapter', ch.id)?.text.trim()
      if (text) chapterTexts.push({ label: `Chapter ${chapterTexts.length + 1}${ch.title.trim() ? ` "${ch.title.trim()}"` : ''}`, text })
    }
    if (chapterTexts.length) {
      const hash = hashText(chapterTexts.map((x) => x.text).join('\n'))
      const sceneId = lastScene(storyId)
      if (sceneId && changedSince(db, 'story', storyId, hash, skip)) {
        return {
          level: 'story',
          targetId: storyId,
          sceneId,
          ask: { level: 'story', title: story.title, summaries: fit(chapterTexts, room) },
          sourceHash: hash,
          place: { storyId, chapterId: null }
        }
      }
    }
  }
  for (const seriesId of seriesToCheck) {
    const series = repo.listSeries(db).find((s) => s.id === seriesId)
    if (!series) continue
    const items = stories
      .filter((s) => s.seriesId === seriesId && !apart(s.id))
      .sort((a, b) => a.createdOrder - b.createdOrder)
      .map((s) => ({
        storyId: s.id,
        label: s.title.trim() || 'Untitled story',
        text: kdb.summaryRow(db, 'story', s.id)?.text.trim() ?? ''
      }))
      .filter((x) => x.text)
    if (!items.length) continue
    const hash = hashText(items.map((x) => `${x.label}\n${x.text}`).join('\n'))
    const sceneId = lastScene(items[items.length - 1].storyId)
    if (sceneId && changedSince(db, 'series', seriesId, hash, skip)) {
      return {
        level: 'series',
        targetId: seriesId,
        sceneId,
        ask: {
          level: 'series',
          name: series.name,
          summaries: fit(
            items.map(({ label, text }) => ({ label, text })),
            room
          )
        },
        sourceHash: hash,
        place: { storyId: null, chapterId: null }
      }
    }
  }
  return null
}

/** Writes one roll-up. False when the call failed, was stopped, or Adam wrote his own meanwhile. */
export async function writeRollUp(o: SummaryOptions, r: RollUp): Promise<boolean> {
  const calls: CallResult[] = []
  const written = await ask(o, r.sceneId, r.ask, ROLLUP_REPLY, calls)
  if (!written) {
    if (!o.closed() && o.db.open && calls.length) recordRun(o.db, r.targetId, 0, o.model, calls, false)
    return false
  }
  return save(o, {
    level: r.level,
    targetId: r.targetId,
    text: written.text,
    sourceHash: r.sourceHash,
    generationId: written.generationId,
    calls,
    logRunId: null,
    sceneId: null,
    place: r.place
  })
}
