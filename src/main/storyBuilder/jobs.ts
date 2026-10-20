// The Story builder's AI calls (contracts/storyBuilder.ts), all with the chat and brainstorm model and run by the task
// runner, so they can be stopped and show in "What the AI saw". The codex list, its talk and its redo, the recipe's
// talk and redo wait for their whole answer; the outline and a plan's talk and redo stream as task events with job
// 'outline' (the window reads them as the outline helper's suggestions). Building the codex is the World builder's
// (ipc/storyBuilder.ts). No Electron imports: the caller passes the database, the model and `emit`.

import type {
  ChatTurn,
  CodexChatReply,
  CodexChatRequest,
  CodexPlan,
  CodexRedoReply,
  CodexRedoRequest,
  PlanChatRequest,
  PlanRedoRequest,
  RecipeChatReply,
  RecipeChatRequest,
  RecipePartRedoReply,
  RecipePartRedoRequest,
  StoryBrief,
  StoryOutlineRequest
} from '@shared/contracts/storyBuilder'
import type { OutlineStageRequest } from '@shared/contracts/outline'
import type { RecipeParts } from '@shared/contracts/recipes'
import { RECIPE_PARTS } from '@shared/contracts/recipes'
import type { ChatMessage, ID, Story, WritingPrefs } from '@shared/types'
import type { TaskDone } from '@shared/contracts/tasks'
import { MODEL_NAMES } from '../ai/jobModel'
import { runTask, startTask } from '../ai/tasks'
import * as repo from '../db/repo'
import { entryNames } from '../db/worldBuilder'
import { estimateTokens } from '../keeper/text'
import { UserError } from '../util'
import { castText, earlierText, planText, storyText, threadsText, type BlockDraft, type FittedBriefing } from '../outline/briefing'
import { outlineFacts, type OutlineFacts } from '../outline/context'
import { briefingBudget, checkReplyRoom, fitBriefing, outlineReplyTokens, OUTLINE_REPLY_MOST, OUTLINE_TEMPERATURE, type JobDeps } from '../outline/jobs'
import { cleanSize, DIRECTION_RULE, DIRECTION_TITLE, outlineAsk } from '../outline/prompts'
import { startStageJob } from '../outline/stages'
import { existingText } from '../worldBuilder/prompts'
import { parseRecipe } from '../recipes/parse'
import { briefText, recipeAsUsed, recipeBlock, styleText } from './brief'
import { carryOver, codexJson, itemJson, readCodex, readRedo, settleList } from './codex'
import { cleanCodex } from './brief'
import {
  codexAsk,
  codexChatSystem,
  codexRedoSystem,
  codexSystem,
  LIST_LINE,
  PARTS_LINE,
  partsText,
  planChatSystem,
  planRedoSystem,
  recipeChatSystem,
  recipeRedoSystem,
  splitAnswer,
  storyStageRules,
  storyOutlineSystem
} from './prompts'

export interface StoryDeps extends JobDeps {
  prefs?: WritingPrefs | null
  /** The recipe a story follows, by id, as the library has it (null when it is gone or not finished). */
  readRecipe?: (id: ID) => { name: string; parts: RecipeParts } | null
}

const WENT_WRONG = 'Something went wrong. Please try again.'
const CODEX_REPLY = 9000
const CHAT_TEMPERATURE = 0.7
const REDO_TEMPERATURE = 0.9
const MOST_TURNS = 12

const clip = (s: unknown, max: number): string => (typeof s === 'string' ? s.slice(0, max) : '')

