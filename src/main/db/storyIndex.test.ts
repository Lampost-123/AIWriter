// The story index's tables (migration 5) and their SQL: a scene's rows written whole and dropped whole, places kept up
// to date, facts true at a point, and entries found by id, name or other name. Worlds made in memory.
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { memoryWorld } from '../../../tests/unit/helpers'
import { MIGRATIONS, migrate } from './migrations'
import * as repo from './repo'
import * as sidx from './storyIndex'
import { purgeTrash } from './trash'
import type { NewIndexFact } from '../storyIndex/types'

const columns = (db: Database.Database, table: string): string[] =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)

function world() {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const o = repo.getOutline(db, story.id)
  const s1 = o.scenes[0].id
  const s2 = repo.createScene(db, o.chapters[0].id, {}).id
  const s3 = repo.createScene(db, o.chapters[0].id, {}).id
  return { db, storyId: story.id, s1, s2, s3 }
}

const row = (sceneId: string, storyId: string, position: number) => ({
  sceneId,
  storyId,
  position,
  label: `Ch 1, Sc ${position}`,
  gist: '',
  present: [],
  mentioned: [],
  placeEntryId: null,
  whenText: '',
  sourceHash: `h${position}`,
  filled: 'free' as const
})

const fact = (more: Partial<NewIndexFact> & Pick<NewIndexFact, 'fromSceneId'>): NewIndexFact => ({
  entryId: 'mara',
  kind: 'where',
  slot: '',
  value: 'the inn',
  quote: '',
  origin: 'tracker',
  ...more
})

describe('the story index tables', () => {
  it('are made by migration 5, empty, beside everything that was there', () => {
    const db = memoryWorld()
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)
    expect(columns(db, 'index_scenes')).toEqual([
      'scene_id',
      'story_id',
      'position',
      'label',
      'gist',
      'present_json',
      'mentioned_json',
      'place_entry_id',
      'when_text',
      'source_hash',
      'filled',
      'updated_at'
    ])
    expect(columns(db, 'index_facts')).toEqual([
      'id',
      'story_id',
      'entry_id',
      'kind',
      'slot',
      'value',
      'from_scene_id',
      'until_scene_id',
      'source_scene_id',
      'quote',
      'origin',
      'created_at'
    ])
    expect(columns(db, 'index_threads')).toEqual(['id', 'story_id', 'thread_entry_id', 'scene_id', 'event', 'note'])
    const indexes = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'index_facts'").all() as { name: string }[]
    ).map((r) => r.name)
    expect(indexes).toContain('index_facts_entry')
    for (const t of ['index_scenes', 'index_facts', 'index_threads'])
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()).toEqual({ n: 0 })
  })

  it('come to a world made before them, which keeps everything it had', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    for (let v = 0; v < 4; v++) db.exec(MIGRATIONS[v])
    db.pragma('user_version = 4')
    repo.initWorld(db, 'w', 'Old world')
    const stories = repo.listStories(db).length
    expect(migrate(db)).toEqual({ from: 4, to: 5 })
    expect(repo.listStories(db)).toHaveLength(stories)
    expect(columns(db, 'index_threads')).toHaveLength(6)
  })

  it('go with a scene emptied from Recently deleted', () => {
    const w = world()
    sidx.writeSceneIndex(w.db, row(w.s2, w.storyId, 2), [fact({ fromSceneId: w.s2 })], [{ threadEntryId: 't', event: 'opened', note: '' }])
    repo.deleteScene(w.db, w.s2)
    expect(sidx.indexScene(w.db, w.s2)).not.toBeNull()
    purgeTrash(w.db, 0, Date.now() + 60_000)
    expect(sidx.indexScene(w.db, w.s2)).toBeNull()
    expect(w.db.prepare('SELECT COUNT(*) AS n FROM index_facts').get()).toEqual({ n: 0 })
    expect(w.db.prepare('SELECT COUNT(*) AS n FROM index_threads').get()).toEqual({ n: 0 })
  })
})

