// Write the whole chapter, step 1 (spec "Write the chapter, reworked", 2026-10-19): the chapter plan. Before any scene is
// written, an agent reads the chapter card and the scene cards with what the story index gives at no cost (everyone on
// the cards as the chapter begins, what has already happened, the open threads), looks up what else it needs with the
// look-up tools (ai/lookups/, answered on this computer, as the chapter begins), and writes the plan with
// write_chapter_plan (or, at its last request, as JSON): for each scene, what it must do, which threads it moves on, what
// changes for each person (where they end up, what they learn), and facts to keep to. The plan is checked (every scene
// of the chapter has a part, in order; lists kept short) and each part made into the words the writer is given and Adam
// reads (partText); Adam may change a part before writing (withAnswer). A chapter whose title is only its number gets a
// name in the plan too, in the style of the story's other chapters (Adam, 2026-10-20), which he may change or clear.
// No Electron imports.

import type Database from 'better-sqlite3'
import type { ChapterPlanAnswer, ChapterWritingPlan, ChapterWritingPlanScene } from '@shared/contracts/chapterWriter'
import type { AgentStep, ChatMessage, EntryState, ID, ToolCall, WritingPrefs } from '@shared/types'
import { namedInProse } from '@shared/names'
import { effectiveStyle } from '@shared/style'
import { CARRY_LABELS } from '@shared/chapterCard'
import * as repo from '../db/repo'
import * as sidx from '../db/storyIndex'
import { pinsForScene } from '../db/memory'
import { runTask, type Emit } from '../ai/tasks'
import type { JobModel } from '../ai/jobModel'
import { answerLookups, LOOKUP_NAMES, LOOKUP_TOOLS, LOOKUPS_MOST, type FoundPassage, type LookupContext } from '../ai/lookups'
import { clip } from '../ai/lookups/text'
import { LOAD_INSTRUCTIONS, loadInstructions, loadInstructionsTool } from '../ai/packs'
import { sceneMemory } from '../memory/scene'
import { buildStoryIndex, indexChecks, openThreads, stateOf } from '../storyIndex'
import { cardLines } from '../outline/context'
import { newId } from '../util'
import {
  NO_MORE_LOOKUPS,
  PLAN_LAST_WORDS,
  PLAN_LOOKUPS,
  PLAN_NUDGE,
  PLAN_PACKS,
  PLAN_PART_MOST,
  PLAN_REPLY,
  PLAN_STEPS,
  PLAN_TEMPERATURE,
  WRITE_CHAPTER_PLAN,
  planSystem
} from './prompts'
import { ownTitle, sceneNamed, type SceneRef } from './tools'

type DB = Database.Database

const squash = (s: unknown): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '')

/** The most of what the planner is given at no cost: each person's lines, everyone's, the scenes before, the threads. */
export const CORE_MOST = { each: 6, people: 30, recent: 14, threads: 8 }

/** What the story index gives the planner at no cost, as the chapter begins. */
export interface ChapterCore {
  /** Everyone on the cards, as the index has them, a few lines each. */
  people: string[]
  /** What happens in the scenes of the last two chapters before this one, a line each. */
  recent: string[]
  /** The plot threads open as the chapter begins. */
  threads: string[]
  /** What the index's free checks find in this chapter's cards (someone on a card after their death, in two places at once). */
  questions: string[]
}

/** Entry names by id. */
export function namesOf(db: DB): (id: ID) => string {
  const byId = new Map(repo.listEntries(db).map((e) => [e.id, e.name]))
  return (id) => byId.get(id) ?? ''
}

/** The people on the chapter's cards (point of view and those there), and on the chapter card, in order. */
export function chapterPeople(db: DB, chapterId: ID, scenes: SceneRef[]): ID[] {
  const card = repo.getChapterCard(db, chapterId)
  const cards = repo.sceneCards(
    db,
    scenes.map((s) => s.id)
  )
  const ids: ID[] = [card.povId, ...card.presentIds].filter((x): x is ID => !!x)
  for (const s of scenes) {
    const c = cards.get(s.id)
    if (c) ids.push(...[c.povId, ...c.presentIds].filter((x): x is ID => !!x))
  }
  return [...new Set(ids)]
}

/**
 * The core for the chapter: the story index brought up to date (cheap when little changed), then everyone on the cards
 * as the first scene begins, the scenes of this chapter's last two before it, the open threads, and the index's free
 * checks on this chapter's cards. Never names what Adam kept out of any of its scenes. Empty when the index can't say.
 */
