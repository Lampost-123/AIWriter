// All SQL for search (milestone 3): reading the words the search index holds, and following every
// change to them. Pure functions over a better-sqlite3 handle, no Electron imports, so they can be
// unit-tested in plain Node. The index itself is src/main/search/index.ts.
//
// The data model is frozen, so search adds nothing to the world file. Changes are followed with
// TEMP triggers: they live only on this connection, are never written to world.db (or a backup),
// and call back into the index with what changed, so a search re-reads only those rows.

import type Database from 'better-sqlite3'
import type { EntryKind, ID, StyleGuide, SummaryLevel } from '@shared/types'
import type { CardPart } from '@shared/contracts/search'

type DB = Database.Database
type Row = Record<string, unknown>

const json = <T>(s: unknown, fallback: T): T => {
  if (typeof s !== 'string' || s === '') return fallback
  try {
    return (JSON.parse(s) as T) ?? fallback
  } catch {
    return fallback
  }
}

/** Which rows changed: one of these, with the row's id ('level:target' for a summary). */
export type ChangeKind = 'scene' | 'outline' | 'chapter' | 'story' | 'series' | 'entry' | 'summary' | 'style'

const FUNCTION = 'aiwrite_search_changed'

// [trigger name, table, when, what changed, the row id]
const TRIGGERS: [string, string, string, ChangeKind, string][] = [
  ['scenes_text', 'scenes', 'AFTER UPDATE OF title, text, card_json', 'scene', 'NEW.id'],
  ['scenes_place', 'scenes', 'AFTER UPDATE OF chapter_id, position, deleted_at', 'outline', 'NEW.id'],
  ['scenes_new', 'scenes', 'AFTER INSERT', 'outline', 'NEW.id'],
  ['scenes_new_text', 'scenes', 'AFTER INSERT', 'scene', 'NEW.id'],
  ['scenes_gone', 'scenes', 'AFTER DELETE', 'outline', 'OLD.id'],
  ['chapters_new', 'chapters', 'AFTER INSERT', 'chapter', 'NEW.id'],
  ['chapters_change', 'chapters', 'AFTER UPDATE', 'chapter', 'NEW.id'],
  ['chapters_gone', 'chapters', 'AFTER DELETE', 'chapter', 'OLD.id'],
  ['stories_new', 'stories', 'AFTER INSERT', 'story', 'NEW.id'],
  ['stories_change', 'stories', 'AFTER UPDATE', 'story', 'NEW.id'],
  ['stories_gone', 'stories', 'AFTER DELETE', 'story', 'OLD.id'],
  ['series_new', 'series', 'AFTER INSERT', 'series', 'NEW.id'],
  ['series_change', 'series', 'AFTER UPDATE', 'series', 'NEW.id'],
  ['series_gone', 'series', 'AFTER DELETE', 'series', 'OLD.id'],
  ['entries_new', 'entries', 'AFTER INSERT', 'entry', 'NEW.id'],
  ['entries_change', 'entries', 'AFTER UPDATE', 'entry', 'NEW.id'],
  ['entries_gone', 'entries', 'AFTER DELETE', 'entry', 'OLD.id'],
  // What the memory knows about an entry over the story is found with the entry.
  ['changes_new', 'changes', 'AFTER INSERT', 'entry', 'NEW.entry_id'],
  ['changes_change', 'changes', 'AFTER UPDATE', 'entry', 'NEW.entry_id'],
  ['changes_moved', 'changes', 'AFTER UPDATE OF entry_id', 'entry', 'OLD.entry_id'],
  ['changes_gone', 'changes', 'AFTER DELETE', 'entry', 'OLD.entry_id'],
  ['summaries_new', 'summaries', 'AFTER INSERT', 'summary', "NEW.level || ':' || NEW.target_id"],
  ['summaries_change', 'summaries', 'AFTER UPDATE', 'summary', "NEW.level || ':' || NEW.target_id"],
  ['summaries_gone', 'summaries', 'AFTER DELETE', 'summary', "OLD.level || ':' || OLD.target_id"],
  ['meta_new', 'meta', "AFTER INSERT WHEN NEW.key = 'style'", 'style', 'NEW.key'],
  ['meta_change', 'meta', "AFTER UPDATE WHEN NEW.key = 'style'", 'style', 'NEW.key']
]

/**
 * Calls `changed` for every row written from now on that search shows. Returns false if it can't
 * (the index then reads everything again whenever anything was written).
 */