/** The earlier turns of a talk, newest kept, each clipped. */
function turns(history: unknown): ChatMessage[] {
  const list = Array.isArray(history) ? (history as ChatTurn[]) : []
  return list
    .filter((t) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string' && t.text.trim())
    .slice(-MOST_TURNS)
    .map((t) => ({ role: t.role, content: t.text.slice(0, 20_000) }))
}

interface Facts {
  story: Story
  brief: StoryBrief
  recipe: { name: string; parts: RecipeParts } | null
}

function factsOf(deps: StoryDeps, storyId: ID, brief: StoryBrief): Facts {
  const story = repo.getStory(deps.db, storyId)
  const stored = brief.recipe ? (deps.readRecipe?.(brief.recipe.id) ?? null) : null
  return { story, brief, recipe: recipeAsUsed(stored, brief) }
}

/** The idea, the story's style and its recipe: the blocks every Story builder request opens with. */
function ideaBlocks(deps: StoryDeps, f: Facts): BlockDraft[] {
  const idea = briefText(f.brief, f.story)
  const forms = [idea, idea.slice(0, 48_000), idea.slice(0, 16_000), idea.slice(0, 6000)]
  const out: BlockDraft[] = [
    { id: 'idea', title: "The author's idea for the story", priority: 2, forms: [...new Set(forms)] },
    { id: 'style', title: "The story's style", priority: 1, forms: [styleText(deps.db, f.story, deps.prefs)] }
  ]
  if (f.recipe) out.push({ id: 'recipe', title: 'The recipe', priority: 3, forms: [recipeBlock(f.recipe)] })
  return out
}

/** The outline helper's blocks: the story, its plan so far, earlier stories, open plot threads, cast and events. */
function storyBlocks(deps: StoryDeps, facts: OutlineFacts, storyId: ID): BlockDraft[] {
  return [
    { id: 'story', title: 'The story', priority: 1, forms: [storyText(facts.story)] },
    { id: 'earlier', title: 'Earlier stories', priority: 5, forms: [earlierText(facts.earlier), earlierText(facts.earlier, 2)] },
    { id: 'plan', title: 'What the story has so far', priority: 2, forms: [0, 1, 2, 3].map((level) => planText(facts.plan, level)) },
    { id: 'threads', title: 'Open plot threads', priority: 3, forms: [threadsText(facts.threads), threadsText(facts.threads, true)], entryIds: facts.threads.map((t) => t.id) },
    {
      id: 'cast',
      title: 'Characters, places, groups and items',
      priority: 3,
      forms: [castText(facts.cast, 60), castText(facts.cast, 30), castText(facts.cast, 60, true)],
      entryIds: facts.cast.map((c) => c.id)
    },
    { id: 'events', title: 'Events', priority: 4, forms: [eventsText(deps, storyId, 40), eventsText(deps, storyId, 15)] }
  ]
}

/** The world's events, this story's first, each with when it happens. */
function eventsText(deps: StoryDeps, storyId: ID, most: number): string {
  const events = repo.listEntries(deps.db, 'event')
  const ours = [...events.filter((e) => e.originStoryId === storyId), ...events.filter((e) => e.originStoryId !== storyId)]
  return ours
    .slice(0, most)
    .map((e) => {
      const when = String(e.fields?.when ?? '').trim()
      const about = (e.summary || String(e.fields?.happened ?? '')).trim().replace(/\s+/g, ' ').slice(0, 240)
      return `- ${e.name}${when ? ` (${when})` : ''}${about ? `: ${about}` : ''}`
    })
    .join('\n')
}

const TOO_LONG = `That is more than the ${MODEL_NAMES.chat} can read at once. Shorten the plot, or pick a model that can read more in Settings › Models.`

function fit(deps: StoryDeps, drafts: BlockDraft[], system: string, reply: number): FittedBriefing {
  return fitBriefing(drafts, system, deps.model, reply, TOO_LONG)
}

/** Each memory entry the briefing sent, with the version sent, for "What the AI saw" (only those whose version is known). */
function sent(fitted: FittedBriefing, facts?: Pick<OutlineFacts, 'cast' | 'threads'>): { entryId: ID; version: string }[] {
  const versions = new Map([...(facts?.cast ?? []), ...(facts?.threads ?? [])].map((l) => [l.id, l.version]))
  return [...new Set(fitted.blocks.filter((b) => !b.dropped).flatMap((b) => b.entryIds))].flatMap((entryId) =>
    versions.has(entryId) ? [{ entryId, version: versions.get(entryId)! }] : []
  )
}

/** One call that waits for its whole answer. */
async function ask(
  deps: StoryDeps,
  o: { taskId: unknown; messages: ChatMessage[]; reply: number; temperature: number; direction: string; fitted?: FittedBriefing }
): Promise<TaskDone> {
  return runTask({
    db: deps.db,
    taskId: String(o.taskId ?? ''),
    job: 'outline',
    sceneId: null,
    model: deps.model,
    messages: o.messages,
    reply: Math.min(o.reply, deps.model.choice.maxOutput && deps.model.choice.maxOutput > 0 ? deps.model.choice.maxOutput : o.reply),
    temperature: o.temperature,
    direction: o.direction,
    blocks: o.fitted?.blocks,
    entries: o.fitted ? sent(o.fitted) : undefined,
    emit: deps.emit,
    onKeyRejected: deps.onKeyRejected
  }).catch((e: unknown) => {
    throw e instanceof UserError ? e : new UserError(WENT_WRONG)
  })
}

const ended = (done: TaskDone): { status: 'stopped' | 'error'; error: string | null } | null =>
  done.status === 'stopped' ? { status: 'stopped', error: null } : done.status === 'error' ? { status: 'error', error: done.error ?? WENT_WRONG } : null

// ---------- The codex ----------

export async function planStoryCodex(deps: StoryDeps, input: { taskId: ID; storyId: ID }, brief: StoryBrief): Promise<CodexPlan> {
  const f = factsOf(deps, input.storyId, brief)
  if (!brief.plot.trim() && !f.story.premise.trim() && !brief.mine.length) {
    throw new UserError('Write your plot first: a few lines on what happens is enough.', 'no-plot')
  }
  const system = codexSystem()
  const drafts: BlockDraft[] = [
    ...ideaBlocks(deps, f),
    { id: 'world', title: 'Already in the world', priority: 4, forms: [existingText(entryNames(deps.db), 2000), existingText(entryNames(deps.db), 600)] },
    { id: 'ask', title: 'What to plan', priority: 0, forms: [codexAsk()] }
  ]
  const fitted = fit(deps, drafts, system, CODEX_REPLY)
  const done = await ask(deps, {
    taskId: input.taskId,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: fitted.text }
    ],
    reply: CODEX_REPLY,
    temperature: OUTLINE_TEMPERATURE,
    direction: 'Story builder: plan the cast and world',
    fitted
  })
  const base = { generationId: done.generationId, items: [] }
  const stop = ended(done)
  if (stop) return { ...base, ...stop }
  const items = readCodex(done.text)
  if (!items) return { ...base, status: 'error', error: 'The AI’s answer didn’t come as a list, so there is nothing to show. Please try again.' }
  return { ...base, status: 'complete', error: null, items: settleList(items, brief.mine, entryNames(deps.db)) }
}