export function chapterCore(db: DB, storyId: ID, scenes: SceneRef[], people: ID[], hidden: ReadonlySet<ID>): ChapterCore {
  const empty: ChapterCore = { people: [], recent: [], threads: [], questions: [] }
  const first = scenes[0]?.id
  if (!first) return empty
  try {
    buildStoryIndex(db, storyId)
  } catch (e) {
    console.warn('Could not bring the story index up to date for the chapter plan', e)
    return empty
  }
  const point = sidx.indexScene(db, first)
  if (!point || point.storyId !== storyId) return empty
  const hiddenNames = repo
    .listEntries(db)
    .filter((e) => hidden.has(e.id))
    .flatMap((e) => [e.name, ...(e.aliases ?? [])])
    .filter((n) => n.trim().length >= 2)
  const free = (l: string): boolean => !hiddenNames.some((n) => namedInProse(l, n))
  const lines: string[] = []
  for (const id of people.filter((x) => !hidden.has(x))) {
    const now = stateOf(db, storyId, id, first, { asItBegins: true })
    if (!now) continue
    const own = now.lines.filter(free)
    const knows = own.filter((l) => l.startsWith(`${now.name} knows:`))
    const ties = own.filter((l) => l.startsWith(`${now.name} and `))
    const rest = own.filter((l) => !knows.includes(l) && !ties.includes(l))
    lines.push(...[...rest, ...ties.slice(0, 2), ...knows.slice(0, 2)].slice(0, CORE_MOST.each).map((l) => clip(l, 240)))
  }
  const chapterOf = (label: string): number | null => {
    const m = /^Ch (\d+), Sc \d+$/.exec(label)
    return m ? Number(m[1]) : null
  }
  const at = chapterOf(point.label)
  const recent = sidx
    .indexScenesBetween(db, storyId, 1, Math.max(0, point.position - 1))
    .filter((s) => s.gist && (at == null || (chapterOf(s.label) ?? 0) >= at - 2))
    .map((s) => clip(`${s.label}: ${s.gist}`, 320))
    .filter(free)
    .slice(-CORE_MOST.recent)
  const threads = openThreads(db, storyId, first, { asItBegins: true })
    .lines.filter(free)
    .slice(0, CORE_MOST.threads)
    .map((l) => clip(l, 240))
  // The index's free checks, on this chapter's scenes only: questions for Adam before anything is written.
  const ours = new Set(scenes.map((s) => s.id))
  let questions: string[] = []
  try {
    questions = indexChecks(db, storyId)
      .filter((f) => ours.has(f.sceneId))
      .map((f) => `${scenes.find((s) => s.id === f.sceneId)?.label ?? 'A scene'}: ${squash(f.message)}`)
      .filter(free)
  } catch (e) {
    console.warn('Could not run the story index’s checks for the chapter plan', e)
  }
  return { people: lines.slice(0, CORE_MOST.people), recent, threads, questions }
}

// ---------- What the planner is told first ----------

/** The most of the story's chapters the planner is shown by name: the nearest this one, so a long story stays small. */
export const CHAPTER_NAMES_MOST = 12

/** The longest chapter name kept, in characters. */
export const NAME_MOST = 80

/**
 * The story's chapters by name, as the planner is shown them (Adam, 2026-10-20: a chapter written with AI was left
 * "Chapter 3" while the others had names): "Ch 1 “The ferry”", "Ch 2" for one with no name of its own, this chapter
 * marked; at most CHAPTER_NAMES_MOST, the nearest this one, in order. `ask`: this chapter has no name of its own, so the
 * plan names it; `styled`: another chapter has a name, so in their style (else a name that fits the story).
 */
export function chapterNames(db: DB, storyId: ID, chapterId: ID): { lines: string[]; trimmed: boolean; ask: boolean; styled: boolean } {
  const chapters = repo.getOutline(db, storyId).chapters
  const at = chapters.findIndex((c) => c.id === chapterId)
  const own = chapters.map((c) => ownTitle(c.title))
  const ask = at >= 0 && !own[at]
  const styled = own.some((t, i) => i !== at && !!t)
  const near = chapters
    .map((_, i) => i)
    .sort((a, b) => Math.abs(a - at) - Math.abs(b - at) || a - b)
    .slice(0, CHAPTER_NAMES_MOST)
    .sort((a, b) => a - b)
  const lines = near.map((i) => `Ch ${i + 1}${own[i] ? ` “${clip(own[i], NAME_MOST)}”` : ''}${i === at ? ' (this chapter)' : ''}`)
  return { lines, trimmed: near.length < chapters.length, ask, styled }
}

