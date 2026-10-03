// What the New story dialog and story settings work out on their own: the four kinds and their help,
// the start and end choices from a story's chapters and scenes, the time-gap label, and the style the AI
// gets for a story with where each rule comes from. No React, so it is unit-tested.
import type { StoryPlacement } from '@shared/api'
import type { StoryFlowStatus } from '@shared/contracts/storyFlows'
import { genreLabel } from '@shared/genres'
import { INTENSITY, intensityStep } from '@shared/intensity'
import { effectiveStyle, STYLE_TEXT_KEYS, type StyleSource } from '@shared/style'
import type { ID, Outline, StartAt, Story, StoryKind, StyleGuide, WritingPrefs } from '@shared/types'

/** The four answers to "What is it?", each with one sentence of help (spec: "The four kinds"). */
export const KINDS: { kind: StoryKind; label: string; help: string }[] = [
  { kind: 'continues', label: 'Continues after', help: 'Starts after that story ends and knows everything before it.' },
  { kind: 'side', label: 'Side story during', help: 'Runs alongside that story. Later books know what happened in it.' },
  { kind: 'prequel', label: 'Prequel to', help: 'Set before that book but written after it. The book stays as written.' },
  {
    kind: 'own',
    label: 'Own version of events',
    help: 'A what-if, or a story that shares only the setting. Nothing in it reaches other stories.'
  }
]

/** What a story is now, as a placement to edit. */
export const placementOf = (s: Story): StoryPlacement => ({
  kind: s.kind,
  startStoryId: s.startStoryId,
  startAt: s.startAt,
  startRefId: s.startRefId,
  endAt: s.endAt,
  endRefId: s.endRefId,
  leadsIntoId: s.leadsIntoId
})

export const samePlacement = (a: StoryPlacement, b: StoryPlacement): boolean =>
  a.kind === b.kind &&
  (a.startStoryId ?? null) === (b.startStoryId ?? null) &&
  (a.startStoryId ? a.startAt === b.startAt && (a.startRefId ?? null) === (b.startRefId ?? null) : true) &&
  (a.kind === 'side' ? (a.endAt ?? 'end') === (b.endAt ?? 'end') && (a.endRefId ?? null) === (b.endRefId ?? null) : true)

// ---------- Start and end choices ----------

/** A point in a story as one select value: 'post', 'end', 'chapter:<id>' or 'scene:<id>'. */
export type PointValue = string

export const pointValue = (at: StartAt, refId: ID | null): PointValue =>
  at === 'chapter' || at === 'scene' ? `${at}:${refId ?? ''}` : at === 'pre' ? 'post' : at

export function readPoint(v: PointValue): { at: StartAt; refId: ID | null } {
  const [at, ...rest] = v.split(':')
  if (at === 'chapter' || at === 'scene') return { at, refId: rest.join(':') || null }
  return { at: at === 'end' ? 'end' : 'post', refId: null }
}

export interface PointOption {
  value: PointValue
  label: string
}

const isDefault = (title: string, word: string, n: number): boolean => !title.trim() || title.trim() === `${word} ${n}`

/** "After Ch 2" or "After Ch 2: The ferry", "After Ch 2, Sc 1" or "After Ch 2, Sc 1: Ashore". */
function afterLabels(outline: Outline): { chapters: Map<ID, string>; scenes: Map<ID, string> } {
  const chapters = new Map<ID, string>()
  const scenes = new Map<ID, string>()
  outline.chapters.forEach((c, ci) => {
    const n = ci + 1
    chapters.set(c.id, `After Ch ${n}${isDefault(c.title, 'Chapter', n) ? '' : `: ${c.title.trim()}`}`)
    outline.scenes
      .filter((s) => s.chapterId === c.id)
      .forEach((s, si) =>
        scenes.set(s.id, `After Ch ${n}, Sc ${si + 1}${isDefault(s.title, 'Scene', si + 1) ? '' : `: ${s.title.trim()}`}`)
      )
  })
  return { chapters, scenes }
}

