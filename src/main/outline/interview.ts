// "Interview me" on a scene card or a chapter: the AI asks Adam one short question at a time, only about
// what the card and the outline don't already say ("Who walks in first?", "How should it end?"), and he
// types or dictates an answer, skips, or says he's done. Then, for a scene, the AI says what goes in the
// card's empty parts (the window puts in only those still empty, so nothing he wrote changes); for a
// chapter, it suggests the chapter's goal and its scene cards, in the outline helper's form, which he
// keeps, edits or discards one by one on the outline helper's page.
//
// Everything here is the outline helper's job: 'outline' generation records with the chat and brainstorm
// model and its Thinking, run by the shared task runner, so they show in "What the AI saw". The answers
// are never stored: they live in the window while the interview is open, and are sent with each request.
// No Electron imports: the caller passes the database, the model and `emit`.

import type Database from 'better-sqlite3'
import type {
  ChapterPlanRequest,
  PlanAnswer,
  PlanQuestion,
  PlanQuestionRequest,
  SceneFill,
  SceneFillParts,
  SceneFillRequest
} from '@shared/contracts/outline'
import { emptySceneCard } from '@shared/defaults'
import type { ChatMessage, EntryState, ID, SceneCard } from '@shared/types'
import { sceneTail, storySoFarText } from '../ai/context'
import { MODEL_NAMES } from '../ai/jobModel'
import { runTask, startTask } from '../ai/tasks'
import * as repo from '../db/repo'
import { parseLenient, str, strList } from '../keeper/json'
import { memoryAt } from '../memory/asOf'
import { UserError } from '../util'
import {
  aroundText,
  castText,
  chapterAroundText,
  fitBlocks,
  placeText,
  storyText,
  threadsText,
  type BlockDraft,
  type CastLine,
  type FittedBriefing,
  type ThreadLine
} from './brief'
import { castLines, ideasFacts, openThreads, storyFacts, storyPlan } from './context'
import { briefingBudget, type JobDeps } from './jobs'
import { MARKER } from './prompts'
import { cleanBeats } from './structure'

type DB = Database.Database

/** Room for a question: a topic and one short question, with plenty to spare. */
export const QUESTION_REPLY = 400
/** Room for a filled card. */
export const FILL_REPLY = 1200
/** Room for a chapter's goal and up to six scene cards. */
export const CHAPTER_REPLY = 1800
export const QUESTION_TEMPERATURE = 0.7
export const FILL_TEMPERATURE = 0.6
export const CHAPTER_TEMPERATURE = 0.8
/** After this many questions the interview is done, whatever the AI says. */
export const MOST_QUESTIONS = 8
/** The longest answer sent (each one), and the most answers. */
const ANSWER_MOST = 2000
const ANSWERS_MOST = 20

export const NO_QUESTION =
  "The AI's reply wasn't a question AI Write could use. Try again, or pick another chat and brainstorm model in Settings › Models."
export const NO_FILL =
  "The AI's reply couldn't be read as a scene card. Try again, or pick another chat and brainstorm model in Settings › Models."
const WENT_WRONG = 'Something went wrong while thinking of a question. Try again.'
const FILL_WRONG = 'Something went wrong while filling in the card. Try again.'

const oneLine = (s: unknown): string =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()

/** The interview's answers as sent: each tidied and cut to size, the latest ones. */
export function cleanAnswers(asked: unknown): PlanAnswer[] {
  return (Array.isArray(asked) ? asked : [])
    .map((a) => ({
      topic: oneLine(a?.topic).slice(0, 80),
      question: oneLine(a?.question).slice(0, 400),
      answer: String(a?.answer ?? '')
        .replace(/\r\n?/g, '\n')
        .trim()
        .slice(0, ANSWER_MOST),
      skipped: !!a?.skipped
    }))
    .filter((a) => a.question)
    .slice(-ANSWERS_MOST)
}

/** The interview so far, for the AI: each question with Adam's answer, or that he skipped it. */
export function answersText(asked: PlanAnswer[]): string {
  return asked
    .map((a) => {
      const head = `- ${a.topic || 'More'}: ${a.question}`
      if (a.skipped || !a.answer.trim()) return `${head}\n  (skipped: the author doesn't want to say now)`
      return `${head}\n  Answer: ${a.answer.trim().replace(/\n+/g, ' / ')}`
    })
    .join('\n')
}

