// One critique of a scene or a chapter (contracts/critique.ts), when Adam asks: gathers a lean briefing (how the story
// is written, the facts it must respect, what Adam has said he wants, on a re-read the notes last time, the card, who
// is in it, how the scene or chapter before ends, and the words), fits it to the writer model (outline/brief.ts
// fitBlocks: the least important parts shorten first, then a long chapter's scenes, down to their summaries; the facts
// and what Adam said shorten but are never left out), asks once (a reply that can't be read is asked for once more,
// saying what was wrong), reads the notes against the words (parse.ts), keeps them to what Adam said (memory.ts
// guardNotes) and keeps the result as the latest for that scene or chapter (store.ts), with the notes he acted on or
// set aside carried along. It is a 'critique' record made by the shared task runner, so it streams, can be stopped and
// shows in "What the AI saw". Never writes once stopped or once the world has closed. No Electron imports.

import type Database from 'better-sqlite3'
import type { Critique, CritiqueNote, CritiqueOutcome, CritiqueRequest, CritiqueTarget, CritiqueWant } from '@shared/contracts/critique'
import type { ChatMessage, Chapter, Entry, ID, SceneCard, Story, StyleGuide, WritingPrefs } from '@shared/types'
import { CARRY_LABELS } from '@shared/chapterCard'
import { intensityLines } from '@shared/intensity'
import { effectiveStyle } from '@shared/style'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as cdb from '../db/checks'
import { sceneTail } from '../ai/context'
import { openThreadsAt } from '../ai/openThreads'
import { MODEL_NAMES, type JobModel } from '../ai/jobModel'
import { runTask, type Emit } from '../ai/tasks'
import { checkReport } from '../checks/report'
import { stillThere } from '../checks/quote'
import { CUT_OFF } from '../keeper/json'
import { sceneMemory } from '../memory/scene'
import { fitBlocks, type BlockDraft, type FittedBriefing } from '../outline/brief'
import { cardLines } from '../outline/context'
import { briefingBudget } from '../outline/jobs'
import { now, UserError } from '../util'
import { carryEarlier, earlierForms, guardNotes, loadWants, saidForms, settledCount, storyOfTarget } from './memory'
import { critiqueFrom, readCritiqueReply, type CritiqueText, type RawCritique } from './parse'
import {
  CRITIQUE_REPLY,
  CRITIQUE_TEMPERATURE,
  castFor,
  castText,
  chapterTextForms,
  critiqueAsk,
  critiqueSystem,
  dueForCritic,
  factsForms,
  retryMessage,
  sceneTextForms,
  storyLines,
  type CritiqueFacts,
  type FactsThread
} from './prompts'
import { cleanTarget, goneNotes, loadCritique, saveCritique, targetTexts, textsHash } from './store'

type DB = Database.Database

export interface CritiqueDeps {
  db: DB
  model: JobModel
  prefs: WritingPrefs
  emit: Emit
  onKeyRejected?: () => void
  /** True once the world has closed: nothing more is written. */
  closed?: () => boolean
  fetchImpl?: typeof fetch
  retryDelays?: number[]
}

/** The most plot threads the facts list (those on the card come first, and are never cut for these). */
export const MOST_THREADS = 8
/** The most must-fix problems the facts list. */
export const MOST_MUST_FIX = 6

const clean = (s: string | undefined | null): string => (s ?? '').replace(/\s+/g, ' ').trim()

/** The first of these that says something: the story's own, its series', the world's. */
function nearest(db: DB, story: Pick<Story, 'seriesId'>, own: string, field: 'tone' | 'themes'): string {
  const series = story.seriesId ? repo.listSeries(db).find((s) => s.id === story.seriesId) : undefined
  return [own, series?.[field], repo.getMeta(db, field) ?? ''].map((t) => (t ?? '').trim()).find(Boolean) ?? ''
}

/** The tone in effect for a story: its own, else its series', else the world's. */
const toneOf = (db: DB, story: Story): string => nearest(db, story, story.tone, 'tone')