/** The chapter card, a line a part. */
export function chapterCardText(db: DB, chapterId: ID, name: (id: ID) => string): string {
  const chapter = repo.getChapter(db, chapterId)
  const card = repo.getChapterCard(db, chapterId)
  const lines: string[] = []
  const add = (label: string, v: string): void => {
    if (v.trim()) lines.push(`${label}: ${v.trim()}`)
  }
  add('Goal', chapter.goal)
  add(CARRY_LABELS.pov, card.povId ? name(card.povId) : '')
  add(CARRY_LABELS.present, card.presentIds.map(name).filter(Boolean).join(', '))
  add(CARRY_LABELS.location, card.locationId ? name(card.locationId) : '')
  add(CARRY_LABELS.when, card.when)
  add(CARRY_LABELS.mood, card.mood)
  add(CARRY_LABELS.notes, clip(card.notes, 800))
  return lines.join('\n') || '(No chapter card.)'
}

/**
 * The planner's opening: the story, its chapters by name, the chapter and its card, each scene card, then what the index
 * gives; and what to do, with a name for the chapter when it needs one (chapterNames).
 */
export function planOpening(o: {
  db: DB
  storyId: ID
  chapterId: ID
  label: string
  scenes: SceneRef[]
  prefs: WritingPrefs
  core: ChapterCore
}): string {
  const { db } = o
  const story = repo.getStory(db, o.storyId)
  const style = effectiveStyle(o.prefs, repo.getWorldStyle(db), story.style)
  const name = namesOf(db)
  const part = (title: string, body: string): string => (body.trim() ? `## ${title}\n${body.trim()}` : '')
  const list = (l: string[]): string => l.map((x) => `- ${x}`).join('\n')
  const styleLines = [
    `Title: ${story.title.trim() || 'Untitled story'}`,
    style.pov && `Point of view: ${style.pov}`,
    style.tense && `Tense: ${style.tense}`,
    style.proseStyle && `Prose style: ${clip(style.proseStyle, 300)}`
  ].filter(Boolean)
  const cards = repo.sceneCards(
    db,
    o.scenes.map((s) => s.id)
  )
  const names = chapterNames(db, o.storyId, o.chapterId)
  const todo = [
    'Look up anything else the chapter needs, all at once; then call write_chapter_plan with every scene.',
    names.ask
      ? names.styled
        ? "This chapter has no name of its own yet: give it one in `title`, in the same style as the other chapters' names above (their length, form and tone)."
        : 'This chapter has no name of its own yet: give it one in `title`, a few words that fit the story and what this chapter does.'
      : ''
  ]
  return [
    part('The story', styleLines.join('\n')),
    names.lines.length > 1 ? part(`The story's chapters${names.trimmed ? ' (the nearest this one)' : ''}, in order`, list(names.lines)) : '',
    part(`The chapter: ${o.label}`, chapterCardText(db, o.chapterId, name)),
    ...o.scenes.map((s) => {
      const c = cards.get(s.id)
      return `### ${s.label}\n${(c && cardLines(c, name)) || '(The card is empty.)'}`
    }),
    part('Already happened (a line a scene; never plan any of it again)', list(o.core.recent)),
    part('Everyone on the cards, as the chapter begins (from the story so far)', list(o.core.people)),
    part('Open plot threads', list(o.core.threads)),
    part('What may not fit in the cards (found in the story so far)', list(o.core.questions)),
    part('What to do', todo.filter(Boolean).join(' '))
  ]
    .filter(Boolean)
    .join('\n\n')
}

// ---------- The plan, read and checked ----------

/** A plan as the model gave it (tool arguments or JSON), read loosely. */
export interface RawChapterPlan {
  overview: string
  /** Whose chapter, what they want, what is against them, how it turns ('' when not said). */
  lead?: string
  wants?: string
  against?: string
  turn?: string
  scenes: { scene: string; does: string; ends?: string; threads: string[]; changes: { who: string; change: string }[]; keep: string[] }[]
  questions: string[]
  /** A name for the chapter, when the brief asked for one ('' or left out when not). */
  title?: string
}

const texts = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? [v] : [])
    .map((x) => (typeof x === 'string' ? squash(x) : x && typeof x === 'object' ? squash(Object.values(x as Record<string, unknown>).find((y) => typeof y === 'string')) : ''))
    .filter(Boolean)

