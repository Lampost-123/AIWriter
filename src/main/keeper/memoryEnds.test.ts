// Facts with a start and an end (World Memory Overhaul B1, 2026-10-08): a change can stop being true at a later scene
// ("lost her knife" ends where she finds it again). What the writer is given at a scene holds only what is still true
// there; the canon timeline keeps what ended as history; entry pages say "until"; the memory model ends a fact with an
// "end" item, which follows its words like any fact and never touches what Adam made himself. Migration 4 only adds
// columns. All text is invented; the memory model is the fake one (tests/fake-provider): no paid calls.

import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import { defaultWritingPrefs } from '@shared/defaults'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import { entryNamed, readScene, saveParas, testWorld } from '../../../tests/unit/keeperRead'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as kdb from '../db/keeper'
import { MIGRATIONS, migrate } from '../db/migrations'
import { undoItem } from './undo'
import { gatherContextInput } from '../ai/gather'
import { mustStayTrue } from '../ai/mustStay'
import { timelineMarks } from '../ai/timeline'
import { changeViews, sceneMemory } from '../memory/scene'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0 })
})
afterAll(() => fake.close())

type DB = Database.Database

const writerMemory = (db: DB, sceneId: ID) =>
  gatherContextInput(db, sceneId, undefined, { prefs: defaultWritingPrefs(), contextLength: 32000, creativity: 'balanced' }).memory
const writerEntry = (db: DB, sceneId: ID, name: string) => writerMemory(db, sceneId).entries.find((e) => e.name === name) ?? null
const mustLines = (db: DB, sceneId: ID, names: string[]): string => {
  const m = writerMemory(db, sceneId)
  return mustStayTrue({
    stand: null,
    reach: 'later',
    people: names.map((n) => m.entries.find((e) => e.name === n)!).filter(Boolean),
    named: [],
    facts: m.facts,
    sceneId,
    storyTitle: '',
    places: {}
  }).join('\n')
}
const changesOf = (db: DB, name: string) => {
  const e = entryNamed(db, name)
  return e ? mem.changesForEntry(db, e.id) : []
}
const logLine = (db: DB, pred: (l: kdb.LogRow) => boolean) => kdb.listLog(db, { limit: 100 }).find(pred) ?? null

const LOST = 'Mara lost her knife.'
const FOUND = 'The next morning, Mara found her knife again.'