/**
 * The scene or chapter before this point in the story: the end of its words, for judging how this one opens. Longest
 * first (about 350 words, then about 120); [''] when nothing before has words.
 */
function endBefore(db: DB, storyId: ID, firstSceneId: ID): string[] {
  const scenes = repo.getOutline(db, storyId).scenes
  const at = scenes.findIndex((s) => s.id === firstSceneId)
  for (let i = at - 1; i >= 0; i--) {
    const text = repo.getScene(db, scenes[i].id).text ?? ''
    if (text.trim()) return [sceneTail(text, { min: 280, target: 350, max: 450 }), sceneTail(text, { min: 90, target: 120, max: 160 })]
  }
  return ['']
}

/** A chapter card's who, where, when and mood, names for its ids (its notes and the chapter's goal are facts). */
function chapterCardText(db: DB, chapterId: ID, name: (id: ID) => string): string {
  const card = repo.getChapterCard(db, chapterId)
  const lines: string[] = []
  const add = (label: string, v: string): void => {
    if (v.trim()) lines.push(`${label}: ${v.trim()}`)
  }
  add(CARRY_LABELS.pov, card.povId ? name(card.povId) : '')
  add(CARRY_LABELS.present, card.presentIds.map(name).filter(Boolean).join(', '))
  add(CARRY_LABELS.location, card.locationId ? name(card.locationId) : '')
  add(CARRY_LABELS.when, card.when)
  add(CARRY_LABELS.mood, card.mood)
  return lines.join('\n')
}

// ---------- Facts to respect ----------

/**
 * The plot threads for the facts: those the card sets up or pays off, then the open ones at the scene, most urgent first
 * (ai/openThreads.ts: due now or overdue, then those that involve the scene), each with when it is due. None when the
 * memory can't be read (the critique goes ahead without them).
 */
function threadFacts(db: DB, sceneId: ID, card: SceneCard | null): FactsThread[] {
  try {
    const memory = sceneMemory(db, sceneId)
    const onCard: [ID, string][] = card
      ? [...card.setsUpIds.map((id): [ID, string] => [id, 'this scene sets it up']), ...card.paysOffIds.map((id): [ID, string] => [id, 'this scene pays it off'])]
      : []
    const known = new Map<ID, Pick<Entry, 'name' | 'summary' | 'fields'>>(memory.entries.map((e) => [e.id, e]))
    const missing = onCard.map(([id]) => id).filter((id) => !known.has(id))
    for (const e of missing.length ? repo.getEntries(db, missing) : []) known.set(e.id, e)
    const out: FactsThread[] = []
    for (const [id, when] of onCard) {
      const e = known.get(id)
      if (e && clean(e.name)) out.push({ name: clean(e.name), promise: clean(e.fields?.promise) || clean(e.summary), when })
    }
    for (const t of openThreadsAt(memory, card, MOST_THREADS)) out.push({ name: t.name, promise: t.promise, when: dueForCritic(t.due) })
    return out
  } catch (e) {
    console.warn('Could not read the plot threads for the critique', e)
    return []
  }
}

/** The open must-fix problems in these scenes whose words are still there, oldest first. */
function mustFixFacts(db: DB, texts: (CritiqueText & { title: string })[], chapter: boolean): CritiqueFacts['mustFix'] {
  try {
    const byScene = new Map(texts.map((t) => [t.sceneId, t]))
    return cdb
      .rowsInScenes(
        db,
        texts.map((t) => t.sceneId)
      )
      .filter((r) => r.status === 'open' && r.severity === 'must-fix' && !cdb.isLiveKind(r.kind))
      .filter((r) => {
        const t = byScene.get(r.scene_id as ID)
        const quote = String(r.quote ?? '')
        return !!t && (!quote.trim() || stillThere(t.text, quote))
      })
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .slice(0, MOST_MUST_FIX)
      .map((r) => ({
        where: chapter ? clean(byScene.get(r.scene_id as ID)?.title) || 'Untitled scene' : '',
        quote: String(r.quote ?? ''),
        message: String(r.message ?? '')
      }))
  } catch (e) {
    console.warn('Could not read the open problems for the critique', e)
    return []
  }
}