// ---------- What the AI is asked ----------

const SCENE_PARTS = `who is in the scene and whose eyes it is seen through, where it happens, the goal (what they are trying to do), the conflict (what stands in their way), the beats (the 3 to 8 things that must happen, in order), the outcome (how it ends, and what changes) and the mood`

const QUESTION_RULES = `- Ask one thing only, in plain, friendly words, in one sentence of at most 20 words ("Who walks in first?", "How should it end?"). No lists, no options to choose from, no two questions in one.
- Use the names the story uses, so the author knows what you mean.
- Never ask again about a topic already asked in this interview, answered or skipped. A skipped topic is one the author doesn't want to talk about now.
- "topic" names what the question is about in one to four words, starting with a capital letter ("Who's there", "The ending", "Mara's goal").
- When what is already there and the answers so far are enough, stop: reply {"done": true}. Don't ask for the sake of asking.

Reply with one JSON object and nothing else:
{"topic": "...", "question": "..."}
or, when there is nothing more worth asking:
{"done": true}`

export function sceneQuestionSystem(): string {
  return `${MARKER} interview scene
You help a novelist plan one scene before it is written. Interview them: ask one short question at a time about what the scene card and the outline don't already say, so that their answers fill in the rest of the card. You plan; you never write the scene itself.

A scene card holds ${SCENE_PARTS}.

Rules
- Ask only about what is missing: the parts of the card listed as empty, and what the outline and the story so far don't settle. Never ask about what the card, the outline or an earlier answer already says.
- Most important first: what happens and how it ends come before the mood.
${QUESTION_RULES}`
}

export function chapterQuestionSystem(): string {
  return `${MARKER} interview chapter
You help a novelist plan one chapter before it is written. Interview them: ask one short question at a time about what the chapter and the outline around it don't already say, so that their answers settle the chapter's goal and its scenes. You plan; you never write the story itself.

A chapter plan says what the chapter achieves, what happens in it and in what order, who is in it and where, and how it ends and leads on to the next.

Rules
- Ask only about what is missing. Never ask about what the chapter, its scenes, the outline or an earlier answer already says.
- Most important first: what happens and how it ends come before the details.
${QUESTION_RULES}`
}

/** The empty parts of a card, in plain words, so the AI asks about those. */
export function emptyParts(card: SceneCard): string[] {
  const out: string[] = []
  if (!card.povId) out.push('point of view')
  if (!card.presentIds.length) out.push('characters present')
  if (!card.locationId) out.push('location')
  if (!card.goal.trim()) out.push('goal')
  if (!card.conflict.trim()) out.push('conflict')
  if (!card.beats.some((b) => b.trim())) out.push('beats')
  if (!card.outcome.trim()) out.push('outcome')
  if (!card.mood.trim()) out.push('mood')
  return out
}

const castForms = (cast: CastLine[]): string[] => [castText(cast, 40), castText(cast, 15), castText(cast, 30, true)]

/** The scene's briefing: what next scene ideas are told, with the interview so far. */
function sceneBlocks(
  db: DB,
  sceneId: ID,
  card: SceneCard,
  asked: PlanAnswer[],
  ask: string
): { drafts: BlockDraft[]; lines: (CastLine | ThreadLine)[] } {
  const facts = ideasFacts(db, sceneId, card)
  const m = facts.memory
  const prev = m.previous
  const tail = (o: { min: number; target: number; max: number }): string => {
    if (!prev?.text.trim()) return ''
    const from = prev.storyId !== m.storyId ? `(The end of ${prev.storyTitle || 'the story before'}.)\n` : ''
    return `${from}${sceneTail(prev.text, o)}`
  }
  const empty = emptyParts(card)
  const onCard = [facts.card, empty.length ? `Empty on the card: ${empty.join(', ')}.` : 'Every part of the card is filled in.']
    .filter(Boolean)
    .join('\n')
  const drafts: BlockDraft[] = [
    { id: 'story', title: 'The story', priority: 1, forms: [storyText(facts.story)] },
    { id: 'place', title: 'Where this scene is', priority: 1, forms: [placeText(facts.plan, sceneId, facts.storyTitle)] },
    { id: 'card', title: 'The scene card as it is', priority: 1, forms: [onCard] },
    { id: 'answers', title: 'The interview so far', priority: 1, forms: [answersText(asked)] },
    { id: 'around', title: 'The outline around it', priority: 2, forms: [0, 1, 2].map((level) => aroundText(facts.plan, sceneId, level)) },
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
    { id: 'ask', title: 'What to do', priority: 0, forms: [ask] }
  ]
  return { drafts, lines: [...facts.cast, ...facts.threads] }
}