export async function storyCodexChat(deps: StoryDeps, input: CodexChatRequest, brief: StoryBrief): Promise<CodexChatReply> {
  const f = factsOf(deps, input.storyId, brief)
  const before = cleanCodex(input.items)
  const message = clip(input.message, 6000).trim()
  if (!message) throw new UserError('Say what you would like changed first.')
  const system = codexChatSystem()
  const drafts: BlockDraft[] = [
    ...ideaBlocks(deps, f),
    { id: 'world', title: 'Already in the world', priority: 4, forms: [existingText(entryNames(deps.db), 1500), existingText(entryNames(deps.db), 500)] },
    { id: 'list', title: 'The list as it stands', priority: 0, forms: [codexJson(before)] }
  ]
  const fitted = fit(deps, drafts, system, CODEX_REPLY)
  const done = await ask(deps, {
    taskId: input.taskId,
    messages: [{ role: 'system', content: system }, { role: 'user', content: fitted.text }, { role: 'assistant', content: 'I have the list. What would you like?' }, ...turns(input.history), { role: 'user', content: message }],
    reply: CODEX_REPLY,
    temperature: CHAT_TEMPERATURE,
    direction: message,
    fitted
  })
  const base = { generationId: done.generationId, answer: '', items: null }
  const stop = ended(done)
  if (stop) return { ...base, ...stop }
  const { answer, rest } = splitAnswer(done.text, LIST_LINE)
  const read = rest ? readCodex(rest) : null
  const items = read ? settleList(carryOver(read, before), brief.mine, entryNames(deps.db)) : null
  return { ...base, status: 'complete', error: null, answer: answer || (items ? 'Here is the list with those changes.' : done.text.trim()), items }
}

