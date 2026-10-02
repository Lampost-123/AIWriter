// The memory as of a point (milestone 3): "Any entry can be viewed as of any scene". Checked on the
// fixed test world, so as-of views follow the same multi-story rules as drafting.

import { describe, expect, it } from 'vitest'
import * as repo from '../../src/main/db/repo'
import { asOfStops, entryAsOf } from '../../src/main/memory/asOf'
import { dbWorld } from './testWorld'
import { memoryWorld } from './helpers'

describe('an entry as of a point', () => {
  const w = dbWorld()
  const { db } = w
  const mara = w.id('mara')
  const scene = (key: string, seenIn?: string) => {
    const story = key.split('.')[0]
    return { kind: 'scene' as const, storyId: w.id(story), sceneId: w.id(key), seenIn: seenIn ? w.id(seenIn) : null }
  }

  it("includes the scene's own changes: Mara has lost her hand by the end of Book 1, Ch 2, Sc 2", () => {
    const before = entryAsOf(db, mara, scene('b1.c2.s1'))
    expect(before.label).toBe('Book 1, Ch 2, Sc 1')
    expect(before.state?.fields.marks).toBe('none')
    const after = entryAsOf(db, mara, scene('b1.c2.s2'))
    expect(after.state?.fields.marks).toBe('left hand missing')
    expect(after.state?.happened.map((h) => h.note)).toContain('lost her left hand')
  })

  it('can be seen along a later story: a side story scene seen in Book 2 knows the rest of Book 1 before it', () => {
    // Kell's Road runs during Book 1 from after Ch 1; on its own it doesn't know Book 1's Ch 2.
    expect(entryAsOf(db, mara, scene('kr.c1.s1')).state?.fields.marks).toBe('none')
    // Book 2 reaches Kell's Road where it ends, after Book 1's Ch 2.
    expect(entryAsOf(db, mara, scene('kr.c1.s1', 'b2')).state?.fields.marks).toBe('left hand missing')
  })

  it('a what-if never reaches another story', () => {
    const keep = entryAsOf(db, mara, { kind: 'end', storyId: w.id('keep') })
    expect(keep.label).toBe('End of Mara Keeps Her Hand')
    expect(keep.state?.fields.marks).toBe('none')
    expect(entryAsOf(db, mara, { kind: 'start', storyId: w.id('b4') }).state?.happened.map((h) => h.note)).not.toContain(
      'learned to fight with both hands'
    )
  })

  it('says when an entry is not there yet', () => {
    const kell = w.id('kell')
    const early = entryAsOf(db, kell, { kind: 'start', storyId: w.id('b1') })
    expect(early.state).toBeNull()
    expect(early.absent).toBe('Not in the story yet at this point')
    expect(early.relationships).toEqual([])
  })

  it('refuses a scene that no longer exists, in plain words', () => {
    expect(() => entryAsOf(db, mara, { kind: 'scene', storyId: w.id('b1'), sceneId: 'gone' })).toThrow('That scene no longer exists.')
  })
})

describe('as-of slider stops', () => {
  const w = dbWorld()

  it('walk the story line in reading order, from the start of the first story to the last scene', () => {
    const stops = asOfStops(w.db, w.id('b2'))
    expect(stops[0]).toMatchObject({ label: 'Start of Book 1', sceneId: null })
    const labels = stops.map((s) => s.label)
    // Kell's Road is added whole where it ends, after Book 1's Ch 2; The Quiet Year comes before Book 2.
    expect(labels.indexOf("Kell's Road, Ch 1, Sc 1")).toBeGreaterThan(labels.indexOf('Book 1, Ch 2, Sc 2'))
    expect(labels.indexOf('Start of Book 2')).toBeGreaterThan(labels.indexOf('The Quiet Year, Ch 1, Sc 1'))
    expect(labels[labels.length - 1]).toMatch(/^Book 2, Ch 6, Sc 1$|^Wolf Winter/)
    // Every stop is seen along Book 2.
    expect(stops.every((s) => s.at.seenIn === w.id('b2'))).toBe(true)
  })

  it("mark where an entry changes", () => {
    const stops = asOfStops(w.db, w.id('b1'), w.id('mara'))
    expect(stops.find((s) => s.label === 'Book 1, Ch 2, Sc 2')?.changes).toBe(1)
    expect(stops.find((s) => s.label === 'Book 1, Ch 1, Sc 1')?.changes).toBe(0)
  })
})

describe('portraits', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

  it('are kept with the entry but never carried in lists', () => {
    const db = memoryWorld()
    const e = repo.createEntry(db, 'character', { name: 'Mara' })
    expect(e.image).toBeNull()
    const withImage = repo.setEntryImage(db, e.id, { bytes: png, type: 'image/png' })
    expect(withImage.image).toMatch(/^aiwrite-image:\/\/entry\/.+\?v=\S+$/)
    expect(withImage.byHand).toBe(true)
    expect(repo.listEntries(db)[0].image).toBe(withImage.image)
    expect(JSON.stringify(repo.listEntries(db))).not.toContain('base64')
    const back = repo.getEntryImage(db, e.id)
    expect(back?.type).toBe('image/png')
    expect([...back!.bytes]).toEqual([...png])
  })

  it('change address when the picture changes, and can be removed', () => {
    const db = memoryWorld()
    const e = repo.createEntry(db, 'place', { name: 'The Reach' })
    const one = repo.setEntryImage(db, e.id, { bytes: png, type: 'image/png' }).image
    const two = repo.setEntryImage(db, e.id, { bytes: new Uint8Array([...png, 4]), type: 'image/png' }).image
    expect(two).not.toBe(one)
    expect(repo.setEntryImage(db, e.id, null).image).toBeNull()
    expect(repo.getEntryImage(db, e.id)).toBeNull()
  })

  it('refuse files that are not pictures, in plain words', () => {
    const db = memoryWorld()
    const e = repo.createEntry(db, 'item', { name: 'Sword' })
    expect(() => repo.setEntryImage(db, e.id, { bytes: png, type: 'application/pdf' })).toThrow(/isn’t a picture/)
  })
})