/** The plan in a tool call's arguments or a reply's JSON; null when there is none. */
export function readChapterPlan(v: unknown): RawChapterPlan | null {
  let o: unknown = v
  if (typeof v === 'string') {
    const body = v.slice(v.indexOf('{'), v.lastIndexOf('}') + 1)
    if (!body) return null
    try {
      o = JSON.parse(body)
    } catch {
      return null
    }
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null
  const r = o as Record<string, unknown>
  if (!Array.isArray(r.scenes)) return null
  const scenes = (r.scenes as unknown[]).flatMap((it) => {
    if (!it || typeof it !== 'object') return []
    const s = it as Record<string, unknown>
    const changes = (Array.isArray(s.changes) ? (s.changes as unknown[]) : []).flatMap((c) => {
      if (typeof c === 'string') {
        const m = /^([^:]{1,60}):\s*(.+)$/.exec(squash(c))
        return m ? [{ who: m[1].trim(), change: m[2].trim() }] : []
      }
      if (!c || typeof c !== 'object') return []
      const x = c as Record<string, unknown>
      const who = squash(x.who ?? x.name)
      const change = squash(x.change ?? x.what ?? x.ends)
      return who && change ? [{ who, change }] : []
    })
    return [
      {
        scene: squash(s.scene),
        does: squash(s.does ?? s.purpose ?? s.what),
        ends: squash(s.ends ?? s.endsWith ?? s.ends_with ?? s.end),
        threads: texts(s.threads),
        changes,
        keep: texts(s.keep)
      }
    ]
  })
  return {
    overview: squash(r.overview),
    lead: squash(r.lead ?? r.who ?? r.pov),
    wants: squash(r.wants ?? r.want ?? r.goal),
    against: squash(r.against ?? r.obstacle ?? r.conflict),
    turn: squash(r.turn ?? r.turns ?? r.twist),
    scenes,
    questions: texts(r.questions),
    title: squash(r.title ?? r.chapterTitle ?? r.chapter_title ?? r.name)
  }
}

/**
 * A chapter name as the planner gave it, made fit to keep: one line, without quotes around it, a "Chapter 3:" or "Ch 3 –"
 * before it, or a full stop after it; at most NAME_MOST characters, cut at a word. '' when nothing is left, or when it
 * only says "Chapter 3".
 */
export function planName(raw: unknown): string {
  let t = squash(raw)
  for (let i = 0; i < 2; i++) {
    t = t
      .replace(/^(?:chapter|ch\.?)\s+[\w-]+\s*[:.\-–—]\s*/i, '')
      .replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, '')
      .replace(/(?<!\.)\.$/, '')
      .trim()
  }
  if (t.length > NAME_MOST) {
    const cut = t.slice(0, NAME_MOST)
    const at = cut.lastIndexOf(' ')
    t = (at > NAME_MOST / 2 ? cut.slice(0, at) : cut).replace(/[\s,;:.\-–—]+$/, '')
  }
  return ownTitle(t)
}

/** A scene's part, in the words the writer is given and Adam reads. */
export function partText(p: Pick<ChapterWritingPlanScene, 'does' | 'threads' | 'changes' | 'keep'> & { ends?: string }): string {
  const lines: string[] = []
  if (p.does.trim()) lines.push(`What it must do: ${p.does.trim()}`)
  if (p.ends?.trim()) lines.push(`Ends with: ${p.ends.trim()}`)
  if (p.threads.length) lines.push(`Threads it moves on:\n${p.threads.map((t) => `- ${t}`).join('\n')}`)
  if (p.changes.length) lines.push(`What changes by its end:\n${p.changes.map((c) => `- ${c.who}: ${c.change}`).join('\n')}`)
  if (p.keep.length) lines.push(`Keep to:\n${p.keep.map((k) => `- ${k}`).join('\n')}`)
  return lines.join('\n')
}

/** What a scene must do when the plan says nothing of it: its card's goal and outcome. */
function fromCard(db: DB, sceneId: ID): string {
  const c = repo.sceneCards(db, [sceneId]).get(sceneId)
  if (!c) return ''
  return [c.goal, c.outcome].map(squash).filter(Boolean).join(' ') || squash(c.beats?.[0]) || squash(c.notes).slice(0, 300)
}

/**
 * The plan checked against the chapter: one part per scene of the chapter, in order (a scene the planner named twice
 * keeps both, one it left out is planned from its card), each list kept short and free of empty lines, and only people
 * who exist (as written in the codex, by name or other name) under what changes. A name for the chapter is kept only when
 * `nameWanted` (chapterNames' `ask`: the chapter has none of its own), made fit by planName. Null when it gives nothing
 * for any scene.
 */
