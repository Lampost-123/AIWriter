// Find and replace across a story (Writing by hand, Ctrl+Shift+F). See src/shared/contracts/find.ts.
// The work is here, with what it needs from the rest of the app passed in (StoryFindDeps), so it is tested
// on an in-memory world; src/main/ipc/find.ts connects it to the open world, History, saving and the memory.

import type Database from 'better-sqlite3'
import { comparableDoc } from '@shared/contracts/history'
import {
  MAX_LISTED,
  type PageChange,
  type PageForFind,
  type RenameOffer,
  type SkippedScene,
  type StoryFindInput,
  type StoryFindResult,
  type StoryReplaceInput,
  type StoryReplaceResult,
  type StorySceneMatches,
  type StoryUndoResult
} from '@shared/contracts/find'
import { ENTRY_KINDS } from '@shared/fields'
import type { EntryInput, ID } from '@shared/types'
import {
  blocksOfDoc,
  curlLike,
  docText,
  findInBlocks,
  hasQuery,
  replaceInDoc,
  snippetAround,
  tidyDoc,
  touches,
  type ChangedRange,
  type FoundMatch,
  type TextBlock
} from '@shared/findReplace'
import * as repo from '../db/repo'
import { newId, UserError } from '../util'

type DB = Database.Database

/** What the story-wide replace needs from the rest of the app. */
export interface StoryFindDeps {
  /** Keeps a History snapshot of a scene before it changes. Never throws. */
  snapshot(sceneId: ID, doc: unknown, text: string): void
  /** Saves a scene's text the way the editor's saves are saved (the memory keeper and History hear of it). */
  save(sceneId: ID, doc: unknown, text: string): void
  /** Changes an entry as Adam's own edit. */
  updateEntry(entryId: ID, patch: EntryInput): void
  /** True while a draft is being written into the scene. */
  drafting(sceneId: ID): boolean
}

/** A scene's words as they are now: the stored scene, or the page when it shows that scene. */
interface SceneNow {
  sceneId: ID
  title: string
  doc: unknown | null
  text: string
  blocks: TextBlock[]
  /** Read from the page (the window changes it through the editor). */
  fromPage: boolean
  keep: { from: number; to: number }[]
}

interface Place {
  sceneId: ID
  chapterId: ID
  chapterNumber: number
  sceneNumber: number
  chapterTitle: string
  sceneTitle: string
}

/** The story's live scenes in reading order, with their chapter and scene numbers. */
function placesOf(db: DB, storyId: ID): Place[] {
  const outline = repo.getOutline(db, storyId)
  const out: Place[] = []
  outline.chapters.forEach((ch, ci) => {
    outline.scenes
      .filter((s) => s.chapterId === ch.id)
      .sort((a, b) => a.position - b.position)
      .forEach((s, si) =>
        out.push({ sceneId: s.id, chapterId: ch.id, chapterNumber: ci + 1, sceneNumber: si + 1, chapterTitle: ch.title, sceneTitle: s.title })
      )
  })
  return out
}

/** The paragraphs to look through: a stored document's, or (a scene saved before documents were kept) its text as one block. */
const blocksOf = (doc: unknown | null, text: string): TextBlock[] => (doc ? blocksOfDoc(doc) : [{ pos: 0, text }])

function sceneNow(db: DB, place: Place, page: PageForFind | null): SceneNow {
  if (page && page.sceneId === place.sceneId && page.doc) {
    return {
      sceneId: place.sceneId,
      title: place.sceneTitle,
      doc: page.doc,
      text: page.text,
      blocks: blocksOfDoc(page.doc),
      fromPage: true,
      keep: Array.isArray(page.keep) ? page.keep : []
    }
  }
  const s = repo.getScene(db, place.sceneId)
  const doc = s.doc && typeof s.doc === 'object' ? s.doc : null
  return { sceneId: s.id, title: s.title, doc, text: s.text ?? '', blocks: blocksOf(doc, s.text ?? ''), fromPage: false, keep: [] }
}

const matchId = (m: { from: number; to: number }): string => `${m.from}:${m.to}`

/** The matches that may change, and how many are held back (inside an AI suggestion waiting in the page). */
function matchesIn(scene: SceneNow, input: StoryFindInput): { open: FoundMatch[]; held: number } {
  const all = findInBlocks(scene.blocks, input.query, input)
  const open = all.filter((m) => !scene.keep.some((k) => touches(m, k)))
  return { open, held: all.length - open.length }
}