export async function redoCodexItem(deps: StoryDeps, input: CodexRedoRequest, brief: StoryBrief): Promise<CodexRedoReply> {
  const f = factsOf(deps, input.storyId, brief)
  const items = cleanCodex(input.items)
  const item = items.find((x) => x.key === input.key)
  if (!item) throw new UserError('That item isn’t on the list any more.')
  const note = clip(input.note, 3000).trim()
  const system = codexRedoSystem()
  const drafts: BlockDraft[] = [
    ...ideaBlocks(deps, f),
    { id: 'list', title: 'The whole list', priority: 3, forms: [codexJson(items)] },
    { id: 'ask', title: 'What to do', priority: 0, forms: [`Write this one again${note ? `, so that: ${note}` : ', as a fresh take on it'}.\n${itemJson(item)}\nReply with one JSON object.`] }
  ]
  const fitted = fit(deps, drafts, system, 1200)
  const done = await ask(deps, {
    taskId: input.taskId,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: fitted.text }
    ],
    reply: 1200,
    temperature: REDO_TEMPERATURE,
    direction: note || `Another take on ${item.name}`,
    fitted
  })
  const base = { generationId: done.generationId, item: null }
  const stop = ended(done)
  if (stop) return { ...base, ...stop }
  const next = readRedo(done.text, item)
  if (!next) return { ...base, status: 'error', error: 'The AI’s answer couldn’t be used. Please try again.' }
  return { ...base, status: 'complete', error: null, item: next }
}

// ---------- The outline ----------

/** The brief has something of Adam's in it (a plot, his own entries or a recipe): the outline is planned from it. */
export const hasIdea = (brief: StoryBrief): boolean => !!brief.plot.trim() || brief.mine.some((e) => e.name.trim()) || !!brief.recipe

/**
 * `premise`: the premise as the outline helper's box has it (in place of the story's kept one, which may not be saved
 * yet); left out, the story's.
 */
export function startStoryOutline(
  deps: StoryDeps,
  input: StoryOutlineRequest & { premise?: string; direction?: string },
  brief: StoryBrief
): { generationId: ID } {
  const size = cleanSize(input.size)
  const base = factsOf(deps, input.storyId, brief)
  const premise = typeof input.premise === 'string' ? input.premise.slice(0, 6000) : base.story.premise
  const f = { ...base, story: { ...base.story, premise } }
  const facts = outlineFacts(deps.db, input.storyId, premise)
  const withPremise = !premise.trim()
  const reply = outlineReplyTokens(size) + (withPremise ? 200 : 0)
  checkReplyRoom(deps.model, reply, 'That is', 'Ask for fewer chapters or fewer scenes in each, or pick a model that writes longer answers in Settings › Models.')
  // The Plan hub (2026-10-20): Adam's own words (or which part of a new story to plan), sent last, and they win.
  const own = typeof input.direction === 'string' ? input.direction.slice(0, 4000).trim() : ''
  const told = storyOutlineSystem({ withActs: size.acts > 0, withPremise, recipe: !!f.recipe })
  const system = own ? `${told}\n- ${DIRECTION_RULE}` : told
  const askText = `${withPremise ? 'Write the premise, then plan the story. ' : ''}${outlineAsk(size, { lastAct: facts.lastAct, chapters: facts.chapterCount, latestWhen: facts.latestWhen })}`
  const drafts: BlockDraft[] = [
    ...ideaBlocks(deps, f),
    ...storyBlocks(deps, facts, input.storyId),
    ...(own ? [{ id: 'direction', title: DIRECTION_TITLE, priority: 0, forms: [own] }] : []),
    { id: 'ask', title: 'What to plan', priority: 0, forms: [askText] }
  ]
  const fitted = fit(deps, drafts, system, reply)
  return startTask({
    db: deps.db,
    taskId: input.taskId,
    job: 'outline',
    sceneId: '',
    model: deps.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: fitted.text }
    ],
    reply,
    temperature: OUTLINE_TEMPERATURE,
    direction: own || 'Story builder: plan the outline',
    blocks: fitted.blocks,
    entries: sent(fitted, facts),
    emit: deps.emit,
    onKeyRejected: deps.onKeyRejected
  })
}

