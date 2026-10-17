// A new story's world, from its plan (Adam, 2026-10-17: "the AI should generate characters with physical descriptions
// and other traits ... and fill out the world codex according to the story with plot threads and pretty much everything
// else the story will need like locations etc, otherwise we are just starting totally blind"). Once Adam keeps an
// outline (the outline helper, a recipe's story, a chapter's plan), the World builder lays out what it needs from a
// summary written here from the story: its premise, themes and tone, and each act, chapter and scene card with who is
// there, where, when and the plot threads it sets up or pays off. Nothing of his is changed: the World build leaves
// what is in the world as it is and fills in only the pages that are thin. No Electron imports.

import type Database from 'better-sqlite3'
import type { ChapterCard, ID, SceneCard } from '@shared/types'
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

/**
 * The story as a summary for the World builder: '' when it has nothing planned to build from (no premise and no
 * chapter or scene with words on its card). Cut to what one build takes.
 */
export function storySummary(db: DB, storyId: ID): string {
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
  lines.push(`This is the plan for the story "${flat(story.title) || 'Untitled'}". Lay out everything it needs: every character with their looks, build, usual clothes, personality, voice, goals and how they relate to the others; every place; the groups, items, lore and rules of its world; and the plot threads it sets up and pays off.`)
  if (flat(story.premise)) lines.push(`Premise: ${flat(story.premise)}`)
  if (flat(story.themes)) lines.push(`Themes: ${flat(story.themes)}`)
  if (flat(story.tone)) lines.push(`Tone: ${flat(story.tone)}`)
  let planned = !!flat(story.premise)
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
      lines.push(`- Scene ${flat(s.title)}: ${[words, own].filter(Boolean).join(' ')}`)
    }
  }
  for (const c of outline.chapters.filter((x) => !x.actId)) chapter(c)
  for (const a of outline.acts ?? []) {
    lines.push(`Act ${[flat(a.title), flat(a.purpose)].filter(Boolean).join(': ')}`)
    for (const c of outline.chapters.filter((x) => x.actId === a.id)) chapter(c)
  }
  if (!planned) return ''
  const text = lines.join('\n')
  return text.length > MAX_SUMMARY_CHARS ? text.slice(0, MAX_SUMMARY_CHARS).replace(/\n[^\n]*$/, '') : text
}
