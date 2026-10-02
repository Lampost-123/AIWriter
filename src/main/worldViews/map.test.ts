// The relationship map on the fixed test world (tests/unit/testWorld.ts): Mara and Tobin are friends
// before any story, enemies from Book 2, Ch 2, Sc 2, and neighbours in the prequel Young Mara.
import { describe, expect, it } from 'vitest'
import type { AsOf } from '@shared/types'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { dbWorld } from '../../../tests/unit/testWorld'
import { memoryWorld } from '../../../tests/unit/helpers'
import { relationshipMapOf } from './index'
import { belongs, graphKey, worldGraph } from './map'
import { loadMemoryData } from '../memory/scene'

function world() {
  const w = dbWorld()
  const { db } = w
  const guild = repo.createEntry(db, 'group', { name: 'The Tide Guild' })
  const rel = (from: string, other: string, type: string, scene?: string) =>
    mem.insertChange(db, {
      kind: 'relationship',
      payload: { otherId: other, type, feels: '', otherFeels: '' },
      entryId: from,
      anchor: scene ? 'scene' : 'baseline',
      sceneId: scene ? w.id(scene) : null,
      origin: 'adam'
    })
  rel(w.id('mara'), guild.id, 'member (lieutenant)', 'b1.c2.s1')
  rel(w.id('kell'), guild.id, 'sworn enemy', 'kr.c1.s2')
  rel(w.id('kell'), w.id('mara'), 'owes money', 'kr.c1.s2')
  return { ...w, guild }
}

describe('the relationship map', () => {
  const w = world()
  const scene = (key: string, seenIn: string): AsOf => ({
    kind: 'scene',
    storyId: w.id(key.split('.')[0]),
    sceneId: w.id(key),
    seenIn: w.id(seenIn)
  })
  const map = (story: string, at: AsOf | null = null, sceneId: string | null = null) => relationshipMapOf(w.db, w.id(story), at, sceneId)
  const link = (m: ReturnType<typeof map>, a: string, b: string) =>
    m.links.find((l) => (l.aId === w.id(a) && l.bId === w.id(b)) || (l.aId === w.id(b) && l.bId === w.id(a)))

  it('shows relationships as of the point, changing as the slider moves', () => {
    const before = map('b2', scene('b2.c2.s1', 'b2'))
    expect(link(before, 'mara', 'tobin')).toMatchObject({ type: 'friend', where: '' })
    const after = map('b2', scene('b2.c2.s2', 'b2'))
    expect(after.label).toBe('Book 2, Ch 2, Sc 2')
    expect(link(after, 'mara', 'tobin')).toMatchObject({ type: 'enemy', where: 'Book 2, Ch 2, Sc 2' })
    // How each feels, from each side.
    const l = link(after, 'mara', 'tobin')!
    expect(l.aId === w.id('tobin') ? [l.aFeels, l.bFeels] : [l.bFeels, l.aFeels]).toEqual(['betrayed', 'guilty'])
  })

  it('keeps everyone in the same place as the slider moves and the story changes', () => {
    const where = (m: ReturnType<typeof map>) => new Map(m.nodes.map((n) => [n.id, [n.x, n.y]]))
    const a = where(map('b2', scene('b1.c1.s1', 'b2')))
    const b = where(map('b2', scene('b2.c2.s2', 'b2')))
    const c = where(map('ym'))
    for (const id of ['mara', 'tobin'].map(w.id)) {
      expect(b.get(id)).toEqual(a.get(id))
      expect(c.get(id)).toEqual(a.get(id))
    }
  })

  it('is seen along the story chosen: the prequel has them as neighbours', () => {
    expect(link(map('ym'), 'mara', 'tobin')?.type).toBe('neighbour')
  })

  it('shows a character only once they exist and have a relationship there', () => {
    const early = map('b1', scene('b1.c1.s1', 'b1'))
    expect(early.nodes.map((n) => n.name).sort()).toEqual(['Mara', 'Tobin'])
    // Kell first appears in Kell's Road, which Book 1 counts from after its Ch 2.
    const late = map('b1')
    expect(late.nodes.map((n) => n.name).sort()).toEqual(['Kell', 'Mara', 'Tobin'])
    expect(link(late, 'kell', 'mara')?.type).toBe('owes money')
  })

  it('lists groups with their members there, leaving out ties against a group', () => {
    expect(map('b1', scene('b1.c1.s1', 'b1')).groups).toEqual([])
    const m = map('b1')
    expect(m.groups).toEqual([{ id: w.guild.id, name: 'The Tide Guild', memberIds: [w.id('mara')] }])
    expect(belongs('member (lieutenant)')).toBe(true)
    expect(belongs('leader')).toBe(true)
    expect(belongs('sworn enemy')).toBe(false)
    expect(belongs('former member')).toBe(false)
  })

  it('counts where relationships between characters change, for the slider', () => {
    const m = map('b2')
    expect(m.stops.find((s) => s.label === 'Book 2, Ch 2, Sc 2')?.changes).toBe(1)
    expect(m.stops.find((s) => s.label === "Kell's Road, Ch 1, Sc 2")?.changes).toBe(1)
    // A tie to a group isn't a relationship between characters.
    expect(m.stops.find((s) => s.label === 'Book 1, Ch 2, Sc 1')?.changes).toBe(0)
    expect(m.stops.every((s) => s.at.seenIn === w.id('b2'))).toBe(true)
  })

  it('starts at the scene Adam is in when it is on the slider, otherwise at the end', () => {
    expect(map('b2', null, w.id('b1.c2.s1')).label).toBe('Book 1, Ch 2, Sc 1')
    expect(map('b2', null, w.id('keep.c1.s1')).label).toBe(map('b2').stops.at(-1)!.label)
    // A point from another story's slider falls back the same way.
    expect(map('b1', scene('b3.c1.s1', 'b3')).label).toBe('Book 1, Ch 3, Sc 2')
  })

  it('lays out every relationship the world has had, once', () => {
    const g = worldGraph(loadMemoryData(w.db))
    expect(g.nodes.map((n) => n.name).sort()).toEqual(['Kell', 'Mara', 'Tobin'])
    expect(graphKey(g)).toBe(graphKey({ nodes: [...g.nodes].reverse(), edges: g.edges.map(([a, b]) => [b, a]) }))
  })
})

describe('an empty map', () => {
  it('says there are no relationships yet', () => {
    const db = memoryWorld()
    repo.createEntry(db, 'character', { name: 'Mara' })
    const m = relationshipMapOf(db, repo.listStories(db)[0].id, null, null)
    expect(m).toMatchObject({ nodes: [], links: [], groups: [], any: false })
    expect(m.stops.length).toBeGreaterThan(0)
  })

  it('knows the story has relationships later on, at a point before them', () => {
    const w = world()
    const m = relationshipMapOf(w.db, w.id('kr'), { kind: 'start', storyId: w.id('b1'), seenIn: w.id('kr') }, null)
    expect(m.any).toBe(true)
  })
})