export function checkChapterPlan(
  raw: RawChapterPlan,
  o: { db: DB; scenes: SceneRef[]; people: readonly Pick<EntryState, 'name' | 'aliases'>[]; nameWanted?: boolean }
): ChapterWritingPlan | null {
  const parts = new Map<ID, RawChapterPlan['scenes'][number]>()
  raw.scenes.forEach((s, i) => {
    let id: ID | null = null
    try {
      id = sceneNamed(o.scenes, s.scene)
    } catch {
      // A part with no scene (or one that isn't of this chapter) is taken for the scene at its place.
      id = !s.scene.trim() ? (o.scenes[i]?.id ?? null) : null
    }
    if (!id) return
    const had = parts.get(id)
    parts.set(
      id,
      had
        ? {
            ...had,
            does: [had.does, s.does].filter(Boolean).join(' '),
            ends: s.ends || had.ends,
            threads: [...had.threads, ...s.threads],
            changes: [...had.changes, ...s.changes],
            keep: [...had.keep, ...s.keep]
          }
        : s
    )
  })
  if (!parts.size) return null
  const known = (who: string): string | null => {
    const w = who.toLowerCase()
    const p = o.people.find((e) => [e.name, ...(e.aliases ?? [])].some((n) => n.trim().toLowerCase() === w))
    if (p) return p.name
    const first = o.people.filter((e) => e.name.split(/\s+/)[0].toLowerCase() === w)
    return first.length === 1 ? first[0].name : null
  }
  const uniq = (l: string[]): string[] => [...new Set(l.map(squash).filter(Boolean))]
  const scenes: ChapterWritingPlanScene[] = o.scenes.map((ref) => {
    const p = parts.get(ref.id)
    const changes = (p?.changes ?? [])
      .map((c) => ({ who: known(c.who), change: squash(c.change) }))
      .filter((c): c is { who: string; change: string } => !!c.who && !!c.change)
      .slice(0, PLAN_PART_MOST.changes)
    const part = {
      does: clip(p?.does || fromCard(o.db, ref.id), 600),
      ends: clip(p?.ends ?? '', 300),
      threads: uniq(p?.threads ?? [])
        .slice(0, PLAN_PART_MOST.threads)
        .map((t) => clip(t, 240)),
      changes: changes.map((c) => ({ who: c.who, change: clip(c.change, 240) })),
      keep: uniq(p?.keep ?? [])
        .slice(0, PLAN_PART_MOST.keep)
        .map((k) => clip(k, 240))
    }
    return { sceneId: ref.id, label: ref.label, ...part, text: partText(part) }
  })
  const lead = raw.lead?.trim() ? known(raw.lead.trim()) : null
  const three = { wants: clip(squash(raw.wants), 300), against: clip(squash(raw.against), 300), turn: clip(squash(raw.turn), 300) }
  const title = o.nameWanted ? planName(raw.title) : ''
  return {
    ...(title ? { title } : {}),
    overview: clip(raw.overview, 800),
    ...(lead ? { lead } : {}),
    ...(three.wants ? { wants: three.wants } : {}),
    ...(three.against ? { against: three.against } : {}),
    ...(three.turn ? { turn: three.turn } : {}),
    scenes,
    questions: uniq(raw.questions).slice(0, 8)
  }
}

/** The most "Kept true from the memory" lines a plan shows, and the most of them about one person. */
export const KEPT_MOST = { all: 8, each: 3 }

/**
 * What the plan holds to from the story so far, each with where it was set (Build with AI's plan review, 2026-10-20): the
 * story index's lines for everyone on the cards as the chapter begins (ChapterCore.people: no AI call), the plain facts
 * first (where they are, what they wear and carry, how they are), a few a person, then ties and what they know; then the
 * scenes' own Keep to lines. At most KEPT_MOST.all, each once.
 */