/** The scene's contract, from the check of its latest draft that had one (checks/report.ts). */
function contractFacts(db: DB, sceneId: ID): CritiqueFacts['contract'] {
  try {
    return (checkReport(db, sceneId)?.contract?.items ?? []).map((i) => ({ part: i.part, text: i.text }))
  } catch {
    return []
  }
}

/** What each scene of a chapter plans on its card (goal, outcome, the threads it sets up or pays off), a line each. */
function sceneCardLines(db: DB, chapter: Chapter, name: (id: ID) => string): string[] {
  const scenes = repo.getOutline(db, chapter.storyId).scenes.filter((s) => s.chapterId === chapter.id)
  return scenes.flatMap((s, i) => {
    const card = repo.getScene(db, s.id).card
    const names = (ids: ID[]): string => ids.map(name).filter(Boolean).join(', ')
    const bits = [
      clean(card.goal) ? `goal: ${clean(card.goal)}` : '',
      clean(card.outcome) ? `outcome: ${clean(card.outcome)}` : '',
      names(card.setsUpIds) ? `sets up ${names(card.setsUpIds)}` : '',
      names(card.paysOffIds) ? `pays off ${names(card.paysOffIds)}` : ''
    ].filter(Boolean)
    return bits.length ? [`Scene ${i + 1} (${clean(s.title) || 'Untitled scene'}): ${bits.join('; ')}`] : []
  })
}

/** What the story says about itself, and the content level and limits in effect. */
function storyFacts(db: DB, story: Story, style: StyleGuide): Pick<CritiqueFacts, 'premise' | 'themes' | 'content' | 'limits'> {
  return {
    premise: story.premise,
    themes: nearest(db, story, story.themes, 'themes'),
    content: intensityLines(style.intensity ?? {}),
    limits: style.contentLimits ?? ''
  }
}

// ---------- The briefing ----------

/** What the reply is kept to (memory.ts guardNotes), and what the new critique carries. */
export interface CritiqueMemory {
  /** The notes last time, sent on a re-read (P1… in order); [] otherwise. */
  previous: CritiqueNote[]
  /** The notes carried from earlier critiques that the reply is kept to. */
  earlier: CritiqueNote[]
  wants: CritiqueWant[]
  /** What the new critique carries (memory.ts carryEarlier). */
  carry: CritiqueNote[]
}

export interface CritiqueBriefing {
  target: CritiqueTarget
  system: string
  drafts: BlockDraft[]
  /** The words it reads, in reading order (the quotes are found in these). */
  texts: CritiqueText[]
  /** The record's scene: the scene itself, or '' for a chapter. */
  sceneId: ID
  memory: CritiqueMemory
}

/**
 * What Adam has said, for one critique: on a re-read, the notes last time (each with what became of it) and what the
 * critique before carried; otherwise what the critique before acted on, set aside or carried. With the parts that tell it.
 */
function memoryFor(db: DB, target: CritiqueTarget, texts: CritiqueText[], again: boolean): { memory: CritiqueMemory; said: string[]; lastTime: string[] } {
  const previous = loadCritique(db, target)
  const storyId = storyOfTarget(db, target)
  const wants = storyId ? loadWants(db, storyId) : []
  const carry = carryEarlier(previous)
  const lastTime = again && previous ? previous.notes : []
  const told = again && previous ? (previous.earlier ?? []) : carry
  const memory: CritiqueMemory = {
    previous: lastTime,
    earlier: again ? (previous?.earlier ?? []) : [...carry, ...(previous?.notes.filter((n) => n.status === 'unwanted') ?? [])],
    wants,
    carry
  }
  const gone = new Set(previous ? goneNotes(previous.notes, texts) : [])
  return { memory, said: saidForms(target.scope, wants, told), lastTime: earlierForms(lastTime, gone) }
}

