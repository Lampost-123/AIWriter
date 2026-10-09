// Where a scene's beats are, kept with the world (beat markers, 2026-10-08): tidied as they are saved, read back as
// saved, one row a scene in the meta table, and forgotten with null.
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import type { SceneBeatMarks } from '@shared/contracts/beats'
import { migrate } from '../db/migrations'
import { cleanMarks, getBeatMarks, MAX_BEATS, MAX_VERSIONS, saveBeatMarks } from './marks'

function world(): Database.Database {
  const db = new Database(':memory:')
  migrate(db)
  return db
}

const MARKS: SceneBeatMarks = {
  sceneId: 's1',
  sessionId: 'sess',
  of: 3,
  mode: 'whole',
  beats: [
    { index: 1, pids: ['a', 'b'], versions: [{ recordId: 'g1', at: 100, sig: 'x1' }] },
    { index: 2, pids: ['c'], versions: [{ recordId: 'g2', at: 200, sig: 'x2' }], keptAt: 300 }
  ]
}

describe('beat marks kept with the scene', () => {
  it('reads back what was saved, for that scene only', () => {
    const db = world()
    expect(getBeatMarks(db, 's1')).toBeNull()
    saveBeatMarks(db, 's1', MARKS)
    expect(getBeatMarks(db, 's1')).toEqual(MARKS)
    expect(getBeatMarks(db, 's2')).toBeNull()
    // Saved under another scene, they become that scene's.
    saveBeatMarks(db, 's2', MARKS)
    expect(getBeatMarks(db, 's2')?.sceneId).toBe('s2')
  })

  it('keeps whether the session was still on (not finished), and only when it was', () => {
    const db = world()
    saveBeatMarks(db, 's1', { ...MARKS, open: true })
    expect(getBeatMarks(db, 's1')?.open).toBe(true)
    saveBeatMarks(db, 's1', { ...MARKS, open: false })
    expect(getBeatMarks(db, 's1')).toEqual(MARKS)
    expect(cleanMarks('s1', { ...MARKS, open: 'yes' })).toEqual(MARKS)
  })

  it('forgets them with null, or with no beats', () => {
    const db = world()
    saveBeatMarks(db, 's1', MARKS)
    saveBeatMarks(db, 's1', null)
    expect(getBeatMarks(db, 's1')).toBeNull()
    saveBeatMarks(db, 's1', MARKS)
    saveBeatMarks(db, 's1', { ...MARKS, beats: [] })
    expect(getBeatMarks(db, 's1')).toBeNull()
  })

  it('keeps a session still on with no beats yet, and where its first beat goes', () => {
    const db = world()
    saveBeatMarks(db, 's1', { ...MARKS, beats: [], open: true, start: 'add' })
    expect(getBeatMarks(db, 's1')).toEqual({ ...MARKS, beats: [], open: true, start: 'add' })
    expect(cleanMarks('s1', { ...MARKS, start: 'somewhere' })).toEqual(MARKS)
    // Finished before any beat put words on the page: nothing is left to keep.
    saveBeatMarks(db, 's1', { ...MARKS, beats: [], open: false, start: 'add' })
    expect(getBeatMarks(db, 's1')).toBeNull()
  })

  it('tidies what is sent: no bad beats, ids or versions, no repeats, in order, kept to a sensible size', () => {
    expect(cleanMarks('s1', null)).toBeNull()
    expect(cleanMarks('s1', { beats: MARKS.beats })).toBeNull()
    const messy = {
      sessionId: 'sess',
      of: 'x',
      mode: 'sideways',
      beats: [
        { index: 2, pids: ['c', 'c', 7, ''], versions: [{ recordId: 'g2', at: 200, sig: 5 }, { recordId: '', at: 1 }, null] },
        { index: 0, pids: ['z'], versions: [] },
        { index: 1.7, pids: ['a'], versions: [] },
        { index: 2, pids: ['d'], versions: [] },
        { index: MAX_BEATS + 1, pids: ['y'], versions: [] },
        { index: 3, pids: 'no', versions: Array.from({ length: MAX_VERSIONS + 5 }, (_, i) => ({ recordId: `r${i}`, at: i, sig: '' })) }
      ]
    }
    const clean = cleanMarks('s1', messy)!
    expect(clean.mode).toBe('whole')
    expect(clean.of).toBe(3)
    expect(clean.beats.map((b) => b.index)).toEqual([1, 2, 3])
    expect(clean.beats[1]).toEqual({ index: 2, pids: ['c'], versions: [{ recordId: 'g2', at: 200, sig: '' }] })
    expect(clean.beats[2].pids).toEqual([])
    expect(clean.beats[2].versions).toHaveLength(MAX_VERSIONS)
    expect(clean.beats[2].versions[0].recordId).toBe('r5')
  })

  it('reads a broken row as none', () => {
    const db = world()
    db.prepare("INSERT INTO meta (key, value) VALUES ('beat_marks:s1', '{not json')").run()
    expect(getBeatMarks(db, 's1')).toBeNull()
  })
})
