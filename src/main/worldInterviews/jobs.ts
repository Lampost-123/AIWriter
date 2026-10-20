// The AI calls of the interviews by topic (contracts/worldInterviews.ts): the next few questions of a topic, and the
// pages (or links) its answers suggest. Each is one 'world' generation record with the World builder model and its
// Thinking, run by the shared task runner, so it can be stopped and shows in "What the AI saw" with its parts. A reply
// that can't be used is said in plain words; one that is plainly a refusal says so. No Electron imports.

import type Database from 'better-sqlite3'
import type {
  InterviewTopic,
  TopicAsked,
  TopicQuestions,
  TopicQuestionsRequest,
  TopicSuggestions,
  TopicSuggestRequest
} from '@shared/contracts/worldInterviews'
import { INTERVIEW_TOPICS, TOPIC_KIND } from '@shared/contracts/worldInterviews'
import type { ChatMessage, ID, WritingPrefs } from '@shared/types'
import type { TaskDone } from '@shared/contracts/tasks'
import { runTask, type Emit } from '../ai/tasks'
import type { JobModel } from '../ai/jobModel'
import { looksLikeRefusalReply } from '../ai/errors'
import { UserError } from '../util'
import type { BlockDraft, FittedBriefing } from '../outline/briefing'
import { fitBriefing } from '../outline/jobs'
import { ideaText, linksText, pagesText, storyOf } from './context'
import { readEntries, readLinks, readQuestions, newQuestions } from './parse'
import {
  askedAlready,
  askedText,
  askNow,
  connectSystem,
  fieldKeysOf,
  MOST_QUESTIONS,
  questionsSystem,
  ROUND_MOST,
  suggestNow,
  suggestSystem,
  TOPIC_FIELDS
} from './prompts'
import { settleEntries, settleLinks } from './settle'

export interface InterviewDeps {
  db: Database.Database
  model: JobModel
  emit: Emit
  onKeyRejected?: () => void
  prefs?: WritingPrefs | null
  /** For tests. */
  fetchImpl?: typeof fetch
  retryDelays?: number[]
}

/** Room for a round of questions, with plenty to spare. */
export const QUESTIONS_REPLY = 500
/** Room for up to 12 pages, or 16 links. */
export const SUGGEST_REPLY = 5000
export const QUESTIONS_TEMPERATURE = 0.7
export const SUGGEST_TEMPERATURE = 0.6

const WENT_WRONG = 'Something went wrong. Please try again.'
const NO_QUESTIONS = "The AI's reply wasn't questions AI Write could use. Try again, or pick another world builder model in Settings › Models."
const NO_SUGGESTIONS = "The AI's answer didn't come as a list, so there is nothing to show. Try again, or pick another world builder model in Settings › Models."
const REFUSED = 'The world builder model turned this down. Try again, or pick another world builder model in Settings › Models.'
const TOO_LONG =
  'That is more than the world builder model can read at once. Shorten your idea or your answers, or pick a model that can read more in Settings › Models.'

const clip = (s: unknown, max: number): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '')

/** The topic asked for, checked. */
export function topicOf(v: unknown): InterviewTopic {
  if (typeof v === 'string' && (INTERVIEW_TOPICS as string[]).includes(v)) return v as InterviewTopic
  throw new UserError(WENT_WRONG)
}

/** The interview so far as the window sends it, cleaned. */
export function cleanAsked(v: unknown): TopicAsked[] {
  return (Array.isArray(v) ? v : [])
    .map((a) => {
      const question = clip(a?.question, 400)
      const answer = typeof a?.answer === 'string' ? a.answer.trim().slice(0, 4000) : ''
      return { question, answer, skipped: !!a?.skipped || !answer }
    })
    .filter((a) => a.question)
    .slice(-60)
}

/** Adam's answers in one text, his words for telling which parts of a suggestion are his. */
export const answersText = (asked: TopicAsked[]): string =>
  asked
    .filter((a) => !a.skipped && a.answer.trim())
    .map((a) => a.answer.trim())
    .join('\n\n')

