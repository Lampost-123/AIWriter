// Summaries the keeper writes: each scene's (100 to 250 words, a long scene in parts first), and the
// roll-ups (chapter from its scenes, story from its chapters, series from its books), each only when
// what it is made from has changed. Adam's own summaries are never replaced automatically: when the
// scene changes under one, a question-marked line offers a new one. Every summary written is listed
// in What changed with Undo. No Electron imports.
// Since 2026-10-16 (long story memory fix 15) no summary is built on an older version of itself: a scene's is written
// again from its words whenever it is due (never patched), and a roll-up is made from the level below plus the story
// record (memory/chapterRecord.ts: what changed in a chapter for a chapter; how things stand at the end of the last
// chapter for a story or series), which the model is told to follow where a summary says otherwise. Each summary is tied to what it was made from (`sourceHash`: the
// scenes, chapters or books by id with the revision of their summaries, and the record's part), so a change to one
// scene makes only what rests on it out of date; markOutOfDate marks those, so the screen can say so.

import type Database from 'better-sqlite3'
import type { ChatMessage, ContextBlock, ID, SummaryLevel } from '@shared/types'
import { countWords } from '@shared/defaults'
import * as mem from '../db/memory'
import * as repo from '../db/repo'
import * as kdb from '../db/keeper'
import { storedSnapshots } from '../db/snapshots'
import { entryNames } from '../memory/chapterRecord'
import { changedLines, endLines, endPart, localPart, type ChapterSnapshot } from '../memory/snapshot'
import { callModel, DEFAULT_MEMORY_CONTEXT, type CallResult, type MemoryModel } from './model'
import { SUMMARY_SYSTEM, cleanSummary, summaryPrompt, type SummaryAsk } from './prompts'
import { estimateTokens, firstWords, hashText, splitLong, textParas } from './text'
import type { Undo } from './apply'
import { MIN_SUMMARY_WORDS, sameSource, sceneSourceHash, summaryDue } from './sceneChange'

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
const MIN_WORDS = MIN_SUMMARY_WORDS
const SCENE_REPLY = 700
const ROLLUP_REPLY = 900
/** The most of a roll-up's room the story record may take (the rest is the summaries it is made from). */
const RECORD_SHARE = 0.4

const summaryFingerprint = (level: SummaryLevel, targetId: ID): string => `summary:${level}:${targetId}`

export { sceneSourceHash }

/** A summary Adam undid isn't written again from the same sources (stored as a suppression keyed by the summary's target). */
function suppressed(db: DB, level: SummaryLevel, targetId: ID, hash: string): boolean {
  const fp = summaryFingerprint(level, targetId)
  return kdb.suppressionsInScene(db, targetId).some((s) => s.fingerprint === fp && (s.words === hash || (level === 'scene' && sameSource(s.words, hash))))
}

/** After an undo: this summary isn't written again until what it is made from changes. */
export function suppressSummary(db: DB, level: SummaryLevel, targetId: ID, sourceHash: string): void {
  if (sourceHash) kdb.addSuppression(db, summaryFingerprint(level, targetId), targetId, sourceHash)
}

/**
 * True when a scene's summary should be (re)written now. Since 2026-10-08 (World Memory Overhaul A3), while Adam is
 * still writing, when about forty words changed or a changed paragraph names someone or something in the memory
 * (sceneChange.ts summaryDue), rather than only when the scene grew or shrank a good deal.
 */
