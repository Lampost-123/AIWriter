// What the outline helper and next scene ideas are told, read from the open world's database: the
// story, what it already has (acts, chapters, scenes, with their summaries and cards), the earlier
// stories on its line, the plot threads still open and the people and places that exist by then. The
// memory decides what exists and what is still open, as it does for drafting. No Electron imports.

import type Database from 'better-sqlite3'
import type { EntryKind, EntryState, ID, SceneCard, Story, ThreadState } from '@shared/types'
import * as repo from '../db/repo'
import * as acts from '../db/acts'
import * as mem from '../db/memory'
import { memoryAt } from '../memory/asOf'
import { sceneMemory } from '../memory/scene'
import type { SceneMemory } from '../memory/types'
import {
  latestWhen,
  planText,
  type CastLine,
  type EarlierStory,
  type PlanAct,
  type PlanChapter,
  type StoryFacts,
  type ThreadLine
} from './brief'

type DB = Database.Database

export function storyFacts(db: DB, story: Story, premise?: string): StoryFacts {
  const series = story.seriesId ? (repo.listSeries(db).find((s) => s.id === story.seriesId) ?? null) : null
  return {
    title: story.title,
    premise: premise ?? story.premise,
    themes: story.themes,
    tone: story.tone,
    series: series ? { name: series.name, themes: series.themes, tone: series.tone } : null,
    world: { themes: repo.getMeta(db, 'themes') ?? '', tone: repo.getMeta(db, 'tone') ?? '' }
  }
}

/** The story's acts, chapters and scenes as they stand, with summaries and cards: the chapters with no act first. */
export function storyPlan(db: DB, storyId: ID): PlanAct[] {
  const o = repo.getOutline(db, storyId)
  const cards = acts.storyCards(db, storyId)
  const said = new Map(mem.storySummaries(db, storyId).map((s) => [`${s.level}:${s.targetId}`, s.text]))
  const chapter = (c: (typeof o.chapters)[number]): PlanChapter => ({
    id: c.id,
    title: c.title,
    goal: c.goal,
    summary: said.get(`chapter:${c.id}`) ?? '',
    scenes: o.scenes
      .filter((s) => s.chapterId === c.id)
      .map((s) => ({
        id: s.id,
        title: s.title,
        summary: said.get(`scene:${s.id}`) ?? '',
        goal: cards.get(s.id)?.goal ?? '',
        beats: cards.get(s.id)?.beats ?? [],
        when: cards.get(s.id)?.when ?? '',
        words: s.wordCount
      }))
  })
  const out: PlanAct[] = []
  const loose = o.chapters.filter((c) => !c.actId)
  if (loose.length) out.push({ id: null, title: '', purpose: '', chapters: loose.map(chapter) })
  for (const a of o.acts ?? [])
    out.push({ id: a.id, title: a.title, purpose: a.purpose, chapters: o.chapters.filter((c) => c.actId === a.id).map(chapter) })
  return out
}

/** A chapter or scene title as it was made ("Chapter 1", "Scene 1"). */
const MADE_TITLE = /^\s*(chapter|scene)\s*\d*\s*$/i

/**
 * Nothing planned or written yet: at most the empty "Chapter 1" and "Scene 1" a new story is made with
 * (titles as made, no acts, words, goals, summaries or beats). The outline helper then plans the story
 * from its premise rather than carrying on after them, as its page says (features/outline/OutlineHelper.tsx).
 */
export function isBlankPlan(plan: PlanAct[]): boolean {
  const chapters = plan.flatMap((a) => a.chapters)
  const scenes = chapters.flatMap((c) => c.scenes)
  return (
    !plan.some((a) => a.id) &&
    chapters.length <= 1 &&
    scenes.length <= 1 &&
    chapters.every((c) => MADE_TITLE.test(c.title) && !c.goal.trim() && !c.summary.trim()) &&
    scenes.every((s) => MADE_TITLE.test(s.title) && s.words === 0 && !s.summary.trim() && !s.goal.trim() && !s.beats.some((b) => b.trim()))
  )
}

const CAST_KINDS: EntryKind[] = ['character', 'place', 'group', 'item']

/**
 * The people, places, groups and items that exist at the point: those in `first` (the scene card), then
 * those named in `text`, then characters before places, groups and items, then the latest changed.
 */
export function castLines(entries: EntryState[], text: string, first: ID[] = []): CastLine[] {
  const lower = text.toLowerCase()
  const named = (e: EntryState): boolean =>
    [e.name, ...e.aliases].some((n) => {
      const w = n.trim().toLowerCase()
      return w.length > 1 && lower.includes(w)
    })
  const score = (e: EntryState): number => (first.includes(e.id) ? 2 : named(e) ? 1 : 0)
  return entries
    .filter((e) => CAST_KINDS.includes(e.kind) && e.name.trim())
    .map((e) => ({ e, s: score(e), k: CAST_KINDS.indexOf(e.kind) }))
    .sort((a, b) => b.s - a.s || a.k - b.k || (a.e.updatedAt < b.e.updatedAt ? 1 : a.e.updatedAt > b.e.updatedAt ? -1 : 0))
    .map(({ e }) => ({ id: e.id, name: e.name, kind: e.kind, summary: e.summary || e.description, version: e.updatedAt }))
}

/** The plot threads still open at the point, with what they are and where they were set up. */
export function openThreads(threads: ThreadState[], byId: Map<ID, EntryState>): ThreadLine[] {
  return threads
    .filter((t) => t.status === 'open')
    .flatMap((t) => {
      const e = byId.get(t.entryId)
      // What it promises the reader first (2026-10-08); a thread only planned isn't "set up" anywhere yet.
      if (!e) return []
      const about = (e.fields?.promise ?? '').trim() || e.summary || e.description
      return [{ id: e.id, name: e.name, summary: about, setUp: t.planned ? '' : t.setUp, version: e.updatedAt }]
    })
}