describe('the story index SQL', () => {
  it('writes a scene’s rows in place of the old, and drops them whole', () => {
    const w = world()
    sidx.writeSceneIndex(w.db, { ...row(w.s1, w.storyId, 1), present: ['mara'], mentioned: ['ash'] }, [fact({ fromSceneId: w.s1 })], [])
    sidx.writeSceneIndex(w.db, row(w.s1, w.storyId, 1), [fact({ fromSceneId: w.s1, value: 'the market' })], [])
    expect(sidx.indexScene(w.db, w.s1)).toMatchObject({ present: [], mentioned: [], sourceHash: 'h1', filled: 'free' })
    expect(sidx.storyFactsInOrder(w.db, w.storyId).map((f) => f.value)).toEqual(['the market'])
    sidx.dropSceneIndex(w.db, [w.s1])
    expect(sidx.indexScenes(w.db, w.storyId)).toEqual([])
    expect(sidx.storyFactsInOrder(w.db, w.storyId)).toEqual([])
  })

  it('moves rows to their new places, and reads the facts true at a point', () => {
    const w = world()
    sidx.writeSceneIndex(w.db, row(w.s1, w.storyId, 1), [fact({ fromSceneId: w.s1 })], [])
    sidx.writeSceneIndex(
      w.db,
      row(w.s2, w.storyId, 2),
      [fact({ fromSceneId: w.s2, value: '' }), fact({ fromSceneId: w.s2, kind: 'knows', slot: 'f1', value: 'a secret' })],
      []
    )
    sidx.writeSceneIndex(w.db, row(w.s3, w.storyId, 3), [], [])
    const [inn] = sidx.storyFactsInOrder(w.db, w.storyId)
    sidx.setFactEnds(w.db, [{ id: inn.id, untilSceneId: w.s2 }])
    expect(sidx.factsAt(w.db, w.storyId, 1).map((f) => [f.value, f.untilLabel])).toEqual([['the inn', 'Ch 1, Sc 2']])
    expect(sidx.factsAt(w.db, w.storyId, 2).map((f) => f.value)).toEqual(['a secret'])
    expect(sidx.factsAt(w.db, w.storyId, 3, { entryId: 'mara', kinds: ['where'] })).toEqual([])
    expect(
      sidx.placeIndexScenes(w.db, [
        { sceneId: w.s3, position: 1, label: 'Ch 1, Sc 1' },
        { sceneId: w.s1, position: 2, label: 'Ch 1, Sc 2' },
        { sceneId: w.s2, position: 3, label: 'Ch 1, Sc 3' }
      ])
    ).toBe(3)
    expect(sidx.placeIndexScenes(w.db, [{ sceneId: w.s3, position: 1, label: 'Ch 1, Sc 1' }])).toBe(0)
    expect(sidx.indexScenes(w.db, w.storyId).map((s) => s.sceneId)).toEqual([w.s3, w.s1, w.s2])
  })

  it('finds an entry by id, name or other name, whatever the case; not a name two share', () => {
    const w = world()
    const mara = repo.createEntry(w.db, 'character', { name: 'Mara Venn', aliases: ['the Captain'] })
    repo.createEntry(w.db, 'character', { name: 'Ash' })
    repo.createEntry(w.db, 'place', { name: 'Ash' })
    expect(sidx.findIndexEntry(w.db, mara.id)?.name).toBe('Mara Venn')
    expect(sidx.findIndexEntry(w.db, '  mara   venn ')?.id).toBe(mara.id)
    expect(sidx.findIndexEntry(w.db, 'THE CAPTAIN')?.id).toBe(mara.id)
    expect(sidx.findIndexEntry(w.db, 'Ash')).toBeNull()
    expect(sidx.findIndexEntry(w.db, 'Nobody')).toBeNull()
  })
})