/**
 * What the critic is told about a scene or a chapter. Throws (plain words) when it is gone or has no words. `again`: a
 * re-read (Critique again, or the chapter writer's later rounds, `o.by`).
 */
export function critiqueBriefing(
  db: DB,
  target: CritiqueTarget,
  prefs: WritingPrefs,
  again = false,
  o: { by?: CritiqueRequest['by'] } = {}
): CritiqueBriefing {
  const texts = targetTexts(db, target)
  const written = texts.filter((t) => t.text.trim())
  const entries = repo.listEntries(db)
  const byId = new Map(entries.map((e) => [e.id, e]))
  const name = (id: ID): string => byId.get(id)?.name ?? ''
  const allText = written.map((t) => t.text).join('\n')
  const castForms = (cast: Entry[]): string[] => [castText(cast, 12, true), castText(cast, 8, false)]
  const ask = (scope: CritiqueTarget['scope'], title: string, earlier: boolean): string =>
    critiqueAsk(scope, title, again, { adam: o.by !== 'chapter-writer', earlier })

  if (target.scope === 'scene') {
    if (!written.length) throw new UserError('This scene has no words yet. Write some first, then ask for a critique.', 'empty')
    const scene = repo.getScene(db, target.id)
    const { chapter, story } = repo.sceneLocation(db, target.id)
    const siblings = repo.getOutline(db, story.id).scenes.filter((s) => s.chapterId === chapter.id)
    const card = scene.card
    const cast = castFor(
      entries,
      allText,
      [card.povId, ...card.presentIds, card.locationId].filter((id): id is ID => !!id)
    )
    const style = effectiveStyle(prefs, repo.getWorldStyle(db), story.style)
    const where = `Chapter: ${chapter.title.trim() || 'Untitled chapter'}, scene ${siblings.findIndex((s) => s.id === scene.id) + 1} of ${siblings.length}.`
    const facts: CritiqueFacts = {
      ...storyFacts(db, story, style),
      card: {
        goal: card.goal,
        conflict: card.conflict,
        outcome: card.outcome,
        beats: card.beats,
        notes: card.notes,
        setsUp: card.setsUpIds.map(name).filter(Boolean),
        paysOff: card.paysOffIds.map(name).filter(Boolean)
      },
      chapterGoal: chapter.goal,
      scenes: [],
      threads: threadFacts(db, scene.id, card),
      contract: contractFacts(db, scene.id),
      mustFix: mustFixFacts(db, written, false)
    }
    const { memory, said, lastTime } = memoryFor(db, target, written, again)
    // The card's plan is in the facts; this part says who, where and when.
    const onCard = cardLines({ ...card, goal: '', conflict: '', outcome: '', beats: [], notes: '', setsUpIds: [], paysOffIds: [] }, name)
    return {
      target,
      system: critiqueSystem('scene'),
      sceneId: scene.id,
      texts: written,
      memory,
      drafts: [
        { id: 'story', title: 'How the story is written', priority: 1, forms: [storyLines({ title: story.title, style, tone: toneOf(db, story) })] },
        { id: 'facts', title: 'Facts to respect', priority: 3, keep: true, forms: factsForms(facts, 'scene') },
        { id: 'said', title: 'What the author has said he wants', priority: 3, keep: true, forms: said },
        { id: 'earlier', title: 'Your notes last time', priority: 3, keep: true, forms: lastTime },
        { id: 'card', title: 'The scene card', priority: 4, forms: [onCard, ''] },
        { id: 'cast', title: 'Who and where', priority: 4, forms: castForms(cast), entryIds: cast.map((e) => e.id) },
        { id: 'where', title: 'Where it sits', priority: 1, forms: [where] },
        { id: 'before', title: 'How the scene before ends', priority: 5, forms: endBefore(db, story.id, scene.id) },
        { id: 'text', title: `The scene: ${scene.title.trim() || 'Untitled scene'}`, priority: 2, forms: sceneTextForms(scene.text) },
        { id: 'ask', title: 'What to do', priority: 0, forms: [ask('scene', scene.title, memory.previous.length > 0)] }
      ]
    }
  }

  if (!written.length) throw new UserError('This chapter has no words yet. Write some first, then ask for a critique.', 'empty')
  const chapter = repo.getChapter(db, target.id)
  const story = repo.getStory(db, chapter.storyId)
  const style = effectiveStyle(prefs, repo.getWorldStyle(db), story.style)
  const card = repo.getChapterCard(db, chapter.id)
  const cast = castFor(
    entries,
    allText,
    [card.povId, ...card.presentIds, card.locationId].filter((id): id is ID => !!id)
  )
  const scenes = written.map((t) => ({ title: t.title, text: t.text, summary: mem.getSummary(db, 'scene', t.sceneId)?.text ?? '' }))
  const unwritten = texts.length - written.length
  const facts: CritiqueFacts = {
    ...storyFacts(db, story, style),
    card: clean(card.notes) ? { goal: '', conflict: '', outcome: '', beats: [], notes: card.notes, setsUp: [], paysOff: [] } : null,
    chapterGoal: chapter.goal,
    scenes: sceneCardLines(db, chapter, name),
    threads: threadFacts(db, written[0].sceneId, null),
    contract: [],
    mustFix: mustFixFacts(db, written, true)
  }
  const { memory, said, lastTime } = memoryFor(db, target, written, again)
  return {
    target,
    system: critiqueSystem('chapter'),
    sceneId: '',
    texts: written,
    memory,
    drafts: [
      { id: 'story', title: 'How the story is written', priority: 1, forms: [storyLines({ title: story.title, style, tone: toneOf(db, story) })] },
      { id: 'facts', title: 'Facts to respect', priority: 3, keep: true, forms: factsForms(facts, 'chapter') },
      { id: 'said', title: 'What the author has said he wants', priority: 3, keep: true, forms: said },
      { id: 'earlier', title: 'Your notes last time', priority: 3, keep: true, forms: lastTime },
      { id: 'card', title: 'The chapter', priority: 4, forms: [chapterCardText(db, chapter.id, name), ''] },
      { id: 'cast', title: 'Who and where', priority: 4, forms: castForms(cast), entryIds: cast.map((e) => e.id) },
      {
        id: 'where',
        title: 'Where it sits',
        priority: 1,
        forms: [
          `${scenes.length} ${scenes.length === 1 ? 'scene' : 'scenes'} with words${unwritten ? ` (${unwritten} more planned, not written yet)` : ''}.`
        ]
      },
      { id: 'before', title: 'How the chapter before ends', priority: 5, forms: endBefore(db, story.id, written[0].sceneId) },
      { id: 'text', title: `The chapter: ${chapter.title.trim() || 'Untitled chapter'}`, priority: 2, forms: chapterTextForms(scenes) },
      { id: 'ask', title: 'What to do', priority: 0, forms: [ask('chapter', chapter.title, memory.previous.length > 0)] }
    ]
  }
}