/**
 * Where a story can start in another: its beginning, after each chapter (each followed by its scenes),
 * and for an own version of events its end too. A side story's start excludes the end (it would have
 * nothing left to run alongside).
 */
export function startOptions(outline: Outline | null, kind: StoryKind): PointOption[] {
  const out: PointOption[] = [{ value: 'post', label: 'At its beginning' }]
  if (outline) {
    const { chapters, scenes } = afterLabels(outline)
    for (const c of outline.chapters) {
      for (const s of outline.scenes.filter((x) => x.chapterId === c.id)) out.push({ value: `scene:${s.id}`, label: scenes.get(s.id)! })
      out.push({ value: `chapter:${c.id}`, label: chapters.get(c.id)! })
    }
  }
  if (kind !== 'side') out.push({ value: 'end', label: 'After its end' })
  return out
}

/**
 * Where a side story can end in its book: its end, or after a chapter at or after where it starts. One
 * that starts at its book's end (it took over a deleted story's start) can only end there too.
 */
export function endOptions(outline: Outline | null, start: PointValue): PointOption[] {
  const out: PointOption[] = [{ value: 'end', label: 'At its end' }]
  const { at, refId } = readPoint(start)
  if (!outline || at === 'end') return out
  const from =
    at === 'chapter'
      ? outline.chapters.findIndex((c) => c.id === refId)
      : at === 'scene'
        ? outline.chapters.findIndex((c) => c.id === outline.scenes.find((s) => s.id === refId)?.chapterId)
        : 0
  const { chapters } = afterLabels(outline)
  outline.chapters.forEach((c, i) => {
    if (i >= Math.max(0, from)) out.push({ value: `chapter:${c.id}`, label: chapters.get(c.id)!.replace(/^After/, 'At the end of') })
  })
  return out
}

/** A side story's end as a select value, kept only while it is still at or after the start. */
export function endValue(p: StoryPlacement, outline: Outline | null): PointValue {
  const v = p.endAt === 'chapter' && p.endRefId ? `chapter:${p.endRefId}` : 'end'
  return endOptions(outline, pointValue(p.startAt, p.startRefId)).some((o) => o.value === v) ? v : 'end'
}

// ---------- Changing kind ----------

/**
 * The placement when Adam picks another kind: it keeps the story it was placed against where that
 * makes sense ("Continues after Book 2" to "Side story during Book 2, from its beginning").
 * `fallback` is the story to use when there is none (the last book on the shelf).
 */
export function switchKind(p: StoryPlacement, kind: StoryKind, fallback: ID | null, firstBook: ID | null): StoryPlacement {
  const base = { startRefId: null, endAt: null, endRefId: null, leadsIntoId: null }
  const story = p.startStoryId ?? fallback
  switch (kind) {
    case 'continues':
      return { ...base, kind, startStoryId: story, startAt: 'end' }
    case 'side':
      return { ...base, kind, startStoryId: story, startAt: 'post', endAt: 'end' }
    case 'prequel':
      return { ...base, kind, startStoryId: p.kind === 'prequel' ? p.startStoryId : (firstBook ?? story), startAt: 'pre' }
    case 'own':
      return { ...base, kind, startStoryId: null, startAt: 'end' }
  }
}

/** The placement with another story to start in: back to its beginning (or end, for "Continues after"). */
export function withStartStory(p: StoryPlacement, storyId: ID | null): StoryPlacement {
  const at: StartAt = p.kind === 'continues' ? 'end' : p.kind === 'prequel' ? 'pre' : p.kind === 'side' ? 'post' : 'end'
  return {
    ...p,
    startStoryId: storyId,
    startAt: at,
    startRefId: null,
    endAt: p.kind === 'side' ? 'end' : null,
    endRefId: null,
    leadsIntoId: null
  }
}

/** The placement with a new start point (a side story's end goes back to its book's end if it would now come first). */
export function withStart(p: StoryPlacement, v: PointValue, outline: Outline | null): StoryPlacement {
  const { at, refId } = readPoint(v)
  const next = { ...p, startAt: at, startRefId: refId }
  if (p.kind !== 'side') return next
  const end = endValue(next, outline)
  return end === 'end' ? { ...next, endAt: 'end', endRefId: null } : next
}

