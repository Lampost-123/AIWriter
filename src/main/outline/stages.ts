// The outline in stages (2026-10-19, after "A full novel" came as up to 96 scene cards in one reply and was often cut
// off): the outline helper asks a level at a time. First the acts (each with its purpose and about how many chapters);
// then, when Adam asks, one act's chapters; then one chapter's scenes, as many as it needs; or one scene's card ("Plan
// this scene", wherever a scene has nothing on its card). Each is told the story, what it has so far (the kept parts
// around the place being planned), the outline being planned (sent by the window, Adam's changes in), open plot threads
// and the cast, cut to fit, and each reply is small, so it comes quickly and whole. Run by the task runner as 'outline'
// records, so they stream, stop and show in "What the AI saw". No Electron imports.

import type { OutlineStageRequest } from '@shared/contracts/outline'
import type { ChatMessage, ContextBlock, ID } from '@shared/types'
import { sceneTail, storySoFarText } from '../ai/context'
import { MODEL_NAMES } from '../ai/jobModel'
import { startTask } from '../ai/tasks'
import * as repo from '../db/repo'
import { UserError } from '../util'
import {
  aroundText,
  castText,
  chapterAroundText,
  earlierText,
  placeText,
  planText,
  storyText,
  threadsText,
  type BlockDraft,
  type CastLine,
  type FittedBriefing,
  type ThreadLine
} from './briefing'
import { ideasFacts, outlineFacts } from './context'
import { checkReplyRoom, fitBriefing, OUTLINE_TEMPERATURE, type JobDeps } from './jobs'
import { STAGE_LIMITS, stageAsk, stageStart, stageSystem, type StageLevel } from './prompts'

const LEVELS: StageLevel[] = ['acts', 'chapters', 'scenes', 'scene']

/** Room for a stage's reply: about 110 tokens an act, 170 a chapter with its card, 170 a scene card. */
export function stageReplyTokens(level: StageLevel, count: number): number {
  if (level === 'acts') return 250 + Math.max(1, count) * 110
  if (level === 'chapters') return 250 + Math.max(1, count) * 170
  if (level === 'scenes') return 300 + STAGE_LIMITS.scenes * 170
  return 700
}

/** What a caller adds: the Story builder's idea, style and recipe first, its rules, and a premise for a story with none. */
export interface StageExtra {
  lead?: BlockDraft[]
  more?: BlockDraft[]
  rules?: string[]
  withPremise?: boolean
  /** Characters, places and plot threads: how many to list at most (the Story builder lists more). */
  castLimit?: number
}

const clip = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')
const count = (v: unknown, lo: number, hi: number): number | null => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : null
}