export function sceneSummaryDue(db: DB, sceneId: ID, done: boolean): boolean {
  const scene = kdb.keeperScene(db, sceneId)
  if (!scene) return false
  const words = countWords(scene.text)
  const row = kdb.summaryRow(db, 'scene', sceneId)
  if (row?.origin === 'adam') return false
  // Not needed (too short to sum up, or Adam undid the one made from these words): a mark that it is being brought up
  // to date goes, as nothing will (long story memory fix 15, review).
  const notNeeded = (): false => {
    if (row?.stale) kdb.setTextSummaryStale(db, 'scene', sceneId, false)
    return false
  }
  if (words < MIN_WORDS) {
    if (words === 0 && row) kdb.deleteTextSummary(db, 'scene', sceneId)
    return notNeeded()
  }
  if (suppressed(db, 'scene', sceneId, sceneSourceHash(scene.text, scene.doc))) return notNeeded()
  return summaryDue(db, sceneId, done)
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
  const sourceHash = sceneSourceHash(text, scene.doc)
  const room = textRoom(o.model, SCENE_REPLY)
  const calls: CallResult[] = []
  let written: Written | null = null
  // Always from the scene's words as they are now, never by patching the old summary (fix 15): every round of editing a
  // summary rather than the scene adds errors.
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

/** The record's lines that fit in `room` tokens, in order (the facts first, how things stand after). */
function fitLines(lines: string[], room: number): string[] {
  const out: string[] = []
  let used = 0
  for (const l of lines) {
    const t = estimateTokens(`- ${l}\n`)
    if (used + t > room) break
    out.push(l)
    used += t
  }
  return out
}

/** A part a roll-up is made from (a scene, chapter or book summary), with what it is. */
interface Part {
  id: ID
  label: string
  text: string
}

/**
 * What one roll-up is made from now (fix 15): the summaries of the level below (signposts), and the story record's
 * snapshot (the facts: a chapter's own, or the last chapter's for a story or series). `tag` ties it to them: the
 * record's part, then each part by id with the revision of its summary. `legacy` is what a roll-up written before then
 * says it was made from (its summaries alone): one whose summaries haven't changed since still counts as up to date, so
 * a world never has every roll-up written again at once.
 */
interface Sources {
  level: 'chapter' | 'story' | 'series'
  targetId: ID
  parts: Part[]
  record: ChapterSnapshot | null
  tag: string
  legacy: string
}

const revisions = (parts: Part[]): string => parts.map((p) => `${p.id}~${hashText(p.text).slice(0, 12)}`).join(',')

/** A chapter is tied to its scenes and to what changed in it; a story or series to its parts and how things stand at its end. */
function sourcesOf(level: Sources['level'], targetId: ID, parts: Part[], record: ChapterSnapshot | null): Sources {
  const prefix = { chapter: 'ch2', story: 'st2', series: 'se2' }[level]
  const own = level === 'chapter' ? localPart(record) : endPart(record)
  const legacy = level === 'series' ? parts.map((p) => `${p.label}\n${p.text}`).join('\n') : parts.map((p) => p.text).join('\n')
  return { level, targetId, parts, record, tag: `${prefix}|${hashText(own)}|${revisions(parts)}`, legacy: hashText(legacy) }
}

/** What a story's roll-ups are made from now: each chapter with a summarised scene, then the story itself. */
function storySources(
  db: DB,
  storyId: ID
): { chapters: (Sources & { title: string; lastSceneId: ID })[]; story: (Sources & { lastSceneId: ID | null }) | null } {
  const outline = repo.getOutline(db, storyId)
  const snapshots = storedSnapshots(
    db,
    outline.chapters.map((c) => c.id)
  )
  const summaries = new Map(mem.storySummaries(db, storyId).map((x) => [`${x.level}:${x.targetId}`, x]))
  const text = (level: SummaryLevel, id: ID): string => summaries.get(`${level}:${id}`)?.text.trim() ?? ''
  const chapters: (Sources & { title: string; lastSceneId: ID })[] = []
  const told: Part[] = []
  let end: ChapterSnapshot | null = null
  let lastSummarised: ID | null = null
  for (const [ci, ch] of outline.chapters.entries()) {
    const scenes = outline.scenes.filter((s) => s.chapterId === ch.id)
    const parts = scenes
      .map((s, i) => ({ id: s.id, label: numbered('Scene', i + 1, s.title), text: text('scene', s.id) }))
      .filter((x) => x.text)
    const snapshot = snapshots.get(ch.id)?.snapshot ?? null
    if (parts.length) {
      chapters.push({ ...sourcesOf('chapter', ch.id, parts, snapshot), title: ch.title, lastSceneId: parts[parts.length - 1].id })
      lastSummarised = parts[parts.length - 1].id
    }
    const own = text('chapter', ch.id)
    if (own) {
      told.push({ id: ch.id, label: numbered('Chapter', ci + 1, ch.title), text: own })
      end = snapshot
    }
  }
  // A story's last scene with a summary (or its last scene): its calls are recorded against it.
  const lastSceneId = lastSummarised ?? outline.scenes.at(-1)?.id ?? null
  return { chapters, story: told.length ? { ...sourcesOf('story', storyId, told, end), lastSceneId } : null }
}

/** A part's label: Scene 2 "The Weir" with a title of its own, Scene 2 alone with none or the default one. */
const numbered = (kind: 'Scene' | 'Chapter', n: number, title: string): string => {
  const t = title.trim()
  return t && !new RegExp(`^${kind}\\s*\\d+$`, 'i').test(t) ? `${kind} ${n} "${t}"` : `${kind} ${n}`
}

/** A series' roll-up sources: its books' summaries (never prequels and the like) and how things stand at the end of the last. */
function seriesSources(db: DB, seriesId: ID, stories: ReturnType<typeof repo.listStories>): (Sources & { lastStoryId: ID }) | null {
  const apart = apartFromBooks(stories)
  const books = stories.filter((s) => s.seriesId === seriesId && !apart(s.id)).sort((a, b) => a.createdOrder - b.createdOrder)
  const parts: Part[] = []
  let lastStoryId: ID | null = null
  let end: ChapterSnapshot | null = null
  for (const s of books) {
    const own = kdb.summaryRow(db, 'story', s.id)?.text.trim() ?? ''
    if (!own) continue
    parts.push({ id: s.id, label: s.title.trim() || 'Untitled story', text: own })
    lastStoryId = s.id
  }
  if (!parts.length || !lastStoryId) return null
  end = storySources(db, lastStoryId).story?.record ?? null
  return { ...sourcesOf('series', seriesId, parts, end), lastStoryId }
}

/**
 * True when a summary is made from what its sources are now, or Adam undid the one made from them: since fix 15 (by its
 * tag), or before it (by its summaries alone: an undo then left the summary with no source and a suppression of that
 * hash, review 2026-10-16), so a roll-up he undid isn't written again when a world first opens with this version.
 */
function upToDate(db: DB, s: Pick<Sources, 'level' | 'targetId' | 'tag' | 'legacy'>, row: { sourceHash: string }): boolean {
  return (
    row.sourceHash === s.tag ||
    (!row.sourceHash.includes('|') && row.sourceHash === s.legacy) ||
    suppressed(db, s.level, s.targetId, s.tag) ||
    suppressed(db, s.level, s.targetId, s.legacy)
  )
}

const changedSince = (db: DB, s: Sources, skip: (key: string) => boolean): boolean => {
  if (skip(`${s.level}:${s.targetId}:${s.tag}`)) return false
  const row = kdb.summaryRow(db, s.level, s.targetId)
  if (row?.origin === 'adam') return false
  return !row || !upToDate(db, s, row)
}

/** The key a roll-up attempt is remembered by (so one that failed isn't tried again until its sources change). */
export const rollUpKey = (r: Pick<RollUp, 'level' | 'targetId' | 'sourceHash'>): string => `${r.level}:${r.targetId}:${r.sourceHash}`

/**
 * The record's lines for a roll-up, within its share of the room: for a chapter, what changed in it (its summary is tied
 * to that alone, so how things stand at its end, which an edit in an earlier chapter can change, is left to the snapshot
 * the timeline shows, with no AI: review, 2026-10-16); for a story or series, how things stand at its end.
 */
function recordFor(s: Sources, names: ReturnType<typeof entryNames>, room: number): { record: string[]; end: string[]; tokens: number } {
  if (!s.record) return { record: [], end: [], tokens: 0 }
  const share = Math.floor(room * RECORD_SHARE)
  const record = s.level === 'chapter' ? fitLines(changedLines(s.record, names), share) : []
  const end = s.level === 'chapter' ? [] : fitLines(endLines(s.record, names), share)
  return { record, end, tokens: estimateTokens([...record, ...end].map((l) => `- ${l}`).join('\n')) }
}

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
  let names: ReturnType<typeof entryNames> | null = null
  const inputs = (s: Sources): { record: string[]; end: string[]; summaries: { label: string; text: string }[] } => {
    names ??= entryNames(db)
    const r = recordFor(s, names, room)
    return { record: r.record, end: r.end, summaries: fit(s.parts.map(({ label, text }) => ({ label, text })), Math.max(200, room - r.tokens)) }
  }
  for (const storyId of storyIds) {
    const story = stories.find((s) => s.id === storyId)
    if (!story) continue
    if (story.seriesId && !apart(story.id)) seriesToCheck.add(story.seriesId)
    const src = storySources(db, storyId)
    for (const ch of src.chapters) {
      if (!changedSince(db, ch, skip)) continue
      const a = inputs(ch)
      return {
        level: 'chapter',
        targetId: ch.targetId,
        sceneId: ch.lastSceneId,
        ask: { level: 'chapter', where: label({ storyId, chapterId: ch.targetId }), title: ch.title, summaries: a.summaries, record: a.record },
        sourceHash: ch.tag,
        place: { storyId, chapterId: ch.targetId }
      }
    }
    const st = src.story
    if (st?.lastSceneId && changedSince(db, st, skip)) {
      const a = inputs(st)
      return {
        level: 'story',
        targetId: storyId,
        sceneId: st.lastSceneId,
        ask: { level: 'story', title: story.title, summaries: a.summaries, end: a.end },
        sourceHash: st.tag,
        place: { storyId, chapterId: null }
      }
    }
  }
  for (const seriesId of seriesToCheck) {
    const series = repo.listSeries(db).find((s) => s.id === seriesId)
    const src = series ? seriesSources(db, seriesId, stories) : null
    if (!series || !src) continue
    const sceneId = storySources(db, src.lastStoryId).story?.lastSceneId ?? null
    if (sceneId && changedSince(db, src, skip)) {
      const a = inputs(src)
      return {
        level: 'series',
        targetId: seriesId,
        sceneId,
        ask: { level: 'series', name: series.name, summaries: a.summaries, end: a.end },
        sourceHash: src.tag,
        place: { storyId: null, chapterId: null }
      }
    }
  }
  return null
}

