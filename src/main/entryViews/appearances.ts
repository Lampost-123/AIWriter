// Where entries appear (milestone 3): the codex's importance and last appearance, and an entry
// page's "Appears in". A scene counts when its card has the entry as point of view, present or the
// location, when its words name the entry or an alias (the memory keeper's rule, see mentions.ts),
// or when one of the entry's changes is pinned to it.
//
// Speed: the scenes' words are read in one pass with a first-word index of every name, and what
// each scene names is remembered (per open world) until its words change. A name that is new since
// (a new entry, a rename, an alias) is looked for in every scene once, on its own. So in a big world
// only the first look reads every scene. No Electron imports.

import type Database from 'better-sqlite3'
import type { Entry, ID } from '@shared/types'
import type { Appearance, AppearanceHow } from '@shared/contracts/entryViews'
import type { WorldShape } from '../memory/types'
import { compareOrder, labeler, storyOrder } from '../memory/line'
import { loadShape } from '../memory/scene'
import * as views from '../db/entryViews'
import { buildNameIndex, findMentions, mentionEnd, patternKeys, quoteAround, type NameIndex, type Named } from './mentions'

type DB = Database.Database

/** What one scene says, as last read. */
interface SceneMemo {
  version: string
  /** Names (pattern keys) its words mention, each with where the first mention starts. */
  hits: Map<string, number>
  /** The words around the first mention of a name, worked out when an entry page first asks. */
  quotes: Map<string, string>
  cast: views.SceneCast
}

/** What the open world's scenes say, kept while the world is open (one per database handle). */
interface Memo {
  /** Names every remembered scene has been read for. */
  scanned: Set<string>
  scenes: Map<ID, SceneMemo>
}

const memos = new WeakMap<DB, Memo>()

/** A live scene in reading order. */
export interface ScenePlace {
  id: ID
  storyId: ID
  title: string
  /** "Book 1, Ch 2, Sc 3". */
  label: string
  /** Its place in reading order across every story (0 first). */
  order: number
}

export interface WorldAppearances {
  /** Every live scene, in reading order. */
  scenes: ScenePlace[]
  sceneById: Map<ID, ScenePlace>
  /** For each entry, the scenes it appears in and how. */
  byEntry: Map<ID, Map<ID, Set<AppearanceHow>>>
  index: NameIndex
  memo: Memo
}

/**
 * Brings the remembered readings up to date: scenes whose words changed are read again for every
 * name, and every other scene is read for names that are new since. One query for the words needed.
 */
function refresh(db: DB, memo: Memo, liveIds: ID[], versions: Map<ID, { version: string }>, entries: Named[]): NameIndex {
  const index = buildNameIndex(entries)
  const keys = new Set(index.patterns.keys())
  const fresh = [...keys].filter((k) => !memo.scanned.has(k))
  const stale = liveIds.filter((id) => memo.scenes.get(id)?.version !== versions.get(id)?.version)
  if (fresh.length || stale.length) {
    const staleSet = new Set(stale)
    const freshIndex = fresh.length ? buildNameIndex(entries, new Set(fresh)) : null
    // New names are looked for in every scene; otherwise only changed scenes are read.
    for (const s of views.sceneWords(db, freshIndex ? null : stale)) {
      if (staleSet.has(s.id) || !memo.scenes.has(s.id)) {
        memo.scenes.set(s.id, { version: s.version, hits: findMentions(index, s.text), quotes: new Map(), cast: s.cast })
        continue
      }
      const m = memo.scenes.get(s.id)!
      for (const k of fresh) {
        m.hits.delete(k)
        m.quotes.delete(k)
      }
      for (const [k, at] of findMentions(freshIndex!, s.text)) m.hits.set(k, at)
    }
  }
  memo.scanned = keys
  return index
}

/** Every live scene in reading order, with its place in plain words. */
function scenesInOrder(shape: WorldShape, versions: Map<ID, { title: string }>): ScenePlace[] {
  const label = labeler(shape)
  const order = storyOrder(shape)
  const list: { s: Omit<ScenePlace, 'order'>; key: number[] }[] = []
  for (const story of shape.stories)
    for (const c of story.chapters)
      for (const sc of c.scenes) {
        list.push({
          s: { id: sc.id, storyId: story.id, title: versions.get(sc.id)?.title ?? sc.title, label: label({ storyId: story.id, sceneId: sc.id }) },
          key: order({ storyId: story.id, sceneId: sc.id })
        })
      }
  list.sort((a, b) => compareOrder(a.key, b.key))
  return list.map(({ s }, i) => ({ ...s, order: i }))
}