/** The outline being planned with only its headings and their one-line purposes and goals: its shortest form. */
export function headingsOnly(plan: string): string {
  return plan
    .split(/\r?\n/)
    .filter((l) => /^\s*#{1,3}\s/.test(l) || /^\s*(purpose|goal|chapters)\s*:/i.test(l))
    .join('\n')
}

/** The title on the first heading of an outline part ("## Chapter: Rain (plan this one)" gives "Rain"). */
export function headingTitle(text: string): string {
  const line = text.split(/\r?\n/).find((l) => /^\s*#{1,3}\s/.test(l)) ?? ''
  return line
    .replace(/^\s*#{1,3}\s*(?:act|chapter|scene)?\s*:?\s*/i, '')
    .replace(/\s*\((?:in the story|plan this one)\)/gi, '')
    .replace(/\s*\[#[acs0-9]+\]/gi, '')
    .trim()
}

const castForms = (cast: CastLine[], most: number): string[] => [castText(cast, most), castText(cast, Math.ceil(most / 2)), castText(cast, most, true)]

function sentEntries(blocks: ContextBlock[], lines: (CastLine | ThreadLine)[]): { entryId: ID; version: string }[] {
  const versions = new Map(lines.map((l) => [l.id, l.version]))
  const ids = new Set(blocks.filter((b) => !b.dropped).flatMap((b) => b.entryIds))
  return [...ids].flatMap((entryId) => (versions.has(entryId) ? [{ entryId, version: versions.get(entryId)! }] : []))
}

const messagesOf = (system: string, fitted: FittedBriefing): ChatMessage[] => [
  { role: 'system', content: system },
  { role: 'user', content: fitted.text }
]

/** What "What the AI saw" says was asked. */
function directionOf(level: StageLevel, title: string): string {
  if (level === 'acts') return 'Outline in stages: suggest the acts'
  if (level === 'chapters') return title ? `Outline in stages: plan the chapters of “${title}”` : 'Outline in stages: suggest the chapters'
  if (level === 'scenes') return `Outline in stages: plan the scenes of “${title || 'the chapter'}”`
  return title ? `Plan the scene “${title}”` : 'Plan this scene'
}

/**
 * Asks for one stage of the outline (see OutlineStageRequest). Throws (plain words) only before it starts: no model, a
 * reply longer than the model can write, or more than it can read.
 */
export function startStageJob(deps: JobDeps, input: OutlineStageRequest, extra: StageExtra = {}): { generationId: ID } {
  const level = LEVELS.includes(input?.level as StageLevel) ? (input.level as StageLevel) : null
  if (!level) throw new UserError('That part of the outline can’t be planned. Please try again.')
  const storyId = String(input?.storyId ?? '')
  if (level === 'scene') return startSceneStage(deps, { ...input, storyId }, extra)

  const premise = typeof input.premise === 'string' ? input.premise.slice(0, 6000) : undefined
  const facts = outlineFacts(deps.db, storyId, premise)
  const plan = clip(input.plan, 60_000).trim()
  const target = clip(input.target, 20_000).trim()
  const acts = count(input.acts, 0, STAGE_LIMITS.acts) ?? 3
  // A chapter in the story already: it is read from the story (its scenes so far, with the chapters either side).
  const keptChapter = level === 'scenes' && input.chapterId ? facts.plan.flatMap((a) => a.chapters).find((c) => c.id === input.chapterId) : undefined
  const keptAct = level === 'chapters' && input.actId ? facts.plan.find((a) => a.id === input.actId) : undefined
  const title = headingTitle(target) || keptChapter?.title || keptAct?.title || ''

  let n: number
  let ask: string
  if (level === 'acts') {
    n = Math.max(1, acts)
    const chapters = count(input.chapters, n, STAGE_LIMITS.chapters) ?? n * 4
    ask = stageAsk('acts', { acts: n, chapters, start: stageStart({ chapters: facts.chapterCount, lastAct: facts.lastAct, newActs: true }) })
  } else if (level === 'chapters') {
    const inAct = !!target || !!keptAct
    n = count(input.chapters, 1, inAct ? STAGE_LIMITS.actChapters : STAGE_LIMITS.chapters) ?? 3
    ask = inAct
      ? stageAsk('chapters', { chapters: n, title, kept: !!keptAct, latestWhen: facts.latestWhen })
      : stageAsk('chapters', { chapters: n, start: stageStart({ chapters: facts.chapterCount, lastAct: facts.lastAct, newActs: false }), latestWhen: facts.latestWhen })
  } else {
    n = STAGE_LIMITS.scenes
    ask = stageAsk('scenes', { title, kept: !!keptChapter, latestWhen: facts.latestWhen })
  }
  const reply = stageReplyTokens(level, n)
  checkReplyRoom(deps.model, reply, 'That is', 'Pick a model that writes longer answers in Settings › Models.')
  const system = stageSystem(level, { withActs: level !== 'chapters' || !!target || !!keptAct, extra: extra.rules, withPremise: extra.withPremise })
  const most = extra.castLimit ?? 40
  const drafts: BlockDraft[] = [
    ...(extra.lead ?? []),
    { id: 'story', title: 'The story', priority: 1, forms: [storyText(facts.story)] },
    { id: 'earlier', title: 'Earlier stories', priority: 4, forms: [earlierText(facts.earlier), earlierText(facts.earlier, 2)] },
    { id: 'plan', title: 'What the story has so far', priority: 3, forms: [0, 1, 2, 3].map((l) => planText(facts.plan, l)) },
    ...(keptChapter
      ? [
          {
            id: 'chapter',
            title: 'The chapter to plan, as the story has it',
            priority: 1,
            forms: [0, 1, 2].map((l) => chapterAroundText(facts.plan, keptChapter.id, facts.story.title, l))
          }
        ]
      : []),
    {
      id: 'outline',
      title: 'The outline being planned (parts marked "(in the story)" are kept already)',
      priority: 2,
      forms: [plan, headingsOnly(plan)]
    },
    { id: 'target', title: level === 'chapters' ? 'The act to plan' : 'The chapter to plan', priority: 1, forms: [target] },
    {
      id: 'threads',
      title: 'Open plot threads',
      priority: 3,
      forms: [threadsText(facts.threads), threadsText(facts.threads, true)],
      entryIds: facts.threads.map((t) => t.id)
    },
    { id: 'cast', title: 'Characters and places', priority: 5, forms: castForms(facts.cast, most), entryIds: facts.cast.map((c) => c.id) },
    ...(extra.more ?? []),
    { id: 'ask', title: 'What to suggest', priority: 0, forms: [ask] }
  ]
  const fitted = fitBriefing(
    drafts,
    system,
    deps.model,
    reply,
    `The story and its outline are more than the ${MODEL_NAMES.chat} can read at once. Pick a model that can read more in Settings › Models.`
  )
  return startTask({
    db: deps.db,
    taskId: input.taskId,
    job: 'outline',
    sceneId: '',
    model: deps.model,
    messages: messagesOf(system, fitted),
    reply,
    temperature: OUTLINE_TEMPERATURE,
    direction: directionOf(level, title),
    blocks: fitted.blocks,
    entries: sentEntries(fitted.blocks, [...facts.cast, ...facts.threads]),
    emit: deps.emit,
    onKeyRejected: deps.onKeyRejected
  })
}

/** One scene's card, from where it sits: its place in the outline, its card as it is and the scene before it. */
function startSceneStage(deps: JobDeps, input: OutlineStageRequest, extra: StageExtra): { generationId: ID } {
  const sceneId = String(input.sceneId ?? '')
  if (!sceneId) throw new UserError('That scene isn’t there any more.')
  const facts = ideasFacts(deps.db, sceneId)
  const m = facts.memory
  const prev = m.previous
  const tail = (o: { min: number; target: number; max: number }): string => {
    if (!prev?.text.trim()) return ''
    const from = prev.storyId !== m.storyId ? `(The end of ${prev.storyTitle || 'the story before'}.)\n` : ''
    return `${from}${sceneTail(prev.text, o)}`
  }
  const scene = repo.getSceneMeta(deps.db, sceneId)
  const own = /^(scene\s*\d*|untitled scene)?$/i.test(scene.title.trim()) ? '' : scene.title.trim()
  const reply = stageReplyTokens('scene', 1)
  checkReplyRoom(deps.model, reply, 'A scene’s card is', 'Pick a model that writes longer answers in Settings › Models.')
  const system = stageSystem('scene', { extra: extra.rules })
  const most = extra.castLimit ?? 40
  const drafts: BlockDraft[] = [
    ...(extra.lead ?? []),
    { id: 'story', title: 'The story', priority: 1, forms: [storyText(facts.story)] },
    { id: 'place', title: 'Where this scene is', priority: 1, forms: [placeText(facts.plan, sceneId, facts.storyTitle)] },
    { id: 'card', title: 'Already on its scene card', priority: 1, forms: [facts.card || '(Nothing yet.)'] },
    { id: 'around', title: 'The outline around it', priority: 2, forms: [0, 1, 2].map((l) => aroundText(facts.plan, sceneId, l)) },
    { id: 'previous', title: 'How the scene before ends', priority: 3, forms: [tail({ min: 250, target: 300, max: 400 }), tail({ min: 90, target: 120, max: 160 })] },
    { id: 'story-so-far', title: 'The story so far', priority: 4, forms: [1, 2, 3, 4].map((l) => storySoFarText(m.storySoFar, facts.storyTitle, l)) },
    {
      id: 'threads',
      title: 'Open plot threads',
      priority: 3,
      forms: [threadsText(facts.threads), threadsText(facts.threads, true)],
      entryIds: facts.threads.map((t) => t.id)
    },
    { id: 'cast', title: 'Characters and places', priority: 5, forms: castForms(facts.cast, most), entryIds: facts.cast.map((c) => c.id) },
    ...(extra.more ?? []),
    { id: 'ask', title: 'What to suggest', priority: 0, forms: [stageAsk('scene', { sceneLabel: own ? `the scene “${own}”` : 'this scene' })] }
  ]
  const fitted = fitBriefing(
    drafts,
    system,
    deps.model,
    reply,
    `This scene and the story around it are more than the ${MODEL_NAMES.chat} can read at once. Pick a model that can read more in Settings › Models.`
  )
  return startTask({
    db: deps.db,
    taskId: input.taskId,
    job: 'outline',
    sceneId,
    model: deps.model,
    messages: messagesOf(system, fitted),
    reply,
    temperature: OUTLINE_TEMPERATURE,
    direction: directionOf('scene', own),
    blocks: fitted.blocks,
    entries: sentEntries(fitted.blocks, [...facts.cast, ...facts.threads]),
    emit: deps.emit,
    onKeyRejected: deps.onKeyRejected
  })
}
