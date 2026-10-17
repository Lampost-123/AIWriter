// Where entries appear (milestone 3): the codex's importance and last appearance, and an entry
// page's "Appears in". A scene counts when its card has the entry as point of view, present or the
// location, when its words name the entry or an alias (the memory keeper's rule, see mentions.ts),
// or when one of the entry's changes is pinned to it.
//
// Speed: the scenes' words are read in one pass with a first-word index of every name, and what
// each scene names is remembered (per open world) until its words change. A name that is new since
// (a new entry, a rename, an alias) is looked for once, on its own, in the scenes that hold every
// word of it (each scene's words are remembered in a small bit field). So in a big world only the
// first look reads every scene, and warm.ts does that a slice at a time once a world opens. No
// Electron imports.

import type Database from 'better-sqlite3'
import type { Entry, ID } from '@shared/types'
import type { Appearance, AppearanceHow } from '@shared/contracts/entryViews'
import type { WorldShape } from '../memory/types'
import { compareOrder, labeler, storyOrder } from '../memory/line'
import { loadShape } from '../memory/scene'
import * as views from '../db/entryViews'
import {
  buildNameIndex,
  findMentions,
  mayName,
  mentionEnd,
  nameWords,
  patternKeys,
  quoteAround,
  wordField,
  type NameIndex,
  type Named,
  type Quote
} from './mentions'

type DB = Database.Database

/** What one scene says, as last read. */
interface SceneMemo {
  version: string
  /** Names (pattern keys) its words mention, each with where the first mention starts. */
  hits: Map<string, number>
  /** The words it holds, as mentions.ts wordField keeps them: a new name is looked for only where they may all be. */
  words: Uint32Array
  /** The words around the first mention of a name (null when there are none), worked out when an entry page first asks. */
  quotes: Map<string, Quote | null>
  cast: views.SceneCast
}

/** What the open world's scenes say, kept while the world is open (one per database handle). */
interface Memo {
  /** Names every remembered scene has been read for. */
  scanned: Set<string>
  scenes: Map<ID, SceneMemo>
}

const memos = new WeakMap<DB, Memo>()

/** How an entry is in a scene, as flags. */
const HOW_BIT: Record<AppearanceHow, number> = { pov: 1, present: 2, location: 4, named: 8, changes: 16 }

/** The scenes one entry appears in, and how. */
export interface EntryScenes {
  at: number[]
  how: number[]
}

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
  /**
   * For each live entry, the scenes it appears in (`at`: places in `scenes`, in reading order) and
   * how (`how`: HOW_BIT flags, side by side). Lists, not a map per entry: the codex is read again
   * after each save in a build (2026-10-17).
   */
  byEntry: Map<ID, EntryScenes>
  index: NameIndex
  memo: Memo
}

function memoOf(db: DB): Memo {
  let memo = memos.get(db)
  if (!memo) memos.set(db, (memo = { scanned: new Set(), scenes: new Map() }))
  return memo
}

/** Reads one scene for every name, remembering what words it holds. */
function readScene(index: NameIndex, s: { version: string; text: string; cast: views.SceneCast }): SceneMemo {
  const words = wordField()
  const hits = findMentions(index, s.text, words)
  return { version: s.version, hits, words, quotes: new Map(), cast: s.cast }
}

/**
 * Brings the remembered readings up to date: scenes whose words changed are read again for every
 * name, and other scenes are read for names that are new since, but only those that hold every word
 * of one of them. One query for the words needed. A scene in Recently deleted isn't read for new
 * names, so what it said is forgotten then: if it comes back (its words and version as they were),
 * it is read again in full.
 */
function refresh(db: DB, memo: Memo, liveIds: ID[], versions: Map<ID, { version: string }>, entries: Named[]): NameIndex {
  const index = buildNameIndex(entries)
  const keys = new Set(index.patterns.keys())
  const fresh = [...keys].filter((k) => !memo.scanned.has(k))
  const stale = liveIds.filter((id) => memo.scenes.get(id)?.version !== versions.get(id)?.version)
  if (fresh.length || stale.length) {
    const staleSet = new Set(stale)
    const freshIndex = fresh.length ? buildNameIndex(entries, new Set(fresh)) : null
    const read = [...stale]
    if (freshIndex) {
      const names = nameWords(freshIndex)
      const live = new Set(liveIds)
      for (const [id, m] of memo.scenes) {
        if (!live.has(id)) {
          memo.scenes.delete(id)
          continue
        }
        for (const k of fresh) {
          m.hits.delete(k)
          m.quotes.delete(k)
        }
        if (!staleSet.has(id) && mayName(m.words, names)) read.push(id)
      }
    }
    for (const s of views.sceneWords(db, read)) {
      const m = memo.scenes.get(s.id)
      if (staleSet.has(s.id) || !m) memo.scenes.set(s.id, readScene(index, s))
      else for (const [k, at] of findMentions(freshIndex!, s.text)) m.hits.set(k, at)
    }
  }
  memo.scanned = keys
  return index
}

/**
 * Reads some scenes' words ahead of time, for every name as it is now (warm.ts does this a slice at
 * a time after a world opens, so the first look at the codex or an entry page needn't read them
 * all). Scenes already read are skipped: if their words have changed since, the next look reads
 * them again. Reads nothing and returns false when the names have changed since other scenes were
 * read: the next look reads what it needs itself then.
 */