/** The parts every request of an interview opens with: the idea and what the world has (and how it is linked). */
function knownBlocks(deps: InterviewDeps, topic: InterviewTopic, storyId: ID | null): BlockDraft[] {
  const story = storyOf(deps.db, storyId)
  const idea = ideaText(deps.db, story, deps.prefs)
  const blocks: BlockDraft[] = [
    { id: 'idea', title: story ? "The author's idea for the story" : "The author's world", priority: 2, forms: [...new Set([idea, idea.slice(0, 16_000), idea.slice(0, 5000)])] },
    {
      id: 'world',
      title: 'Already in the world',
      priority: 3,
      forms: [pagesText(deps.db, topic, 60), pagesText(deps.db, topic, 25), pagesText(deps.db, topic, 8)]
    }
  ]
  if (topic === 'connections') blocks.push({ id: 'links', title: 'How the pages already stand with each other', priority: 4, forms: [linksText(deps.db, 80), linksText(deps.db, 20)] })
  return blocks
}

function fit(deps: InterviewDeps, drafts: BlockDraft[], system: string, reply: number): FittedBriefing {
  return fitBriefing(drafts, system, deps.model, reply, TOO_LONG)
}

async function ask(deps: InterviewDeps, o: { taskId: string; messages: ChatMessage[]; reply: number; temperature: number; direction: string; fitted: FittedBriefing }): Promise<TaskDone> {
  const most = deps.model.choice.maxOutput && deps.model.choice.maxOutput > 0 ? deps.model.choice.maxOutput : o.reply
  return runTask({
    db: deps.db,
    taskId: o.taskId,
    job: 'world',
    sceneId: null,
    model: deps.model,
    messages: o.messages,
    reply: Math.min(o.reply, most),
    temperature: o.temperature,
    direction: o.direction,
    blocks: o.fitted.blocks,
    emit: deps.emit,
    onKeyRejected: deps.onKeyRejected,
    fetchImpl: deps.fetchImpl,
    retryDelays: deps.retryDelays
  }).catch((e: unknown) => {
    throw e instanceof UserError ? e : new UserError(WENT_WRONG)
  })
}

const ended = (done: TaskDone): { status: 'stopped' | 'error'; error: string | null } | null =>
  done.status === 'stopped' ? { status: 'stopped', error: null } : done.status === 'error' ? { status: 'error', error: done.error ?? WENT_WRONG } : null

/** The plain words for a reply that couldn't be read: a refusal, or not what was asked for. */
const unreadable = (text: string, otherwise: string): string => (looksLikeRefusalReply(text) ? REFUSED : otherwise)

const TOPIC_DIRECTION: Record<InterviewTopic, string> = {
  characters: 'Interview me about the characters',
  places: 'Interview me about the places',
  lore: 'Interview me about the lore and history',
  connections: 'Interview me about how it all connects'
}

