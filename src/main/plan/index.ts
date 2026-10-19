// Plan before writing, on the open world (plan.ts does the work): whether to plan at all, with which model, from which
// briefing, with what the story index gives at no cost (core.ts) and the look-ups it may make (ai/lookups/). ai/draftFlow.ts
// asks for a plan before Generate, Add below, each set of Variants (one plan the set shares), each scene of Write the
// whole chapter, and Beat by beat (one plan for the scene, its beats its structure, kept for its later beats). Continue
// makes no call: it is given the scene's last plan while its words haven't moved on too far (planForContinueOf). With a
// continuity brief (long story memory fix 14, brief.ts), what the plan reads besides comes from the world here: as much
// of the book so far as goes in, how each earlier chapter ended, and the rule checks' findings still open in the scene.

import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import type { ContextPreview, ID, SceneCard } from '@shared/types'
import { AUTO_LENGTH } from '@shared/defaults'
import { getSettings } from '../settings'
import * as world from '../world'
import { memoryModel } from '../keeper'
import { contentNoteFor, DEFAULT_MEMORY_CONTEXT } from '../keeper/model'
import { estimateTokens } from '../keeper/text'
import { pausedNote } from '../usage/gate'
import { toldStage, type ContextInput, type PreparedContext } from '../ai/context'
import { memoryScale } from '../ai/memoryRoom'
import { shortPlace } from '../ai/mustStay'
import { briefSize, briefWanted, hasEarlierBooks, type ContinuityBrief } from '../ai/brief'
import type { LookupContext } from '../ai/lookups'
import { SO_FAR_BLOCK } from '../beats/instructions'
import { openRuleFindings, sceneTexts } from '../db/checks'
import { storedSnapshots } from '../db/snapshots'
import { loadShape } from '../memory/scene'
import { buildLine, labeler, storyOfScene } from '../memory/line'
import { findInStory } from '../retrieval'
import { planCore, type PlanCore } from './core'
import {
  makePlan,
  planForContinue,
  planMaterial,
  planMessages,
  planText,
  PLAN_REPLY_TOKENS,
  type BeatAt,
  type MadePlan,
  type PlanMaterial,
  type ScenePlan
} from './plan'
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
 * Each scene's last plan (2026-10-19), in memory for the scenes planned most recently: Beat by beat's later beats are
 * written from it (one plan a scene, with its brief), and Continue is given it while its words haven't moved on too far.
 */
interface KeptPlan {
  /** What it was made from: the scene card and the author's direction (planKey). */
  key: string
  /** The scene card alone (cardKey), for Continue, which has its own "what happens next". */
  card: string
  plan: ScenePlan
  needs: ID[]
  brief: ContinuityBrief | null
  lookedUp: string
  pov: string
  /** Made for Beat by beat: the whole scene, beat by beat. */
  beats: boolean
  /** Words in the scene when it was made, and how far into the scene it reaches (words), for Continue. */
  words: number
  reach: number
}
const scenePlans = new Map<ID, KeptPlan>()
const MOST_KEPT = 20
/** Continue is given the scene's plan while its words reach no further than what the plan was for and half as much again. */
const CONTINUE_REACH = 1.5

/** What a scene's plan was made from: its card and the author's direction. */
export const planKey = (card: SceneCard, direction: string): string =>
  createHash('sha1')
    .update(JSON.stringify([cardKey(card), direction.replace(/\s+/g, ' ').trim()]))
    .digest('hex')

/** The parts of a scene card a plan rests on (not its length, its status or how it was filled in). */
export function cardKey(card: SceneCard): string {
  const c = card as SceneCard & Record<string, unknown>
  return JSON.stringify([c.povId, c.presentIds, c.locationId, c.when, c.goal, c.conflict, c.outcome, c.mood, c.notes, c.beats, c.setsUpIds, c.paysOffIds])
}

/** Forgets every kept plan (tests). */
export function forgetScenePlans(): void {
  scenePlans.clear()
}

const wordsIn = (text: string | undefined): number => (text ?? '').split(/\s+/).filter(Boolean).length