/**
 * The outline in stages (2026-10-19), planned from the idea: the outline helper's stage (outline/stages.ts) with the
 * idea, the story's style and its recipe first, the world's events after, and the Story builder's rules on what wins. The
 * first stage of a story with no premise writes one first, as the whole outline does.
 */
export function startStoryStage(deps: StoryDeps, input: OutlineStageRequest, brief: StoryBrief): { generationId: ID } {
  const base = factsOf(deps, input.storyId, brief)
  const premise = typeof input.premise === 'string' ? input.premise.slice(0, 6000) : base.story.premise
  const f = { ...base, story: { ...base.story, premise } }
  const first = input.level === 'acts' || (input.level === 'chapters' && !input.target && !input.actId)
  return startStageJob(
    deps,
    { ...input, premise },
    {
      lead: ideaBlocks(deps, f),
      more: [{ id: 'events', title: 'Events', priority: 4, forms: [eventsText(deps, input.storyId, 40), eventsText(deps, input.storyId, 15)] }],
      rules: storyStageRules(!!f.recipe),
      withPremise: first && !premise.trim(),
      castLimit: 60
    }
  )
}

/** Room for a whole plan again: about a third more than the plan as it is now. */
const planRoom = (current: string): number => Math.min(OUTLINE_REPLY_MOST, Math.max(1500, Math.ceil(estimateTokens(current) * 1.35) + 500))

export function startPlanChat(deps: StoryDeps, input: PlanChatRequest, brief: StoryBrief): { generationId: ID } {
  const f = factsOf(deps, input.storyId, brief)
  const facts = outlineFacts(deps.db, input.storyId)
  const current = clip(input.current, 120_000)
  const message = clip(input.message, 6000).trim()
  if (!message) throw new UserError('Say what you would like changed first.')
  const reply = planRoom(current)
  const system = planChatSystem()
  const looking = typeof input.looking === 'string' ? clip(input.looking.replace(/\s+/g, ' ').trim(), 200) : ''
  const drafts: BlockDraft[] = [
    ...ideaBlocks(deps, f),
    ...storyBlocks(deps, facts, input.storyId),
    { id: 'suggestions', title: 'The suggestions still waiting for a decision', priority: 0, forms: [current || '(none)'] },
    // Build with AI (2026-10-20): what the author is looking at while talking, so the answer is about that.
    ...(looking ? [{ id: 'looking-at', title: 'What the author is looking at now', priority: 0, forms: [`${looking}. Answer about that first.`] }] : [])
  ]
  const fitted = fit(deps, drafts, system, reply)
  return startTask({
    db: deps.db,
    taskId: input.taskId,
    job: 'outline',
    sceneId: '',
    model: deps.model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: fitted.text }, { role: 'assistant', content: 'I have the plan. What would you like?' }, ...turns(input.history), { role: 'user', content: message }],
    reply,
    temperature: CHAT_TEMPERATURE,
    direction: message,
    blocks: fitted.blocks,
    entries: sent(fitted, facts),
    emit: deps.emit,
    onKeyRejected: deps.onKeyRejected
  })
}

const REDO_ROOM = { scene: 700, chapter: 2600, act: 8000 }

