// Build with AI (Adam, 2026-10-20: "I told you I wanted a unified area to build all parts of the story using AI"): the
// logic of the one area, with no React so it is unit-tested. Its sections, in order down the page (Your idea, Cast and
// world, The story line, Threads) and how each stands in a line ("Cast and world · 6 people, 4 places"); which section a
// story opens at (a new one at Your idea, one under way at the story line); where every older way in now lands (the Story
// builder's steps, the outline helper, a chapter's plan, a recipe story's plan, the World builder's summary build); the
// open plot threads in the order the Threads section lists them (overdue, then due, then the quietest); and the words of
// Write this chapter's plan review: its step, its time and cost, what it keeps true, and the name it picked.

import type { ChapterWriterEstimate, ChapterWriterProgress, ChapterWritingPlan } from '@shared/contracts/chapterWriter'
import type { StoryBrief } from '@shared/contracts/storyBuilder'
import type { BoardThread } from '@shared/contracts/worldViews'
import { QUIET_SCENES } from '@shared/contracts/worldViews'
import type { EntryKind, ID, Outline } from '@shared/types'
import type { View } from '@/lib/store'
import { lineChapters, type HubMode } from './hubLogic'

/** The area's sections, in order down the page. */
export type BuildSection = 'idea' | 'cast' | 'line' | 'threads'

export const SECTIONS: readonly { id: BuildSection; label: string }[] = [
  { id: 'idea', label: 'Your idea' },
  { id: 'cast', label: 'Cast and world' },
  { id: 'line', label: 'The story line' },
  { id: 'threads', label: 'Threads' }
]

export const sectionLabel = (id: BuildSection): string => SECTIONS.find((s) => s.id === id)?.label ?? ''

/** What can be open inline at a scene of the story line. */
export type SceneTool = 'ideas' | 'interview'

/** What can be open inline at a chapter of the story line. */
export type ChapterPanel = 'plan' | 'write'

