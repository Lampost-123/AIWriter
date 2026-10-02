// Starting the outline helper's and next scene ideas' AI calls: what the model is told (context.ts and
// brief.ts), fitted to the chat and brainstorm model, then run by the task runner (ai/tasks.ts) as
// 'outline' and 'ideas' records, so they stream, can be stopped and show in "What the AI saw". No
// Electron imports: the caller passes the database, the model and `emit`.

import type Database from 'better-sqlite3'
import type { OutlineRequest, OutlineSize, SceneIdeasRequest } from '@shared/contracts/outline'
import type { ChatMessage, ContextBlock, ID } from '@shared/types'
import { sceneTail, storySoFarText, withThinkingShare } from '../ai/context'
import { MODEL_NAMES, type JobModel } from '../ai/jobModel'
import { DEFAULT_TASK_CONTEXT, startTask, type Emit } from '../ai/tasks'
import * as repo from '../db/repo'
import { UserError } from '../util'
import {
  aroundText,
  castText,
  earlierText,
  fitBlocks,
  placeText,
  planText,
  storyText,
  threadsText,
  type BlockDraft,
  type CastLine,
  type FittedBriefing,
  type ThreadLine
} from './brief'
import { ideasFacts, outlineFacts } from './context'
import { cleanSize, ideasAsk, ideasSystem, outlineAsk, outlineSystem } from './prompts'

type DB = Database.Database

export interface JobDeps {
  db: DB
  model: JobModel
  emit: Emit
  /** The provider turned the key down. */
  onKeyRejected?: () => void
}

export const OUTLINE_TEMPERATURE = 0.8
/** Ideas should differ from one another, so a little more adventurous. */
export const IDEAS_TEMPERATURE = 0.95
/** Room for three ideas, with some to spare. */
export const IDEAS_REPLY = 900

/** Room for an outline's reply: about 50 tokens for each act and chapter heading and 95 for each scene card. */
export const outlineReplyTokens = (size: OutlineSize): number =>
  Math.min(12_000, 300 + (size.acts + size.chapters) * 50 + size.chapters * size.scenes * 95)

/** Tokens the briefing may use: the model's window less the reply's room (and its thinking's) and 5% spare. */
export function briefingBudget(model: Pick<JobModel, 'choice' | 'thinking'>, reply: number): number {
  const length = model.choice.contextLength && model.choice.contextLength > 0 ? model.choice.contextLength : DEFAULT_TASK_CONTEXT
  const most = model.choice.maxOutput && model.choice.maxOutput > 0 ? Math.min(reply, model.choice.maxOutput) : reply
  return length - withThinkingShare(most, model.thinking) - Math.ceil(length * 0.05)
}

/** Each memory entry the briefing sent, with the version sent, for "What the AI saw". */
function sentEntries(blocks: ContextBlock[], lines: (CastLine | ThreadLine)[]): { entryId: ID; version: string }[] {
  const versions = new Map(lines.map((l) => [l.id, l.version]))
  const ids = new Set(blocks.filter((b) => !b.dropped).flatMap((b) => b.entryIds))
  return [...ids].flatMap((entryId) => (versions.has(entryId) ? [{ entryId, version: versions.get(entryId)! }] : []))
}

const messagesOf = (system: string, fitted: FittedBriefing): ChatMessage[] => [
  { role: 'system', content: system },
  { role: 'user', content: fitted.text }
]

const castForms = (cast: CastLine[]): string[] => [castText(cast, 40), castText(cast, 15), castText(cast, 30, true)]

/**
 * Asks for an outline. Throws (plain words) only before it starts: no model, more than the model can
 * answer in one go, or a story too big for it to read.
 */
