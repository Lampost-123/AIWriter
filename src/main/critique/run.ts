// One critique of a scene or a chapter (contracts/critique.ts), when Adam asks: gathers a lean briefing (how the story
// is written, the card, who is in it, how the scene or chapter before ends, and the words), fits it to the writer
// model (outline/brief.ts fitBlocks: the least important parts shorten first, then a long chapter's scenes, down to
// their summaries), asks once (a reply that can't be read is asked for once more, saying what was wrong), reads the
// notes against the words (parse.ts) and keeps the result as the latest for that scene or chapter (store.ts). It is a
// 'critique' record made by the shared task runner, so it streams, can be stopped and shows in "What the AI saw".
// Never writes once stopped or once the world has closed. No Electron imports.

import type Database from 'better-sqlite3'
import type { Critique, CritiqueOutcome, CritiqueRequest, CritiqueTarget } from '@shared/contracts/critique'
import type { ChatMessage, Entry, ID, WritingPrefs } from '@shared/types'
import { CARRY_LABELS } from '@shared/chapterCard'
import { effectiveStyle } from '@shared/style'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { sceneTail } from '../ai/context'
import { MODEL_NAMES, type JobModel } from '../ai/jobModel'
import { runTask, type Emit } from '../ai/tasks'
import { CUT_OFF } from '../keeper/json'
import { fitBlocks, type BlockDraft, type FittedBriefing } from '../outline/brief'
import { cardLines } from '../outline/context'
import { briefingBudget } from '../outline/jobs'
import { now, UserError } from '../util'
import { critiqueFrom, readCritiqueReply, type CritiqueText, type RawCritique } from './parse'
import {
  CRITIQUE_REPLY,
  CRITIQUE_TEMPERATURE,
  castFor,
  castText,
  chapterTextForms,
  critiqueAsk,
  critiqueSystem,
  retryMessage,
  sceneTextForms,
  storyLines
} from './prompts'
import { cleanTarget, saveCritique, targetTexts, textsHash } from './store'

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

/** The tone in effect for a story: its own, else its series', else the world's. */
function toneOf(db: DB, story: { tone: string; seriesId: ID | null }): string {
  const series = story.seriesId ? repo.listSeries(db).find((s) => s.id === story.seriesId) : undefined
  return [story.tone, series?.tone, repo.getMeta(db, 'tone') ?? ''].map((t) => (t ?? '').trim()).find(Boolean) ?? ''
}

/** The scene or chapter before this point in the story: the end of its words, for judging how this one opens. */
function endBefore(db: DB, storyId: ID, firstSceneId: ID): string {
  const scenes = repo.getOutline(db, storyId).scenes
  const at = scenes.findIndex((s) => s.id === firstSceneId)
  for (let i = at - 1; i >= 0; i--) {
    const text = repo.getScene(db, scenes[i].id).text ?? ''
    if (text.trim()) return sceneTail(text, { min: 90, target: 120, max: 160 })
  }
  return ''
}

/** A chapter card's lines (with the chapter's goal), names for its ids. */
function chapterCardText(db: DB, chapterId: ID, goal: string, name: (id: ID) => string): string {
  const card = repo.getChapterCard(db, chapterId)
  const lines: string[] = []
  const add = (label: string, v: string): void => {
    if (v.trim()) lines.push(`${label}: ${v.trim()}`)
  }
  add('Goal', goal)
  add(CARRY_LABELS.pov, card.povId ? name(card.povId) : '')
  add(CARRY_LABELS.present, card.presentIds.map(name).filter(Boolean).join(', '))
  add(CARRY_LABELS.location, card.locationId ? name(card.locationId) : '')
  add(CARRY_LABELS.when, card.when)
  add(CARRY_LABELS.mood, card.mood)
  add(CARRY_LABELS.notes, card.notes.slice(0, 800))
  return lines.join('\n')
}

export interface CritiqueBriefing {
  target: CritiqueTarget
  system: string
  drafts: BlockDraft[]
  /** The words it reads, in reading order (the quotes are found in these). */
  texts: CritiqueText[]
  /** The record's scene: the scene itself, or '' for a chapter. */
  sceneId: ID
}

/** What the critic is told about a scene or a chapter. Throws (plain words) when it is gone or has no words. */
export function critiqueBriefing(db: DB, target: CritiqueTarget, prefs: WritingPrefs): CritiqueBriefing {
  const texts = targetTexts(db, target)
  const written = texts.filter((t) => t.text.trim())
  const entries = repo.listEntries(db)
  const byId = new Map(entries.map((e) => [e.id, e]))
  const name = (id: ID): string => byId.get(id)?.name ?? ''
  const allText = written.map((t) => t.text).join('\n')
  const castForms = (cast: Entry[]): string[] => [castText(cast, 12, true), castText(cast, 8, false)]

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
    return {
      target,
      system: critiqueSystem('scene'),
      sceneId: scene.id,
      texts: written,
      drafts: [
        {
          id: 'story',
          title: 'How the story is written',
          priority: 1,
          forms: [storyLines({ title: story.title, style, tone: toneOf(db, story) })]
        },
        { id: 'card', title: 'The scene card', priority: 3, forms: [cardLines(card, name), ''] },
        { id: 'cast', title: 'Who and where', priority: 4, forms: castForms(cast), entryIds: cast.map((e) => e.id) },
        { id: 'where', title: 'Where it sits', priority: 1, forms: [where] },
        { id: 'before', title: 'How the scene before ends', priority: 5, forms: [endBefore(db, story.id, scene.id)] },
        { id: 'text', title: `The scene: ${scene.title.trim() || 'Untitled scene'}`, priority: 2, forms: sceneTextForms(scene.text) },
        { id: 'ask', title: 'What to do', priority: 0, forms: [critiqueAsk('scene', scene.title)] }
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
  return {
    target,
    system: critiqueSystem('chapter'),
    sceneId: '',
    texts: written,
    drafts: [
      {
        id: 'story',
        title: 'How the story is written',
        priority: 1,
        forms: [storyLines({ title: story.title, style, tone: toneOf(db, story) })]
      },
      { id: 'card', title: 'The chapter', priority: 3, forms: [chapterCardText(db, chapter.id, chapter.goal, name), ''] },
      { id: 'cast', title: 'Who and where', priority: 4, forms: castForms(cast), entryIds: cast.map((e) => e.id) },
      {
        id: 'where',
        title: 'Where it sits',
        priority: 1,
        forms: [
          `${scenes.length} ${scenes.length === 1 ? 'scene' : 'scenes'} with words${unwritten ? ` (${unwritten} more planned, not written yet)` : ''}.`
        ]
      },
      { id: 'before', title: 'How the chapter before ends', priority: 5, forms: [endBefore(db, story.id, written[0].sceneId)] },
      { id: 'text', title: `The chapter: ${chapter.title.trim() || 'Untitled chapter'}`, priority: 2, forms: chapterTextForms(scenes) },
      { id: 'ask', title: 'What to do', priority: 0, forms: [critiqueAsk('chapter', chapter.title)] }
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
  const briefing = critiqueBriefing(db, target, deps.prefs)
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
  const critique: Critique = {
    ...critiqueFrom(raw, briefing.texts, target),
    at: now(),
    textHash,
    shortened,
    generationId
  }
  try {
    saveCritique(db, critique)
  } catch (e) {
    console.warn('Could not keep the critique', e)
  }
  return { status: 'complete', critique }
}