export function startPlanRedo(deps: StoryDeps, input: PlanRedoRequest, brief: StoryBrief): { generationId: ID } {
  const kind = input.kind === 'act' || input.kind === 'chapter' ? input.kind : 'scene'
  const f = factsOf(deps, input.storyId, brief)
  const facts = outlineFacts(deps.db, input.storyId)
  const note = clip(input.note, 3000).trim()
  const target = clip(input.target, 40_000).trim()
  if (!target) throw new UserError(WENT_WRONG)
  const reply = Math.max(REDO_ROOM[kind], Math.ceil(estimateTokens(target) * 1.4))
  const system = planRedoSystem(kind)
  const drafts: BlockDraft[] = [
    ...ideaBlocks(deps, f),
    ...storyBlocks(deps, facts, input.storyId),
    { id: 'suggestions', title: 'The whole plan of suggestions', priority: 2, forms: [clip(input.current, 120_000), clip(input.current, 20_000)] },
    { id: 'ask', title: 'What to do', priority: 0, forms: [`Write this ${kind} again${note ? `, so that: ${note}` : ', as a fresh take on it'}.\n\n${target}`] }
  ]
  const fitted = fit(deps, drafts, system, reply)
  return startTask({
    db: deps.db,
    taskId: input.taskId,
    job: 'outline',
    sceneId: '',
    model: deps.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: fitted.text }
    ],
    reply,
    temperature: REDO_TEMPERATURE,
    direction: note || `Another take on this ${kind}`,
    blocks: fitted.blocks,
    entries: sent(fitted, facts),
    emit: deps.emit,
    onKeyRejected: deps.onKeyRejected
  })
}

// ---------- A recipe ----------

function cleanParts(v: unknown): RecipeParts {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  const out = {} as RecipeParts
  for (const k of RECIPE_PARTS) out[k] = clip(o[k], 12_000)
  return out
}

export async function recipeChat(deps: StoryDeps, input: RecipeChatRequest): Promise<RecipeChatReply> {
  const parts = cleanParts(input.parts)
  const message = clip(input.message, 6000).trim()
  if (!message) throw new UserError('Say what you would like changed first.')
  const system = recipeChatSystem()
  const text = `The recipe as it stands:\n\n${partsText(parts)}`
  const reply = Math.min(9000, Math.max(2000, Math.ceil(estimateTokens(text) * 1.2) + 400))
  const budget = briefingBudget(deps.model, reply)
  if (estimateTokens(system + text) > budget) throw new UserError(TOO_LONG, 'briefing-too-long')
  const done = await ask(deps, {
    taskId: input.taskId,
    messages: [{ role: 'system', content: system }, { role: 'user', content: text }, { role: 'assistant', content: 'I have the recipe. What would you like?' }, ...turns(input.history), { role: 'user', content: message }],
    reply,
    temperature: CHAT_TEMPERATURE,
    direction: message
  })
  const base = { generationId: done.generationId, answer: '', parts: null }
  const stop = ended(done)
  if (stop) return { ...base, ...stop }
  const { answer, rest } = splitAnswer(done.text, PARTS_LINE)
  const changed = rest ? parseRecipe(rest).parts : {}
  const real = Object.fromEntries(Object.entries(changed).filter(([k, v]) => v && v !== parts[k as keyof RecipeParts])) as Partial<RecipeParts>
  const has = Object.keys(real).length > 0
  return { ...base, status: 'complete', error: null, answer: answer || (has ? 'Here are those changes.' : done.text.trim()), parts: has ? real : null }
}

export async function redoRecipePart(deps: StoryDeps, input: RecipePartRedoRequest): Promise<RecipePartRedoReply> {
  const parts = cleanParts(input.parts)
  const part = RECIPE_PARTS.includes(input.part) ? input.part : null
  if (!part) throw new UserError(WENT_WRONG)
  const note = clip(input.note, 3000).trim()
  const system = recipeRedoSystem(part)
  const text = `The recipe:\n\n${partsText(parts)}\n\nWrite this part again${note ? `, so that: ${note}` : ', as a fresh take on it'}.`
  const reply = Math.min(4000, Math.max(800, Math.ceil(estimateTokens(parts[part]) * 1.5) + 300))
  const done = await ask(deps, {
    taskId: input.taskId,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: text }
    ],
    reply,
    temperature: REDO_TEMPERATURE,
    direction: note || 'Another take on this part'
  })
  const base = { generationId: done.generationId, text: '' }
  const stop = ended(done)
  if (stop) return { ...base, ...stop }
  const out = done.text
    .replace(/^\s*#{1,6}\s*[^\n]*\n/, (m) => (/[a-z]/i.test(m) && m.length < 60 ? '' : m))
    .replace(/^```[a-z]*\n?|\n?```\s*$/g, '')
    .trim()
  if (!out) return { ...base, status: 'error', error: 'Nothing came back. Please try again.' }
  return { ...base, status: 'complete', error: null, text: out }
}
