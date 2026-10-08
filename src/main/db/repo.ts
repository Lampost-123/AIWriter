import type Database from 'better-sqlite3'
import type {
  Chapter,
  ChapterCard,
  DeletedItem,
  Entry,
  EntryInput,
  EntryKind,
  ID,
  Origin,
  Outline,
  Scene,
  SceneCard,
  SceneMeta,
  SceneStatus,
  Series,
  Story,
  StyleGuide
} from '@shared/types'
import { countWords, defaultStyleGuide, emptySceneCard } from '@shared/defaults'
import { withAiLink, withoutAiLink, type ThreadList } from '@shared/threadLinks'
import { adoptChapter, carryOf, CHAPTER_CARD_PREFIX, chapterCardEmpty, cleanChapterCard, resolveCardWrite, withCarry } from '@shared/chapterCard'
import type { ChapterCardUpdate } from '@shared/contracts/chapterCards'
import { newId, now, UserError } from '../util'
import { addExistsPoint, defaultExistsPoint, loadShape } from './memory'
import { buildLine, previousSceneStep } from '../memory/line'
import { getVersion, recordVersion } from './history'
import { chapterCreated, chapterMoved, chapterRestored, deletedActs, listActs } from './acts'

// All reads and writes of a world database. Pure functions over a better-sqlite3
// handle, with no Electron imports, so they can be unit-tested in plain Node.

type Row = Record<string, unknown>
type DB = Database.Database

