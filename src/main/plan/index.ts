// Plan before writing, on the open world (plan.ts does the work): whether to plan at all, with which model, and from
// which briefing. ai/draftFlow.ts asks for a plan before Generate, Add below and each beat (not Variants: one plan for a
// set would make its drafts alike, and choice is what they are for). With a continuity brief (long story memory fix 14,
// brief.ts), what the plan reads besides comes from the world here: as much of the book so far as goes in, how each
// earlier chapter ended, and the rule checks' findings still open in the scene. Beat by beat writes one brief a scene.

import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import type { ContextPreview, ID } from '@shared/types'
import { getSettings } from '../settings'
import * as world from '../world'
import { memoryModel } from '../keeper'
import { DEFAULT_MEMORY_CONTEXT } from '../keeper/model'
import { estimateTokens } from '../keeper/text'
import { pausedNote } from '../usage/gate'
import { toldStage, type ContextInput, type PreparedContext } from '../ai/context'
import { memoryScale } from '../ai/memoryRoom'
import { shortPlace } from '../ai/mustStay'
import { briefSize, briefWanted, hasEarlierBooks, type ContinuityBrief } from '../ai/brief'
import { SO_FAR_BLOCK } from '../beats/instructions'
import { openRuleFindings, sceneTexts } from '../db/checks'
import { storedSnapshots } from '../db/snapshots'
import { loadShape } from '../memory/scene'
import { buildLine, labeler, storyOfScene } from '../memory/line'
import { makePlan, planMaterial, planMessages, PLAN_REPLY_TOKENS, type MadePlan, type PlanMaterial } from './plan'
import {
  BOOK_MOST,
  BOOK_READER,
  BOOK_SHARE,
  BRIEF_REPLY_SHARE,
  WHOLE_SHARE,
  bookPart,
  bookWithin,
  briefFrees,
  briefMaterial,
  briefRoom,
  planThreads,
  type BookScene,
  type BriefMaterial,
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
 * Beat by beat's briefs (fix 14's review): one a scene, written with its first beat's plan and given to its later beats
 * while the scene card and the record it was made from read the same (`key`, briefKey), so the book so far isn't read
 * again for every beat. In memory only, for the scenes planned most recently.
 */
const sceneBriefs = new Map<ID, { key: string; brief: ContinuityBrief }>()
const MOST_SCENE_BRIEFS = 20

/** What a scene's brief was made from: its card, and the record and book the planner read (not the passages, by step). */
export function briefKey(input: Pick<ContextInput, 'scene'>, m: BriefMaterial): string {
  const book = m.book ? [m.book.length, m.book[m.book.length - 1].label, m.bookFrom ?? null] : null
  return createHash('sha1')
    .update(JSON.stringify([input.scene.card, m.record, book]))
    .digest('hex')
}

/** Forgets every kept brief (tests). */
export function forgetSceneBriefs(): void {
  sceneBriefs.clear()
}