export function followChanges(db: DB, changed: (kind: ChangeKind, id: string) => void): boolean {
  try {
    db.function(FUNCTION, { deterministic: false }, (kind: unknown, id: unknown) => {
      // Never throws: a failure here would fail the save that set it off.
      try {
        changed(kind as ChangeKind, String(id))
      } catch (e) {
        console.error('Search could not note a change', e)
      }
      return null
    })
    db.transaction(() => {
      for (const [name, table, when, kind, id] of TRIGGERS) {
        const [timing, ...condition] = when.split(' WHEN ')
        db.exec(
          `CREATE TEMP TRIGGER IF NOT EXISTS aiwrite_search_${name} ${timing} ON main.${table}` +
            `${condition.length ? ` WHEN ${condition.join(' WHEN ')}` : ''} BEGIN SELECT ${FUNCTION}('${kind}', ${id}); END`
        )
      }
    })()
    return true
  } catch (e) {
    console.error('Search could not follow changes; it will read the world again after each change', e)
    return false
  }
}

/** How many rows this connection has written so far (for when changes can't be followed). */
export const writeCount = (db: DB): number => (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n

// ---------- Rows ----------

/** The words of a scene: its title, its text and its card. */
export interface SceneWords {
  id: ID
  title: string
  text: string
  /** The card's goal, conflict, outcome, mood, when and beats. */
  card: { part: CardPart; label: string; text: string }[]
  /** The card's notes for the AI. */
  notes: string
}

const CARD_FIELDS: [CardPart, string][] = [
  ['goal', 'Goal'],
  ['conflict', 'Conflict'],
  ['outcome', 'Outcome'],
  ['mood', 'Mood or tone'],
  ['when', 'When']
]

function toSceneWords(r: Row): SceneWords {
  const card = json<Record<string, unknown>>(r.card_json, {})
  const text = (k: string): string => (typeof card[k] === 'string' ? (card[k] as string) : '')
  const beats = Array.isArray(card.beats) ? card.beats.filter((b): b is string => typeof b === 'string' && b.trim() !== '') : []
  return {
    id: r.id as string,
    title: r.title as string,
    text: r.text as string,
    card: [
      ...CARD_FIELDS.map(([part, label]) => ({ part, label, text: text(part) })),
      ...(beats.length ? [{ part: 'beats' as const, label: 'Beats', text: beats.join('\n') }] : [])
    ].filter((f) => f.text.trim() !== ''),
    notes: text('notes')
  }
}

/** Live scenes' words: every one, or only these (a scene not returned is gone or deleted). */
export function sceneWords(db: DB, ids?: ID[]): SceneWords[] {
  const rows = ids
    ? db
        .prepare('SELECT id, title, text, card_json FROM scenes WHERE id IN (SELECT value FROM json_each(?)) AND deleted_at IS NULL')
        .all(JSON.stringify(ids))
    : db.prepare('SELECT id, title, text, card_json FROM scenes WHERE deleted_at IS NULL').all()
  return (rows as Row[]).map(toSceneWords)
}

/** The words of an entry. */
export interface EntryWords {
  id: ID
  kind: EntryKind
  name: string
  aliases: string[]
  summary: string
  description: string
  tags: string[]
  fields: Record<string, string>
  notes: string
  /** What the memory has about it over the story, with the section of its page that lists each. */
  changes: { section: ChangeSection; text: string }[]
}

/**
 * The section of an entry's page that lists a change: how it stands with others at the start, what a
 * character knows at the start, or how it changes over the story (features/world/memoryLogic.ts splitChanges).
 */
export type ChangeSection = 'relationships' | 'knows' | 'changes'

const ENTRY_WORDS = 'id, kind, name, aliases_json, summary, description, tags_json, notes, fields_json'

function toEntryWords(r: Row): EntryWords {
  const fields = json<Record<string, unknown>>(r.fields_json, {})
  return {
    id: r.id as string,
    kind: r.kind as EntryKind,
    name: r.name as string,
    aliases: json<unknown[]>(r.aliases_json, []).filter((a): a is string => typeof a === 'string'),
    summary: r.summary as string,
    description: r.description as string,
    tags: json<unknown[]>(r.tags_json, []).filter((t): t is string => typeof t === 'string'),
    fields: Object.fromEntries(Object.entries(fields).filter((f): f is [string, string] => typeof f[1] === 'string' && f[1].trim() !== '')),
    notes: r.notes as string,
    changes: []
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const strings = (v: unknown): string[] =>
  v && typeof v === 'object' ? Object.values(v).filter((x): x is string => typeof x === 'string') : []

/** The words of one change (shared/types.ts ChangeData), each with the section of the entry's page that lists it. */
function changeWords(kind: string, anchor: unknown, p: Record<string, unknown>): { section: ChangeSection; text: string }[] {
  const out: { section: ChangeSection; text: string }[] = []
  const add = (section: ChangeSection, text: string): void => {
    if (text.trim()) out.push({ section, text })
  }
  const state = (): void => {
    add('changes', str(p.summary))
    add('changes', str(p.description))
    for (const v of strings(p.fields)) add('changes', v)
  }
  // Relationships and what a character knows from the start have sections of their own; anything
  // else (a fresh description too, with what it says they know) is listed as a change over time.
  const start = anchor === 'baseline'
  switch (kind) {
    case 'update':
      add('changes', str(p.note))
      state()
      break
    case 'full':
      state()
      for (const k of Array.isArray(p.knows) ? p.knows : []) add('changes', str((k as Record<string, unknown> | null)?.fact))
      break
    case 'relationship':
      add(start ? 'relationships' : 'changes', [p.type, p.feels, p.otherFeels].map(str).filter(Boolean).join(' · '))
      break
    case 'knowledge':
      add(start ? 'knows' : 'changes', str(p.fact))
      break
    case 'thread':
      add('changes', str(p.note))
      break
  }
  return out
}

/** Live entries' words, with their changes over the story: every entry, or only these. Two statements. */
export function entryWords(db: DB, ids?: ID[]): EntryWords[] {
  const only = ids ? JSON.stringify(ids) : null
  const rows = only
    ? db.prepare(`SELECT ${ENTRY_WORDS} FROM entries WHERE id IN (SELECT value FROM json_each(?)) AND deleted_at IS NULL`).all(only)
    : db.prepare(`SELECT ${ENTRY_WORDS} FROM entries WHERE deleted_at IS NULL`).all()
  const entries = new Map((rows as Row[]).map((r) => [r.id as string, toEntryWords(r)]))
  if (!entries.size) return []
  const columns = 'entry_id, kind, anchor, payload_json'
  const live = 'deleted_at IS NULL ORDER BY position'
  const changes = only
    ? db.prepare(`SELECT ${columns} FROM changes WHERE entry_id IN (SELECT value FROM json_each(?)) AND ${live}`).all(only)
    : db.prepare(`SELECT ${columns} FROM changes WHERE ${live}`).all()
  for (const c of changes as Row[]) {
    const words = changeWords(c.kind as string, c.anchor, json<Record<string, unknown>>(c.payload_json, {}))
    entries.get(c.entry_id as string)?.changes.push(...words)
  }
  return [...entries.values()]
}

export interface SummaryWords {
  level: SummaryLevel
  targetId: ID
  text: string
}

/** Summaries with words in them: every one, or only these ('level:target' keys). */
export function summaryWords(db: DB, keys?: string[]): SummaryWords[] {
  const key = "level || ':' || target_id"
  const rows = keys
    ? db
        .prepare(`SELECT level, target_id, text FROM summaries WHERE ${key} IN (SELECT value FROM json_each(?)) AND text <> ''`)
        .all(JSON.stringify(keys))
    : db.prepare("SELECT level, target_id, text FROM summaries WHERE text <> ''").all()
  return (rows as Row[]).map((r) => ({ level: r.level as SummaryLevel, targetId: r.target_id as string, text: r.text as string }))
}

export interface ChapterWords {
  id: ID
  storyId: ID
  title: string
  goal: string
}

/** Every live chapter's title and goal. */
export function chapterWords(db: DB): ChapterWords[] {
  return (db.prepare('SELECT id, story_id, title, goal FROM chapters WHERE deleted_at IS NULL').all() as Row[]).map((r) => ({
    id: r.id as string,
    storyId: r.story_id as string,
    title: r.title as string,
    goal: r.goal as string
  }))
}

export interface StoryWords {
  id: ID
  title: string
  premise: string
  seriesId: ID | null
  /** The story's own style for the AI (only what differs from the world's). */
  style: Partial<StyleGuide>
}

/** Every live story's title, premise and own style. */
export function storyWords(db: DB): StoryWords[] {
  return (db.prepare('SELECT id, title, premise, series_id, style_json FROM stories WHERE deleted_at IS NULL').all() as Row[]).map((r) => ({
    id: r.id as string,
    title: r.title as string,
    premise: r.premise as string,
    seriesId: (r.series_id as string) ?? null,
    style: json<Partial<StyleGuide>>(r.style_json, {})
  }))
}

/** Every series' name, by id. */
export function seriesNames(db: DB): Map<ID, string> {
  return new Map((db.prepare('SELECT id, name FROM series').all() as Row[]).map((r) => [r.id as string, r.name as string]))
}

/** The world's style guide as stored (fields left out are empty). */
export function worldStyle(db: DB): Partial<StyleGuide> {
  const r = db.prepare("SELECT value FROM meta WHERE key = 'style'").get() as { value: string } | undefined
  return json<Partial<StyleGuide>>(r?.value, {})
}