const json = <T>(s: unknown, fallback: T): T => {
  if (typeof s !== 'string' || s === '') return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

// ---------- Meta (world-level settings) ----------

export function getMeta(db: DB, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as Row | undefined
  return row ? (row.value as string) : null
}

export function setMeta(db: DB, key: string, value: string): void {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

export function getWorldStyle(db: DB): StyleGuide {
  return { ...defaultStyleGuide(), ...json<Partial<StyleGuide>>(getMeta(db, 'style'), {}) }
}

/** Sets up a brand new world database: identity, first series and first story. */
export function initWorld(db: DB, id: ID, name: string): void {
  const t = now()
  db.transaction(() => {
    setMeta(db, 'id', id)
    setMeta(db, 'name', name)
    setMeta(db, 'themes', '')
    setMeta(db, 'tone', '')
    setMeta(db, 'style', JSON.stringify(defaultStyleGuide()))
    setMeta(db, 'created_at', t)
    setMeta(db, 'updated_at', t)
    const seriesId = newId()
    db.prepare('INSERT INTO series (id, name, position, created_at) VALUES (?, ?, 0, ?)').run(seriesId, name, t)
    const story = createStory(db, { title: 'Book 1', seriesId })
    const chapter = createChapter(db, story.id, { title: 'Chapter 1' })
    createScene(db, chapter.id, { title: 'Scene 1' })
  })()
}

export function touchWorld(db: DB): void {
  setMeta(db, 'updated_at', now())
}

// ---------- Series and stories ----------

const toSeries = (r: Row): Series => ({
  id: r.id as string,
  name: r.name as string,
  themes: r.themes as string,
  tone: r.tone as string,
  position: r.position as number
})

export function listSeries(db: DB): Series[] {
  return (db.prepare('SELECT * FROM series ORDER BY position, created_at').all() as Row[]).map(toSeries)
}

const toStory = (r: Row): Story => ({
  id: r.id as string,
  seriesId: (r.series_id as string) ?? null,
  title: r.title as string,
  premise: r.premise as string,
  themes: r.themes as string,
  tone: r.tone as string,
  kind: r.kind as Story['kind'],
  startStoryId: (r.start_story_id as string) ?? null,
  startAt: ((r.start_at as string) ?? 'end') as Story['startAt'],
  startRefId: (r.start_ref_id as string) ?? null,
  endAt: ((r.end_at as string) ?? null) as Story['endAt'],
  endRefId: (r.end_ref_id as string) ?? null,
  leadsIntoId: (r.leads_into_id as string) ?? null,
  leadsIn: !!r.leads_in,
  timeGap: (r.time_gap as string) ?? '',
  position: r.position as number,
  createdOrder: r.created_order as number,
  style: json<Partial<StyleGuide>>(r.style_json, {}),
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string
})

export function listStories(db: DB): Story[] {
  return (db.prepare('SELECT * FROM stories WHERE deleted_at IS NULL ORDER BY position, created_order').all() as Row[]).map(toStory)
}

export function getStory(db: DB, id: ID): Story {
  const r = db.prepare('SELECT * FROM stories WHERE id = ? AND deleted_at IS NULL').get(id) as Row | undefined
  if (!r) throw new UserError('That story no longer exists.')
  return toStory(r)
}

export function createStory(db: DB, input: { title: string; seriesId?: ID | null; startStoryId?: ID | null }): Story {
  const t = now()
  const id = newId()
  const max = db.prepare('SELECT COALESCE(MAX(position), -1) AS p, COALESCE(MAX(created_order), -1) AS c FROM stories').get() as Row
  const stories = listStories(db)
  // Default: a new story continues after the last story on the shelf.
  const startStoryId = input.startStoryId !== undefined ? input.startStoryId : (stories[stories.length - 1]?.id ?? null)
  const seriesId = input.seriesId !== undefined ? input.seriesId : (listSeries(db)[0]?.id ?? null)
  db.prepare(
    `INSERT INTO stories (id, series_id, title, kind, start_story_id, position, created_order, created_at, updated_at)
     VALUES (?, ?, ?, 'continues', ?, ?, ?, ?, ?)`
  ).run(id, seriesId, input.title.trim() || 'Untitled story', startStoryId, (max.p as number) + 1, (max.c as number) + 1, t, t)
  return getStory(db, id)
}

export function updateStory(
  db: DB,
  id: ID,
  patch: Partial<Pick<Story, 'title' | 'premise' | 'themes' | 'tone' | 'style' | 'seriesId' | 'timeGap'>>
): Story {
  const s = getStory(db, id)
  const next = { ...s, ...patch }
  db.prepare(
    `UPDATE stories SET title = ?, premise = ?, themes = ?, tone = ?, style_json = ?, series_id = ?, time_gap = ?, updated_at = ? WHERE id = ?`
  ).run(next.title, next.premise, next.themes, next.tone, JSON.stringify(next.style ?? {}), next.seriesId, (next.timeGap ?? '').trim(), now(), id)
  return getStory(db, id)
}

export function deleteStory(db: DB, id: ID): void {
  db.prepare('UPDATE stories SET deleted_at = ? WHERE id = ?').run(now(), id)
}

// ---------- Chapters ----------

const toChapter = (r: Row): Chapter => ({
  id: r.id as string,
  storyId: r.story_id as string,
  title: r.title as string,
  goal: r.goal as string,
  position: r.position as number,
  actId: (r.act_id as string) ?? null
})

export function getChapter(db: DB, id: ID): Chapter {
  const r = db.prepare('SELECT * FROM chapters WHERE id = ? AND deleted_at IS NULL').get(id) as Row | undefined
  if (!r) throw new UserError('That chapter no longer exists.')
  return toChapter(r)
}

function chapterIds(db: DB, storyId: ID): ID[] {
  return (db.prepare('SELECT id FROM chapters WHERE story_id = ? AND deleted_at IS NULL ORDER BY position').all(storyId) as Row[]).map(
    (r) => r.id as string
  )
}

function renumber(db: DB, table: 'chapters' | 'scenes', ids: ID[]): void {
  const stmt = db.prepare(`UPDATE ${table} SET position = ? WHERE id = ?`)
  ids.forEach((id, i) => stmt.run(i, id))
}

export function createChapter(db: DB, storyId: ID, input: { title?: string; afterId?: ID | null } = {}): Chapter {
  getStory(db, storyId)
  const t = now()
  const id = newId()
  return db.transaction(() => {
    const ids = chapterIds(db, storyId)
    const after = input.afterId ? ids.indexOf(input.afterId) : -1
    const at = after >= 0 ? after + 1 : ids.length
    const title = input.title ?? `Chapter ${ids.length + 1}`
    db.prepare('INSERT INTO chapters (id, story_id, title, position, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)').run(
      id,
      storyId,
      title,
      t,
      t
    )
    ids.splice(at, 0, id)
    renumber(db, 'chapters', ids)
    // Milestone 4: in a story with acts, it goes in an act (see acts.ts).
    chapterCreated(db, id, input.afterId)
    return getChapter(db, id)
  })()
}

export function updateChapter(db: DB, id: ID, patch: Partial<Pick<Chapter, 'title' | 'goal'>>): Chapter {
  const c = { ...getChapter(db, id), ...patch }
  db.prepare('UPDATE chapters SET title = ?, goal = ?, updated_at = ? WHERE id = ?').run(c.title, c.goal, now(), id)
  return getChapter(db, id)
}

export function deleteChapter(db: DB, id: ID): void {
  const t = now()
  db.transaction(() => {
    db.prepare('UPDATE chapters SET deleted_at = ? WHERE id = ?').run(t, id)
    db.prepare('UPDATE scenes SET deleted_at = ? WHERE chapter_id = ? AND deleted_at IS NULL').run(t, id)
  })()
}

export type Restorable = 'story' | 'chapter' | 'scene' | 'entry'

/**
 * Undoes a delete. A chapter comes back with the scenes that were deleted with it. A scene or
 * chapter whose chapter or story is also deleted brings that back too (just that one row, none of
 * its other scenes), or it would be restored somewhere nobody can see it.
 */
export function restoreDeleted(db: DB, kind: Restorable, id: ID): void {
  const table = { story: 'stories', chapter: 'chapters', scene: 'scenes', entry: 'entries' }[kind]
  db.transaction(() => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Row | undefined
    if (!row) throw new UserError('That item could not be found to restore.')
    if (kind === 'chapter' && row.deleted_at) {
      db.prepare('UPDATE scenes SET deleted_at = NULL WHERE chapter_id = ? AND deleted_at = ?').run(id, row.deleted_at)
    }
    db.prepare(`UPDATE ${table} SET deleted_at = NULL WHERE id = ?`).run(id)
    // An entry's memory history shows it came back, as it was then.
    if (kind === 'entry' && row.deleted_at) {
      recordVersion(db, { factKind: 'entry', factId: id, entryId: id, data: getEntry(db, id), origin: 'adam' })
    }
    const chapterId = kind === 'scene' ? (row.chapter_id as string) : kind === 'chapter' ? id : null
    if (chapterId) {
      const chapterBack = db.prepare('UPDATE chapters SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL').run(chapterId).changes > 0
      db.prepare(
        'UPDATE stories SET deleted_at = NULL WHERE id = (SELECT story_id FROM chapters WHERE id = ?) AND deleted_at IS NOT NULL'
      ).run(chapterId)
      // Things added since may have taken its place number: number them again so the order stays clear.
      if (kind === 'scene') renumber(db, 'scenes', sceneIds(db, chapterId))
      // Its chapter's card may have changed while it was deleted: the parts it follows take the chapter's value now,
      // and an empty part it never settled takes the chapter's; a part of its own stays (adoptChapter 'follow').
      if (kind === 'scene' && row.deleted_at) {
        const was = getScene(db, id).card
        const next = adoptChapter(was, getChapterCard(db, chapterId), 'follow')
        if (JSON.stringify(next) !== JSON.stringify(was)) writeCard(db, id, next, now())
      }
      if (kind === 'chapter' || chapterBack) {
        const storyId = (db.prepare('SELECT story_id FROM chapters WHERE id = ?').get(chapterId) as Row).story_id as string
        renumber(db, 'chapters', chapterIds(db, storyId))
        // Milestone 4: its act comes back with it, and each act's chapters stay together.
        chapterRestored(db, chapterId)
      }
    }
  })()
}

/** What is in the trash, newest first. Scenes deleted along with their chapter are counted in it, not listed. */
export function listDeleted(db: DB): DeletedItem[] {
  const item = (r: Row, kind: DeletedItem['kind']): DeletedItem => ({
    kind,
    id: r.id as string,
    title: (r.title as string) ?? '',
    deletedAt: r.deleted_at as string,
    entryKind: (r.entry_kind as EntryKind | undefined) ?? null,
    storyId: (r.story_id as string | undefined) ?? null,
    storyTitle: (r.story_title as string | undefined) ?? null,
    chapterTitle: (r.chapter_title as string | undefined) ?? null,
    sceneCount: (r.scene_count as number | undefined) ?? 0
  })
  const all = (sql: string): Row[] => db.prepare(sql).all() as Row[]
  const stories = all('SELECT id, title, deleted_at, id AS story_id, title AS story_title FROM stories WHERE deleted_at IS NOT NULL')
  const chapters = all(
    `SELECT c.id, c.title, c.deleted_at, c.story_id, st.title AS story_title,
       (SELECT COUNT(*) FROM scenes s WHERE s.chapter_id = c.id AND s.deleted_at = c.deleted_at) AS scene_count
     FROM chapters c JOIN stories st ON st.id = c.story_id
     WHERE c.deleted_at IS NOT NULL`
  )
  const scenes = all(
    `SELECT s.id, s.title, s.deleted_at, c.story_id, st.title AS story_title, c.title AS chapter_title
     FROM scenes s JOIN chapters c ON c.id = s.chapter_id JOIN stories st ON st.id = c.story_id
     WHERE s.deleted_at IS NOT NULL AND (c.deleted_at IS NULL OR c.deleted_at <> s.deleted_at)`
  )
  const entries = all('SELECT id, name AS title, kind AS entry_kind, deleted_at FROM entries WHERE deleted_at IS NOT NULL')
  // Milestone 4: deleted acts, holding the chapters deleted along with them.
  const acted = deletedActs(db)
  return [
    ...stories.map((r) => item(r, 'story')),
    ...acted.items,
    ...chapters.filter((r) => !acted.chapterIds.has(r.id as string)).map((r) => item(r, 'chapter')),
    ...scenes.map((r) => item(r, 'scene')),
    ...entries.map((r) => item(r, 'entry'))
  ].sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : a.deletedAt > b.deletedAt ? -1 : 0))
}

