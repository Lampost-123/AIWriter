// The briefing for the outline helper and next scene ideas, as plain-text parts ("blocks", shown in
// "What the AI saw"). Each part can have shorter forms; `fitBlocks` picks the longest forms that fit the
// model, shortening the least important parts first. Pure: the facts come from context.ts.

import type { ContextBlock, EntryKind, ID } from '@shared/types'
import { KIND_LABELS } from '@shared/fields'
import { estimateTokens } from '../keeper/text'
import { UserError } from '../util'

// ---------- The facts a briefing is made from ----------

export interface StoryFacts {
  title: string
  premise: string
  themes: string
  tone: string
  series: { name: string; themes: string; tone: string } | null
  world: { themes: string; tone: string }
}

export interface PlanScene {
  id: ID
  title: string
  /** Its summary, once it has words; '' before. */
  summary: string
  /** From its card. */
  goal: string
  beats: string[]
  /** Its card's When ("Day 3, dusk"); '' or left out when it has none. */
  when?: string
  words: number
}

export interface PlanChapter {
  id: ID
  title: string
  goal: string
  /** Its summary, once its scenes have words. */
  summary: string
  scenes: PlanScene[]
}

/** An act and its chapters; `id` null for the chapters with no act (they come first). */
export interface PlanAct {
  id: ID | null
  title: string
  purpose: string
  chapters: PlanChapter[]
}

export interface CastLine {
  id: ID
  name: string
  kind: EntryKind
  summary: string
  /** The entry's updatedAt, for "What the AI saw". */
  version: string
}

export interface ThreadLine {
  id: ID
  name: string
  summary: string
  /** Where it was set up, in plain words ("Book 1, Ch 2, Sc 1"); '' when not known. */
  setUp: string
  version: string
}

/** One part of a briefing, with its forms from longest to shortest ('' leaves it out). */
export interface BlockDraft {
  id: string
  title: string
  /** 0 and 1 are never shortened; higher numbers are shortened first. */
  priority: number
  forms: string[]
  entryIds?: ID[]
}

// ---------- Small helpers ----------