/** The writer model's name, in the plain words a message about it uses. */
const TOO_LONG = (scope: string): string =>
  `This ${scope} is more than the ${MODEL_NAMES.writer} can read at once, even shortened. Pick a model that can read more in Settings › Models.`

/** Fits the briefing to the model. Throws (plain words) when even its shortest form doesn't fit. */
export function fitCritique(b: CritiqueBriefing, model: Pick<JobModel, 'choice' | 'thinking'>): FittedBriefing {
  let fitted: FittedBriefing
  try {
    fitted = fitBlocks(b.drafts, b.system, briefingBudget(model, CRITIQUE_REPLY), MODEL_NAMES.writer)
  } catch (e) {
    if (e instanceof UserError && e.code === 'briefing-too-long') throw new UserError(TOO_LONG(b.target.scope), 'briefing-too-long')
    throw e
  }
  // The words themselves left out altogether: nothing to critique.
  if (fitted.blocks.find((x) => x.id === 'text')?.dropped) throw new UserError(TOO_LONG(b.target.scope), 'briefing-too-long')
  return fitted
}

const WRONG_FORMAT = "The writer model's critique wasn't in the right format. Try again, or pick another writer model in Settings › Models."

/**
 * Critiques the scene or chapter and keeps the result. Throws (plain words) only before it starts: the target is
 * gone, has no words, or is too long for the model.
 */
