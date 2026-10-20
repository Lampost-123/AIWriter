// What an interview by topic is told, so it never asks what is already known: the author's idea (a story's brief and
// style, or the world's summary, themes and tone), the pages the world already has (in full for the topic's own kind,
// by name for the rest), and, for the connections, how those pages already stand with each other. Reads the database;
// no Electron.

import type Database from 'better-sqlite3'
import type { Entry, EntryKind, ID, Story, WritingPrefs } from '@shared/types'
import type { InterviewTopic } from '@shared/contracts/worldInterviews'
import { TOPIC_KIND } from '@shared/contracts/worldInterviews'
import { KIND_LABELS } from '@shared/fields'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { briefText, readBrief, styleText } from '../storyBuilder/brief'
import { fieldLabel, TOPIC_FIELDS } from './prompts'

type DB = Database.Database

/** Where the World builder keeps its summary (ipc/worldBuilder.ts SUMMARY_KEY). */
const SUMMARY_KEY = 'world_summary'

/** The kinds the connections interview links. */
export const CONNECT_KINDS: EntryKind[] = ['character', 'place', 'lore', 'event', 'group']

const oneLine = (s: unknown): string =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()

const cut = (s: string, most: number): string => (s.length > most ? `${s.slice(0, most).replace(/\s+\S*$/, '')}…` : s)

/** The story, when there is one and it is in this world (null for the world on its own). */
export function storyOf(db: DB, storyId: ID | null): Story | null {
  if (!storyId) return null
  return repo.listStories(db).find((s) => s.id === storyId) ?? null
}

/** The author's idea: the story's brief and style (and the world's summary beside it), or the world's summary, themes and tone. */
export function ideaText(db: DB, story: Story | null, prefs?: WritingPrefs | null): string {
  const summary = (repo.getMeta(db, SUMMARY_KEY) ?? '').trim()
  const parts: string[] = []
  if (story) {
    parts.push(briefText(readBrief(db, story.id), story), styleText(db, story, prefs))
    if (summary) parts.push(`The world's summary, in the author's words:\n${summary}`)
  } else {
    const name = (repo.getMeta(db, 'name') ?? '').trim()
    if (name) parts.push(`The world: ${name}`)
    if (summary) parts.push(`The world's summary, in the author's words:\n${summary}`)
    const themes = (repo.getMeta(db, 'themes') ?? '').trim()
    const tone = (repo.getMeta(db, 'tone') ?? '').trim()
    if (themes) parts.push(`Themes: ${themes}`)
    if (tone) parts.push(`Tone: ${tone}`)
  }
  const text = parts.map((p) => p.trim()).filter(Boolean).join('\n\n')
  return text || "The author hasn't written anything about it yet."
}

/** The live pages of these kinds, oldest first. */
export function pagesOf(db: DB, kinds: EntryKind[]): Entry[] {
  return repo.listEntries(db).filter((e) => kinds.includes(e.kind) && e.name.trim())
}

/** One page in a line: its name, other names, where it is, its summary and (with `full`) the parts it has. */
export function pageLine(e: Entry, byId: Map<ID, Entry>, full: boolean, empties = false): string {
  const also = e.aliases.length ? ` (also: ${e.aliases.slice(0, 3).join(', ')})` : ''
  const parent = e.parentId ? byId.get(e.parentId) : null
  const inside = e.kind === 'place' && parent ? ` [inside ${parent.name}]` : ''
  const rule = e.kind === 'lore' && e.hardRule ? ' [always true]' : ''
  const summary = oneLine(e.summary)
  let line = `- ${e.name}${also}${inside}${rule}${summary ? `: ${cut(summary, 200)}` : ''}`
  const keys = TOPIC_FIELDS[e.kind] ?? []
  if (full) {
    const parts = keys.map((k) => [k, oneLine(e.fields[k])] as const).filter(([, v]) => v)
    if (parts.length) line += `\n  ${parts.map(([k, v]) => `${fieldLabel(e.kind, k)}: ${cut(v, 160)}`).join('; ')}`
  }
  if (empties) {
    const empty = keys.filter((k) => !oneLine(e.fields[k]))
    if (empty.length) line += `\n  Empty: ${empty.join(', ')}`
  }
  return line
}

/**
 * What the world has already, for a topic: its own kind's pages in full (or, cut down, by name), then the other kinds
 * by name. `most`: how many of the topic's own pages are told in full.
 */
export function pagesText(db: DB, topic: InterviewTopic, most: number): string {
  const all = pagesOf(db, ['character', 'place', 'group', 'item', 'lore', 'event'])
  const byId = new Map(all.map((e) => [e.id, e]))
  if (topic === 'connections') {
    const blocks = CONNECT_KINDS.map((k) => {
      const list = all.filter((e) => e.kind === k)
      if (!list.length) return ''
      const shown = list.slice(0, most)
      const more = list.length > most ? `\n- (and ${list.length - most} more: ${list.slice(most).map((e) => e.name).join('; ')})` : ''
      return `${KIND_LABELS[k].many}:\n${shown.map((e) => pageLine(e, byId, k === 'character' || k === 'place', true)).join('\n')}${more}`
    }).filter(Boolean)
    return blocks.length ? blocks.join('\n\n') : 'Nothing yet.'
  }
  const kind = TOPIC_KIND[topic]
  const own = all.filter((e) => e.kind === kind)
  const rest = all.filter((e) => e.kind !== kind)
  const ownText = own.length
    ? `${KIND_LABELS[kind].many} already in the world:\n${own
        .slice(0, most)
        .map((e) => pageLine(e, byId, true))
        .join('\n')}${own.length > most ? `\n- (and ${own.length - most} more: ${own.slice(most).map((e) => e.name).join('; ')})` : ''}`
    : `No ${KIND_LABELS[kind].many.toLowerCase()} in the world yet.`
  const restText = rest.length ? `\n\nAlso in the world: ${rest.map((e) => `${e.name} (${KIND_LABELS[e.kind].one.toLowerCase()})`).join('; ')}` : ''
  return `${ownText}${restText}`
}

/** How the pages already stand with each other (relationships true from the start: the world's or a story's). */
export function linksText(db: DB, most: number): string {
  const names = new Map(repo.listEntries(db).map((e) => [e.id, e.name]))
  const lines = mem
    .listAllChanges(db)
    .flatMap((c) => {
      if (c.kind !== 'relationship' || c.anchor === 'scene') return []
      const from = names.get(c.entryId)
      const to = names.get(c.payload.otherId)
      return from && to ? [`- ${from}: ${oneLine(c.payload.type) || 'linked to'} ${to}`] : []
    })
  if (!lines.length) return 'None yet.'
  return lines.slice(0, most).join('\n') + (lines.length > most ? `\n- (and ${lines.length - most} more)` : '')
}

/** Every pair of pages that already has a relationship, either way round ("a|b" with the ids sorted). */
export function linkedPairs(db: DB): Set<string> {
  const out = new Set<string>()
  for (const c of mem.listAllChanges(db)) if (c.kind === 'relationship') out.add([c.entryId, c.payload.otherId].sort().join('|'))
  return out
}
