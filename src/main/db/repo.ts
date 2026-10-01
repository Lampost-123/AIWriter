import type Database from 'better-sqlite3'
import type {
  Chapter,
  Entry,
  EntryInput,
  EntryKind,
  ID,
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
import { newId, now, UserError } from '../util'

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
  patch: Partial<Pick<Story, 'title' | 'premise' | 'themes' | 'tone' | 'style' | 'seriesId'>>
): Story {
  const s = getStory(db, id)
  const next = { ...s, ...patch }
  db.prepare(
    `UPDATE stories SET title = ?, premise = ?, themes = ?, tone = ?, style_json = ?, series_id = ?, updated_at = ? WHERE id = ?`
  ).run(next.title, next.premise, next.themes, next.tone, JSON.stringify(next.style ?? {}), next.seriesId, now(), id)
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
  position: r.position as number
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

export function moveChapter(db: DB, id: ID, index: number): void {
  const c = getChapter(db, id)
  db.transaction(() => {
    const ids = chapterIds(db, c.storyId).filter((x) => x !== id)
    ids.splice(Math.max(0, Math.min(index, ids.length)), 0, id)
    renumber(db, 'chapters', ids)
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
  updatedAt: r.updated_at as string
})

const toScene = (r: Row): Scene => ({
  ...toSceneMeta(r),
  card: { ...emptySceneCard(), ...json<Partial<SceneCard>>(r.card_json, {}) },
  doc: json<unknown>(r.doc_json, null),
  text: r.text as string
})

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
    .prepare('SELECT id, chapter_id, title, position, status, word_count, updated_at FROM scenes WHERE id = ? AND deleted_at IS NULL')
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
    db.prepare('INSERT INTO scenes (id, chapter_id, title, card_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      id,
      chapterId,
      title,
      JSON.stringify(emptySceneCard()),
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

export function saveSceneText(db: DB, id: ID, doc: unknown, text: string): { wordCount: number; updatedAt: string } {
  const meta = getSceneMeta(db, id)
  const wordCount = countWords(text)
  const t = now()
  // A planned scene with text in it counts as drafted.
  const status = meta.status === 'planned' && wordCount > 0 ? 'drafted' : meta.status
  db.prepare('UPDATE scenes SET doc_json = ?, text = ?, word_count = ?, status = ?, updated_at = ? WHERE id = ?').run(
    doc == null ? null : JSON.stringify(doc),
    text,
    wordCount,
    status,
    t,
    id
  )
  return { wordCount, updatedAt: t }
}

export function updateSceneCard(db: DB, id: ID, card: SceneCard): SceneCard {
  getSceneMeta(db, id)
  const clean: SceneCard = { ...emptySceneCard(), ...card }
  db.prepare('UPDATE scenes SET card_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(clean), now(), id)
  return clean
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
        `SELECT s.id, s.chapter_id, s.title, s.position, s.status, s.word_count, s.updated_at
         FROM scenes s JOIN chapters c ON c.id = s.chapter_id
         WHERE c.story_id = ? AND s.deleted_at IS NULL AND c.deleted_at IS NULL
         ORDER BY c.position, s.position`
      )
      .all(storyId) as Row[]
  ).map(toSceneMeta)
  return { story, chapters, scenes }
}

/** Where a scene sits: its chapter and story. */
export function sceneLocation(db: DB, sceneId: ID): { scene: SceneMeta; chapter: Chapter; story: Story } {
  const scene = getSceneMeta(db, sceneId)
  const chapter = getChapter(db, scene.chapterId)
  return { scene, chapter, story: getStory(db, chapter.storyId) }
}

/**
 * The scene before this one in reading order: earlier in this story, or the
 * last scene of the story this one continues after. Milestone 2 replaces this
 * with the full line-building rules.
 */
export function previousScene(db: DB, sceneId: ID): Scene | null {
  const { story } = sceneLocation(db, sceneId)
  const order = getOutline(db, story.id).scenes
  const i = order.findIndex((s) => s.id === sceneId)
  if (i > 0) return getScene(db, order[i - 1].id)
  let prevStoryId = story.startStoryId
  const seen = new Set<ID>([story.id])
  while (prevStoryId && !seen.has(prevStoryId)) {
    seen.add(prevStoryId)
    try {
      const prev = getOutline(db, prevStoryId)
      const last = prev.scenes[prev.scenes.length - 1]
      if (last) return getScene(db, last.id)
      prevStoryId = prev.story.startStoryId
    } catch {
      return null
    }
  }
  return null
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
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string
})

export function listEntries(db: DB, kind?: EntryKind): Entry[] {
  const rows = kind
    ? db.prepare('SELECT * FROM entries WHERE kind = ? AND deleted_at IS NULL ORDER BY name COLLATE NOCASE').all(kind)
    : db.prepare('SELECT * FROM entries WHERE deleted_at IS NULL ORDER BY kind, name COLLATE NOCASE').all()
  return (rows as Row[]).map(toEntry)
}

export function getEntry(db: DB, id: ID): Entry {
  const r = db.prepare('SELECT * FROM entries WHERE id = ? AND deleted_at IS NULL').get(id) as Row | undefined
  if (!r) throw new UserError('That entry no longer exists.')
  return toEntry(r)
}

export function getEntries(db: DB, ids: ID[]): Entry[] {
  return ids.flatMap((id) => {
    const r = db.prepare('SELECT * FROM entries WHERE id = ? AND deleted_at IS NULL').get(id) as Row | undefined
    return r ? [toEntry(r)] : []
  })
}

export function createEntry(db: DB, kind: EntryKind, input: EntryInput = {}): Entry {
  const t = now()
  const id = newId()
  db.prepare(
    `INSERT INTO entries (id, kind, name, aliases_json, summary, description, tags_json, notes, fields_json, parent_id, hard_rule, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    t,
    t
  )
  return getEntry(db, id)
}

export function updateEntry(db: DB, id: ID, patch: EntryInput): Entry {
  const e = { ...getEntry(db, id), ...patch }
  if (e.parentId === id) e.parentId = null
  db.prepare(
    `UPDATE entries SET name = ?, aliases_json = ?, summary = ?, description = ?, tags_json = ?, notes = ?, fields_json = ?,
     parent_id = ?, hard_rule = ?, updated_at = ? WHERE id = ?`
  ).run(
    e.name.trim() || 'Unnamed',
    JSON.stringify(e.aliases),
    e.summary,
    e.description,
    JSON.stringify(e.tags),
    e.notes,
    JSON.stringify(e.fields),
    e.parentId,
    e.hardRule ? 1 : 0,
    now(),
    id
  )
  return getEntry(db, id)
}

export function deleteEntry(db: DB, id: ID): void {
  db.prepare('UPDATE entries SET deleted_at = ? WHERE id = ?').run(now(), id)
}