const clean = (s: string | undefined | null): string => (s ?? '').replace(/\s+/g, ' ').trim()
const sentence = (s: string): string => (/[.!?…:;]["'”’)\]]*$/.test(s) ? s : `${s}.`)

/** The first `n` sentences of a text, on one line. */
export function firstSentences(text: string, n: number): string {
  const t = clean(text)
  const parts = t.match(/[^.!?…]+[.!?…]+["'”’)\]]*\s*|[^.!?…]+$/g) ?? [t]
  return parts.slice(0, n).join('').trim()
}

const titleOf = (title: string, fallback: string): string => clean(title) || fallback

// ---------- The story ----------

export function storyText(s: StoryFacts): string {
  const lines = [`Title: ${titleOf(s.title, 'Untitled story')}`]
  const add = (label: string, v: string): void => {
    if (clean(v)) lines.push(`${label}: ${v.trim()}`)
  }
  add('Premise', s.premise)
  add('Themes', s.themes)
  add('Tone', s.tone)
  if (s.series) {
    lines.push(`Part of the series: ${titleOf(s.series.name, 'Untitled series')}`)
    add('Series themes', s.series.themes)
    add('Series tone', s.series.tone)
  }
  add('World themes', s.world.themes)
  add('World tone', s.world.tone)
  return lines.join('\n')
}

// ---------- What the story has so far ----------

const sceneLine = (sc: PlanScene, detail: boolean): string => {
  const what = clean(sc.summary) || clean(sc.goal)
  const when = clean(sc.when)
  const head = `- ${titleOf(sc.title, 'Untitled scene')}${when ? ` (When: ${when})` : ''}${what ? `: ${sentence(what)}` : ''}${sc.words > 0 || clean(sc.summary) ? '' : ' (planned, not written yet)'}`
  const beats = sc.beats.map(clean).filter(Boolean)
  return detail && beats.length && !clean(sc.summary) ? `${head} Beats: ${beats.map((b) => sentence(b)).join(' ')}` : head
}

const actHeading = (a: PlanAct): string =>
  `Act: ${titleOf(a.title, 'Untitled act')}${clean(a.purpose) ? `. Purpose: ${sentence(clean(a.purpose))}` : ''}`
const chapterHeading = (c: PlanChapter): string =>
  `Chapter: ${titleOf(c.title, 'Untitled chapter')}${clean(c.goal) ? `. Goal: ${sentence(clean(c.goal))}` : ''}`

/**
 * The story's acts, chapters and scenes as they stand. Level 0 gives every scene (its summary, or its
 * card while it has no words); 1 gives each chapter by its summary and only the last two chapters'
 * scenes; 2 only acts and chapters with their goals, and the last chapter's scenes; 3 only the last
 * six chapters' titles. Empty when the story has nothing yet.
 */
export function planText(plan: PlanAct[], level: number): string {
  const chapters = plan.flatMap((a) => a.chapters)
  if (!chapters.length && !plan.some((a) => a.id)) return ''
  const total = chapters.length
  const lines: string[] = []
  if (level >= 3) {
    const shown = chapters.slice(-6)
    if (shown.length < total) lines.push(`(${total - shown.length} earlier chapters left out to save space.)`)
    for (const c of shown) lines.push(chapterHeading(c))
    return lines.join('\n')
  }
  let index = 0
  for (const a of plan) {
    if (a.id) lines.push(actHeading(a))
    if (a.id && !a.chapters.length) lines.push('  (no chapters yet)')
    for (const c of a.chapters) {
      const fromEnd = total - ++index
      const pad = a.id ? '  ' : ''
      lines.push(`${pad}${chapterHeading(c)}`)
      const inDetail = level === 0 || (level === 1 && fromEnd < 2) || (level === 2 && fromEnd < 1)
      if (inDetail) {
        for (const sc of c.scenes) lines.push(`${pad}  ${sceneLine(sc, level === 0 || fromEnd < 1)}`)
      } else if (level === 1) {
        const told = clean(c.summary)
        if (told) lines.push(`${pad}  Summary: ${told}`)
        else if (c.scenes.length) lines.push(`${pad}  Scenes: ${c.scenes.map((s) => titleOf(s.title, 'Untitled scene')).join('; ')}`)
      }
    }
  }
  return lines.join('\n')
}

/** The When of the story's last scene that has one, in reading order: '' when none has. */
export function latestWhen(plan: PlanAct[]): string {
  const scenes = plan.flatMap((a) => a.chapters).flatMap((c) => c.scenes)
  for (let i = scenes.length - 1; i >= 0; i--) {
    const when = clean(scenes[i].when)
    if (when) return when
  }
  return ''
}

// ---------- Around one scene (next scene ideas) ----------

interface Spot {
  chapters: { act: PlanAct; chapter: PlanChapter }[]
  /** Index of the scene's chapter in `chapters`, and of the scene in it. */
  ci: number
  si: number
}

function findSpot(plan: PlanAct[], sceneId: ID): Spot | null {
  const chapters = plan.flatMap((act) => act.chapters.map((chapter) => ({ act, chapter })))
  for (let ci = 0; ci < chapters.length; ci++) {
    const si = chapters[ci].chapter.scenes.findIndex((s) => s.id === sceneId)
    if (si >= 0) return { chapters, ci, si }
  }
  return null
}

/** A scene title Adam hasn't changed from the one it was given ("Scene 3"), or none. */
export const isPlainSceneTitle = (title: string): boolean => /^(scene\s*\d*|untitled scene)?$/i.test(clean(title))

/** Where the scene is: the story, its act and chapter (with their purpose and goal) and its place in the chapter. */
export function placeText(plan: PlanAct[], sceneId: ID, storyTitle: string): string {
  const spot = findSpot(plan, sceneId)
  if (!spot) return `Story: ${titleOf(storyTitle, 'Untitled story')}`
  const { act, chapter } = spot.chapters[spot.ci]
  const scene = chapter.scenes[spot.si]
  const lines = [`Story: ${titleOf(storyTitle, 'Untitled story')}`]
  if (act.id) lines.push(actHeading(act))
  lines.push(
    `Chapter ${spot.ci + 1} of ${spot.chapters.length}: ${titleOf(chapter.title, 'Untitled chapter')}${clean(chapter.goal) ? `. Goal: ${sentence(clean(chapter.goal))}` : ''}`
  )
  const named = isPlainSceneTitle(scene.title) ? '' : `, titled “${clean(scene.title)}”`
  lines.push(`This is scene ${spot.si + 1} of ${chapter.scenes.length} in the chapter${named}.`)
  return lines.join('\n')
}

const THIS_SCENE = '- (this scene: the one to plan)'

/**
 * The outline around the scene. Level 0: the chapter before, this chapter's scenes (this one marked)
 * and the next two chapters with their scenes; 1: this chapter and the next chapter's heading; 2: only
 * the scenes just before and after it. Empty when there is nothing around it.
 */
export function aroundText(plan: PlanAct[], sceneId: ID, level: number): string {
  const spot = findSpot(plan, sceneId)
  if (!spot) return ''
  const { chapters, ci, si } = spot
  const here = chapters[ci].chapter
  const lines: string[] = []
  if (level >= 2) {
    const before = here.scenes[si - 1]
    const after = here.scenes[si + 1]
    if (before) lines.push(`Just before it: ${sceneLine(before, true).slice(2)}`)
    if (after) lines.push(`Just after it: ${sceneLine(after, true).slice(2)}`)
    return lines.join('\n')
  }
  const prev = chapters[ci - 1]?.chapter
  if (prev && level === 0) {
    lines.push(`The chapter before: ${chapterHeading(prev)}`)
    if (clean(prev.summary)) lines.push(`  Summary: ${clean(prev.summary)}`)
    else for (const sc of prev.scenes.slice(-3)) lines.push(`  ${sceneLine(sc, false)}`)
  }
  lines.push(`This chapter: ${chapterHeading(here)}`)
  here.scenes.forEach((sc, i) => lines.push(`  ${i === si ? THIS_SCENE : sceneLine(sc, true)}`))
  const next = chapters.slice(ci + 1, ci + (level === 0 ? 3 : 2))
  if (next.length) {
    lines.push('After this chapter:')
    for (const { act, chapter } of next) {
      const newAct = act.id && act.id !== chapters[ci].act.id ? ` (in the act “${titleOf(act.title, 'Untitled act')}”)` : ''
      lines.push(`  ${chapterHeading(chapter)}${newAct}`)
      if (level === 0) for (const sc of chapter.scenes) lines.push(`    ${sceneLine(sc, false)}`)
    }
  }
  return lines.join('\n')
}

// ---------- Earlier stories, threads, people and places ----------

export interface EarlierStory {
  title: string
  meanwhile: boolean
  text: string
}

/** One paragraph for each earlier story on this story's line; `sentences` cuts each short. */
export function earlierText(stories: EarlierStory[], sentences = 0): string {
  return stories
    .filter((s) => clean(s.text))
    .map(
      (s) =>
        `${s.meanwhile ? 'Meanwhile: ' : ''}${titleOf(s.title, 'An earlier story')}: ${sentences ? firstSentences(s.text, sentences) : clean(s.text)}`
    )
    .join('\n\n')
}

export function threadsText(threads: ThreadLine[], short = false): string {
  return threads
    .map((t) => {
      if (short) return `- ${titleOf(t.name, 'Unnamed thread')}`
      const about = clean(t.summary)
      return `- ${titleOf(t.name, 'Unnamed thread')}${about ? `: ${sentence(firstSentences(about, 2))}` : ''}${clean(t.setUp) ? ` (set up in ${clean(t.setUp)})` : ''}`
    })
    .join('\n')
}

const kindWord = (kind: EntryKind): string => KIND_LABELS[kind]?.one.toLowerCase() ?? 'entry'

/** People and places: `limit` lines, each with its one-liner unless `namesOnly`. */
export function castText(cast: CastLine[], limit: number, namesOnly = false): string {
  const shown = cast.slice(0, limit)
  if (namesOnly) return shown.map((c) => `${titleOf(c.name, 'Unnamed')} (${kindWord(c.kind)})`).join('; ')
  const lines = shown.map((c) => {
    const about = clean(c.summary)
    return `- ${titleOf(c.name, 'Unnamed')} (${kindWord(c.kind)})${about ? `: ${sentence(firstSentences(about, 1))}` : ''}`
  })
  if (cast.length > shown.length) lines.push(`(and ${cast.length - shown.length} more not listed here)`)
  return lines.join('\n')
}

// ---------- Fitting it to the model ----------

export const blockAsSent = (b: Pick<ContextBlock, 'title' | 'text'>): string => `## ${b.title}\n${b.text}`

export interface FittedBriefing {
  blocks: ContextBlock[]
  /** The user message: every part sent, in order. */
  text: string
  tokens: number
}

/**
 * Picks each part's longest form that lets the whole briefing (with `system`) fit in `budget` tokens,
 * shortening the least important parts first (the last of equals first). Parts of priority 0 and 1 are
 * never shortened; when even those don't fit, says so in plain words.
 */
export function fitBlocks(drafts: BlockDraft[], system: string, budget: number, modelName: string): FittedBriefing {
  const parts = drafts.filter((d) => d.forms.some((f) => clean(f)))
  const pick = parts.map(() => 0)
  const textOf = (i: number): string => parts[i].forms[pick[i]] ?? ''
  const costOf = (i: number): number => (textOf(i).trim() ? estimateTokens(blockAsSent({ title: parts[i].title, text: textOf(i) })) + 2 : 0)
  const costs = parts.map((_, i) => costOf(i))
  const base = estimateTokens(system) + 16
  let total = base + costs.reduce((a, b) => a + b, 0)
  while (total > budget) {
    let best = -1
    for (let i = 0; i < parts.length; i++) {
      // A part one past its last form is left out altogether.
      if (parts[i].priority <= 1 || pick[i] >= parts[i].forms.length) continue
      if (best < 0 || parts[i].priority >= parts[best].priority) best = i
    }
    if (best < 0) {
      throw new UserError(
        `This is more than the ${modelName} can read at once. Pick a model that can read more in Settings › Models.`,
        'briefing-too-long'
      )
    }
    // One step shorter; past the last form, the part is left out.
    pick[best]++
    total -= costs[best]
    costs[best] = pick[best] < parts[best].forms.length ? costOf(best) : 0
    total += costs[best]
  }
  const blocks: ContextBlock[] = parts.map((p, i) => {
    const text = pick[i] < p.forms.length ? (p.forms[pick[i]] ?? '').trim() : ''
    const full = p.forms[0].trim()
    return {
      id: p.id,
      priority: Math.max(1, Math.min(10, p.priority || 1)),
      title: p.title,
      text: text || full,
      tokens: estimateTokens(text || full),
      entryIds: p.entryIds ?? [],
      dropped: !text,
      short: !!text && pick[i] > 0,
      hasShort: p.forms.filter((f) => f.trim()).length > 1
    }
  })
  const sent = blocks.filter((b) => !b.dropped)
  return { blocks, text: sent.map(blockAsSent).join('\n\n'), tokens: total }
}