export function withEnd(p: StoryPlacement, v: PointValue): StoryPlacement {
  const { at, refId } = readPoint(v)
  return at === 'chapter' ? { ...p, endAt: 'chapter', endRefId: refId } : { ...p, endAt: 'end', endRefId: null }
}

/** The label of the time-gap field, naming the story it comes after; null when there is none to come after. */
export function gapLabel(p: StoryPlacement, stories: Pick<Story, 'id' | 'title'>[]): string | null {
  if (p.kind === 'side' || p.kind === 'prequel' || !p.startStoryId) return null
  const title = stories.find((s) => s.id === p.startStoryId)?.title.trim()
  if (!title) return null
  return p.startAt === 'end' ? `Time since ${title} ended` : 'Time since that point'
}

/** Why there is no time gap to fill in, for the quiet line the New story dialog shows in its place. */
export function noGapReason(p: StoryPlacement): string {
  if (p.kind === 'side') return 'A side story runs alongside its story, so there is no time gap to fill in.'
  if (p.kind === 'prequel') return 'A prequel is set before its book, so there is no time gap to fill in.'
  if (!p.startStoryId) return 'It starts at the beginning of the world, so there is no time gap to fill in.'
  return 'There is no time gap to fill in.'
}

/** The first book of a series on the shelf, for "Prequel to" (a story that starts in another series' book counts). */
export function firstBookOf(stories: Story[], seriesId: ID | null): ID | null {
  const inSeries = stories.filter((s) => s.seriesId === seriesId && s.kind === 'continues')
  const byId = new Map(stories.map((s) => [s.id, s]))
  const first = inSeries.find((s) => !s.startStoryId || byId.get(s.startStoryId)?.seriesId !== seriesId)
  return first?.id ?? inSeries[0]?.id ?? null
}

/**
 * The stories in reading order, as the main process sends it (shelf order is reading order). Any the
 * order doesn't list yet, such as a story just made, keep their place after the others.
 */