/**
 * Where every entry appears (or, with `only`, one entry). `entries` are the live entries: every name
 * and alias is looked for, so what each scene says stays remembered for all of them.
 */
export function worldAppearances(db: DB, entries: Named[], shape: WorldShape = loadShape(db), only?: ID): WorldAppearances {
  let memo = memos.get(db)
  if (!memo) memos.set(db, (memo = { scanned: new Set(), scenes: new Map() }))
  const versions = views.sceneVersions(db)
  const scenes = scenesInOrder(shape, versions)
  const index = refresh(
    db,
    memo,
    scenes.map((s) => s.id),
    versions,
    entries
  )

  const live = new Set(entries.map((e) => e.id))
  const byEntry = new Map<ID, Map<ID, Set<AppearanceHow>>>()
  const add = (entryId: ID | null, sceneId: ID, how: AppearanceHow): void => {
    if (!entryId || !live.has(entryId) || (only && entryId !== only)) return
    let m = byEntry.get(entryId)
    if (!m) byEntry.set(entryId, (m = new Map()))
    let set = m.get(sceneId)
    if (!set) m.set(sceneId, (set = new Set()))
    set.add(how)
  }
  const sceneById = new Map(scenes.map((s) => [s.id, s]))
  for (const s of scenes) {
    const m = memo.scenes.get(s.id)
    if (!m) continue
    add(m.cast.povId, s.id, 'pov')
    for (const id of m.cast.presentIds) add(id, s.id, 'present')
    add(m.cast.locationId, s.id, 'location')
    for (const k of m.hits.keys()) for (const id of index.patterns.get(k)?.entryIds ?? []) add(id, s.id, 'named')
  }
  for (const c of views.sceneChangeEntries(db)) if (sceneById.has(c.sceneId)) for (const id of c.entryIds) add(id, c.sceneId, 'changes')
  return { scenes, sceneById, byEntry, index, memo }
}

/** How much a scene adds to an entry's importance: its point of view most, then being there, then being named or changed. */
export function sceneWeight(how: Set<AppearanceHow> | AppearanceHow[]): number {
  const has = (h: AppearanceHow): boolean => (Array.isArray(how) ? how.includes(h) : how.has(h))
  if (has('pov')) return 3
  if (has('present') || has('location')) return 2
  return 1
}

const HOW_ORDER: AppearanceHow[] = ['pov', 'present', 'location', 'named', 'changes']

/** Every scene one entry appears in, in reading order, with the words around its first mention in each. */
export function appearancesOf(db: DB, entry: Pick<Entry, 'id' | 'name' | 'aliases'>, entries: Named[]): Appearance[] {
  const w = worldAppearances(db, entries, loadShape(db), entry.id)
  const mine = w.byEntry.get(entry.id)
  if (!mine) return []
  const keys = patternKeys(entry)
  const list = [...mine.keys()].map((id) => w.sceneById.get(id)!).sort((a, b) => a.order - b.order)
  // The words around the first mention, for scenes that name it. Remembered with the scene, so only
  // scenes not quoted before are read (in one query).
  const firstAt = new Map<ID, { key: string; at: number }>()
  const quotes = new Map<ID, string>()
  for (const s of list) {
    const m = w.memo.scenes.get(s.id)
    if (!m) continue
    let first: { key: string; at: number } | null = null
    for (const k of keys) {
      const at = m.hits.get(k)
      if (at !== undefined && (!first || at < first.at)) first = { key: k, at }
    }
    if (!first) continue
    const known = m.quotes.get(first.key)
    if (known !== undefined) quotes.set(s.id, known)
    else firstAt.set(s.id, first)
  }
  if (firstAt.size)
    for (const s of views.sceneWords(db, [...firstAt.keys()])) {
      const f = firstAt.get(s.id)!
      const end = mentionEnd(w.index, f.key, s.text, f.at)
      const quote = end > f.at ? quoteAround(s.text, f.at, end) : ''
      w.memo.scenes.get(s.id)!.quotes.set(f.key, quote)
      quotes.set(s.id, quote)
    }
  return list.map((s) => ({
    sceneId: s.id,
    storyId: s.storyId,
    label: s.label,
    title: s.title,
    how: HOW_ORDER.filter((h) => mine.get(s.id)!.has(h)),
    quote: quotes.get(s.id) || null
  }))
}

/** Forgets what the open world's scenes say (for tests that time a first look). */
export function forgetReadings(db: DB): void {
  memos.delete(db)
}
