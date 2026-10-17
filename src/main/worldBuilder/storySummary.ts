// A new story's world, from its plan (Adam, 2026-10-17: "the AI should generate characters with physical descriptions
// and other traits ... and fill out the world codex according to the story with plot threads and pretty much everything
// else the story will need like locations etc, otherwise we are just starting totally blind"). Once Adam keeps an
// outline (the outline helper, a recipe's story, a chapter's plan), the World builder lays out what it needs from a
// summary written here from the story: its premise, themes and tone, and each act, chapter and scene card with who is
// there, where, when and the plot threads it sets up or pays off. Nothing of his is changed: the World build leaves
// what is in the world as it is and fills in only the pages that are thin. No Electron imports.

import type Database from 'better-sqlite3'
import type { ChapterCard, ID, SceneCard } from '@shared/types'
import type { RecipeParts } from '@shared/contracts/recipes'
import * as repo from '../db/repo'
import { MAX_SUMMARY_CHARS } from './sizes'

type DB = Database.Database

const flat = (s: unknown): string =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()

/** "Who: Mara (point of view), Tobin. Where: The Ferry. When: Day 1, dusk. Sets up: The Duke's debt." for a card. */
function cardLine(card: Partial<SceneCard & ChapterCard>, name: (id: ID | null | undefined) => string): string {
  const pov = name(card.povId)
  const present = (card.presentIds ?? []).map(name).filter((n) => n && n !== pov)
  const who = [pov ? `${pov} (point of view)` : '', ...present].filter(Boolean)
  const parts = [
    who.length ? `Who: ${who.join(', ')}.` : '',
    name(card.locationId) ? `Where: ${name(card.locationId)}.` : '',
    flat(card.when) ? `When: ${flat(card.when)}.` : '',
    flat(card.mood) ? `Mood: ${flat(card.mood)}.` : '',
    (card.setsUpIds ?? []).length ? `Sets up: ${(card.setsUpIds ?? []).map(name).filter(Boolean).join(', ')}.` : '',
    (card.paysOffIds ?? []).length ? `Pays off: ${(card.paysOffIds ?? []).map(name).filter(Boolean).join(', ')}.` : ''
  ]
  return parts.filter(Boolean).join(' ')
}

/** What a story planned from a recipe adds to its summary: the recipe's cast roles and devices (leak-checked already). */
export type RecipeExtras = Partial<Pick<RecipeParts, 'cast' | 'devices'>>

/**
 * The story as a summary for the World builder: '' when it has nothing planned to build from (no premise and no
 * chapter or scene with words on its card). Cut to what one build takes. A story planned from a recipe (2026-10-17)
 * ends with the recipe's cast roles and devices, while there is room, so the parts its characters play reach the build.
 */
export function storySummary(db: DB, storyId: ID, recipe?: RecipeExtras | null): string {
  const { summary } = storyPlan(db, storyId)
  if (!summary || !recipe) return summary
  const extra = [
    flat(recipe.cast) ? `The parts the characters play, from the recipe (roles for this story's characters, not more characters): ${flat(recipe.cast)}` : '',
    flat(recipe.devices) ? `Set-ups, pay-offs and motifs, from the recipe: ${flat(recipe.devices)}` : ''
  ].filter(Boolean)
  let text = summary
  for (const line of extra) if (text.length + line.length + 1 <= MAX_SUMMARY_CHARS) text += `\n${line}`
  return text
}

/**
 * The scenes a story's summary numbers ("Scene 1" is the first), so the events the World builder lays out can be put
 * in the scene they happen in: none when `summary` isn't the story's own (Adam's World builder summary). The recipe's
 * lines after it (storySummary) don't change that.
 */
export function planScenes(db: DB, storyId: ID, summary: string): ID[] {
  const plan = storyPlan(db, storyId)
  const given = summary.trim()
  return plan.summary && (plan.summary === given || given.startsWith(`${plan.summary}\n`)) ? plan.scenes : []
}

/**
 * The story's own themes and tone, each only when the summary gives it as storySummary writes it ("Themes: ..."):
 * the World build copies those into the world's empty themes and tone rather than asking the AI to (2026-10-17).
 */