export function startOutlineJob(deps: JobDeps, input: OutlineRequest): { generationId: ID } {
  const size = cleanSize(input.size)
  const reply = outlineReplyTokens(size)
  // An answer the model can't write in full would stop part way every time: better to say so first.
  const most = deps.model.choice.maxOutput
  if (most && most > 0 && reply > most) {
    throw new UserError(
      `That is more than the ${MODEL_NAMES.chat} can answer in one go. Ask for fewer chapters or fewer scenes in each, or pick a model that writes longer answers in Settings › Models.`,
      'reply-too-long'
    )
  }
  const premise = (input.premise ?? '').slice(0, 6000)
  const facts = outlineFacts(deps.db, input.storyId, premise)
  const system = outlineSystem(size.acts > 0)
  const drafts: BlockDraft[] = [
    { id: 'story', title: 'The story', priority: 1, forms: [storyText(facts.story)] },
    { id: 'earlier', title: 'Earlier stories', priority: 4, forms: [earlierText(facts.earlier), earlierText(facts.earlier, 2)] },
    { id: 'plan', title: 'What the story has so far', priority: 2, forms: [0, 1, 2, 3].map((level) => planText(facts.plan, level)) },
    {
      id: 'threads',
      title: 'Open plot threads',
      priority: 3,
      forms: [threadsText(facts.threads), threadsText(facts.threads, true)],
      entryIds: facts.threads.map((t) => t.id)
    },
    { id: 'cast', title: 'Characters and places', priority: 5, forms: castForms(facts.cast), entryIds: facts.cast.map((c) => c.id) },
    {
      id: 'ask',
      title: 'What to suggest',
      priority: 0,
      forms: [outlineAsk(size, { lastAct: facts.lastAct, chapters: facts.chapterCount })]
    }
  ]
  let fitted: FittedBriefing
  try {
    fitted = fitBlocks(drafts, system, briefingBudget(deps.model, reply), MODEL_NAMES.chat)
  } catch (e) {
    if (e instanceof UserError && e.code === 'briefing-too-long') {
      throw new UserError(
        `That is more than the ${MODEL_NAMES.chat} can plan at once. Ask for fewer chapters or scenes, or pick a model that can read more in Settings › Models.`,
        'briefing-too-long'
      )
    }
    throw e
  }
  return startTask({
    db: deps.db,
    taskId: input.taskId,
    job: 'outline',
    sceneId: '',
    model: deps.model,
    messages: messagesOf(system, fitted),
    reply,
    temperature: OUTLINE_TEMPERATURE,
    blocks: fitted.blocks,
    entries: sentEntries(fitted.blocks, [...facts.cast, ...facts.threads]),
    emit: deps.emit,
    onKeyRejected: deps.onKeyRejected
  })
}

/** Asks for three directions for a scene. Throws (plain words) only before it starts. */
export function startIdeasJob(deps: JobDeps, input: SceneIdeasRequest): { generationId: ID } {
  const facts = ideasFacts(deps.db, input.sceneId)
  const system = ideasSystem()
  const m = facts.memory
  const prev = m.previous
  const tail = (o: { min: number; target: number; max: number }): string => {
    if (!prev?.text.trim()) return ''
    const from = prev.storyId !== m.storyId ? `(The end of ${prev.storyTitle || 'the story before'}.)\n` : ''
    return `${from}${sceneTail(prev.text, o)}`
  }
  const scene = repo.getSceneMeta(deps.db, input.sceneId)
  const label = /^(scene\s*\d*|untitled scene)?$/i.test(scene.title.trim()) ? 'this scene' : `the scene “${scene.title.trim()}”`
  const drafts: BlockDraft[] = [
    { id: 'story', title: 'The story', priority: 1, forms: [storyText(facts.story)] },
    { id: 'place', title: 'Where this scene is', priority: 1, forms: [placeText(facts.plan, input.sceneId, facts.storyTitle)] },
    { id: 'card', title: 'Already on its scene card', priority: 1, forms: [facts.card] },
    {
      id: 'around',
      title: 'The outline around it',
      priority: 2,
      forms: [0, 1, 2].map((level) => aroundText(facts.plan, input.sceneId, level))
    },
    {
      id: 'previous',
      title: 'How the scene before ends',
      priority: 3,
      forms: [tail({ min: 250, target: 300, max: 400 }), tail({ min: 90, target: 120, max: 160 })]
    },
    {
      id: 'story-so-far',
      title: 'The story so far',
      priority: 4,
      forms: [1, 2, 3, 4].map((level) => storySoFarText(m.storySoFar, facts.storyTitle, level))
    },
    {
      id: 'threads',
      title: 'Open plot threads',
      priority: 3,
      forms: [threadsText(facts.threads), threadsText(facts.threads, true)],
      entryIds: facts.threads.map((t) => t.id)
    },
    { id: 'cast', title: 'Characters and places', priority: 5, forms: castForms(facts.cast), entryIds: facts.cast.map((c) => c.id) },
    { id: 'ask', title: 'What to suggest', priority: 0, forms: [ideasAsk(label)] }
  ]
  const fitted = fitBlocks(drafts, system, briefingBudget(deps.model, IDEAS_REPLY), MODEL_NAMES.chat)
  return startTask({
    db: deps.db,
    taskId: input.taskId,
    job: 'ideas',
    sceneId: input.sceneId,
    model: deps.model,
    messages: messagesOf(system, fitted),
    reply: IDEAS_REPLY,
    temperature: IDEAS_TEMPERATURE,
    blocks: fitted.blocks,
    entries: sentEntries(fitted.blocks, [...facts.cast, ...facts.threads]),
    emit: deps.emit,
    onKeyRejected: deps.onKeyRejected
  })
}