export function moveChapter(db: DB, id: ID, index: number): void {
  const c = getChapter(db, id)
  db.transaction(() => {
    const ids = chapterIds(db, c.storyId).filter((x) => x !== id)
    ids.splice(Math.max(0, Math.min(index, ids.length)), 0, id)
    renumber(db, 'chapters', ids)
    // Milestone 4: it stays in its act, and each act's chapters stay together.
    chapterMoved(db, id)
  })()
}

// ---------- Scenes ----------

const toSceneMeta = (r: Row): SceneMeta => ({
  id: r.id as string,
  chapterId: r.chapter_id as string,
  title: r.title as string,
  position: r.position as number,
  status: r.status as SceneStatus,
  wordCount: r.word_count as number,
  updatedAt: r.updated_at as string,
  acceptedAt: (r.accepted_at as string) ?? null,
  memoryState: ((r.memory_status as string) ?? 'current') as SceneMeta['memoryState']
})

const toScene = (r: Row): Scene => ({
  ...toSceneMeta(r),
  card: { ...emptySceneCard(), ...json<Partial<SceneCard>>(r.card_json, {}) },
  doc: json<unknown>(r.doc_json, null),
  text: r.text as string
})

/** The scene cards of these scenes (those that still exist), by id, without their text: one query per 500. */
export function sceneCards(db: DB, ids: ID[]): Map<ID, SceneCard> {
  const out = new Map<ID, SceneCard>()
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    if (!chunk.length) continue
    const rows = db
      .prepare(`SELECT id, card_json FROM scenes WHERE deleted_at IS NULL AND id IN (${chunk.map(() => '?').join(',')})`)
      .all(...chunk) as Row[]
    for (const r of rows) out.set(r.id as string, { ...emptySceneCard(), ...json<Partial<SceneCard>>(r.card_json, {}) })
  }
  return out
}