/**
 * The plan for a draft about to be written from this briefing, made with the memory model (and its Thinking, Off unless
 * Adam changed it); null when planning is off, the memory model isn't set up or is paused (the month's spending limit),
 * or the plan failed, was stopped or took too long. Never throws. With "Write a continuity brief before each scene" on
 * (fix 14), the same call also writes the brief. `beat`: Beat by beat, the beat being written: the scene is planned once,
 * as a whole, with its first beat written (or the first after a scene card or direction that changed), and its later
 * beats are given that plan with no call. `brief: false`: never a brief, whatever the setting (Write the whole chapter:
 * its chapter plan has a part for every scene, and the brief's planner reads up to 150,000 tokens of the book for each;
 * token audit, 2026-10-19). `chapter`: Write the whole chapter's part of its plan for this scene, which the scene plan
 * builds on (spec "Write the chapter, reworked", 2026-10-19).
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
  o: { brief?: boolean; beat?: BeatAt; chapter?: string } = {}
): Promise<MadePlan | null> {
  try {
    if (!planWanted() || pausedNote()) return null
    const carryingOn = b.preview.blocks.some((x) => x.id === SO_FAR_BLOCK && !x.dropped)
    const card = b.input.scene.card
    const key = planKey(card, b.input.options.direction ?? '')
    // Beat by beat: the scene's plan, while its card and direction read the same (a fresh start at beat 1 plans again).
    if (o.beat) {
      const kept = scenePlans.get(sceneId)
      if (kept && kept.beats && kept.key === key && (o.beat.index > 1 || carryingOn)) return keptFor(kept, carryingOn, o.beat)
    }
    const model = memoryModel()
    if ('error' in model) return null
    const live = (): boolean => db.open && world.maybeCurrentWorld()?.db === db
    const entries = b.preview.entries ?? []
    const hidden = new Set(entries.filter((e) => e.hidden).map((e) => e.entryId))
    // What the story index gives at no cost: everyone here as things stand, the scenes before, the open threads.
    const core: PlanCore | null = safely(() => planCore(db, b.input, sceneId, { carryingOn, hidden }), null)
    const plain: PlanMaterial = {
      ...planMaterial(b.input, b.preview, b.prepared, { core, beats: !!o.beat, ...(o.chapter?.trim() ? { chapter: o.chapter } : {}) }),
      contentNote: contentNoteFor(b.input.style.intensity)
    }
    // With a continuity brief (fix 14) when Adam wants one; a brief that can't be put together leaves the plan as it was.
    const material =
      o.brief !== false && briefWanted(getSettings())
        ? safely(() => withBrief(db, sceneId, b, plain, model.choice.contextLength ?? DEFAULT_MEMORY_CONTEXT), plain)
        : plain
    const stand = toldStage(b.input)
    const storyTitle = b.input.story.title
    // The look-ups, even when the core couldn't be read (those of the story index then say it has nothing yet).
    const storyId = core?.storyId ?? b.input.memory.storyId
    const lookups: LookupContext | undefined = storyId
      ? {
          db,
          sceneId,
          storyId,
          asItBegins: !carryingOn,
          entries: b.input.memory.entries,
          facts: b.input.memory.facts,
          relationships: b.input.memory.relationships,
          people: material.people,
          hidden,
          find: async (query, most) =>
            (await findInStory(db, sceneId, query, most, signal))?.map((p) => ({ where: shortPlace(p.where, storyTitle), text: p.text })) ?? null
        }
      : undefined
    const plan = await makePlan({
      db,
      model,
      sceneId,
      material,
      check: {
        // The stage as the writer is told it: only the people in the scene, and a time that still holds.
        stand,
        entries: b.input.memory.entries,
        inBriefing: new Set(entries.filter((e) => !e.hidden && e.blockId).map((e) => e.entryId)),
        hidden,
        ...(core ? { known: core.known } : {}),
        present: [...material.people, ...(stand?.characters ?? []).map((c) => c.name)]
      },
      carryingOn,
      ...(lookups ? { lookups } : {}),
      ...(o.beat ? { beat: o.beat } : {}),
      signal,
      closed: () => !live()
    })
    if (plan?.plan && live()) {
      const words = wordsIn(b.input.soFar)
      const asked = b.input.options.targetWords ?? AUTO_LENGTH.typical
      scenePlans.delete(sceneId)
      scenePlans.set(sceneId, {
        key,
        card: cardKey(card),
        plan: plan.plan,
        needs: plan.needs,
        brief: plan.brief ?? null,
        lookedUp: plan.lookedUp ?? '',
        pov: material.pov ?? '',
        beats: !!o.beat,
        words,
        reach: words + Math.round(asked * (o.beat ? o.beat.of : 1) * CONTINUE_REACH)
      })
      for (const old of [...scenePlans.keys()].slice(0, Math.max(0, scenePlans.size - MOST_KEPT))) scenePlans.delete(old)
    }
    return plan
  } catch (e) {
    console.warn('Could not plan the scene; writing without a plan', e)
    return null
  }
}

/** A later beat's plan: the scene's, with its notes written for this beat. */
function keptFor(k: KeptPlan, carryingOn: boolean, beat: BeatAt): MadePlan {
  return {
    needs: k.needs,
    text: planText(k.plan, carryingOn, { ...(k.pov ? { pov: k.pov } : {}), beat }),
    // A beat's contract is the card's beat itself: the scene's plan says nothing it must change.
    must: [],
    checked: k.plan.checked,
    ...(k.brief ? { brief: k.brief } : {}),
    plan: k.plan,
    ...(k.lookedUp ? { lookedUp: k.lookedUp } : {})
  }
}

/**
 * The scene's last plan as Continue is given it (no call; plan.ts planForContinue), or '' when there is none to give:
 * planning is off, the scene has no plan kept, its card has changed since, or the words before the cursor are before
 * where the plan began or have moved on past what it was for (half as much again as the words it planned).
 */
export function planForContinueOf(sceneId: ID, card: SceneCard, wordsBefore: number): string {
  if (!planWanted()) return ''
  const k = scenePlans.get(sceneId)
  if (!k || k.card !== cardKey(card) || wordsBefore < k.words || wordsBefore > k.reach) return ''
  return planForContinue(k.plan, k.pov)
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
    console.warn('Could not read part of the story for the plan', e)
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
