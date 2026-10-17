// The Story builder's brief (contracts/storyBuilder.ts): kept in the world's meta table under `story_brief:<storyId>`
// as JSON, cleaned whenever it is read or written (a hand-edited or older one never breaks the page). Also how the
// brief, the story's style and its recipe are told to the AI. No Electron imports.

import type Database from 'better-sqlite3'
import type { BriefAnswer, BriefEntry, CodexItem, StoryBrief, StoryLength } from '@shared/contracts/storyBuilder'
import { emptyBrief } from '@shared/contracts/storyBuilder'
import type { RecipeParts } from '@shared/contracts/recipes'
import { RECIPE_PARTS } from '@shared/contracts/recipes'
import type { EntryKind, ID, Story, WritingPrefs } from '@shared/types'
import { ENTRY_KINDS, KIND_LABELS } from '@shared/fields'
import { genreLabel } from '@shared/genres'
import { intensityLines } from '@shared/intensity'
import { effectiveStyle } from '@shared/style'
import * as repo from '../db/repo'

type DB = Database.Database

export const briefKey = (storyId: ID): string => `story_brief:${storyId}`

const LIMITS = { plot: 40_000, text: 6000, entries: 60, answers: 30, codex: 300 }

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const kindOf = (v: unknown): EntryKind | null => (typeof v === 'string' && (ENTRY_KINDS as string[]).includes(v) ? (v as EntryKind) : null)
const LENGTHS: StoryLength[] = ['', 'short', 'novella', 'novel']

function cleanEntry(v: unknown): BriefEntry | null {
  if (!isObject(v)) return null
  const kind = kindOf(v.kind) ?? 'character'
  const name = str(v.name, 120)
  const about = str(v.about, 2000)
  return name.trim() || about.trim() ? { kind, name, about } : null
}

function cleanAnswer(v: unknown): BriefAnswer | null {
  if (!isObject(v)) return null
  const answer = str(v.answer, 3000)
  return answer.trim() ? { topic: str(v.topic, 80), question: str(v.question, 400), answer } : null
}

/** One codex item as the window sent it (or as it was kept), with every part checked; null when it has no name. */
export function cleanCodexItem(v: unknown, i = 0): CodexItem | null {
  if (!isObject(v)) return null
  const kind = kindOf(v.kind)
  const name = str(v.name, 120).trim()
  if (!kind || !name) return null
  const existing = isObject(v.existing) && typeof v.existing.entryId === 'string' ? { entryId: v.existing.entryId, name: str(v.existing.name, 120) } : null
  return {
    key: str(v.key, 60) || `k${i}`,
    kind,
    name,
    aliases: Array.isArray(v.aliases) ? v.aliases.map((a) => str(a, 120).trim()).filter(Boolean).slice(0, 8) : [],
    about: str(v.about, 1200),
    in: kind === 'place' ? str(v.in, 120) : '',
    rule: kind === 'lore' && v.rule === true,
    when: kind === 'event' ? str(v.when, 160) : '',
    role: kind === 'character' ? str(v.role, 160) : '',
    mine: v.mine === true,
    on: v.on !== false,
    existing
  }
}

export const cleanCodex = (v: unknown): CodexItem[] =>
  Array.isArray(v) ? v.slice(0, LIMITS.codex).flatMap((x, i) => cleanCodexItem(x, i) ?? []) : []

function cleanTweaks(v: unknown): Partial<RecipeParts> {
  const out: Partial<RecipeParts> = {}
  if (!isObject(v)) return out
  for (const k of RECIPE_PARTS) if (typeof v[k] === 'string') out[k] = str(v[k], 12_000)
  return out
}

/** A brief as kept or sent, with every part checked. */
export function cleanBrief(v: unknown): StoryBrief {
  const b = emptyBrief()
  if (!isObject(v)) return b
  b.plot = str(v.plot, LIMITS.plot)
  b.setting = str(v.setting, LIMITS.text)
  b.mustHappen = str(v.mustHappen, LIMITS.text)
  b.avoid = str(v.avoid, LIMITS.text)
  b.length = LENGTHS.includes(v.length as StoryLength) ? (v.length as StoryLength) : ''
  b.mine = Array.isArray(v.mine) ? v.mine.slice(0, LIMITS.entries).flatMap((e) => cleanEntry(e) ?? []) : []
  b.answers = Array.isArray(v.answers) ? v.answers.slice(0, LIMITS.answers).flatMap((a) => cleanAnswer(a) ?? []) : []
  b.recipe = isObject(v.recipe) && typeof v.recipe.id === 'string' && v.recipe.id ? { id: v.recipe.id, tweaks: cleanTweaks(v.recipe.tweaks) } : null
  b.codex = v.codex === null || v.codex === undefined ? null : cleanCodex(v.codex)
  b.built =
    isObject(v.built) && typeof v.built.buildId === 'string'
      ? { buildId: v.built.buildId, runId: typeof v.built.runId === 'string' ? v.built.runId : null, at: str(v.built.at, 40) }
      : null
  return b
}

