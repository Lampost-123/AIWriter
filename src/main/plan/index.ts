// Plan before writing, on the open world (plan.ts does the work): whether to plan at all, with which model, and from
// which briefing. ai/draftFlow.ts asks for a plan before Generate, Add below and each beat (not Variants: one plan for a
// set would make its drafts alike, and choice is what they are for). With a continuity brief (long story memory fix 14,
// brief.ts), what the plan reads besides comes from the world here: the book so far when it goes in whole, how each
// earlier chapter ended, and the rule checks' findings still open in the scene.

import type Database from 'better-sqlite3'
import type { ContextPreview, ID } from '@shared/types'
import { getSettings } from '../settings'
import * as world from '../world'
import { memoryModel } from '../keeper'
import { DEFAULT_MEMORY_CONTEXT } from '../keeper/model'
import { estimateTokens } from '../keeper/text'
import { pausedNote } from '../usage/gate'
import { TOKENS_PER_WORD, toldStage, type ContextInput, type PreparedContext } from '../ai/context'
import { memoryScale } from '../ai/memoryRoom'
import { shortPlace } from '../ai/mustStay'
import { briefSize, briefWanted } from '../ai/brief'
import { SO_FAR_BLOCK } from '../beats/instructions'
import * as repo from '../db/repo'
import { openRuleFindings, sceneTexts } from '../db/checks'
import { storedSnapshots } from '../db/snapshots'
import { loadShape } from '../memory/scene'
import { buildLine, labeler, storyOfScene } from '../memory/line'
import { makePlan, planMaterial, planMessages, PLAN_REPLY_TOKENS, type MadePlan, type PlanMaterial } from './plan'
import {
  allOpenThreads,
  BOOK_READER,
  BRIEF_REPLY_SHARE,
  briefFrees,
  briefMaterial,
  briefRoom,
  type BookScene,
  type BriefSources,
  type ChapterRecord
} from './brief'

type DB = Database.Database

/**
 * Whether drafts plan first: Settings › Models, "Plan before writing" (on unless Adam turns it off). App tests that
 * aren't about planning turn it off with AIWRITE_PLAN=off, so they make no extra call.
 */
export function planWanted(): boolean {
  if (process.env.AIWRITE_PLAN === 'off') return false
  return getSettings().planFirst !== false
}

/**
 * The plan for a draft about to be written from this briefing, made with the memory model (and its Thinking, Off unless
 * Adam changed it); null when planning is off, the memory model isn't set up or is paused (the month's spending limit),
 * or the plan failed, was stopped or took too long. Never throws. `focus`: for Beat by beat, the one beat to plan. With
 * "Write a continuity brief before each scene" on (fix 14), the same call also writes the brief.
 */
export async function planBeforeWriting(
  db: Database.Database,
  sceneId: ID,
  b: {
    input: ContextInput
    preview: ContextPreview
    prepared: Pick<PreparedContext, 'finals' | 'contract'> & Partial<Pick<PreparedContext, 'blocks'>>
  },
  signal?: AbortSignal,
  focus = ''
): Promise<MadePlan | null> {
  try {
    if (!planWanted() || pausedNote()) return null
    const model = memoryModel()
    if ('error' in model) return null
    const live = (): boolean => db.open && world.maybeCurrentWorld()?.db === db
    const entries = b.preview.entries ?? []
    const plain = planMaterial(b.input, b.preview, b.prepared, focus)
    // With a continuity brief (fix 14) when Adam wants one; a brief that can't be put together leaves the plan as it was.
    const material = briefWanted(getSettings())
      ? safely(() => withBrief(db, sceneId, b, plain, model.choice.contextLength ?? DEFAULT_MEMORY_CONTEXT), plain)
      : plain
    return await makePlan({
      db,
      model,
      sceneId,
      material,
      check: {
        // The stage as the writer is told it: only the people in the scene, and a time that still holds.
        stand: toldStage(b.input),
        entries: b.input.memory.entries,
        inBriefing: new Set(entries.filter((e) => !e.hidden && e.blockId).map((e) => e.entryId)),
        hidden: new Set(entries.filter((e) => e.hidden).map((e) => e.entryId))
      },
      carryingOn: b.preview.blocks.some((x) => x.id === SO_FAR_BLOCK && !x.dropped),
      signal,
      closed: () => !live()
    })
  } catch (e) {
    console.warn('Could not plan the scene; writing without a plan', e)
    return null
  }
}

/**
 * The plan's material with what the continuity brief needs (fix 14): every open plot thread in place of the writer's
 * capped list, the story record fitted to the room the memory model has, and the book so far when it goes in whole.
 * Whatever can't be read is left out; the plan is as it would be without a brief only if nothing can be. The brief is
 * asked to be about as long as what goes short beside it frees, between 1,000 tokens and what the writer's room allows.
 */
