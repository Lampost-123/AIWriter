// Clothes off for a while are never kept as what someone typically wears (code review, 2026-10-16: live on DeepSeek
// Flash, the memory set both lovers' Typical clothing to "none" and "nothing" after an undressing scene). The memory
// keeper leaves such a value out of a change, a detail and a new entry, and keeps the rest. Invented test text only.

import type Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as kdb from '../db/keeper'
import { planRead } from './track'
import { applyRead } from './apply'
import { Ids } from './request'
import { memoryAt } from './places'

function world(): { db: Database.Database; storyId: ID; sceneId: ID } {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const o = repo.getOutline(db, story.id)
  return { db, storyId: story.id, sceneId: o.scenes[0].id }
}

function save(db: Database.Database, sceneId: ID, paras: [string, string][]): void {
  const doc = {
    type: 'doc',
    content: paras.map(([pid, text]) => ({ type: 'paragraph', attrs: { pid }, content: [{ type: 'text', text }] }))
  }
  repo.saveSceneText(db, sceneId, doc, paras.map(([, t]) => t).join('\n\n'))
  kdb.noteSceneSaved(db, sceneId)
}

describe('the memory keeper and clothes off for a while', () => {
  it('keeps no Typical clothing that only says someone is undressed, in a change, a detail or a new entry', () => {
    const w = world()
    const mara = repo.createEntry(w.db, 'character', { name: 'Mara', fields: { clothing: 'a green wool dress' } }, { origin: 'text', originStoryId: w.storyId, originSceneId: w.sceneId })
    save(w.db, w.sceneId, [
      ['p1', 'Mara stepped out of her green dress and let her hair down loose.'],
      ['p2', 'Wren slipped in after her, naked as the day she was born, her grey eyes bright.']
    ])
    const s = kdb.keeperScene(w.db, w.sceneId)!
    const plan = planRead(w.db, s)
    const ctx = { runId: kdb.startRun(w.db, w.sceneId, plan.version), memory: memoryAt(w.db, w.storyId, w.sceneId), shape: null, sideClashes: null }
    const reply = {
      facts: [],
      add: [
        { type: 'change', entry: 'Mara', note: 'undressed', fields: { clothing: 'nothing', hair: 'loose' }, quote: 'let her hair down loose' },
        { type: 'change', entry: 'Mara', note: '', fields: { clothing: 'dress off' }, quote: 'stepped out of her green dress' },
        { type: 'detail', entry: 'Mara', field: 'clothing', value: 'naked', quote: 'stepped out of her green dress' },
        { type: 'entry', ref: 'N1', kind: 'character', name: 'Wren', summary: 'Comes in after Mara.', fields: { clothing: 'none', eyes: 'grey' }, quote: 'Wren slipped in after her' }
      ],
      clashes: []
    }
    w.db.transaction(() => applyRead(w.db, ctx, plan, [{ ids: new Ids(), reply, paras: plan.toRead }]))()
    // The change keeps its note and the hair; the clothing-only change has nothing left, so it is not made.
    const changes = mem.listAllChanges(w.db).filter((c) => c.entryId === mara.id)
    expect(changes.map((c) => (c.kind === 'update' ? c.payload : null))).toEqual([{ note: 'undressed', fields: { hair: 'loose' } }])
    expect(repo.getEntry(w.db, mara.id).fields.clothing).toBe('a green wool dress')
    const wren = repo.listEntries(w.db).find((e) => e.name === 'Wren')!
    expect(wren.fields).toEqual({ eyes: 'grey' })
  })

  it('keeps Typical clothing to what they usually wear, never a moment’s coat and scarf (live test, 2026-10-16)', () => {
    const w = world()
    const DRESS = 'grey wool dress, laced boots, her grandmother’s brass key on a cord round her neck'
    const nell = repo.createEntry(w.db, 'character', { name: 'Nell', fields: { clothing: DRESS } })
    save(w.db, w.sceneId, [['p1', 'Nell sat with her coat buttoned to the chin and the red wool scarf up round her jaw.']])
    const s = kdb.keeperScene(w.db, w.sceneId)!
    const plan = planRead(w.db, s)
    const ctx = { runId: kdb.startRun(w.db, w.sceneId, plan.version), memory: memoryAt(w.db, w.storyId, w.sceneId), shape: null, sideClashes: null }
    const moment = 'grey wool dress, laced boots, coat buttoned to the chin, the red wool scarf up round her jaw, her grandmother’s brass key on a cord round her neck'
    const reply = {
      facts: [],
      add: [
        { type: 'change', entry: 'Nell', note: 'wears the red wool scarf up round her jaw', fields: { clothing: moment }, quote: 'the red wool scarf up round her jaw' },
        { type: 'detail', entry: 'Nell', field: 'clothing', value: 'coat buttoned to the chin', quote: 'her coat buttoned to the chin' }
      ],
      clashes: []
    }
    w.db.transaction(() => applyRead(w.db, ctx, plan, [{ ids: new Ids(), reply, paras: plan.toRead }]))()
    // The note is kept; the clothing, with only the moment's pieces new, is not changed at all.
    const changes = mem.listAllChanges(w.db).filter((c) => c.entryId === nell.id)
    expect(changes.map((c) => (c.kind === 'update' ? c.payload : null))).toEqual([{ note: 'wears the red wool scarf up round her jaw' }])
    expect(repo.getEntry(w.db, nell.id).fields.clothing).toBe(DRESS)
  })

  it('reads an older change that kept a moment’s clothes as typical without them', () => {
    const w = world()
    const DRESS = 'grey wool dress, laced boots'
    const nell = repo.createEntry(w.db, 'character', { name: 'Nell', fields: { clothing: DRESS } })
    const next = repo.createScene(w.db, repo.getOutline(w.db, w.storyId).chapters[0].id, { title: 'Two' }).id
    mem.insertChange(w.db, {
      kind: 'update',
      payload: { note: 'cold on the train', fields: { clothing: 'grey wool dress, laced boots, coat buttoned to the chin' } },
      entryId: nell.id,
      anchor: 'scene',
      sceneId: w.sceneId,
      origin: 'text'
    })
    const later = memoryAt(w.db, w.storyId, next).entries.find((e) => e.id === nell.id)!
    expect(later.fields.clothing).toBe(DRESS)
    expect(later.changed ?? []).not.toContain('clothing')
  })
})