export function readAhead(db: DB, entries: Named[], ids: ID[]): boolean {
  const memo = memoOf(db)
  const index = buildNameIndex(entries)
  const keys = new Set(index.patterns.keys())
  if (memo.scenes.size && (keys.size !== memo.scanned.size || [...keys].some((k) => !memo.scanned.has(k)))) return false
  const unread = ids.filter((id) => !memo.scenes.has(id))
  for (const s of views.sceneWords(db, unread)) memo.scenes.set(s.id, readScene(index, s))
  memo.scanned = keys
  return true
}

/** Every live scene in reading order, with its place in plain words. */
function scenesInOrder(shape: WorldShape, versions: Map<ID, { title: string }>): ScenePlace[] {
  const label = labeler(shape)
  const order = storyOrder(shape)
  const list: { s: Omit<ScenePlace, 'order'>; key: number[] }[] = []
  for (const story of shape.stories)
    for (const c of story.chapters)
      for (const sc of c.scenes) {
        const at = { storyId: story.id, sceneId: sc.id }
        list.push({ s: { id: sc.id, storyId: story.id, title: versions.get(sc.id)?.title ?? sc.title, label: label(at) }, key: order(at) })
      }
  list.sort((a, b) => compareOrder(a.key, b.key))
  return list.map(({ s }, i) => ({ ...s, order: i }))
}

/**
 * Where every entry appears (or, with `only`, one entry). `entries` are the live entries: every name
 * and alias is looked for, so what each scene says stays remembered for all of them.
 */
export function worldAppearances(db: DB, entries: Named[], shape: WorldShape = loadShape(db), only?: ID): WorldAppearances {
  const memo = memoOf(db)
  const versions = views.sceneVersions(db)
  const scenes = scenesInOrder(shape, versions)
  const index = refresh(
    db,
    memo,
    scenes.map((s) => s.id),
    versions,
    entries
  )

  const byEntry = new Map<ID, EntryScenes>()
  for (const e of entries) if (!only || e.id === only) byEntry.set(e.id, { at: [], how: [] })
  // Scenes are walked in reading order, so an entry's scenes come in order and each scene once.
  const add = (entryId: ID | null, i: number, bit: number): void => {
    const a = entryId ? byEntry.get(entryId) : undefined
    if (!a) return
    const n = a.at.length
    if (n && a.at[n - 1] === i) a.how[n - 1] |= bit
    else {
      a.at.push(i)
      a.how.push(bit)
    }
  }
  const sceneById = new Map(scenes.map((s) => [s.id, s]))
  const changed = new Map<ID, ID[]>()
  for (const c of views.sceneChangeEntries(db)) {
    const list = changed.get(c.sceneId)
    if (list) list.push(...c.entryIds)
    else changed.set(c.sceneId, c.entryIds)
  }
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i]
    const m = memo.scenes.get(s.id)
    if (m) {
      add(m.cast.povId, i, HOW_BIT.pov)
      for (const id of m.cast.presentIds) add(id, i, HOW_BIT.present)
      add(m.cast.locationId, i, HOW_BIT.location)
      for (const k of m.hits.keys()) for (const id of index.patterns.get(k)?.entryIds ?? []) add(id, i, HOW_BIT.named)
    }
    for (const id of changed.get(s.id) ?? []) add(id, i, HOW_BIT.changes)
  }
  return { scenes, sceneById, byEntry, index, memo }
}

/** How much a scene adds to an entry's importance: its point of view most, then being there, then being named or changed. */
export function sceneWeight(how: number): number {
  if (how & HOW_BIT.pov) return 3
  if (how & (HOW_BIT.present | HOW_BIT.location)) return 2
  return 1
}

const HOW_ORDER: AppearanceHow[] = ['pov', 'present', 'location', 'named', 'changes']

/** Every scene one entry appears in, in reading order, with the words around its first mention in each. */
export function appearancesOf(db: DB, entry: Pick<Entry, 'id' | 'name' | 'aliases'>, entries: Named[]): Appearance[] {
  const w = worldAppearances(db, entries, loadShape(db), entry.id)
  const mine = w.byEntry.get(entry.id)
  if (!mine) return []
  const keys = patternKeys(entry)
  const list = mine.at.map((i) => w.scenes[i])
  // The words around the first mention, for scenes that name it. Remembered with the scene, so only
  // scenes not quoted before are read (in one query).
  const firstAt = new Map<ID, { key: string; at: number }>()
  const quotes = new Map<ID, Quote | null>()
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
      const quote = end > f.at ? quoteAround(s.text, f.at, end) : null
      w.memo.scenes.get(s.id)!.quotes.set(f.key, quote?.text ? quote : null)
      quotes.set(s.id, quote?.text ? quote : null)
    }
  return list.map((s, k) => {
    const q = quotes.get(s.id)
    return {
      sceneId: s.id,
      storyId: s.storyId,
      label: s.label,
      title: s.title,
      how: HOW_ORDER.filter((h) => mine.how[k] & HOW_BIT[h]),
      quote: q?.text ?? null,
      quoteCut: { start: !!q?.cutStart, end: !!q?.cutEnd }
    }
  })
}

/** Forgets what the open world's scenes say (for tests that time a first look). */
export function forgetReadings(db: DB): void {
  memos.delete(db)
}