export function keptFacts(core: Pick<ChapterCore, 'people'>, plan: Pick<ChapterWritingPlan, 'scenes'>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const per = new Map<string, number>()
  const add = (line: string, who: string | null): void => {
    const l = squash(line)
    const key = l.toLowerCase()
    if (!l || seen.has(key) || out.length >= KEPT_MOST.all) return
    if (who) {
      const n = per.get(who) ?? 0
      if (n >= KEPT_MOST.each) return
      per.set(who, n + 1)
    }
    seen.add(key)
    out.push(clip(l, 240))
  }
  const plain = (l: string): boolean => !/^[^:]+ knows:/.test(l) && !/^[^:]+ and [^:]+:/.test(l)
  const who = (l: string): string | null => /^(.+?)(?: knows| and [^:]+)?:/.exec(l)?.[1]?.trim() ?? null
  // Only what says where it was set ("since Ch 1, Sc 2", or a scene's label).
  const placed = core.people.filter((l) => /\((?:since )?Ch \d+, Sc \d+\)/.test(l))
  for (const l of placed.filter(plain)) add(l, who(l))
  for (const l of placed.filter((x) => !plain(x))) add(l, who(l))
  for (const s of plan.scenes) for (const k of s.keep) add(k, null)
  return out
}

/** What the chapter does, as the drafts and the report are told it: the overview, then what they want, what is against them, how it turns. */
export function chapterLine(p: Pick<ChapterWritingPlan, 'overview' | 'lead' | 'wants' | 'against' | 'turn'>): string {
  const lead = p.lead?.trim() ?? ''
  return [
    p.overview.trim(),
    p.wants?.trim() ? `${lead || 'The lead'} wants: ${p.wants.trim()}` : '',
    p.against?.trim() ? `Against ${lead || 'them'}: ${p.against.trim()}` : '',
    p.turn?.trim() ? `How it turns: ${p.turn.trim()}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

/** The plan as text: what the chapter does, then each scene's part under its label (the report's, and the record's). */
export function chapterPlanText(p: ChapterWritingPlan): string {
  return [chapterLine(p), ...p.scenes.filter((s) => s.text.trim()).map((s) => `${s.label}:\n${s.text.trim()}`)].filter(Boolean).join('\n\n')
}

/**
 * The plan with Adam's changes: a scene's part he rewrote is his words from then on (what changes keeps only the people
 * his words still name, for the plan check after the draft); a new overview. The chapter's name as he kept it, when the
 * plan named the chapter: cleared (or only "Chapter 3"), the chapter keeps the title it has. Parts he left are as they were.
 */
export function withAnswer(p: ChapterWritingPlan, a: Pick<ChapterPlanAnswer, 'scenes' | 'overview' | 'wants' | 'against' | 'turn' | 'title'>): ChapterWritingPlan {
  const by = new Map((a.scenes ?? []).map((s) => [s.sceneId, typeof s.text === 'string' ? s.text.replace(/\r\n?/g, '\n').trim() : '']))
  // What the chapter does, each part he changed (left out: as it was).
  const own = (v: unknown, was: string | undefined): Partial<Record<'v', string>> => (typeof v === 'string' ? { v: clip(squash(v), 600) } : was !== undefined ? { v: was } : {})
  const three = { wants: own(a.wants, p.wants).v, against: own(a.against, p.against).v, turn: own(a.turn, p.turn).v }
  // His name for the chapter: only where the plan gave one (the review shows the box only then).
  const { title: planned, ...rest } = p
  const title = planned === undefined ? '' : typeof a.title === 'string' ? ownTitle(squash(a.title).slice(0, NAME_MOST).trim()) : planned
  return {
    ...rest,
    ...(title ? { title } : {}),
    overview: typeof a.overview === 'string' ? clip(a.overview.trim(), 2000) : p.overview,
    ...(three.wants !== undefined ? { wants: three.wants } : {}),
    ...(three.against !== undefined ? { against: three.against } : {}),
    ...(three.turn !== undefined ? { turn: three.turn } : {}),
    scenes: p.scenes.map((s) => {
      const text = by.get(s.sceneId)
      if (text === undefined || text === s.text.trim()) return s
      return { ...s, text: clip(text, 4000), changed: true, changes: s.changes.filter((c) => namedInProse(text, c.who)) }
    })
  }
}

// ---------- The session ----------

/** What making the plan needs from the run. */
export interface PlanDeps {
  db: DB
  storyId: ID
  chapterId: ID
  /** "Ch 3 “The crossing”". */
  label: string
  scenes: SceneRef[]
  prefs: WritingPrefs
  model: JobModel
  signal: AbortSignal
  /** Told the task's id as it starts (and null as it ends), so Stop can stop it. */
  onTask: (taskId: ID | null) => void
  taskEmit: Emit
  /** Searches the story so far (find_in_story); left out: the look-up says it isn't available. */
  find?: (sceneId: ID, query: string, most: number) => Promise<FoundPassage[] | null>
  fetchImpl?: typeof fetch
  retryDelays?: number[]
}

export type PlanOutcome =
  | { status: 'complete'; plan: ChapterWritingPlan; core: ChapterCore }
  | { status: 'stopped' }
  | { status: 'error'; error: string | null }

class Mistake extends Error {}

/** The planner at work: its look-ups (at most PLAN_LOOKUPS) and write_chapter_plan, which ends the session. */
class Planner {
  readonly tools = [...LOOKUP_TOOLS, WRITE_CHAPTER_PLAN, loadInstructionsTool(PLAN_PACKS)]
  plan: ChapterWritingPlan | null = null
  private lookups = 0
  private askedAgain = false
  /** The instruction packs sent already (each once). */
  private readonly packs = new Set<string>()

  constructor(
    private readonly o: { db: DB; scenes: SceneRef[]; ctx: LookupContext; people: readonly EntryState[]; nameWanted: boolean }
  ) {}

  ended(): string | null {
    return this.plan ? 'The chapter plan is written.' : null
  }

  async runAll(calls: ToolCall[]): Promise<{ results: ChatMessage[]; steps: AgentStep[] }> {
    const results: ChatMessage[] = []
    const steps: AgentStep[] = []
    const looks: ToolCall[] = []
    const flush = async (): Promise<void> => {
      if (!looks.length) return
      const r = await answerLookups(looks.splice(0), this.o.ctx)
      results.push(...r.results)
      steps.push(...r.steps)
    }
    let inRound = 0
    for (const c of calls) {
      if (LOOKUP_NAMES.includes(c.name)) {
        if (this.plan || this.lookups >= PLAN_LOOKUPS || inRound >= LOOKUPS_MOST) {
          await flush()
          const said = this.plan ? 'The plan is written: nothing more is looked up.' : NO_MORE_LOOKUPS
          results.push({ role: 'tool', toolCallId: c.id, content: said })
          steps.push({ label: 'Not looked up', tool: c.name, arguments: c.arguments.slice(0, 2000), result: said })
          continue
        }
        this.lookups++
        inRound++
        looks.push(c)
        continue
      }
      await flush()
      // An instruction pack (overhaul phase 2): its text, once; not counted as a look-up.
      if (c.name === LOAD_INSTRUCTIONS) {
        const p = loadInstructions(c.arguments, { offered: PLAN_PACKS, loaded: this.packs })
        results.push({ role: 'tool', toolCallId: c.id, content: p.text })
        steps.push({ label: p.label, tool: c.name, arguments: c.arguments.slice(0, 2000), result: p.text.slice(0, 1500) })
        continue
      }
      let result: string
      let label = 'Writing the chapter plan'
      try {
        if (c.name !== WRITE_CHAPTER_PLAN.name) throw new Mistake(`There is no tool called “${c.name}”. Look things up, then call write_chapter_plan.`)
        result = this.write(c.arguments)
      } catch (e) {
        label = 'Not kept'
        result = e instanceof Mistake ? e.message : `That didn't work: ${(e as Error)?.message ?? e}`
      }
      results.push({ role: 'tool', toolCallId: c.id, content: result })
      steps.push({ label, tool: c.name, arguments: c.arguments.slice(0, 2000), result: result.slice(0, 1500) })
    }
    await flush()
    return { results, steps }
  }

  private write(args: string): string {
    if (this.plan) return 'The plan is already written.'
    let v: unknown
    try {
      v = args.trim() ? JSON.parse(args) : {}
    } catch {
      throw new Mistake('The arguments were not valid JSON (or were cut off). Call write_chapter_plan again with valid JSON, keeping each part short.')
    }
    const raw = readChapterPlan(v)
    if (!raw || !raw.scenes.length) throw new Mistake('The plan has no scenes. Give `scenes`: one item for each scene, in order.')
    const missing = this.o.scenes.filter((s) => !raw.scenes.some((x) => sceneMatches(this.o.scenes, x.scene, s.id)))
    // Asked once to cover every scene; a second plan is kept as it is (a scene left out is planned from its card).
    if (missing.length && !this.askedAgain && raw.scenes.some((x) => x.scene.trim())) {
      this.askedAgain = true
      throw new Mistake(`Not kept: these scenes have no part yet: ${missing.map((s) => s.label).join(', ')}. Call write_chapter_plan again with every scene, in order.`)
    }
    const plan = checkChapterPlan(raw, { db: this.o.db, scenes: this.o.scenes, people: this.o.people, nameWanted: this.o.nameWanted })
    if (!plan) throw new Mistake('None of those scenes is in this chapter. Name each as "Sc 1", "Sc 2"…')
    this.plan = plan
    return 'The chapter plan is kept. The author reads it, then each scene is written to its part.'
  }
}