export function readBrief(db: DB, storyId: ID): StoryBrief {
  const raw = repo.getMeta(db, briefKey(storyId))
  if (!raw) return emptyBrief()
  try {
    return cleanBrief(JSON.parse(raw))
  } catch {
    return emptyBrief()
  }
}

export function writeBrief(db: DB, storyId: ID, brief: unknown): void {
  const text = JSON.stringify(cleanBrief(brief))
  if (repo.getMeta(db, briefKey(storyId)) === text) return
  repo.setMeta(db, briefKey(storyId), text)
}

/** A recipe as this story uses it: the recipe's parts, with Adam's changes for this story on top. */
export function recipeAsUsed(recipe: { name: string; parts: RecipeParts } | null, brief: StoryBrief): { name: string; parts: RecipeParts } | null {
  if (!recipe || !brief.recipe) return null
  return { name: recipe.name, parts: { ...recipe.parts, ...brief.recipe.tweaks } }
}

const LENGTH_WORDS: Record<Exclude<StoryLength, ''>, string> = {
  short: 'a short story or novelette',
  novella: 'a novella',
  novel: 'a full-length novel'
}

const line = (label: string, v: string): string => (v.trim() ? `${label}: ${v.trim()}` : '')

/** The author's idea for the story, as every Story builder request is told it (their words, labelled). */
export function briefText(brief: StoryBrief, story: Pick<Story, 'title' | 'premise'>): string {
  const parts: string[] = []
  if (story.title.trim() && !/^untitled/i.test(story.title.trim())) parts.push(`Title: ${story.title.trim()}`)
  if (story.premise.trim()) parts.push(`Premise: ${story.premise.trim()}`)
  if (brief.plot.trim()) parts.push(`The plot, in the author's own words:\n${brief.plot.trim()}`)
  parts.push(line('Setting', brief.setting), line('Must happen', brief.mustHappen), line('Must never happen or appear', brief.avoid))
  if (brief.length) parts.push(`Length: ${LENGTH_WORDS[brief.length]}`)
  const mine = brief.mine.filter((e) => e.name.trim())
  if (mine.length) {
    parts.push(
      `The author's own characters, places and other things (keep each exactly as written, with the same name):\n${mine
        .map((e) => `- ${e.name.trim()} (${KIND_LABELS[e.kind].one.toLowerCase()})${e.about.trim() ? `: ${e.about.trim()}` : ''}`)
        .join('\n')}`
    )
  }
  if (brief.answers.length) parts.push(`The author's answers to questions about it:\n${brief.answers.map((a) => `- ${a.topic || 'More'}: ${a.answer.trim()}`).join('\n')}`)
  return parts.filter(Boolean).join('\n\n')
}

/** The story's style as the AI will write it (its genre, tone, point of view, tense, content levels and prose style). */
export function styleText(db: DB, story: Story, prefs?: WritingPrefs | null): string {
  const style = effectiveStyle(prefs ?? ({} as WritingPrefs), repo.getWorldStyle(db), story.style ?? {})
  const lines = [
    style.genres.length ? `Genre: ${genreLabel(style.genres)}` : '',
    line('Genre notes', style.genreNotes),
    line('Tone', story.tone || (repo.getMeta(db, 'tone') ?? '')),
    line('Themes', story.themes),
    line('Point of view', style.pov),
    line('Tense', style.tense),
    line('Prose style', style.proseStyle.slice(0, 800)),
    line('Content limits', style.contentLimits),
    ...intensityLines(style.intensity)
  ].filter(Boolean)
  return lines.join('\n')
}

/** A recipe's parts as the plan is told them (its writing style goes to the story's style instead). */
export function recipeBlock(r: { name: string; parts: RecipeParts }): string {
  const heads: Partial<Record<keyof RecipeParts, string>> = {
    themes: 'Themes',
    tone: 'Tone',
    feel: 'Genre and content',
    shape: 'Shape',
    beats: 'Beats',
    cast: 'Cast roles',
    pacing: 'Pacing',
    devices: 'Devices'
  }
  const body = (Object.keys(heads) as (keyof RecipeParts)[])
    .filter((k) => r.parts[k]?.trim())
    .map((k) => `### ${heads[k]}\n${r.parts[k].trim()}`)
    .join('\n\n')
  return `The recipe "${r.name.trim() || 'Untitled recipe'}": the shape, beats, cast roles, pacing, themes and devices of a story the author admires. Follow its shape and pacing, but tell an entirely new story: new characters with new names (or the author's own), a new setting.\n\n${body}`
}