describe('a fact the story ends', () => {
  it('holds until the scene that ends it, then is only history', async () => {
    const w = testWorld(3)
    const [s1, s2, s3, s4] = w.scenes
    saveParas(w.db, s1, [['p1', LOST]])
    await readScene(w.db, fake, s1)
    saveParas(w.db, s3, [['p3', FOUND]])
    await readScene(w.db, fake, s3)

    const [c] = changesOf(w.db, 'Mara')
    expect(c.until).toMatchObject({ sceneId: s3, when: 'the next morning', origin: 'text', quote: FOUND, paragraphId: 'p3' })

    // Before the end: still true (the briefing and what must stay true have it).
    expect(writerEntry(w.db, s2, 'Mara')!.happened.map((h) => h.note)).toEqual(['lost her knife'])
    expect(writerEntry(w.db, s2, 'Mara')!.fields.marks ?? '').toContain('knife')
    expect(mustLines(w.db, s2, ['Mara'])).toContain('knife')
    // Drafting the scene that ends it: the end is that scene's own news, so it still holds as the scene begins.
    expect(writerEntry(w.db, s3, 'Mara')!.happened.map((h) => h.note)).toEqual(['lost her knife'])
    // After it: no longer true, kept as history with where it stopped.
    const after = writerEntry(w.db, s4, 'Mara')!
    expect(after.happened).toEqual([])
    expect(after.fields.marks ?? '').not.toContain('knife')
    expect(after.ended?.map((h) => [h.note, h.until, h.when])).toEqual([['lost her knife', expect.stringContaining('Sc 3'), 'the next morning']])
    expect(mustLines(w.db, s4, ['Mara'])).not.toContain('knife')
  })

  it('says so in What changed, with Undo that makes it true again (and not ended again from the same words)', async () => {
    const w = testWorld(2)
    const [s1, s2, s3] = w.scenes
    saveParas(w.db, s1, [['p1', LOST]])
    await readScene(w.db, fake, s1)
    saveParas(w.db, s2, [['p2', FOUND]])
    await readScene(w.db, fake, s2)
    const [c] = changesOf(w.db, 'Mara')
    const line = logLine(w.db, (l) => l.factId === c.id && l.text.startsWith('No longer true from here'))!
    expect(line.text).toBe('No longer true from here: lost her knife (the next morning)')
    expect(line.quote).toBe(FOUND)
    undoItem(w.db, line.id)
    expect(mem.getChange(w.db, c.id).until).toBeUndefined()
    expect(writerEntry(w.db, s3, 'Mara')!.happened.map((h) => h.note)).toEqual(['lost her knife'])
    // Read again with the same words: Adam's Undo stands.
    saveParas(w.db, s2, [
      ['p2', FOUND],
      ['p4', 'The gulls were loud.']
    ])
    await readScene(w.db, fake, s2)
    expect(mem.getChange(w.db, c.id).until).toBeUndefined()
  })

  it('follows its words: moved words carry it, deleted words make the fact true again', async () => {
    const w = testWorld(2)
    const [s1, s2, s3] = w.scenes
    saveParas(w.db, s1, [['p1', LOST]])
    await readScene(w.db, fake, s1)
    saveParas(w.db, s2, [
      ['p2', 'The ferry was late.'],
      ['p3', FOUND]
    ])
    await readScene(w.db, fake, s2)
    const [c] = changesOf(w.db, 'Mara')
    saveParas(w.db, s2, [
      ['p3', FOUND],
      ['p2', 'The ferry was late.']
    ])
    await readScene(w.db, fake, s2)
    expect(mem.getChange(w.db, c.id).until?.paragraphId).toBe('p3')
    saveParas(w.db, s2, [['p2', 'The ferry was late.']])
    await readScene(w.db, fake, s2)
    expect(mem.getChange(w.db, c.id).until).toBeUndefined()
    expect(logLine(w.db, (l) => l.factId === c.id && l.action === 'removed')!.text).toBe(
      'True again: lost her knife (the words that ended it are gone)'
    )
    expect(writerEntry(w.db, s3, 'Mara')!.happened.map((h) => h.note)).toEqual(['lost her knife'])
  })

  it("never ends Adam's own fact: a quiet note instead", async () => {
    const w = testWorld(2)
    const [s1, s2, s3] = w.scenes
    const mara = repo.createEntry(w.db, 'character', { name: 'Mara' })
    const mine = mem.insertChange(w.db, {
      kind: 'update',
      payload: { note: 'lost her knife' },
      entryId: mara.id,
      anchor: 'scene',
      sceneId: s1,
      origin: 'adam'
    })
    saveParas(w.db, s2, [['p2', FOUND]])
    await readScene(w.db, fake, s2)
    expect(mem.getChange(w.db, mine.id).until).toBeUndefined()
    expect(logLine(w.db, (l) => l.factId === mine.id)!.text).toBe('Lost her knife: the scene says this is no longer true (yours is kept as it is)')
    expect(writerEntry(w.db, s3, 'Mara')!.happened.map((h) => h.note)).toEqual(['lost her knife'])
  })

  it('puts back a field it set, but not one a later change set again', () => {
    const w = testWorld(3)
    const [s1, s2, s3, s4] = w.scenes
    const mara = repo.createEntry(w.db, 'character', { name: 'Mara', fields: { marks: 'a scar on her chin' } })
    const tobin = repo.createEntry(w.db, 'character', { name: 'Tobin' })
    const lost = mem.insertChange(w.db, {
      kind: 'update',
      payload: { note: 'hurt her arm', fields: { condition: 'arm in a sling' } },
      entryId: mara.id,
      anchor: 'scene',
      sceneId: s1,
      origin: 'text'
    })
    const rel = mem.insertChange(w.db, {
      kind: 'relationship',
      payload: { otherId: tobin.id, type: 'travelling with', feels: '', otherFeels: '' },
      entryId: mara.id,
      anchor: 'scene',
      sceneId: s1,
      origin: 'text'
    })
    const knows = mem.insertChange(w.db, {
      kind: 'knowledge',
      payload: { factId: 'f1', fact: 'the bridge is out' },
      entryId: tobin.id,
      anchor: 'scene',
      sceneId: s1,
      origin: 'text'
    })
    const marks = mem.insertChange(w.db, {
      kind: 'update',
      payload: { note: 'scarred', fields: { marks: 'a fresh scar on her cheek' } },
      entryId: mara.id,
      anchor: 'scene',
      sceneId: s1,
      origin: 'text'
    })
    const later = mem.insertChange(w.db, {
      kind: 'update',
      payload: { note: 'the scar healed', fields: { marks: 'a faint line' } },
      entryId: mara.id,
      anchor: 'scene',
      sceneId: s2,
      origin: 'text'
    })
    const end = { sceneId: s3, when: '', origin: 'text' as const, quote: 'x', paragraphId: null }
    for (const id of [lost.id, rel.id, knows.id, marks.id]) mem.setChangeUntil(w.db, id, end, { origin: 'text' })
    const at = sceneMemory(w.db, s4)
    const m = at.entries.find((e) => e.id === mara.id)!
    expect(m.fields.condition ?? '').toBe('')
    expect(m.changed).not.toContain('condition')
    // The scar was set again later: that later value stands.
    expect(m.fields.marks).toBe('a faint line')
    expect(at.relationships).toEqual([])
    expect(at.facts.find((f) => f.factId === 'f1')?.knownBy ?? []).toEqual([])
    expect(m.happened.map((h) => h.note)).toEqual(['the scar healed'])
    expect(later.until).toBeUndefined()
    // Before the end, all of it holds.
    const before = sceneMemory(w.db, s3)
    expect(before.entries.find((e) => e.id === mara.id)!.fields.condition).toBe('arm in a sling')
    expect(before.relationships).toHaveLength(1)
  })
})