interface ChapterFacts {
  storyId: ID
  drafts: BlockDraft[]
  lines: (CastLine | ThreadLine)[]
}

/** The chapter's briefing: the story, the chapter with the outline around it, open threads, people and places, and the interview so far. */
function chapterBlocks(db: DB, chapterId: ID, asked: PlanAnswer[], ask: string): ChapterFacts {
  const chapter = repo.getChapter(db, chapterId)
  const story = repo.getStory(db, chapter.storyId)
  const plan = storyPlan(db, story.id)
  let entries: EntryState[] = []
  let threads: ThreadLine[] = []
  try {
    // As of the story's end: who and what exists, and which threads are still open, by the time it is told.
    const at = memoryAt(db, { kind: 'end', storyId: story.id })
    entries = [...at.state.entries.values()]
    threads = openThreads(at.state.threads, at.state.entries)
  } catch (e) {
    console.warn('The chapter interview could not read the memory', e)
  }
  const here = chapterAroundText(plan, chapterId, story.title, 0)
  const cast = castLines(entries, `${here}\n${asked.map((a) => a.answer).join('\n')}`)
  const drafts: BlockDraft[] = [
    { id: 'story', title: 'The story', priority: 1, forms: [storyText(storyFacts(db, story))] },
    {
      id: 'chapter',
      title: 'The chapter and the outline around it',
      priority: 1,
      forms: [0, 1, 2].map((l) => chapterAroundText(plan, chapterId, story.title, l))
    },
    { id: 'answers', title: 'The interview so far', priority: 1, forms: [answersText(asked)] },
    {
      id: 'threads',
      title: 'Open plot threads',
      priority: 3,
      forms: [threadsText(threads), threadsText(threads, true)],
      entryIds: threads.map((t) => t.id)
    },
    { id: 'cast', title: 'Characters and places', priority: 5, forms: castForms(cast), entryIds: cast.map((c) => c.id) },
    { id: 'ask', title: 'What to do', priority: 0, forms: [ask] }
  ]
  return { storyId: story.id, drafts, lines: [...cast, ...threads] }
}

const messagesOf = (system: string, fitted: FittedBriefing): ChatMessage[] => [
  { role: 'system', content: system },
  { role: 'user', content: fitted.text }
]

function sentEntries(fitted: FittedBriefing, lines: (CastLine | ThreadLine)[]): { entryId: ID; version: string }[] {
  const versions = new Map(lines.map((l) => [l.id, l.version]))
  const ids = new Set(fitted.blocks.filter((b) => !b.dropped).flatMap((b) => b.entryIds))
  return [...ids].flatMap((entryId) => (versions.has(entryId) ? [{ entryId, version: versions.get(entryId)! }] : []))
}

// ---------- Reading the replies ----------