/** True when what the model called a scene names this one. */
function sceneMatches(scenes: SceneRef[], raw: string, id: ID): boolean {
  try {
    return sceneNamed(scenes, raw) === id
  } catch {
    return false
  }
}

/**
 * Makes the chapter plan: the planner with its look-ups, through the task runner's agent loop (job 'chapter', the chapter
 * writer model), its last request asking for the plan as JSON. A plan it never writes is made from the cards alone (with
 * a question saying so), so the run goes on; a call that fails says so.
 */
export async function makeChapterPlan(d: PlanDeps): Promise<PlanOutcome> {
  const { db } = d
  const first = d.scenes[0]?.id
  if (!first) return { status: 'error', error: 'This chapter has no scenes to plan.' }
  const hidden = new Set<ID>()
  for (const s of d.scenes) for (const p of pinsForScene(db, s.id)) if (p.action === 'hide') hidden.add(p.entryId)
  const peopleIds = chapterPeople(db, d.chapterId, d.scenes)
  const core = chapterCore(db, d.storyId, d.scenes, peopleIds, hidden)
  const memory = sceneMemory(db, first)
  const people = memory.entries.filter((e) => e.kind === 'character' && !hidden.has(e.id))
  const name = namesOf(db)
  const ctx: LookupContext = {
    db,
    sceneId: first,
    storyId: d.storyId,
    asItBegins: true,
    entries: memory.entries,
    facts: memory.facts,
    relationships: memory.relationships,
    people: peopleIds.filter((id) => !hidden.has(id)).map(name).filter(Boolean),
    hidden,
    ...(d.find ? { find: (query: string, most: number) => d.find!(first, query, most) } : {})
  }
  // A chapter with only its number for a title is named in the plan (chapterNames).
  const nameWanted = chapterNames(db, d.storyId, d.chapterId).ask
  const planner = new Planner({ db, scenes: d.scenes, ctx, people, nameWanted })
  const messages: ChatMessage[] = [
    { role: 'system', content: planSystem() },
    { role: 'user', content: planOpening({ db, storyId: d.storyId, chapterId: d.chapterId, label: d.label, scenes: d.scenes, prefs: d.prefs, core }) }
  ]
  const taskId = newId()
  d.onTask(taskId)
  let done: Awaited<ReturnType<typeof runTask>>
  try {
    done = await runTask({
      background: true,
      db,
      taskId,
      job: 'chapter',
      sceneId: first,
      model: d.model,
      messages,
      reply: PLAN_REPLY,
      temperature: PLAN_TEMPERATURE,
      direction: `Planning ${d.label}`,
      emit: d.taskEmit,
      agent: {
        tools: planner.tools,
        maxSteps: PLAN_STEPS,
        run: (calls) => planner.runAll(calls),
        lastWords: () => PLAN_LAST_WORDS,
        // Words that are the plan's JSON are kept as it; anything else is sent back once.
        nudge: (answer) => (planner.plan || readChapterPlan(answer)?.scenes.length ? null : PLAN_NUDGE),
        maxNudges: 1,
        ended: () => planner.ended(),
        dropBeforeTools: () => true
      },
      fetchImpl: d.fetchImpl,
      retryDelays: d.retryDelays
    })
  } finally {
    d.onTask(null)
  }
  if (done.status === 'stopped' || d.signal.aborted) return { status: 'stopped' }
  if (done.status === 'error') return { status: 'error', error: done.error ?? null }
  let plan = planner.plan
  if (!plan) {
    const raw = readChapterPlan(done.text)
    plan = raw ? checkChapterPlan(raw, { db, scenes: d.scenes, people, nameWanted }) : null
  }
  if (!plan) {
    // Never written: each scene is planned from its card, and Adam is told.
    plan = checkChapterPlan({ overview: '', scenes: d.scenes.map((s) => ({ scene: s.label, does: '', threads: [], changes: [], keep: [] })), questions: [] }, { db, scenes: d.scenes, people })!
    plan.questions.push('The AI couldn’t make a plan for this chapter, so each scene is planned from its card alone.')
  }
  // The index's free checks on the cards, before the planner's own questions.
  plan.questions = [...new Set([...core.questions, ...plan.questions])].slice(0, 10)
  // What it holds to from the story so far, for Adam to see (no AI call).
  plan.kept = keptFacts(core, plan)
  return { status: 'complete', plan, core }
}
