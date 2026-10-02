// "Interview me" on the World builder page: the AI asks Adam one short question at a time about what his
// summary is still missing or thin on (the premise, the main characters and what they want, the setting,
// how the world works, the tone, how it ends...). One request per question, reading the summary as it
// stands; his answers are added to the summary by the interface, in his own words, under the question's
// topic ("Setting: ..."), with no AI call. Each request is a 'world' generation record run by the shared
// task runner with the World builder model, so it shows in "What the AI saw" like the build's own. The
// prompt and the reader are pure; askQuestion runs one request. No Electron imports.

import type Database from 'better-sqlite3'
import type { WorldInterviewAsked, WorldInterviewInput, WorldInterviewQuestion } from '@shared/contracts/worldBuilder'
import type { ChatMessage } from '@shared/types'
import { runTask, type Emit } from '../ai/tasks'
import type { JobModel } from '../ai/jobModel'
import { parseLenient } from '../keeper/json'
import { estimateTokens } from '../keeper/text'
import { UserError } from '../util'
import { WORLD_MARKER } from './prompts'
import { contextOf, MAX_SUMMARY_CHARS } from './sizes'

/** Room for the reply: a topic and one short question, with plenty to spare. */
export const INTERVIEW_REPLY = 400
/** A little variety between interviews, but questions that stay on point. */
export const INTERVIEW_TEMPERATURE = 0.7
/** The most earlier questions told with each request (the latest ones). */
export const ASKED_MOST = 30
/** The longest topic kept as the label for an answer. */
export const TOPIC_MOST = 40

/** The reply couldn't be read as a question. */
export const NO_QUESTION =
  "The AI's reply wasn't a question AI Write could use. Try again, or pick another world builder model in Settings › Models."
const WENT_WRONG = 'Something went wrong while thinking of a question. Try again.'

export function interviewSystem(): string {
  return `${WORLD_MARKER} interview
You help an author flesh out the summary of their world or story, before AI Write lays the world out from it. Interview them: ask one short question about what the summary is still missing, or says too little about, so that their answer gives the world more to build on.

What a good summary covers, most important first:
- The premise: what the story is about, and what sets it going.
- The main characters: who they are, what each wants, and what stands in their way.
- The setting: where and when it takes place, and what it is like there.
- How the world works: its rules, magic, technology, powers, politics or customs, and what they cost.
- The groups, places and things that matter, and the history behind them.
- The tone: how the story should feel to read.
- How it ends, or where it is heading.

Rules
- Read the summary as it stands. Ask about the most important thing it is missing or thin on. Never ask about what it already covers well.
- Ask one thing only, in plain, friendly words, in one sentence of at most 25 words. No lists, no options to choose from, no two questions in one.
- Use the names the summary uses, so the author knows what you mean.
- Never ask again about a topic already asked in this interview, answered or skipped. A skipped topic is one the author doesn't want to talk about now.
- "topic" names what the question is about in one to four words, starting with a capital letter ("Setting", "Mara's goal", "How magic works", "The ending"). The answer is added to the summary under it, so make it read well as a heading.

Reply with one JSON object and nothing else:
{"topic": "...", "question": "..."}`
}

/** The summary, cut in the middle when it is longer than `maxTokens` (the start and the end say the most about what is missing). */
export function fitSummary(summary: string, maxTokens: number): string {
  const text = summary.trim().slice(0, MAX_SUMMARY_CHARS)
  if (estimateTokens(text) <= maxTokens) return text
  const keep = Math.max(200, Math.floor(maxTokens * 3.5) - 20)
  const head = Math.ceil(keep * 0.6)
  return `${text.slice(0, head).trimEnd()}\n[…]\n${text.slice(text.length - (keep - head)).trimStart()}`
}

/** What was asked before in this interview, newest last, and how the author answered. */
export function askedText(asked: WorldInterviewAsked[]): string {
  const list = asked.filter((a) => a.question.trim()).slice(-ASKED_MOST)
  if (!list.length) return ''
  const lines = list.map(
    (a) =>
      `- ${oneLine(a.topic) || 'More'}: ${oneLine(a.question)} (${a.skipped ? 'skipped' : 'answered: the answer is now in the summary'})`
  )
  return `Already asked in this interview:\n${lines.join('\n')}`
}

export function interviewUser(summary: string, asked: WorldInterviewAsked[]): string {
  const said = summary.trim()
    ? `The author's summary as it stands:\n"""\n${summary.trim()}\n"""`
    : "The author hasn't written a summary yet. Start with the premise."
  const before = askedText(asked)
  return `${said}${before ? `\n\n${before}` : ''}\n\nAsk the next question now, as one JSON object.`
}