const cleanTopic = (topic: unknown): string => {
  const t = oneLine(topic)
    .replace(/^[#*_"“'‘\s-]+|[*_"”'’\s]+$/g, '')
    .replace(/^topic\s*:\s*/i, '')
    .replace(/[\s:.;,!?-]+$/, '')
    .slice(0, 40)
    .trim()
  return t ? t[0].toUpperCase() + t.slice(1) : ''
}
const cleanQuestion = (q: unknown): string =>
  oneLine(q)
    .replace(/^(?:question\s*:\s*)/i, '')
    .replace(/^["“*_]+|["”*_]+$/g, '')
    .trim()

/** The next question, or done; null when the reply is neither. */
export function readPlanQuestion(reply: string): { topic: string; question: string; done: boolean } | null {
  const parsed = parseLenient(reply)
  if (parsed.ok && parsed.value && typeof parsed.value === 'object' && !Array.isArray(parsed.value)) {
    const o = Object.fromEntries(Object.entries(parsed.value as Record<string, unknown>).map(([k, v]) => [k.toLowerCase(), v]))
    const question = cleanQuestion(o.question ?? o.ask ?? o.q)
    if (question) return { topic: cleanTopic(o.topic ?? o.about) || 'More', question, done: false }
    if (o.done === true || o.done === 'true') return { topic: '', question: '', done: true }
  }
  const text = reply.trim()
  if (/^\W*done\W*$/i.test(text)) return { topic: '', question: '', done: true }
  const q = text.match(/^\W*question\W*:\s*(.+)$/im)?.[1]
  if (q && cleanQuestion(q))
    return { topic: cleanTopic(text.match(/^\W*topic\W*:\s*(.+)$/im)?.[1]) || 'More', question: cleanQuestion(q), done: false }
  if (!text.includes('{')) {
    const line = text.split('\n').find((l) => l.includes('?'))
    if (line && cleanQuestion(line)) return { topic: 'More', question: cleanQuestion(line), done: false }
  }
  return null
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[’']s\b/g, '')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** The entry a name means: its name or an alias exactly, else the only one whose name starts with it ("Mara" for "Mara Venn"). */
export function matchEntry<T extends { id: ID; name: string; aliases: string[] }>(name: string, entries: T[]): T | null {
  const n = norm(name)
  if (!n) return null
  const exact = entries.filter((e) => [e.name, ...e.aliases].some((a) => norm(a) === n))
  if (exact.length) return exact[0]
  const starts = entries.filter((e) => [e.name, ...e.aliases].some((a) => norm(a).startsWith(`${n} `) || n.startsWith(`${norm(a)} `)))
  return starts.length === 1 ? starts[0] : null
}

type Named = { id: ID; name: string; aliases: string[] }

/**
 * What the AI would put in the card, read from its JSON: text parts tidied, beats as the card keeps them,
 * names matched to the characters and places given (a name it doesn't know is left out).
 */
export function readSceneFill(reply: string, characters: Named[], places: Named[]): SceneFillParts | null {
  const parsed = parseLenient(reply)
  if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return null
  const o = Object.fromEntries(
    Object.entries(parsed.value as Record<string, unknown>).map(([k, v]) => [k.toLowerCase().replace(/[\s_-]/g, ''), v])
  )
  const fill: SceneFillParts = {}
  const text = (v: unknown, max: number): string => str(v, max).replace(/\s+/g, ' ').trim()
  const goal = text(o.goal, 1000)
  if (goal) fill.goal = goal
  const conflict = text(o.conflict, 1000)
  if (conflict) fill.conflict = conflict
  const outcome = text(o.outcome, 1000)
  if (outcome) fill.outcome = outcome
  const mood = text(o.mood ?? o.moodortone ?? o.tone, 200)
  if (mood) fill.mood = mood
  const beats = cleanBeats(Array.isArray(o.beats) ? o.beats : strList(o.beats, 12))
  if (beats.length) fill.beats = beats
  const pov =
    typeof o.pov === 'string'
      ? matchEntry(o.pov, characters)
      : typeof o.pointofview === 'string'
        ? matchEntry(o.pointofview, characters)
        : null
  if (pov) fill.povId = pov.id
  const named = Array.isArray(o.present)
    ? o.present
    : Array.isArray(o.characters)
      ? o.characters
      : Array.isArray(o.characterspresent)
        ? o.characterspresent
        : []
  const present: ID[] = []
  for (const n of named) {
    const e = typeof n === 'string' ? matchEntry(n, characters) : null
    if (e && !present.includes(e.id)) present.push(e.id)
  }
  if (fill.povId && present.length && !present.includes(fill.povId)) present.unshift(fill.povId)
  if (present.length) fill.presentIds = present
  const where = typeof o.location === 'string' ? o.location : typeof o.place === 'string' ? o.place : ''
  const loc = where ? matchEntry(where, places) : null
  if (loc) fill.locationId = loc.id
  return fill
}

// ---------- The calls ----------

/** Asks for the interview's next question, or done. Throws (plain words) only before it starts; Stop is stopTask(taskId). */
export async function askPlanQuestion(deps: JobDeps, input: PlanQuestionRequest): Promise<PlanQuestion> {
  const asked = cleanAnswers(input?.asked)
  const base = { generationId: null, topic: '', question: '', done: false, error: null }
  // Enough has been asked: the interview ends without another call.
  if (asked.length >= MOST_QUESTIONS) return { ...base, status: 'complete', done: true }
  const target = input?.target
  let system: string
  let briefing: { drafts: BlockDraft[]; lines: (CastLine | ThreadLine)[] }
  let sceneId: ID | null = null
  const next = asked.length
    ? 'Ask the next question now, or say you are done, as one JSON object.'
    : 'Ask the first question now, as one JSON object.'
  if (target?.kind === 'scene') {
    sceneId = target.sceneId
    const card = { ...emptySceneCard(), ...(input.card ?? repo.getScene(deps.db, target.sceneId).card) }
    system = sceneQuestionSystem()
    briefing = sceneBlocks(deps.db, target.sceneId, card, asked, next)
  } else if (target?.kind === 'chapter') {
    system = chapterQuestionSystem()
    briefing = chapterBlocks(deps.db, target.chapterId, asked, next)
  } else throw new UserError(WENT_WRONG)
  const fitted = fitBlocks(briefing.drafts, system, briefingBudget(deps.model, QUESTION_REPLY), MODEL_NAMES.chat)
  const done = await runTask({
    db: deps.db,
    taskId: String(input?.taskId ?? ''),
    job: 'outline',
    sceneId,
    model: deps.model,
    messages: messagesOf(system, fitted),
    reply: QUESTION_REPLY,
    temperature: QUESTION_TEMPERATURE,
    direction: `Interview me: the next question about this ${target.kind}`,
    blocks: fitted.blocks,
    entries: sentEntries(fitted, briefing.lines),
    emit: deps.emit,
    onKeyRejected: deps.onKeyRejected
  }).catch((e: unknown) => {
    throw e instanceof UserError ? e : new UserError(WENT_WRONG)
  })
  const out = { ...base, generationId: done.generationId }
  if (done.status === 'stopped') return { ...out, status: 'stopped' }
  if (done.status === 'error') return { ...out, status: 'error', error: done.error ?? WENT_WRONG }
  const q = readPlanQuestion(done.text)
  if (!q) return { ...out, status: 'error', error: NO_QUESTION }
  return { ...out, status: 'complete', ...q }
}

export function sceneFillSystem(): string {
  return `${MARKER} fill scene
You help a novelist plan one scene before it is written. From their answers to a short interview, the scene card as it is and the outline around it, you fill in the parts of the card that are still empty. You plan; you never write the scene itself.

Reply with one JSON object and nothing else, with only the empty parts:
{"pov": "<the point-of-view character's name>", "present": ["<a character's name>", "..."], "location": "<the place's name>", "goal": "<what they are trying to do>", "conflict": "<what stands in their way>", "beats": ["<a beat>", "..."], "outcome": "<how it ends, and what changes>", "mood": "<a few words>"}

Rules
- Fill only the parts listed as empty. Leave out every part that is already filled, and any part nothing settles.
- The author's answers come first: keep to them, in their words where they fit. Then what the card, the outline and the story so far say. Never contradict any of them.
- Names: only the characters and places listed, spelled as listed. Leave out anyone or anywhere not listed.
- Beats: 3 to 8 short lines, in order, each one thing that must happen.
- Goal, conflict and outcome: one or two sentences each. Mood: a few words.`
}

/** Asks what goes in the card's empty parts, from the interview's answers. Throws (plain words) only before it starts. */
export async function fillSceneCard(deps: JobDeps, input: SceneFillRequest): Promise<SceneFill> {
  const sceneId = String(input?.sceneId ?? '')
  const card = { ...emptySceneCard(), ...(input?.card ?? repo.getScene(deps.db, sceneId).card) }
  const answers = cleanAnswers(input?.answers)
  const base = { generationId: null, fill: {}, error: null }
  if (!emptyParts(card).length) return { ...base, status: 'complete' }
  const system = sceneFillSystem()
  const { drafts, lines } = sceneBlocks(
    deps.db,
    sceneId,
    card,
    answers,
    'Fill in the empty parts of the scene card now, as one JSON object.'
  )
  const fitted = fitBlocks(drafts, system, briefingBudget(deps.model, FILL_REPLY), MODEL_NAMES.chat)
  const done = await runTask({
    db: deps.db,
    taskId: String(input?.taskId ?? ''),
    job: 'outline',
    sceneId,
    model: deps.model,
    messages: messagesOf(system, fitted),
    reply: FILL_REPLY,
    temperature: FILL_TEMPERATURE,
    direction: 'Interview me: fill in the scene card from my answers',
    blocks: fitted.blocks,
    entries: sentEntries(fitted, lines),
    emit: deps.emit,
    onKeyRejected: deps.onKeyRejected
  }).catch((e: unknown) => {
    throw e instanceof UserError ? e : new UserError(FILL_WRONG)
  })
  const out = { ...base, generationId: done.generationId }
  if (done.status === 'stopped') return { ...out, status: 'stopped' }
  if (done.status === 'error') return { ...out, status: 'error', error: done.error ?? FILL_WRONG }
  // Names are matched against every character and place in the world (the card's pickers list them all).
  const entries = repo.listEntries(deps.db)
  const fill = readSceneFill(
    done.text,
    entries.filter((e) => e.kind === 'character'),
    entries.filter((e) => e.kind === 'place')
  )
  if (!fill) return { ...out, status: 'error', error: NO_FILL }
  return { ...out, status: 'complete', fill }
}

export function chapterPlanSystem(): string {
  return `${MARKER} plan chapter
You help a novelist plan one chapter. From their answers to a short interview, the chapter as it is and the outline around it, you suggest the chapter's goal and the scenes it still needs. You plan; you never write the story itself.

Answer in exactly this form and nothing else: no introduction, no chapter heading, no notes at the end, no bold or other formatting.

Goal: <one sentence: what this chapter achieves>

### Scene: <the scene's title>
When: <the day it happens on, in the story's count of days, and the time of day: "Day 1, morning", "Day 3, dusk">
Summary: <one sentence: what happens in it>
- <a beat: one thing that must happen in the scene>
- <the next beat>
- <the next beat>

Rules:
- The author's answers come first: keep to them. Then what the chapter, the outline and the story so far say. Never contradict any of them.
- Suggest 2 to 6 scenes, as many as the chapter needs. They come after the scenes the chapter already has, carry on from them and never repeat them.
- Each scene has 3 to 6 beats, in order, each a short line.
- Each scene has a When, carrying on from the scenes before ("Day 2, evening"). If the story's scenes give their time another way (a date or a year), use that way instead.
- Titles are a few words, with no numbers.
- Use the characters, places and plot threads given, by their names. Bring in someone or something new only when the chapter needs it.
- The chapter leads on to the chapter after it, if there is one.`
}

/** Asks for the chapter's goal and scene cards; it streams as task events. Throws (plain words) only before it starts. */
export function startChapterPlan(deps: JobDeps, input: ChapterPlanRequest): { generationId: ID } {
  const chapterId = String(input?.chapterId ?? '')
  const answers = cleanAnswers(input?.answers)
  const system = chapterPlanSystem()
  const ask = answers.length
    ? 'Suggest the chapter’s goal and its scenes now, from the interview.'
    : 'Suggest the chapter’s goal and its scenes now, from the chapter and the outline around it.'
  const { drafts, lines } = chapterBlocks(deps.db, chapterId, answers, ask)
  const fitted = fitBlocks(drafts, system, briefingBudget(deps.model, CHAPTER_REPLY), MODEL_NAMES.chat)
  return startTask({
    db: deps.db,
    taskId: input.taskId,
    job: 'outline',
    sceneId: '',
    model: deps.model,
    messages: messagesOf(system, fitted),
    reply: CHAPTER_REPLY,
    temperature: CHAPTER_TEMPERATURE,
    direction: answers.length ? 'Interview me: plan this chapter from my answers' : 'Plan this chapter',
    blocks: fitted.blocks,
    entries: sentEntries(fitted, lines),
    emit: deps.emit,
    onKeyRejected: deps.onKeyRejected
  })
}
