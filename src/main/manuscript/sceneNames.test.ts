import { describe, expect, it } from 'vitest'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { emptySceneCard } from '@shared/defaults'
import { dbWorld } from '../../../tests/unit/testWorld'
import { ABSENT, sceneNames, stateLines, voiceNotes } from './sceneNames'

describe("a scene's names, as of the scene", () => {
  const w = dbWorld()
  const { db } = w

  it('gives every live entry with its state as of the end of the scene, its own changes included', () => {
    const names = sceneNames(db, w.id('b1.c2.s2'))
    expect(names.label).toBe('Book 1, Ch 2, Sc 2')
    expect(names.storyId).toBe(w.id('b1'))
    const mara = names.entries.find((e) => e.id === w.id('mara'))!
    expect(mara.summary).toBe("Heir to the Reach, raised as a smith's daughter.")
    expect(mara.absent).toBeNull()
    expect(mara.state).toEqual([
      { kind: 'happened', text: 'Lost her left hand', where: 'Book 1, Ch 2, Sc 2', here: true },
      { kind: 'field', text: 'Distinguishing marks: left hand missing', where: '', here: false }
    ])
    // The scene before doesn't know it yet.
    expect(sceneNames(db, w.id('b1.c2.s1')).entries.find((e) => e.id === w.id('mara'))!.state).toEqual([])
    // A later scene does, but not as this scene's.
    expect(sceneNames(db, w.id('b1.c3.s1')).entries.find((e) => e.id === w.id('mara'))!.state[0]).toEqual({
      kind: 'happened',
      text: 'Lost her left hand',
      where: 'Book 1, Ch 2, Sc 2',
      here: false
    })
  })

  it("marks entries that aren't in the story yet, and keeps plot threads (their names aren't underlined, but cards need them)", () => {
    const names = sceneNames(db, w.id('b1.c1.s1'))
    expect(names.entries.find((e) => e.id === w.id('kell'))!.absent).toBe(ABSENT)
    expect(names.entries.find((e) => e.id === w.id('burned'))!.kind).toBe('thread')
  })

  it("gives the scene card's cast, leaving out entries deleted since and the point of view among those present", () => {
    const scene = w.id('b1.c1.s2')
    repo.updateSceneCard(db, scene, {
      ...emptySceneCard(),
      povId: w.id('mara'),
      presentIds: [w.id('mara'), w.id('tobin'), 'gone', w.id('tobin')],
      locationId: w.id('mill')
    })
    expect(sceneNames(db, scene).cast).toEqual({ povId: w.id('mara'), presentIds: [w.id('tobin')], locationId: w.id('mill') })
    repo.deleteEntry(db, w.id('mill'))
    expect(sceneNames(db, scene).cast.locationId).toBeNull()
    expect(sceneNames(db, scene).entries.some((e) => e.id === w.id('mill'))).toBe(false)
    repo.restoreDeleted(db, 'entry', w.id('mill'))
  })

  it('gives the relationships as of the scene', () => {
    expect(sceneNames(db, w.id('b1.c2.s2')).relationships).toEqual([
      { aId: w.id('mara'), bId: w.id('tobin'), type: 'friend', aFeels: 'trusts him', bFeels: 'would die for her', where: '' }
    ])
  })

  it('refuses a scene that no longer exists, in plain words', () => {
    expect(() => sceneNames(db, 'gone')).toThrow('That scene no longer exists.')
  })

  it('reads the memory once for the whole scene, not once per entry', () => {
    const prepare = db.prepare.bind(db)
    let n = 0
    db.prepare = ((sql: string) => {
      n++
      return prepare(sql)
    }) as typeof db.prepare
    try {
      sceneNames(db, w.id('b2.c2.s2'))
    } finally {
      db.prepare = prepare
    }
    expect(n).toBeLessThan(25)
  })
})

describe('state lines and voice notes', () => {
  const base = { kind: 'character' as const, fields: {} as Record<string, string>, changed: [] as string[] }

  it('keeps the last few things that happened, oldest first, then the fields changes set', () => {
    const happened = ['one', 'two', 'three', 'four', 'five.'].map((note, i) => ({ note, where: `Sc ${i + 1}`, changeId: `c${i}` }))
    const lines = stateLines(
      {
        ...base,
        happened,
        changed: ['hair', 'description', 'speech', 'unknown', 'eyes'],
        fields: { hair: 'cropped  short', eyes: '', speech: 'Clipped' }
      },
      new Set(['c4'])
    )
    expect(lines.map((l) => l.text)).toEqual(['Two', 'Three', 'Four', 'Five', 'Hair: cropped short'])
    expect(lines[3]).toEqual({ kind: 'happened', text: 'Five', where: 'Sc 5', here: true })
  })

  it('gives voice notes only for a character that has some, without quotation marks of their own', () => {
    expect(voiceNotes({ kind: 'place', fields: { speech: 'Loud' } })).toBeNull()
    expect(voiceNotes({ kind: 'character', fields: {} })).toBeNull()
    expect(
      voiceNotes({
        kind: 'character',
        fields: { speech: 'Short,\nplain words', sampleLines: '“Get in the boat.”\n\n- "Not tonight."\nThird\nFourth' }
      })
    ).toEqual({ speech: 'Short, plain words', tics: '', neverSays: '', sampleLines: ['Get in the boat.', 'Not tonight.', 'Third'] })
  })
})

describe('speed', () => {
  it("is about as quick as a scene's briefing in a world with many entries and changes", () => {
    const w = dbWorld()
    const { db } = w
    db.transaction(() => {
      for (let i = 0; i < 500; i++) {
        const kind = i % 5 === 0 ? 'place' : 'character'
        const e = repo.createEntry(db, kind, { name: `Person ${i}`, aliases: [`P${i}`], summary: 'Someone.' })
        mem.insertChange(db, {
          kind: 'update',
          payload: { note: `changed ${i}`, fields: { hair: `style ${i}` } },
          entryId: e.id,
          anchor: 'scene',
          sceneId: w.id('b1.c1.s1'),
          storyId: w.id('b1'),
          origin: 'text'
        })
      }
    })()
    const scene = w.id('b2.c2.s2')
    sceneNames(db, scene)
    const t = performance.now()
    const names = sceneNames(db, scene)
    const ms = performance.now() - t
    expect(names.entries.length).toBeGreaterThan(500)
    // Generous for a slow test machine; typically a few milliseconds.
    expect(ms).toBeLessThan(250)
  })
})