function sceneIds(db: DB, chapterId: ID): ID[] {
  return (db.prepare('SELECT id FROM scenes WHERE chapter_id = ? AND deleted_at IS NULL ORDER BY position').all(chapterId) as Row[]).map(
    (r) => r.id as string
  )
}

export function getScene(db: DB, id: ID): Scene {
  const r = db.prepare('SELECT * FROM scenes WHERE id = ? AND deleted_at IS NULL').get(id) as Row | undefined
  if (!r) throw new UserError('That scene no longer exists.')
  return toScene(r)
}

export function getSceneMeta(db: DB, id: ID): SceneMeta {
  const r = db
    .prepare(
      'SELECT id, chapter_id, title, position, status, word_count, updated_at, accepted_at, memory_status FROM scenes WHERE id = ? AND deleted_at IS NULL'
    )
    .get(id) as Row | undefined
  if (!r) throw new UserError('That scene no longer exists.')
  return toSceneMeta(r)
}

export function createScene(db: DB, chapterId: ID, input: { title?: string; afterId?: ID | null } = {}): SceneMeta {
  getChapter(db, chapterId)
  const t = now()
  const id = newId()
  return db.transaction(() => {
    const ids = sceneIds(db, chapterId)
    const after = input.afterId ? ids.indexOf(input.afterId) : -1
    const at = after >= 0 ? after + 1 : ids.length
    const title = input.title ?? `Scene ${ids.length + 1}`
    // A new scene starts with its chapter's card, following every part of it.
    const card = adoptChapter(emptySceneCard(), getChapterCard(db, chapterId), 'new')
    db.prepare('INSERT INTO scenes (id, chapter_id, title, card_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      id,
      chapterId,
      title,
      JSON.stringify(card),
      t,
      t
    )
    ids.splice(at, 0, id)
    renumber(db, 'scenes', ids)
    return getSceneMeta(db, id)
  })()
}

export function updateScene(db: DB, id: ID, patch: { title?: string; status?: SceneStatus }): SceneMeta {
  const s = { ...getSceneMeta(db, id), ...patch }
  db.prepare('UPDATE scenes SET title = ?, status = ?, updated_at = ? WHERE id = ?').run(s.title, s.status, now(), id)
  return getSceneMeta(db, id)
}

export function saveSceneText(db: DB, id: ID, doc: unknown, text: string): { wordCount: number; updatedAt: string; status: SceneStatus } {
  const meta = getSceneMeta(db, id)
  const wordCount = countWords(text)
  const t = now()
  // A planned scene with text in it counts as drafted; a drafted scene emptied of text goes back to
  // planned. Revised and done are Adam's own say, so they stay as they are.
  const status: SceneStatus =
    meta.status === 'planned' && wordCount > 0 ? 'drafted' : meta.status === 'drafted' && wordCount === 0 ? 'planned' : meta.status
  db.prepare('UPDATE scenes SET doc_json = ?, text = ?, word_count = ?, status = ?, updated_at = ? WHERE id = ?').run(
    doc == null ? null : JSON.stringify(doc),
    text,
    wordCount,
    status,
    t,
    id
  )
  return { wordCount, updatedAt: t, status }
}

/**
 * Saves a scene card. A part that follows the chapter card stays so unless the card changes it to something other
 * than the chapter's: then it is the scene's own from now on (shared/chapterCard.ts resolveCardWrite).
 */