/** An entry named exactly the words being found (ignoring case and spaces at the ends), characters first. */
function renameOfferFor(db: DB, query: string): RenameOffer | null {
  const want = query.trim().toLocaleLowerCase()
  if (!want) return null
  const named = repo.listEntries(db).filter((e) => e.name.trim().toLocaleLowerCase() === want)
  named.sort((a, b) => ENTRY_KINDS.indexOf(a.kind) - ENTRY_KINDS.indexOf(b.kind))
  const e = named[0]
  return e ? { entryId: e.id, kind: e.kind, name: e.name } : null
}

export function findInStory(db: DB, input: StoryFindInput): StoryFindResult {
  const result: StoryFindResult = { query: input.query, scenes: [], total: 0, listed: 0, heldBack: 0, rename: null }
  if (!hasQuery(input.query)) return result
  for (const place of placesOf(db, input.storyId)) {
    const scene = sceneNow(db, place, input.page)
    const { open, held } = matchesIn(scene, input)
    result.heldBack += held
    result.total += open.length
    const room = MAX_LISTED - result.listed
    if (!open.length || room <= 0) continue
    const listed = open.slice(0, room)
    result.listed += listed.length
    const entry: StorySceneMatches = { ...place, matches: [] }
    for (const m of listed) {
      const b = scene.blocks[m.block]
      const s = snippetAround(b.text, m.from - b.pos, m.to - b.pos)
      entry.matches.push({ id: matchId(m), before: s.before, text: s.match, after: s.after })
    }
    result.scenes.push(entry)
  }
  result.rename = renameOfferFor(db, input.query)
  return result
}

// ---------- Replacing, and Undo ----------

interface SceneRecord {
  sceneId: ID
  title: string
  before: { doc: unknown | null; text: string }
  after: { doc: unknown | null; text: string }
  /** Where the changes are in `after` (ranges' from/to are in `before`). */
  ranges: ChangedRange[]
}

interface ReplaceRecord {
  db: DB
  scenes: SceneRecord[]
  rename: { entryId: ID; before: { name: string; aliases: string[] }; after: { name: string; aliases: string[] } } | null
}

/** Undo records of this run of the app, newest last; only the last few are kept (an Undo shows for seconds). */
const records = new Map<ID, ReplaceRecord>()
const KEEP_RECORDS = 10

function remember(record: ReplaceRecord): ID {
  const token = newId()
  records.set(token, record)
  while (records.size > KEEP_RECORDS) records.delete(records.keys().next().value as ID)
  return token
}

/** Forgets every Undo of a world (it closed). */
export function forgetWorld(db: DB): void {
  for (const [token, r] of records) if (r.db === db) records.delete(token)
}

/** The new text for one scene with its picked matches replaced. */
function replaced(scene: SceneNow, picks: FoundMatch[], replacement: string): { doc: unknown | null; text: string; ranges: ChangedRange[] } {
  const edits = picks.map((m) => {
    const b = scene.blocks[m.block]
    const at = m.from - b.pos
    return { from: m.from, to: m.to, text: curlLike(replacement, b.text.slice(at, m.to - b.pos), b.text[at - 1] ?? '') }
  })
  if (scene.doc) {
    const r = replaceInDoc(scene.doc, edits)
    return { doc: r.doc, text: docText(r.doc), ranges: r.ranges }
  }
  // A scene kept only as text: the words change in the text.
  let text = scene.text
  const ranges: ChangedRange[] = []
  let delta = 0
  for (const e of [...edits].sort((a, b) => a.from - b.from)) {
    text = text.slice(0, e.from + delta) + e.text + text.slice(e.to + delta)
    ranges.push({ from: e.from, to: e.to, newFrom: e.from + delta, newTo: e.from + delta + e.text.length })
    delta += e.text.length - (e.to - e.from)
  }
  return { doc: null, text, ranges }
}

const sameWords = (a: { doc: unknown | null; text: string }, b: { doc: unknown | null; text: string }): boolean =>
  a.text === b.text && (a.doc && b.doc ? comparableDoc(tidyDoc(a.doc)) === comparableDoc(tidyDoc(b.doc)) : !a.doc === !b.doc)

const sameNames = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])