/** The next few questions of a topic; `enough` (with no call) once it has had MOST_QUESTIONS. */
export async function askTopicQuestions(deps: InterviewDeps, input: TopicQuestionsRequest): Promise<TopicQuestions> {
  const topic = topicOf(input?.topic)
  const storyId = typeof input?.storyId === 'string' && input.storyId ? input.storyId : null
  const asked = cleanAsked(input?.asked)
  if (asked.length >= MOST_QUESTIONS) return { status: 'complete', generationId: null, error: null, questions: [], enough: true }
  const system = questionsSystem(topic, !!storyOf(deps.db, storyId))
  const drafts: BlockDraft[] = [
    ...knownBlocks(deps, topic, storyId),
    { id: 'asked', title: 'This interview so far', priority: 0, forms: [askedText(asked)] },
    { id: 'ask', title: 'What to do', priority: 0, forms: [askNow(topic)] }
  ]
  const fitted = fit(deps, drafts, system, QUESTIONS_REPLY)
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: fitted.text }
  ]
  const run = (msgs: ChatMessage[]) =>
    ask(deps, { taskId: String(input?.taskId ?? ''), messages: msgs, reply: QUESTIONS_REPLY, temperature: QUESTIONS_TEMPERATURE, direction: TOPIC_DIRECTION[topic], fitted })
  let done = await run(messages)
  let read = done.status === 'complete' ? readQuestions(done.text, ROUND_MOST) : null
  let fresh = read ? newQuestions(read.questions, asked) : []
  // Every question asked before (in other words): sent back once.
  if (read && !read.done && !fresh.length) {
    const again = await run([...messages, { role: 'assistant', content: done.text }, { role: 'user', content: askedAlready }])
    const read2 = again.status === 'complete' ? readQuestions(again.text, ROUND_MOST) : null
    if (again.status !== 'complete' || read2) {
      done = again
      read = read2
      fresh = read2 ? newQuestions(read2.questions, asked) : []
    }
  }
  const base = { generationId: done.generationId, questions: [], enough: false, error: null }
  const stop = ended(done)
  if (stop) return { ...base, ...stop }
  if (!read) return { ...base, status: 'error', error: unreadable(done.text, NO_QUESTIONS) }
  // Nothing new to ask: it has what it can get.
  if (read.done || !fresh.length) return { ...base, status: 'complete', enough: true }
  return { ...base, status: 'complete', questions: fresh }
}

/** The pages (or, for the connections, the links) a topic's answers suggest, settled against the world. Nothing is made. */
export async function suggestFromTopic(deps: InterviewDeps, input: TopicSuggestRequest): Promise<TopicSuggestions> {
  const topic = topicOf(input?.topic)
  const storyId = typeof input?.storyId === 'string' && input.storyId ? input.storyId : null
  const asked = cleanAsked(input?.asked)
  const answers = answersText(asked)
  if (!answers) throw new UserError('Answer at least one question first: the suggestions are made from your answers.', 'no-answers')
  const story = !!storyOf(deps.db, storyId)
  const system = topic === 'connections' ? connectSystem(story) : suggestSystem(topic, TOPIC_KIND[topic], story)
  const drafts: BlockDraft[] = [
    ...knownBlocks(deps, topic, storyId),
    {
      id: 'asked',
      title: "The interview: the author's answers",
      priority: 0,
      forms: [askedText(asked.filter((a) => !a.skipped), 4000), askedText(asked.filter((a) => !a.skipped), 1200)]
    },
    { id: 'ask', title: 'What to do', priority: 0, forms: [suggestNow(topic)] }
  ]
  const fitted = fit(deps, drafts, system, SUGGEST_REPLY)
  const done = await ask(deps, {
    taskId: String(input?.taskId ?? ''),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: fitted.text }
    ],
    reply: SUGGEST_REPLY,
    temperature: SUGGEST_TEMPERATURE,
    direction: `${TOPIC_DIRECTION[topic]}: suggest ${topic === 'connections' ? 'the links' : 'the pages'}`,
    fitted
  })
  const base = { generationId: done.generationId, entries: [], links: [], error: null }
  const stop = ended(done)
  if (stop) return { ...base, ...stop }
  if (topic === 'connections') {
    const raw = readLinks(done.text)
    if (!raw) return { ...base, status: 'error', error: unreadable(done.text, NO_SUGGESTIONS) }
    return { ...base, status: 'complete', links: settleLinks(deps.db, raw) }
  }
  const kind = TOPIC_KIND[topic]
  const raw = readEntries(done.text, TOPIC_FIELDS[kind] ?? fieldKeysOf(kind))
  if (!raw) return { ...base, status: 'error', error: unreadable(done.text, NO_SUGGESTIONS) }
  return { ...base, status: 'complete', entries: settleEntries(deps.db, kind, raw, answers) }
}