export function inShelfOrder<T extends { id: ID }>(stories: T[], order: ID[]): T[] {
  const at = new Map(order.map((id, i) => [id, i]))
  return stories
    .map((s, i) => ({ s, key: at.get(s.id) ?? order.length + i }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.s)
}

// ---------- The style the AI gets ----------

export type StyleTag = 'My preferences' | 'World' | 'This story'

export interface StyleRule {
  key: string
  label: string
  value: string
  tag: StyleTag
}

const TAGS: Record<Exclude<StyleSource, 'none'>, StyleTag> = { prefs: 'My preferences', world: 'World', story: 'This story' }

const LABELS: Record<(typeof STYLE_TEXT_KEYS)[number], string> = {
  pov: 'Point of view',
  tense: 'Tense',
  proseStyle: 'Prose style',
  samplePassage: 'Sample passage',
  contentLimits: 'Content limits',
  notes: 'Notes',
  genreNotes: 'Genre notes'
}

/**
 * Every rule of the style guide the AI gets for a story (Adam's preferences, then the world's guide,
 * then the story's own, each overriding the one before), tagged with where it comes from. Phrases to
 * avoid add up, so each level that asks for some has its own row, listing those it adds.
 */
export function styleRules(prefs: WritingPrefs, world: StyleGuide, story: Partial<StyleGuide>): StyleRule[] {
  const s = effectiveStyle(prefs, world, story)
  const rules: StyleRule[] = []
  const push = (key: string, label: string, value: string, source: StyleSource): void => {
    if (source !== 'none' && value.trim()) rules.push({ key, label, value: value.trim(), tag: TAGS[source] })
  }
  push('pov', LABELS.pov, s.pov, s.sources.pov)
  push('tense', LABELS.tense, s.tense, s.sources.tense)
  push('spelling', 'Spelling', s.spelling ? `${s.spelling} spelling` : '', s.sources.spelling)
  push('genres', s.genres.length > 1 ? 'Genres' : 'Genre', genreLabel(s.genres), s.sources.genres)
  push('genreNotes', LABELS.genreNotes, s.genreNotes, s.sources.genreNotes)
  const levels = INTENSITY.flatMap(({ scale, label }) => {
    const step = intensityStep(s.intensity, scale)
    return step ? [`${label}: ${step.label}`] : []
  })
  push('intensity', 'Content', levels.join(' · '), s.sources.intensity)
  for (const key of ['proseStyle', 'samplePassage', 'contentLimits', 'notes'] as const) push(key, LABELS[key], s[key], s.sources[key])
  const seen = new Set<string>()
  const phraseLevels: [string[] | undefined, StyleSource][] = [
    [prefs?.avoidWords, 'prefs'],
    [world?.avoidPhrases, 'world'],
    [story?.avoidPhrases, 'story']
  ]
  for (const [list, source] of phraseLevels) {
    const added: string[] = []
    for (const raw of Array.isArray(list) ? list : []) {
      const phrase = typeof raw === 'string' ? raw.trim() : ''
      if (!phrase || seen.has(phrase.toLocaleLowerCase())) continue
      seen.add(phrase.toLocaleLowerCase())
      added.push(phrase)
    }
    if (added.length) push(`avoid:${source}`, 'Phrases to avoid', added.join(', '), source)
  }
  return rules
}

// ---------- The story flows' quiet line ----------

const NUMBER = /^(\d[\d,.]*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds|thousands)\b/i
const SPAN = /^(a|an|some|several|many|a few|a couple of|about|almost|nearly|over|more than)\b/i
const UNIT = /\b(days?|nights?|weeks?|fortnights?|months?|seasons?|years?|decades?|century|centuries|generations?|ages?|winters?|summers?|springs?|autumns?|lifetimes?)$/i

/**
 * What a time gap's flow is doing, before the flow says so itself: "in the 200 years", "over a decade",
 * "over the winter" (from "1 winter"); anything that isn't plainly a length of time is left out.
 */
function gapWorking(gap: string): string {
  const said = gap
    .trim()
    .replace(/[.!]+$/, '')
    .replace(/\s+(later|after|on|afterwards|have passed|has passed|passed)$/i, '')
    .trim()
  const what = said.charAt(0).toLowerCase() + said.slice(1)
  if (!what || what.length > 40 || !UNIT.test(what)) return 'Working out what changed before this story starts…'
  const one = /^(1|one)\s+([a-z]+)$/i.exec(what)
  if (one) return `Working out what changed over the ${one[2].toLowerCase()}…`
  if (NUMBER.test(what)) return `Working out what changed in the ${what}…`
  if (SPAN.test(what)) return `Working out what changed ${/^over\b/i.test(what) ? '' : 'over '}${what}…`
  return 'Working out what changed before this story starts…'
}

/**
 * The quiet line for a story flow in story settings: what it is doing ("Working out what changed in the
 * 200 years…"), then the result ("Added 4 changes"), or what went wrong. A running flow says what it is
 * doing itself; until it does, `about` (what it was started about: the time gap, or for "When did these
 * happen?" the book that now continues after the story) says it here.
 */
export function flowLine(status: Pick<StoryFlowStatus, 'flow' | 'state' | 'message'>, about = ''): string {
  const message = status.message?.trim()
  if (status.state === 'running') {
    if (message) return message
    if (status.flow === 'time-gap') return gapWorking(about)
    if (status.flow === 'starting-cast') return 'Drafting how each of them starts…'
    return `Working out when the changes at the start of ${about.trim() || 'the next book'} happened…`
  }
  if (status.state === 'failed') return message || 'That didn’t work. Try again in a moment.'
  return message || 'Done.'
}

/** Whether a flow ended because Adam stopped it ("Stopped. Nothing was changed."): no tick for that. */
export const flowStopped = (status: Pick<StoryFlowStatus, 'state' | 'message'>): boolean =>
  status.state === 'done' && /^Stopped\b/.test(status.message?.trim() ?? '')