/**
 * The plan for a draft about to be written from this briefing, made with the memory model (and its Thinking, Off unless
 * Adam changed it); null when planning is off, the memory model isn't set up or is paused (the month's spending limit),
 * or the plan failed, was stopped or took too long. Never throws. `focus`: for Beat by beat, the one beat to plan. With
 * "Write a continuity brief before each scene" on (fix 14), the same call also writes the brief; a later beat of a scene
 * gets the brief its first beat's plan wrote, while its card and record read the same, and its plan reads no more than
 * it always did.
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
    const briefed = briefWanted(getSettings())
      ? safely(() => withBrief(db, sceneId, b, plain, model.choice.contextLength ?? DEFAULT_MEMORY_CONTEXT), plain)
      : plain
    const key = focus && briefed.brief ? briefKey(b.input, briefed.brief) : null
    const kept = key ? sceneBriefs.get(sceneId) : undefined
    const reuse = kept && kept.key === key ? kept.brief : null
    const plan = await makePlan({
      db,
      model,
      sceneId,
      material: reuse ? plain : briefed,
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
    if (reuse) return { ...(plan ?? { needs: [], text: '', must: [], checked: { corrected: 0, dropped: 0 } }), brief: reuse }
    if (key && plan?.brief) {
      sceneBriefs.delete(sceneId)
      sceneBriefs.set(sceneId, { key, brief: plan.brief })
      for (const old of [...sceneBriefs.keys()].slice(0, Math.max(0, sceneBriefs.size - MOST_SCENE_BRIEFS))) sceneBriefs.delete(old)
    }
    return plan
  } catch (e) {
    console.warn('Could not plan the scene; writing without a plan', e)
    return null
  }
}

/**
 * The plan's material with what the continuity brief needs (fix 14): the open plot threads as the memory model's room
 * allows (planThreads) in place of the writer's list, the story record fitted to the room the memory model has, and as
 * much of the book so far as goes in (at most BOOK_MOST tokens, whole chapters, the oldest left out first: bookWithin).
 * Whatever can't be read is left out; with no room for the plan and a brief together (a small memory model), no brief.
 * The brief is asked to be about as long as what goes short beside it frees, between 1,000 tokens and what the writer's
 * room allows, and held to what goes short without who knows what should it say nothing of who knows what.
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
  const scale = memoryScale(b.input.contextLength)
  const frees = briefFrees(b.preview, b.prepared.blocks, { earlierBooks: hasEarlierBooks(b.input.memory) })
  const tokens = briefSize(scale, frees.always + frees.knows)
  const tokensNoKnows = briefSize(scale, frees.always)
  const reply = PLAN_REPLY_TOKENS + Math.ceil(tokens * BRIEF_REPLY_SHARE)
  const own: PlanMaterial = { ...material, threads: planThreads(b.input, contextLength) }
  const empty = { book: null, record: [], late: [], words: 0, tokens }
  const base = estimateTokens(
    planMessages({ ...own, brief: empty })
      .map((m) => m.content)
      .join('\n')
  )
  // No room for the plan and a brief: the plan as it was, with no brief.
  if (base + reply > contextLength * WHOLE_SHARE) return material
  let book: { scenes: BookScene[]; from: string | null } | null = null
  if (contextLength >= BOOK_READER) {
    const scenes = safely(() => bookScenes(db, sceneId, b.input.story.title), null)
    book = scenes ? bookWithin(scenes, Math.min(BOOK_MOST, Math.floor(contextLength * BOOK_SHARE))) : null
  }
  const size = book ? estimateTokens(bookPart(book.scenes, true, book.from)) : null
  const room = briefRoom({ contextLength, base, reply, book: size })
  if (!room.book) book = null
  const sources: BriefSources = {
    book: book?.scenes ?? null,
    bookFrom: book?.from ?? null,
    chapters: safely(() => chapterRecords(db, sceneId, b.input.story.title), []),
    findings: safely(() => openRuleFindings(db, sceneId), []),
    room: room.record,
    tokens,
    tokensNoKnows
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

/** This story's scenes before this one on its line, in reading order, with where each is and its words (none left out). */
function bookScenes(db: DB, sceneId: ID, storyTitle: string): BookScene[] | null {
  const shape = loadShape(db)
  const story = storyOfScene(shape, sceneId)
  if (!story) return null
  const label = labeler(shape)
  const titles = new Map(story.chapters.flatMap((c) => c.scenes.map((s) => [s.id, s.title] as const)))
  const steps = buildLine(shape, { storyId: story.id, before: sceneId }).steps.flatMap((s) =>
    s.type === 'scene' && s.via === 'line' && s.storyId === story.id ? [s] : []
  )
  const texts = sceneTexts(
    db,
    steps.map((s) => s.sceneId)
  )
  const out = steps.flatMap((s) => {
    const text = (texts.get(s.sceneId) ?? '').trim()
    if (!text) return []
    return [
      {
        label: shortPlace(label({ storyId: story.id, sceneId: s.sceneId }), storyTitle),
        title: titles.get(s.sceneId) ?? '',
        text,
        chapter: shortPlace(label({ storyId: story.id, chapterId: s.chapterId }), storyTitle)
      }
    ]
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