/**
 * Marks which of a story's roll-ups (its chapters', its own, and its series') the memory wrote from sources that have
 * changed since, so the screen can say each is being brought up to date, and clears the mark from those made from what
 * is there now. Adam's own are left alone, and so is one Adam undid (it isn't written again until its sources change).
 * `givenUp`: roll-ups the keeper has stopped trying to write this session (by rollUpKey), which aren't marked either, as
 * nothing would bring them up to date. Reads only stored summaries and snapshots: no model. True when a mark changed.
 */
export function markOutOfDate(db: DB, storyId: ID, givenUp: (key: string) => boolean = () => false): boolean {
  if (!db.open) return false
  const stories = repo.listStories(db)
  const story = stories.find((s) => s.id === storyId)
  if (!story) return false
  const src = storySources(db, storyId)
  const all: Sources[] = [...src.chapters, ...(src.story ? [src.story] : [])]
  if (story.seriesId && !apartFromBooks(stories)(story.id)) {
    const series = seriesSources(db, story.seriesId, stories)
    if (series) all.push(series)
  }
  let changed = false
  for (const s of all) {
    const row = kdb.summaryRow(db, s.level, s.targetId)
    if (!row || row.origin === 'adam' || !row.text.trim()) continue
    const current = upToDate(db, s, row) || givenUp(rollUpKey({ level: s.level, targetId: s.targetId, sourceHash: s.tag }))
    if (current === !row.stale) continue
    kdb.setTextSummaryStale(db, s.level, s.targetId, !current)
    changed = true
  }
  return changed
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