const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`

// ---------- How each section stands ----------

/** Your idea: "written" (with "follows a recipe"), or "not written yet". */
export function ideaStatus(brief: Pick<StoryBrief, 'plot' | 'recipe' | 'mine'> | null, premise = ''): string {
  const written = !!brief?.plot.trim() || !!premise.trim() || (brief?.mine.length ?? 0) > 0
  const words = written ? 'written' : 'not written yet'
  return brief?.recipe ? `${words} · follows a recipe` : words
}

/** The kinds the cast line counts, with their words. */
const CAST_WORDS: [EntryKind, string, string][] = [
  ['character', 'person', 'people'],
  ['place', 'place', 'places'],
  ['group', 'group', 'groups'],
  ['item', 'thing', 'things']
]

/**
 * Cast and world: "6 people, 4 places" (what the world has, the first two kinds that have any), "building…", or what the
 * Story builder's list has planned ("12 planned, not built yet"); "nobody yet" for an empty world.
 */
export function castStatus(
  counts: Partial<Record<EntryKind, number>> | null,
  brief: Pick<StoryBrief, 'codex' | 'built'> | null,
  building = false
): string {
  if (building) return 'building…'
  const have = CAST_WORDS.flatMap(([k, one, many]) => ((counts?.[k] ?? 0) > 0 ? [plural(counts![k]!, one, many)] : []))
  const planned = (brief?.codex ?? []).filter((c) => c.on).length
  if (!brief?.built && planned) return have.length ? `${have.slice(0, 2).join(', ')} · ${planned} more planned` : `${planned} planned, not built yet`
  if (have.length) return have.slice(0, 2).join(', ')
  return counts ? 'nobody yet' : ''
}

/** "Ch 1–2" or "Ch 3". */
const range = (nos: number[]): string => (nos.length === 1 ? `Ch ${nos[0]}` : `Ch ${nos[0]}–${nos[nos.length - 1]}`)

/**
 * The story line: "Ch 1–2 written, Ch 3–4 planned" (a chapter with any words counts as written; chapters after the last
 * written one with scenes count as planned), "nothing planned yet" for a story with only its empty first chapter.
 */
export function lineStatus(outline: Pick<Outline, 'chapters' | 'scenes' | 'acts'>): string {
  const chapters = lineChapters({ acts: [], ...outline } as Outline)
  const plain = (t: string): boolean => /^\s*(chapter|scene)?\s*\d*\s*$/i.test(t)
  const written = chapters.filter((c) => c.words > 0).map((c) => c.no)
  const last = written.length ? written[written.length - 1] : 0
  // The empty "Chapter 1" a story is made with (its one "Scene 1" too) is nothing planned yet.
  const starter = (c: (typeof chapters)[number]): boolean => plain(c.title) && !c.goal.trim() && c.scenes.every((s) => plain(s.title))
  const planned = chapters.filter((c) => c.no > last && c.words === 0 && !(chapters.length === 1 && starter(c))).map((c) => c.no)
  const parts: string[] = []
  if (written.length) parts.push(`${range(written)} written`)
  if (planned.length) parts.push(`${range(planned)} planned`)
  if (!parts.length) return (outline.acts ?? []).length ? `${plural((outline.acts ?? []).length, 'act')} planned` : 'nothing planned yet'
  return parts.join(', ')
}

/** Threads: "3 open, 1 overdue", "2 open", "none open" ('' while not known). */
export function threadsStatus(threads: readonly Pick<BoardThread, 'column' | 'due' | 'warn'>[] | null): string {
  if (!threads) return ''
  const open = threads.filter((t) => t.column === 'open')
  if (!open.length) return 'none open'
  const overdue = open.filter((t) => t.due?.state === 'overdue' || t.warn === 'overdue').length
  return overdue ? `${open.length} open, ${overdue} overdue` : `${open.length} open`
}

/** Where a story opens with no section asked for: a story with nothing yet at Your idea, else at the story line. */
export const defaultSection = (mode: HubMode): BuildSection => (mode === 'start' ? 'idea' : 'line')

// ---------- The threads, in the Threads section's order ----------

/** How urgent a thread is: overdue, due now, quiet for a long stretch, or neither. */
export function threadUrgency(t: Pick<BoardThread, 'due' | 'warn' | 'quietScenes' | 'column'>): 'overdue' | 'due' | 'quiet' | null {
  if (t.due?.state === 'overdue' || t.warn === 'overdue') return 'overdue'
  if (t.due?.state === 'now') return 'due'
  if (t.warn === 'quiet' || (t.column === 'open' && (t.quietScenes ?? 0) >= QUIET_SCENES)) return 'quiet'
  return null
}

const RANK = { overdue: 0, due: 1, quiet: 2 } as const

/** The open threads, overdue first, then due now, then quiet ones, then the rest, the quietest first in each. */
export function openThreadsInOrder<T extends Pick<BoardThread, 'column' | 'due' | 'warn' | 'quietScenes' | 'name'>>(threads: readonly T[]): T[] {
  return threads
    .filter((t) => t.column === 'open')
    .map((t, i) => {
      const u = threadUrgency(t)
      return { t, i, r: u ? RANK[u] : 3 }
    })
    .sort((a, b) => a.r - b.r || (b.t.quietScenes ?? -1) - (a.t.quietScenes ?? -1) || a.i - b.i)
    .map((x) => x.t)
}

/** What "Plan its payoff" puts in the story line's box for a thread. */
export function payoffWords(t: Pick<BoardThread, 'name' | 'promise'>): string {
  const promise = t.promise.replace(/\s+/g, ' ').trim()
  return `Move toward paying off the plot thread “${t.name.trim()}”${promise ? ` (${promise.replace(/[.!?]+$/, '')})` : ''}.`
}

// ---------- Where every older way in lands ----------

/** The area's own view: the story, and what to show first. */
export type BuildView = Extract<View, { kind: 'planHub' }>

/**
 * Where a view lands now that the area holds every AI building tool (Adam, 2026-10-20): the Story builder's steps, the
 * outline helper, a chapter's plan, a recipe story's plan and (with a story open) the World builder's build from a summary
 * open the matching section of Build with AI. Any other view is itself. `storyId`: the story open.
 */
export function buildRoute(view: View, storyId: ID | null): View {
  switch (view.kind) {
    case 'storyBuilder': {
      const section: BuildSection | undefined = view.step === 'idea' ? 'idea' : view.step === 'codex' ? 'cast' : view.step === 'outline' ? 'line' : undefined
      return { kind: 'planHub', storyId: view.storyId, ...(section ? { section } : {}) }
    }
    case 'outline':
      return view.chapterId
        ? { kind: 'planHub', storyId: view.storyId, section: 'line', chapterId: view.chapterId, open: 'plan' }
        : { kind: 'planHub', storyId: view.storyId, section: 'line' }
    case 'recipePlan':
      return { kind: 'planHub', storyId: view.storyId, section: 'line', recipeId: view.recipeId }
    case 'worldBuilder':
      return storyId ? { kind: 'planHub', storyId, section: 'cast', summary: true } : view
    default:
      return view
  }
}

// ---------- Write this chapter ----------

/** Write this chapter's step, from the run's stage: 1 of 3 the plan, 2 of 3 writing, 3 of 3 checking and fixing. */
export function writeStep(stage: ChapterWriterProgress['stage'] | null): { no: 1 | 2 | 3; words: string } {
  if (!stage || stage === 'planning' || stage === 'review' || stage === 'study') return { no: 1, words: 'step 1 of 3: the plan' }
  if (stage === 'drafting') return { no: 2, words: 'step 2 of 3: writing' }
  return { no: 3, words: 'step 3 of 3: checking and fixing' }
}

/** "about 9 cents", "less than a cent", "about $1.20", "free", "cost not known". */
export function costWords(e: Pick<ChapterWriterEstimate, 'cost' | 'free'>): string {
  if (e.free) return 'free'
  if (e.cost == null) return 'cost not known'
  if (e.cost < 0.01) return 'less than a cent'
  if (e.cost < 1) {
    const cents = Math.round(e.cost * 100)
    return `about ${cents} ${cents === 1 ? 'cent' : 'cents'}`
  }
  return `about $${e.cost.toFixed(2)}`
}

/** "About 6 minutes", "About a minute", "About 1 hour 20 minutes". */
export function minutesWords(minutes: number): string {
  const m = Math.max(1, Math.round(minutes))
  if (m === 1) return 'About a minute'
  if (m < 60) return `About ${m} minutes`
  const h = Math.floor(m / 60)
  const rest = Math.round((m - h * 60) / 5) * 5
  return `About ${h === 1 ? '1 hour' : `${h} hours`}${rest ? ` ${rest} minutes` : ''}`
}

/** The review's estimate in a line: "About 6 minutes · about 9 cents" ('' when there is none). */
export function estimateWords(e: ChapterWriterEstimate | null | undefined): string {
  if (!e) return ''
  return `${minutesWords(e.minutes)} · ${costWords(e)}`
}

/**
 * "Kept true from the memory": what the plan holds to, each with where it was set. The plan's own list (the story index's
 * facts, then its scenes' Keep to lines); a plan made before it had one gives its scenes' Keep to lines, each once.
 */
export function keptLines(plan: Pick<ChapterWritingPlan, 'kept' | 'scenes'>, most = 8): string[] {
  if (plan.kept?.length) return plan.kept.slice(0, most)
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of plan.scenes)
    for (const k of s.keep) {
      const key = k.trim().toLowerCase()
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(k.trim())
    }
  return out.slice(0, most)
}

/** "Wren wants", "Against Wren", "How it turns": the three tiles' heads ("What they want" with no name). */
export function threeHeads(lead: string | undefined): { wants: string; against: string; turn: string } {
  const who = lead?.trim()
  return { wants: who ? `${who} wants` : 'What they want', against: who ? `Against ${who}` : 'What stands in the way', turn: 'How it turns' }
}

/** A scene of the plan in the review's words: "1 · The ford" from "Sc 1 “The ford”" (or "Sc 1" alone). */
export function sceneHead(label: string): string {
  const m = /^Sc\s*(\d+)\s*(?:[“"](.*)[”"])?\s*$/.exec(label.trim())
  if (!m) return label.trim()
  return m[2]?.trim() ? `${m[1]} · ${m[2].trim()}` : `Scene ${m[1]}`
}

/** The hint under the chapter name the plan picked. */
export const NAME_HINT = 'Picked to fit your story and its other chapters. Change it, or clear it to keep the chapter as it is.'

/**
 * The chapter's name as Adam kept it, for the answer to the plan: nothing when the plan gave no name or he left it as it
 * was; his words (trimmed, '' when he cleared it, which keeps the title the chapter has) when he changed it.
 */
export function nameAnswer(planned: string | undefined, typed: string): { title?: string } {
  if (planned === undefined) return {}
  const t = typed.replace(/\s+/g, ' ').trim()
  return t === planned.trim() ? {} : { title: t }
}

/** What a scene of the plan does, as the review shows it: its own `does`, else the first line of its part's words. */
export function sceneDoes(s: Pick<ChapterWritingPlan['scenes'][number], 'does' | 'text'>): string {
  if (s.does.trim()) return s.does.trim()
  const first = s.text.split('\n').find((l) => l.trim()) ?? ''
  return first.replace(/^What it must do:\s*/, '').trim()
}