/** The messages for one question, with the summary cut to fit the model beside the instructions and the reply. */
export function interviewMessages(summary: string, asked: WorldInterviewAsked[], contextLength: number): ChatMessage[] {
  const system = interviewSystem()
  const fixed = estimateTokens(system) + estimateTokens(interviewUser('', asked)) + INTERVIEW_REPLY + 200
  const room = Math.max(300, contextLength - Math.ceil(contextLength * 0.05) - fixed)
  return [
    { role: 'system', content: system },
    { role: 'user', content: interviewUser(fitSummary(summary, room), asked) }
  ]
}

const oneLine = (s: unknown): string =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()

/** A topic that reads well as the label in front of an answer: one line, no trailing colon or full stop, a capital first, not too long. */
export function cleanTopic(topic: unknown): string {
  let t = oneLine(topic)
    .replace(/^[#*_"“'‘\s-]+|[*_"”'’\s]+$/g, '')
    .replace(/^topic\s*:\s*/i, '')
    .replace(/[\s:.;,!?-]+$/, '')
  if (t.length > TOPIC_MOST) {
    const cut = t.slice(0, TOPIC_MOST + 1)
    t = (cut.lastIndexOf(' ') > 10 ? cut.slice(0, cut.lastIndexOf(' ')) : cut.slice(0, TOPIC_MOST)).replace(/[\s:.;,-]+$/, '')
  }
  return t ? t[0].toUpperCase() + t.slice(1) : ''
}

/** One question, tidied: one line, unquoted, ending as a question does. */
export function cleanQuestion(question: unknown): string {
  const q = oneLine(question)
    .replace(/^(?:question\s*:\s*)/i, '')
    .replace(/^["“*_]+|["”*_]+$/g, '')
    .trim()
  return q
}

/**
 * The topic and question in a reply: the JSON object asked for (whatever the keys' case, or a fenced one),
 * else "Topic: ... / Question: ..." lines, else a lone question in plain words. Null when there is none.
 */
export function readQuestion(reply: string): { topic: string; question: string } | null {
  const parsed = parseLenient(reply)
  if (parsed.ok && parsed.value && typeof parsed.value === 'object' && !Array.isArray(parsed.value)) {
    const o = Object.fromEntries(Object.entries(parsed.value as Record<string, unknown>).map(([k, v]) => [k.toLowerCase(), v]))
    const question = cleanQuestion(o.question ?? o.ask ?? o.q)
    if (question) return { topic: cleanTopic(o.topic ?? o.about ?? o.label) || 'More', question }
  }
  const text = reply.trim()
  const q = text.match(/^\W*question\W*:\s*(.+)$/im)?.[1]
  if (q && cleanQuestion(q)) return { topic: cleanTopic(text.match(/^\W*topic\W*:\s*(.+)$/im)?.[1]) || 'More', question: cleanQuestion(q) }
  if (!text.includes('{')) {
    const line = text.split('\n').find((l) => l.includes('?'))
    if (line && cleanQuestion(line)) return { topic: 'More', question: cleanQuestion(line) }
  }
  return null
}

export interface InterviewContext {
  db: Database.Database
  model: JobModel
  emit: Emit
  onKeyRejected?: () => void
  /** For tests. */
  fetchImpl?: typeof fetch
  retryDelays?: number[]
}

/** Asks the World builder model for the next question. Throws (plain words) only before it starts; Stop is stopTask(taskId). */
export async function askQuestion(ctx: InterviewContext, input: WorldInterviewInput): Promise<WorldInterviewQuestion> {
  const summary = typeof input?.summary === 'string' ? input.summary : ''
  const asked = (Array.isArray(input?.asked) ? input.asked : []).map((a) => ({
    topic: oneLine(a?.topic).slice(0, 80),
    question: oneLine(a?.question).slice(0, 400),
    skipped: !!a?.skipped
  }))
  const done = await runTask({
    db: ctx.db,
    taskId: String(input?.taskId ?? ''),
    job: 'world',
    sceneId: null,
    model: ctx.model,
    messages: interviewMessages(summary, asked, contextOf(ctx.model.choice)),
    reply: INTERVIEW_REPLY,
    temperature: INTERVIEW_TEMPERATURE,
    direction: 'Interview me: the next question about my summary',
    emit: ctx.emit,
    onKeyRejected: ctx.onKeyRejected,
    fetchImpl: ctx.fetchImpl,
    retryDelays: ctx.retryDelays
  }).catch((e: unknown) => {
    throw e instanceof UserError ? e : new UserError(WENT_WRONG)
  })
  const base = { generationId: done.generationId, topic: '', question: '', error: null }
  if (done.status === 'stopped') return { ...base, status: 'stopped' }
  if (done.status === 'error') return { ...base, status: 'error', error: done.error ?? WENT_WRONG }
  const q = readQuestion(done.text)
  if (!q) return { ...base, status: 'error', error: NO_QUESTION }
  return { ...base, status: 'complete', ...q }
}