export function storyThemes(db: DB, storyId: ID, summary: string): Partial<Record<'themes' | 'tone', string>> {
  const story = repo.getStory(db, storyId)
  const lines = new Set(summary.split(/\r?\n/).map((l) => l.trim()))
  const out: Partial<Record<'themes' | 'tone', string>> = {}
  const themes = flat(story.themes)
  const tone = flat(story.tone)
  if (themes && lines.has(`Themes: ${themes}`)) out.themes = themes
  if (tone && lines.has(`Tone: ${tone}`)) out.tone = tone
  return out
}

/** The summary, and the scenes it numbers, in order. */
function storyPlan(db: DB, storyId: ID): { summary: string; scenes: ID[] } {
  const story = repo.getStory(db, storyId)
  const outline = repo.getOutline(db, storyId)
  const cards = repo.sceneCards(db, outline.scenes.map((s) => s.id))
  const all = repo.listEntries(db)
  const byId = new Map(all.map((e) => [e.id, e]))
  // A room is named with the place it is inside: "Kitchen (inside Venn House)".
  const names = new Map(
    all.map((e) => {
      const parent = e.kind === 'place' && e.parentId ? byId.get(e.parentId) : undefined
      return [e.id, parent ? `${e.name} (inside ${parent.name})` : e.name]
    })
  )
  const name = (id: ID | null | undefined): string => (id ? (names.get(id) ?? '') : '')
  const lines: string[] = []
  lines.push(`From the plan below for the story "${flat(story.title) || 'Untitled'}", lay out everything it needs: every character with their looks, build, usual clothes, personality, voice, goals and how they relate to the others; every place; the groups, items, lore and rules of its world; the events it plans, each in the numbered scene it happens in; and the plot threads it sets up and pays off.`)
  if (flat(story.premise)) lines.push(`Premise: ${flat(story.premise)}`)
  if (flat(story.themes)) lines.push(`Themes: ${flat(story.themes)}`)
  if (flat(story.tone)) lines.push(`Tone: ${flat(story.tone)}`)
  let planned = !!flat(story.premise)
  // Each scene listed is numbered, for an event to say which scene it happens in.
  const scenes: ID[] = []
  const chapter = (c: (typeof outline.chapters)[number]): void => {
    const card = cardLine(repo.getChapterCard(db, c.id), name)
    const head = [flat(c.title), flat(c.goal)].filter(Boolean).join(': ')
    if (head || card) lines.push(`Chapter ${head}${card ? ` ${card}` : ''}`)
    for (const s of outline.scenes.filter((x) => x.chapterId === c.id)) {
      const sc = cards.get(s.id)
      if (!sc) continue
      const words = [flat(sc.goal), ...sc.beats.map(flat)].filter(Boolean).join(' ')
      const own = cardLine(sc, name)
      if (!words && !own) continue
      planned = true
      scenes.push(s.id)
      const title = flat(s.title)
      lines.push(`- Scene ${scenes.length}${title ? ` (${title})` : ''}: ${[words, own].filter(Boolean).join(' ')}`)
    }
  }
  // In story order (2026-10-17), as memory/line.ts walks the chapters, so "Scene 3" is the third scene read even when
  // chapters with and without an act are mixed. Each act is named before its first chapter; one with none, at the end.
  const acts = outline.acts ?? []
  const actLine = (a: (typeof acts)[number]): string => `Act ${[flat(a.title), flat(a.purpose)].filter(Boolean).join(': ')}`
  const named = new Set<ID>()
  let at: ID | null = null
  for (const c of outline.chapters) {
    if (c.actId !== at) {
      at = c.actId ?? null
      const a = at ? acts.find((x) => x.id === at) : undefined
      if (a && !named.has(a.id)) {
        named.add(a.id)
        lines.push(actLine(a))
      }
    }
    chapter(c)
  }
  for (const a of acts) if (!named.has(a.id)) lines.push(actLine(a))
  if (!planned) return { summary: '', scenes: [] }
  const text = lines.join('\n')
  return { summary: text.length > MAX_SUMMARY_CHARS ? text.slice(0, MAX_SUMMARY_CHARS).replace(/\n[^\n]*$/, '') : text, scenes }
}