export function updateSceneCard(db: DB, id: ID, card: SceneCard): SceneCard {
  const meta = getSceneMeta(db, id)
  const prev = getScene(db, id).card
  const clean: SceneCard = resolveCardWrite(prev, { ...emptySceneCard(), ...card }, getChapterCard(db, meta.chapterId))
  db.prepare('UPDATE scenes SET card_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(clean), now(), id)
  return clean
}

/**
 * The memory's own plot thread link on a scene card (shared/threadLinks.ts): added (`on`) unless the thread is on that
 * list already or Adam took the memory's link off; taken back (not `on`) only when it is the memory's. True when the
 * card changed. A deleted scene's card is left alone.
 */
export function setAiThreadLink(db: DB, sceneId: ID, list: ThreadList, threadId: ID, on: boolean): boolean {
  const card = sceneCards(db, [sceneId]).get(sceneId)
  if (!card) return false
  const next = on ? withAiLink(card, list, threadId) : withoutAiLink(card, list, threadId)
  if (!next) return false
  db.prepare('UPDATE scenes SET card_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), now(), sceneId)
  return true
}

// ---------- Chapter cards (2026-10-08) ----------
// The scene card parts a chapter's scenes share, kept in the meta table (one row a chapter, `chapter_card:<id>`): the
// data model is frozen, and the meta table is the world's own key-value store. The chapter's values are written into
// the scene cards that follow them (shared/chapterCard.ts), so nothing that reads a scene card reads this.

const chapterCardKey = (chapterId: ID): string => `${CHAPTER_CARD_PREFIX}${chapterId}`

/** The chapter's card; an empty one when it has none. */
export function getChapterCard(db: DB, chapterId: ID): ChapterCard {
  return cleanChapterCard(json<unknown>(getMeta(db, chapterCardKey(chapterId)), {}))
}

function storeChapterCard(db: DB, chapterId: ID, card: ChapterCard): void {
  if (chapterCardEmpty(card)) db.prepare('DELETE FROM meta WHERE key = ?').run(chapterCardKey(chapterId))
  else setMeta(db, chapterCardKey(chapterId), JSON.stringify(card))
}

/** A scene card written by the chapter card: its time moves, so everything kept from it (views, search) is made again. */
function writeCard(db: DB, id: ID, card: SceneCard, t: string): void {
  db.prepare('UPDATE scenes SET card_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(card), t, id)
}

/**
 * Saves a chapter's card, and puts it into the cards of its scenes (adoptChapter 'follow'), all in one go. Says which
 * scene cards changed, with what they had before, so one Undo can put them back.
 */
export function saveChapterCard(db: DB, chapterId: ID, input: unknown): { card: ChapterCard; updated: ChapterCardUpdate[] } {
  getChapter(db, chapterId)
  const card = cleanChapterCard(input)
  return db.transaction(() => {
    storeChapterCard(db, chapterId, card)
    const t = now()
    const updated: ChapterCardUpdate[] = []
    for (const sceneId of sceneIds(db, chapterId)) {
      const was = getScene(db, sceneId).card
      const next = adoptChapter(was, card, 'follow')
      if (JSON.stringify(next) === JSON.stringify(was)) continue
      writeCard(db, sceneId, next, t)
      updated.push({ sceneId, before: carryOf(was) })
    }
    return { card, updated }
  })()
}

/**
 * Undo for saveChapterCard: the chapter's card as it was, and those scenes' parts and marks as they were (scenes since
 * deleted, or moved to another chapter, are left as they are). Their other parts are never touched.
 */
export function restoreChapterCard(db: DB, chapterId: ID, card: unknown, scenes: ChapterCardUpdate[]): number {
  getChapter(db, chapterId)
  const clean = cleanChapterCard(card)
  return db.transaction(() => {
    storeChapterCard(db, chapterId, clean)
    const t = now()
    let n = 0
    for (const u of Array.isArray(scenes) ? scenes : []) {
      const r = db.prepare('SELECT chapter_id FROM scenes WHERE id = ? AND deleted_at IS NULL').get(String(u?.sceneId ?? '')) as Row | undefined
      if (!r || r.chapter_id !== chapterId || !u.before) continue
      const was = getScene(db, u.sceneId).card
      const next = withCarry(was, { parts: cleanChapterCard(u.before.parts), inherits: u.before.inherits ?? null })
      if (JSON.stringify(next) === JSON.stringify(was)) continue
      writeCard(db, u.sceneId, next, t)
      n++
    }
    return n
  })()
}

export function deleteScene(db: DB, id: ID): void {
  db.prepare('UPDATE scenes SET deleted_at = ? WHERE id = ?').run(now(), id)
}

export function moveScene(db: DB, id: ID, chapterId: ID, index: number): void {
  const s = getSceneMeta(db, id)
  getChapter(db, chapterId)
  db.transaction(() => {
    if (s.chapterId !== chapterId) {
      db.prepare('UPDATE scenes SET chapter_id = ? WHERE id = ?').run(chapterId, id)
      renumber(db, 'scenes', sceneIds(db, s.chapterId))
      // In its new chapter, the parts it follows take that chapter's card (a part of its own stays).
      const was = getScene(db, id).card
      const next = adoptChapter(was, getChapterCard(db, chapterId), 'follow')
      if (JSON.stringify(next) !== JSON.stringify(was)) writeCard(db, id, next, now())
    }
    const ids = sceneIds(db, chapterId).filter((x) => x !== id)
    ids.splice(Math.max(0, Math.min(index, ids.length)), 0, id)
    renumber(db, 'scenes', ids)
  })()
}

export function getOutline(db: DB, storyId: ID): Outline {
  const story = getStory(db, storyId)
  const chapters = (
    db.prepare('SELECT * FROM chapters WHERE story_id = ? AND deleted_at IS NULL ORDER BY position').all(storyId) as Row[]
  ).map(toChapter)
  const scenes = (
    db
      .prepare(
        `SELECT s.id, s.chapter_id, s.title, s.position, s.status, s.word_count, s.updated_at, s.accepted_at, s.memory_status
         FROM scenes s JOIN chapters c ON c.id = s.chapter_id
         WHERE c.story_id = ? AND s.deleted_at IS NULL AND c.deleted_at IS NULL
         ORDER BY c.position, s.position`
      )
      .all(storyId) as Row[]
  ).map(toSceneMeta)
  // Milestone 4: the story's acts. A chapter whose act is deleted has none.
  const acts = listActs(db, storyId)
  const live = new Set(acts.map((a) => a.id))
  for (const c of chapters) if (c.actId && !live.has(c.actId)) c.actId = null
  return { story, chapters, scenes, acts }
}

/** Where a scene sits: its chapter and story. */
export function sceneLocation(db: DB, sceneId: ID): { scene: SceneMeta; chapter: Chapter; story: Story } {
  const scene = getSceneMeta(db, sceneId)
  const chapter = getChapter(db, scene.chapterId)
  return { scene, chapter, story: getStory(db, chapter.storyId) }
}

/**
 * Block 3's previous scene: the last scene on this story's line before this one (spec, Multi-story
 * rules), never a side story added whole. Empty for a prequel's first scene and for the first scene
 * of a story that starts at the beginning of the world. Built by the line, like every "what came earlier".
 */
export function previousScene(db: DB, sceneId: ID): Scene | null {
  const { story } = sceneLocation(db, sceneId)
  const step = previousSceneStep(buildLine(loadShape(db), { storyId: story.id, before: sceneId }))
  return step ? getScene(db, step.sceneId) : null
}

// ---------- Entries ----------

const toEntry = (r: Row): Entry => ({
  id: r.id as string,
  kind: r.kind as EntryKind,
  name: r.name as string,
  aliases: json<string[]>(r.aliases_json, []),
  summary: r.summary as string,
  description: r.description as string,
  tags: json<string[]>(r.tags_json, []),
  notes: r.notes as string,
  fields: json<Record<string, string>>(r.fields_json, {}),
  parentId: (r.parent_id as string) ?? null,
  hardRule: !!r.hard_rule,
  origin: ((r.origin as string) ?? 'adam') as Entry['origin'],
  fieldOrigins: json<Record<string, Origin>>(r.field_origins_json, {}),
  originStoryId: (r.origin_story_id as string) ?? null,
  originSceneId: (r.origin_scene_id as string) ?? null,
  originStart: !!r.origin_start,
  byHand: !!r.by_hand,
  image: r.image_version ? `${IMAGE_SCHEME}://entry/${encodeURIComponent(r.id as string)}?v=${r.image_version as string}` : null,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string
})

/** The address scheme portraits are served on (src/main/portraits.ts). */
export const IMAGE_SCHEME = 'aiwrite-image'

/**
 * Every entry column the interface needs. The portrait itself (entries.image, a data: URL) is left
 * out, so lists stay small; `image_version` changes whenever the portrait does.
 */
const ENTRY_COLUMNS = `id, kind, name, aliases_json, summary, description, tags_json, notes, fields_json, parent_id, hard_rule,
  origin, field_origins_json, origin_story_id, origin_scene_id, origin_start, by_hand, created_at, updated_at,
  CASE WHEN image IS NULL OR image = '' THEN NULL ELSE length(image) || '-' || hex(substr(image, -9)) END AS image_version`

export function listEntries(db: DB, kind?: EntryKind): Entry[] {
  const rows = kind
    ? db.prepare(`SELECT ${ENTRY_COLUMNS} FROM entries WHERE kind = ? AND deleted_at IS NULL ORDER BY name COLLATE NOCASE`).all(kind)
    : db.prepare(`SELECT ${ENTRY_COLUMNS} FROM entries WHERE deleted_at IS NULL ORDER BY kind, name COLLATE NOCASE`).all()
  return (rows as Row[]).map(toEntry)
}

export function getEntry(db: DB, id: ID): Entry {
  const r = db.prepare(`SELECT ${ENTRY_COLUMNS} FROM entries WHERE id = ? AND deleted_at IS NULL`).get(id) as Row | undefined
  if (!r) throw new UserError('That page no longer exists. It may have been deleted.')
  return toEntry(r)
}

export function getEntries(db: DB, ids: ID[]): Entry[] {
  const get = db.prepare(`SELECT ${ENTRY_COLUMNS} FROM entries WHERE id = ? AND deleted_at IS NULL`)
  return ids.flatMap((id) => {
    const r = get.get(id) as Row | undefined
    return r ? [toEntry(r)] : []
  })
}

/** Image types a portrait can be, and the most it may weigh once the interface has made it small. */
export const PORTRAIT_TYPES = ['image/webp', 'image/png', 'image/jpeg', 'image/gif']
export const PORTRAIT_MAX_BYTES = 2 * 1024 * 1024

/**
 * Gives an entry a portrait, or removes it (null). Stored in the world's database (entries.image,
 * as a data: URL), so backups, restores and the trash keep it. Adam did it, so the entry counts as
 * touched by hand. Writes no memory-history version: the history is of the entry's words.
 */
export function setEntryImage(db: DB, id: ID, image: { bytes: Uint8Array; type: string } | null): Entry {
  getEntry(db, id)
  let value: string | null = null
  if (image) {
    if (!PORTRAIT_TYPES.includes(image.type)) throw new UserError('That file isn’t a picture AI Write can show. Try a PNG, JPEG or WebP image.')
    if (!image.bytes?.length) throw new UserError('That picture is empty. Try another one.')
    if (image.bytes.length > PORTRAIT_MAX_BYTES) throw new UserError('That picture is too large. Try a smaller one.')
    value = `data:${image.type};base64,${Buffer.from(image.bytes).toString('base64')}`
  }
  db.prepare('UPDATE entries SET image = ?, by_hand = 1, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(value, now(), id)
  return getEntry(db, id)
}

/** An entry's portrait as bytes, for the aiwrite-image: address; null when it has none (or is deleted). */
export function getEntryImage(db: DB, id: ID): { bytes: Buffer; type: string } | null {
  const r = db.prepare('SELECT image FROM entries WHERE id = ? AND deleted_at IS NULL').get(id) as { image: string | null } | undefined
  const m = r?.image ? /^data:([\w/+.-]+);base64,(.*)$/s.exec(r.image) : null
  return m ? { type: m[1], bytes: Buffer.from(m[2], 'base64') } : null
}

/** How an entry is being made: by Adam (the default), read from a scene's text, or drafted by the AI; and whether by a start-of-story change. */
export interface EntryMaking {
  origin: Origin
  originStoryId?: ID | null
  originSceneId?: ID | null
  originStart?: boolean
  /** The memory keeper run making it. */
  runId?: ID | null
}

/** Makes an entry and gives it its default first-exists point (spec, Multi-story rules). */
export function createEntry(db: DB, kind: EntryKind, input: EntryInput = {}, making: EntryMaking = { origin: 'adam' }): Entry {
  const t = now()
  const id = newId()
  const originStoryId = making.originStoryId ?? input.originStoryId ?? null
  const originSceneId = making.originSceneId ?? null
  db.transaction(() => {
    db.prepare(
      `INSERT INTO entries (id, kind, name, aliases_json, summary, description, tags_json, notes, fields_json, parent_id, hard_rule,
         origin, origin_story_id, origin_scene_id, origin_start, by_hand, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      kind,
      (input.name ?? '').trim() || 'Unnamed',
      JSON.stringify(input.aliases ?? []),
      input.summary ?? '',
      input.description ?? '',
      JSON.stringify(input.tags ?? []),
      input.notes ?? '',
      JSON.stringify(input.fields ?? {}),
      input.parentId ?? null,
      input.hardRule ? 1 : 0,
      making.origin,
      originStoryId,
      originSceneId,
      making.originStart ? 1 : 0,
      making.origin === 'adam' ? 1 : 0,
      t,
      t
    )
    const point = defaultExistsPoint(db, { kind, origin: making.origin, originStoryId, originSceneId, originStart: !!making.originStart })
    addExistsPoint(db, { ...point, entryId: id, byHand: false })
    recordVersion(db, { factKind: 'entry', factId: id, entryId: id, data: getEntry(db, id), origin: making.origin, runId: making.runId })
  })()
  return getEntry(db, id)
}

const entryName = (name: string | undefined): string => (name ?? '').trim() || 'Unnamed'

/**
 * The keys an entry patch changes, as field-origin keys (field keys, or 'name', 'aliases', 'summary',
 * 'description', 'tags'). Only the fields a patch names count: the rest are kept as saved.
 */
function changedKeys(before: Entry, patch: EntryInput): string[] {
  const keys: string[] = []
  if (patch.name !== undefined && entryName(patch.name) !== before.name) keys.push('name')
  for (const k of ['aliases', 'summary', 'description', 'tags'] as const) {
    if (patch[k] !== undefined && JSON.stringify(patch[k]) !== JSON.stringify(before[k])) keys.push(k)
  }
  for (const [k, v] of Object.entries(patch.fields ?? {})) if ((before.fields[k] ?? '') !== (v ?? '')) keys.push(k)
  return keys
}

/**
 * Saves changes to an entry and writes a memory-history version. Adam's edits (the default) make
 * every field he changed his ('adam'), so the memory keeper never changes those fields, and mark the
 * entry as touched by hand, so it is never removed automatically. The memory keeper passes
 * `{ origin: 'text' }` (or 'ai') with its run, and only for fields that aren't Adam's.
 * `fields` is merged into the saved fields (a field is emptied by sending ''), so a field the memory
 * keeper filled in just before a page's save isn't lost because the page didn't know of it.
 */
export function updateEntry(db: DB, id: ID, patch: EntryInput, by: { origin: Origin; runId?: ID | null } = { origin: 'adam' }): Entry {
  const before = getEntry(db, id)
  const e = { ...before, ...patch, fields: patch.fields ? { ...before.fields, ...patch.fields } : before.fields }
  if (e.parentId === id) e.parentId = null
  const keys = changedKeys(before, patch)
  // Saving what is already there changes nothing, so it writes no version (the history lists real changes only).
  const same = !keys.length && e.notes === before.notes && (e.parentId ?? null) === before.parentId && !!e.hardRule === before.hardRule
  if (same) return before
  const fieldOrigins = { ...before.fieldOrigins }
  for (const k of keys) fieldOrigins[k] = by.origin
  return db.transaction(() => {
    db.prepare(
      `UPDATE entries SET name = ?, aliases_json = ?, summary = ?, description = ?, tags_json = ?, notes = ?, fields_json = ?,
       parent_id = ?, hard_rule = ?, field_origins_json = ?, by_hand = MAX(by_hand, ?), updated_at = ? WHERE id = ?`
    ).run(
      entryName(e.name),
      JSON.stringify(e.aliases),
      e.summary,
      e.description,
      JSON.stringify(e.tags),
      e.notes,
      JSON.stringify(e.fields),
      e.parentId,
      e.hardRule ? 1 : 0,
      JSON.stringify(fieldOrigins),
      by.origin === 'adam' ? 1 : 0,
      now(),
      id
    )
    const after = getEntry(db, id)
    recordVersion(db, { factKind: 'entry', factId: id, entryId: id, data: after, origin: by.origin, runId: by.runId })
    return after
  })()
}

/** Moves an entry to Trash and writes a memory-history version saying who removed it (once: deleting it again changes nothing). */
export function deleteEntry(db: DB, id: ID, by: { origin: Origin; runId?: ID | null } = { origin: 'adam' }): void {
  db.transaction(() => {
    if (!db.prepare('UPDATE entries SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(now(), id).changes) return
    recordVersion(db, { factKind: 'entry', factId: id, entryId: id, data: null, origin: by.origin, runId: by.runId })
  })()
}

/**
 * Brings an entry back as it was at an earlier version of its memory history: its own fields and who
 * each one came from, so bringing a version back and then undoing that leaves the entry exactly as it
 * was. An entry moved to Recently deleted since comes back too. Adam does this, so the new version is
 * his and the entry counts as touched by hand (never moved to the Trash automatically).
 */
export function restoreEntryVersion(db: DB, entryId: ID, versionId: ID): Entry {
  const v = getVersion(db, versionId)
  if (!v || v.factKind !== 'entry' || v.factId !== entryId) throw new UserError('That earlier copy of this page could not be found.')
  if (!v.data || typeof v.data !== 'object') throw new UserError('That is from when this page was deleted. Pick an earlier one.')
  if (!db.prepare('SELECT 1 FROM entries WHERE id = ?').get(entryId)) {
    throw new UserError('That page has been deleted for good, so it can’t be brought back.')
  }
  const old = v.data as Partial<Entry>
  const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [])
  return db.transaction(() => {
    db.prepare(
      `UPDATE entries SET name = ?, aliases_json = ?, summary = ?, description = ?, tags_json = ?, notes = ?, fields_json = ?,
       parent_id = ?, hard_rule = ?, field_origins_json = ?, by_hand = 1, deleted_at = NULL, updated_at = ? WHERE id = ?`
    ).run(
      entryName(old.name),
      JSON.stringify(strings(old.aliases)),
      old.summary ?? '',
      old.description ?? '',
      JSON.stringify(strings(old.tags)),
      old.notes ?? '',
      JSON.stringify(old.fields ?? {}),
      old.parentId && old.parentId !== entryId ? old.parentId : null,
      old.hardRule ? 1 : 0,
      JSON.stringify(old.fieldOrigins ?? {}),
      now(),
      entryId
    )
    const after = getEntry(db, entryId)
    recordVersion(db, { factKind: 'entry', factId: entryId, entryId, data: after, origin: 'adam' })
    return after
  })()
}