export function replaceInStory(db: DB, input: StoryReplaceInput, deps: StoryFindDeps): StoryReplaceResult {
  const result: StoryReplaceResult = { token: null, replaced: 0, scenes: 0, skipped: [], page: null, renamed: null }
  if (!hasQuery(input.query)) return result
  const replacement = typeof input.replacement === 'string' ? input.replacement : ''
  const wanted = new Map(input.picks.map((p) => [p.sceneId, new Set(p.matchIds)]))
  const record: ReplaceRecord = { db, scenes: [], rename: null }

  for (const place of placesOf(db, input.storyId)) {
    const ids = wanted.get(place.sceneId)
    if (!ids?.size) continue
    const scene = sceneNow(db, place, input.page)
    const picks = matchesIn(scene, input).open.filter((m) => ids.has(matchId(m)))
    if (!picks.length) continue
    if (!scene.fromPage && deps.drafting(scene.sceneId)) {
      result.skipped.push({ sceneId: scene.sceneId, title: scene.title })
      continue
    }
    const next = replaced(scene, picks, replacement)
    // History keeps the scene as it was, then it changes (the open scene through the editor, in the window).
    deps.snapshot(scene.sceneId, scene.doc, scene.text)
    if (scene.fromPage) result.page = { sceneId: scene.sceneId, doc: next.doc, ranges: next.ranges }
    else deps.save(scene.sceneId, next.doc, next.text)
    record.scenes.push({
      sceneId: scene.sceneId,
      title: scene.title,
      before: { doc: scene.doc, text: scene.text },
      after: { doc: next.doc, text: next.text },
      ranges: next.ranges
    })
    result.replaced += picks.length
    result.scenes++
  }

  const to = replacement.trim()
  if (input.rename && to) {
    const entry = (() => {
      try {
        return repo.getEntry(db, input.rename.entryId)
      } catch {
        return null
      }
    })()
    // Only while it still has the name it was offered under.
    if (entry && entry.name.trim().toLocaleLowerCase() === input.rename.name.trim().toLocaleLowerCase() && entry.name !== to) {
      const lower = to.toLocaleLowerCase()
      const aliases = entry.aliases.filter((a) => a.trim().toLocaleLowerCase() !== lower && a.trim().toLocaleLowerCase() !== entry.name.trim().toLocaleLowerCase())
      aliases.push(entry.name)
      deps.updateEntry(entry.id, { name: to, aliases })
      const now = repo.getEntry(db, entry.id)
      record.rename = { entryId: entry.id, before: { name: entry.name, aliases: entry.aliases }, after: { name: now.name, aliases: now.aliases } }
      result.renamed = { entryId: entry.id, from: entry.name, to: now.name }
    }
  }

  if (record.scenes.length || record.rename) result.token = remember(record)
  return result
}

export function undoReplaceInStory(db: DB, token: ID, page: PageForFind | null, deps: StoryFindDeps): StoryUndoResult {
  const record = records.get(token)
  if (!record || record.db !== db) throw new UserError('That can’t be undone any more.', 'gone')
  records.delete(token)
  const result: StoryUndoResult = { scenes: 0, skipped: [], page: null, rename: null }
  const inverse = (r: SceneRecord): ChangedRange[] => r.ranges.map((x) => ({ from: x.newFrom, to: x.newTo, newFrom: x.from, newTo: x.to }))

  for (const r of record.scenes) {
    if (page && page.sceneId === r.sceneId) {
      // The open scene goes back through the editor, while it shows what the replace left.
      if (r.before.doc && sameWords({ doc: page.doc, text: page.text }, r.after)) {
        result.page = { sceneId: r.sceneId, doc: r.before.doc, ranges: inverse(r) } satisfies PageChange
        result.scenes++
      } else result.skipped.push({ sceneId: r.sceneId, title: r.title })
      continue
    }
    let now: { doc: unknown | null; text: string; title: string }
    try {
      const s = repo.getScene(db, r.sceneId)
      now = { doc: s.doc && typeof s.doc === 'object' ? s.doc : null, text: s.text ?? '', title: s.title }
    } catch {
      result.skipped.push({ sceneId: r.sceneId, title: r.title } satisfies SkippedScene)
      continue
    }
    if (deps.drafting(r.sceneId) || !sameWords(now, r.after)) {
      result.skipped.push({ sceneId: r.sceneId, title: now.title })
      continue
    }
    deps.save(r.sceneId, r.before.doc, r.before.text)
    result.scenes++
  }

  if (record.rename) {
    const { entryId, before, after } = record.rename
    let entry = null
    try {
      entry = repo.getEntry(db, entryId)
    } catch {
      entry = null
    }
    if (entry && entry.name === after.name && sameNames(entry.aliases, after.aliases)) {
      deps.updateEntry(entryId, { name: before.name, aliases: before.aliases })
      result.rename = 'undone'
    } else result.rename = 'changed'
  }
  return result
}