export function withBrief(
  db: DB,
  sceneId: ID,
  b: {
    input: ContextInput
    preview: Pick<ContextPreview, 'blocks'>
    prepared: Pick<PreparedContext, 'contract'> & Partial<Pick<PreparedContext, 'blocks'>>
  },
  material: PlanMaterial,
  contextLength: number
): PlanMaterial {
  const tokens = briefSize(memoryScale(b.input.contextLength), briefFrees(b.preview, b.prepared.blocks))
  const reply = PLAN_REPLY_TOKENS + Math.ceil(tokens * BRIEF_REPLY_SHARE)
  const own: PlanMaterial = { ...material, threads: allOpenThreads(b.input) }
  const empty = { book: null, record: [], late: [], words: 0, tokens }
  const base = estimateTokens(
    planMessages({ ...own, brief: empty })
      .map((m) => m.content)
      .join('\n')
  )
  const scenes = contextLength >= BOOK_READER ? safely(() => bookScenes(db, sceneId, b.input.story.title), null) : null
  // A first guess from the word counts (no text read), then the text's own size once it is read.
  const guess = scenes ? Math.ceil(scenes.words * TOKENS_PER_WORD) : null
  let room = briefRoom({ contextLength, base, reply, book: guess })
  let book: BookScene[] | null = null
  if (room.book && scenes) {
    book = safely(() => bookText(db, scenes.ids), null)
    const size = book ? estimateTokens(book.map((s) => `### ${s.label}: ${s.title}\n${s.text}`).join('\n\n')) : null
    room = briefRoom({ contextLength, base, reply, book: size })
    if (!room.book) book = null
  }
  const sources: BriefSources = {
    book,
    chapters: safely(() => chapterRecords(db, sceneId, b.input.story.title), []),
    findings: safely(() => openRuleFindings(db, sceneId), []),
    room: room.record,
    tokens
  }
  return { ...own, brief: briefMaterial(b.input, b.prepared, sources) }
}

const safely = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn()
  } catch (e) {
    console.warn('Could not read part of the story for the continuity brief', e)
    return fallback
  }
}

/** This story's scenes before this one on its line, in reading order, with where each is and how many words (no text). */
function bookScenes(db: DB, sceneId: ID, storyTitle: string): { ids: { id: ID; label: string; title: string }[]; words: number } | null {
  const shape = loadShape(db)
  const story = storyOfScene(shape, sceneId)
  if (!story) return null
  const label = labeler(shape)
  const titles = new Map(story.chapters.flatMap((c) => c.scenes.map((s) => [s.id, s.title] as const)))
  const ids = buildLine(shape, { storyId: story.id, before: sceneId })
    .steps.flatMap((s) => (s.type === 'scene' && s.via === 'line' && s.storyId === story.id ? [s.sceneId] : []))
    .map((id) => ({ id, label: shortPlace(label({ storyId: story.id, sceneId: id }), storyTitle), title: titles.get(id) ?? '' }))
  const counts = repo.sceneWordCounts(
    db,
    ids.map((x) => x.id)
  )
  const kept = ids.filter((x) => (counts.get(x.id) ?? 0) > 0)
  if (!kept.length) return null
  return { ids: kept, words: kept.reduce((n, x) => n + (counts.get(x.id) ?? 0), 0) }
}

/** The book so far's words, scene by scene in reading order (scenes with none left out). */
function bookText(db: DB, ids: { id: ID; label: string; title: string }[]): BookScene[] | null {
  const texts = sceneTexts(
    db,
    ids.map((x) => x.id)
  )
  const out = ids.flatMap((x) => {
    const text = (texts.get(x.id) ?? '').trim()
    return text ? [{ label: x.label, title: x.title, text }] : []
  })
  return out.length ? out : null
}

/** How each earlier chapter of this story ended, as the memory keeper last worked it out (fix 15), oldest first. */
function chapterRecords(db: DB, sceneId: ID, storyTitle: string): ChapterRecord[] {
  const shape = loadShape(db)
  const story = storyOfScene(shape, sceneId)
  if (!story) return []
  const at = story.chapters.findIndex((c) => c.scenes.some((s) => s.id === sceneId))
  const before = story.chapters.slice(0, Math.max(0, at))
  if (!before.length) return []
  const kept = storedSnapshots(
    db,
    before.map((c) => c.id)
  )
  const label = labeler(shape)
  return before.flatMap((c) => {
    const snapshot = kept.get(c.id)?.snapshot
    return snapshot ? [{ label: shortPlace(label({ storyId: story.id, chapterId: c.id }), storyTitle), snapshot }] : []
  })
}