export async function runCritique(deps: CritiqueDeps, input: CritiqueRequest): Promise<CritiqueOutcome> {
  const target = cleanTarget(input?.target)
  const taskId = String(input?.taskId ?? '')
  if (!target || !taskId) throw new UserError('Something went wrong starting the critique. Try again.')
  const { db } = deps
  const again = input?.again === true
  const by = input?.by === 'chapter-writer' ? 'chapter-writer' : undefined
  const briefing = critiqueBriefing(db, target, deps.prefs, again, { by })
  const fitted = fitCritique(briefing, deps.model)
  // What the words were when they were read: a critique of words changed since says so.
  const textHash = textsHash(targetTexts(db, target))
  const shortened = !!fitted.blocks.find((x) => x.id === 'text')?.short
  const entries = [...new Set(fitted.blocks.filter((x) => !x.dropped).flatMap((x) => x.entryIds))]
  const versions = new Map(repo.getEntries(db, entries).map((e) => [e.id, e.updatedAt]))

  let messages: ChatMessage[] = [
    { role: 'system', content: briefing.system },
    { role: 'user', content: fitted.text }
  ]
  let raw: RawCritique | null = null
  let generationId: ID | null = null
  for (let attempt = 0; attempt < 2 && !raw; attempt++) {
    // The second asking goes under the same task id (the first has ended), so Stop stops whichever is running.
    const done = await runTask({
      db,
      taskId,
      job: 'critique',
      sceneId: briefing.sceneId,
      model: deps.model,
      messages,
      reply: CRITIQUE_REPLY,
      temperature: CRITIQUE_TEMPERATURE,
      topP: 1,
      direction: target.scope === 'scene' ? 'Critique this scene' : 'Critique this chapter',
      blocks: fitted.blocks,
      entries: entries.map((entryId) => ({ entryId, version: versions.get(entryId) ?? '' })),
      emit: deps.emit,
      onKeyRejected: deps.onKeyRejected,
      fetchImpl: deps.fetchImpl,
      retryDelays: deps.retryDelays
    })
    generationId = done.generationId
    if (done.status === 'stopped') return { status: 'stopped' }
    if (done.status === 'error')
      return { status: 'error', error: done.error ?? 'Something went wrong while the critique was written. Try again.' }
    const reply = readCritiqueReply(done.text)
    if (reply.ok) {
      raw = reply.value
      break
    }
    if (attempt === 1) break
    messages = [
      ...messages,
      { role: 'assistant', content: done.text },
      { role: 'user', content: retryMessage(reply.why, reply.why === CUT_OFF || done.cutOff) }
    ]
  }
  if (!db.open || deps.closed?.()) return { status: 'stopped' }
  if (!raw) return { status: 'error', error: WRONG_FORMAT }
  const { memory } = briefing
  const read = critiqueFrom(raw, briefing.texts, target, memory.previous.length)
  const settledSince = memory.previous.length ? settledCount(memory.previous, read.settled, read.notes) : 0
  const critique: Critique = {
    scope: read.scope,
    targetId: read.targetId,
    summary: read.summary,
    strengths: read.strengths,
    notes: guardNotes(read.notes, memory),
    at: now(),
    textHash,
    shortened,
    generationId,
    ...(again ? { reread: true } : {}),
    ...(by ? { by } : {}),
    ...(settledSince ? { settledSince } : {}),
    ...(memory.carry.length ? { earlier: memory.carry } : {})
  }
  try {
    saveCritique(db, critique)
  } catch (e) {
    console.warn('Could not keep the critique', e)
  }
  return { status: 'complete', critique }
}