const earlierOf = (m: Pick<SceneMemory, 'storySoFar'>): EarlierStory[] =>
  m.storySoFar.stories.map((s) => ({ title: s.title, meanwhile: s.meanwhile, text: s.text }))

export interface OutlineFacts {
  story: StoryFacts
  plan: PlanAct[]
  earlier: EarlierStory[]
  threads: ThreadLine[]
  cast: CastLine[]
  /** The story's last act, which chapters carry on when no new acts are asked for. */
  lastAct: string | null
  chapterCount: number
  /** The When of the story's last scene that has one ('' when none has), so the new scenes' days carry on from it. */
  latestWhen: string
}

/** Everything the outline helper tells the AI about a story, as of its end. */
export function outlineFacts(db: DB, storyId: ID, premise: string): OutlineFacts {
  const story = repo.getStory(db, storyId)
  const shape = storyPlan(db, storyId)
  // A new story's empty "Chapter 1" is nothing to carry on from.
  const plan = isBlankPlan(shape) ? [] : shape
  const acted = plan.filter((a) => a.id)
  let entries: EntryState[] = []
  let threads: ThreadLine[] = []
  try {
    const at = memoryAt(db, { kind: 'end', storyId })
    entries = [...at.state.entries.values()]
    threads = openThreads(at.state.threads, at.state.entries)
  } catch (e) {
    // The plan still helps without the memory.
    console.warn('The outline helper could not read the memory', e)
  }
  // The earlier stories are read from the story's first scene, even an empty one.
  const firstScene = shape.flatMap((a) => a.chapters).flatMap((c) => c.scenes)[0]
  let earlier: EarlierStory[] = []
  if (firstScene) {
    try {
      earlier = earlierOf(sceneMemory(db, firstScene.id, { forWriter: true }))
    } catch (e) {
      console.warn('The outline helper could not read the earlier stories', e)
    }
  }
  return {
    story: storyFacts(db, story, premise),
    plan,
    earlier,
    threads,
    cast: castLines(entries, `${premise}\n${planText(plan, 0)}`),
    lastAct: acted.length ? acted[acted.length - 1].title || 'Untitled act' : null,
    chapterCount: plan.reduce((n, a) => n + a.chapters.length, 0),
    // Read from the whole story: the empty "Scene 1" a new story is made with may have a When already.
    latestWhen: latestWhen(shape)
  }
}

export interface IdeasFacts {
  story: StoryFacts
  plan: PlanAct[]
  storyTitle: string
  sceneId: ID
  /** What is already on the scene's card (who, where, when, mood, notes, threads), one line each. */
  card: string
  memory: SceneMemory
  threads: ThreadLine[]
  cast: CastLine[]
}

/** The card's who, where and when (and anything else on it) in plain lines, with names for its ids. */
function cardLines(card: SceneCard, name: (id: ID) => string): string {
  const lines: string[] = []
  const add = (label: string, v: string): void => {
    if (v.trim()) lines.push(`${label}: ${v.trim()}`)
  }
  const names = (ids: ID[]): string => ids.map(name).filter(Boolean).join(', ')
  add('Point of view', card.povId ? name(card.povId) : '')
  add('Characters present', names(card.presentIds.filter((id) => id !== card.povId)))
  add('Location', card.locationId ? name(card.locationId) : '')
  add('When', card.when)
  add('Goal', card.goal)
  add('Conflict', card.conflict)
  add('Outcome', card.outcome)
  add('Beats', card.beats.join('; '))
  add('Mood or tone', card.mood)
  add('Notes', card.notes)
  add('Sets up', names(card.setsUpIds))
  add('Pays off', names(card.paysOffIds))
  return lines.join('\n')
}

/**
 * Everything next scene ideas (and a scene's interview) tell the AI about one scene, as of just before it.
 * `onScreen`: the card as the window shows it, in place of the saved one.
 */
export function ideasFacts(db: DB, sceneId: ID, onScreen?: SceneCard | null): IdeasFacts {
  const { story } = repo.sceneLocation(db, sceneId)
  const saved = repo.getScene(db, sceneId)
  const scene = onScreen ? { ...saved, card: { ...saved.card, ...onScreen } } : saved
  const plan = storyPlan(db, story.id)
  const memory = sceneMemory(db, sceneId, { forWriter: true })
  const byId = new Map(memory.entries.map((e) => [e.id, e]))
  const onCard = [
    scene.card.povId,
    ...scene.card.presentIds,
    scene.card.locationId,
    ...scene.card.setsUpIds,
    ...scene.card.paysOffIds
  ].filter((id): id is ID => !!id)
  const missing = onCard.filter((id) => !byId.has(id))
  const others = new Map(missing.length ? repo.getEntries(db, missing).map((e) => [e.id, e.name]) : [])
  const name = (id: ID): string => byId.get(id)?.name ?? others.get(id) ?? ''
  const around = plan
    .flatMap((a) => a.chapters)
    .flatMap((c) => [c.title, c.goal, c.summary, ...c.scenes.flatMap((s) => [s.title, s.goal, s.summary, ...s.beats])])
    .join('\n')
  return {
    story: storyFacts(db, story),
    plan,
    storyTitle: story.title,
    sceneId,
    card: cardLines(scene.card, name),
    memory,
    threads: openThreads(memory.threads, byId),
    cast: castLines(memory.entries, `${around}\n${memory.previous?.text.slice(-3000) ?? ''}`, onCard)
  }
}