describe('where an ended fact shows', () => {
  it('the entry page says until where', async () => {
    const w = testWorld(2)
    const [s1, s2] = w.scenes
    saveParas(w.db, s1, [['p1', LOST]])
    await readScene(w.db, fake, s1)
    saveParas(w.db, s2, [['p2', FOUND]])
    await readScene(w.db, fake, s2)
    const views = changeViews(w.db, changesOf(w.db, 'Mara'))
    expect(views[0].untilWhere).toMatch(/Sc 2$/)
  })

  it('the canon timeline marks it as past', () => {
    const marks = timelineMarks(
      [
        {
          kind: 'character',
          name: 'Mara',
          happened: [],
          ended: [{ note: 'lost her knife', where: 'Book 1, Ch 1, Sc 1', changeId: 'c1', at: 1, until: 'Book 1, Ch 1, Sc 3' }]
        }
      ],
      'Book 1'
    )
    expect(marks.get('Book 1, Ch 1, Sc 1')).toEqual(['Mara: lost her knife (until Ch 1, Sc 3)'])
  })
})

describe('migration 4', () => {
  it('only adds columns: a world from before opens and its changes still hold', () => {
    const db = new Database(':memory:')
    db.exec(MIGRATIONS[0])
    db.exec(MIGRATIONS[1])
    db.exec(MIGRATIONS[2])
    db.pragma('user_version = 3')
    db.prepare(
      `INSERT INTO entries (id, kind, name, created_at, updated_at) VALUES ('e1', 'character', 'Mara', '2026-01-01', '2026-01-01')`
    ).run()
    db.prepare(
      `INSERT INTO changes (id, entry_id, anchor, kind, payload_json, created_at, updated_at)
       VALUES ('c1', 'e1', 'baseline', 'update', '{"note":"lost her knife"}', '2026-01-01', '2026-01-01')`
    ).run()
    expect(migrate(db)).toEqual({ from: 3, to: 4 })
    const cols = (db.prepare('PRAGMA table_info(changes)').all() as { name: string }[]).map((c) => c.name)
    expect(cols).toEqual(expect.arrayContaining(['until_scene_id', 'until_when', 'until_origin', 'until_quote', 'until_paragraph_id']))
    const c = mem.getChange(db, 'c1')
    expect(c.until).toBeUndefined()
    expect(c.kind === 'update' && c.payload.note).toBe('lost her knife')
    db.close()
  })

  it('a world saved before the overhaul (version 2) goes through 3 and 4 with its entries, changes and links whole', () => {
    const db = new Database(':memory:')
    db.exec(MIGRATIONS[0])
    db.exec(MIGRATIONS[1])
    db.pragma('user_version = 2')
    db.prepare(
      `INSERT INTO entries (id, kind, name, created_at, updated_at) VALUES ('e1', 'character', 'Tobin', '2026-01-01', '2026-01-01')`
    ).run()
    db.prepare(
      `INSERT INTO changes (id, entry_id, anchor, kind, payload_json, created_at, updated_at)
       VALUES ('c1', 'e1', 'baseline', 'update', '{"note":"has a lantern"}', '2026-01-01', '2026-01-01')`
    ).run()
    const link = db.prepare(
      `INSERT INTO source_links (id, fact_kind, fact_id, field, scene_id, scene_version, paragraph_id, start, end, quote, state, created_at, updated_at)
       VALUES (?, 'change', 'c1', NULL, 's1', 1, 'p1', 0, 6, 'Tobin.', ?, '2026-01-01', ?)`
    )
    link.run('l1', 'ok', '2026-01-02')
    link.run('l2', 'changed', '2026-01-03')
    expect(migrate(db)).toEqual({ from: 2, to: MIGRATIONS.length })
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)
    expect(db.prepare(`SELECT id, name FROM entries`).all()).toEqual([{ id: 'e1', name: 'Tobin' }])
    const c = mem.getChange(db, 'c1')
    expect(c.until).toBeUndefined()
    expect(c.kind === 'update' && c.payload.note).toBe('has a lantern')
    expect(db.prepare('SELECT id, quote, state, changed_at, checks FROM source_links ORDER BY id').all()).toEqual([
      { id: 'l1', quote: 'Tobin.', state: 'ok', changed_at: null, checks: 0 },
      { id: 'l2', quote: 'Tobin.', state: 'changed', changed_at: '2026-01-03', checks: 0 }
    ])
    db.close()
  })
})
