// The relationship map on the fixed test world (tests/unit/testWorld.ts): Mara and Tobin are friends
// before any story, enemies from Book 2, Ch 2, Sc 2, and neighbours in the prequel Young Mara.
import { describe, expect, it } from 'vitest'
import type { AsOf } from '@shared/types'
import type { RelationshipMap } from '@shared/contracts/worldViews'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { dbWorld } from '../../../tests/unit/testWorld'
import { memoryWorld } from '../../../tests/unit/helpers'
import { relationshipMapOf } from './index'
import { belongs, createLayoutCache, graphKey, worldGraph } from './map'
import { MAP_LAYOUT_KEY, readMapLayout, writeMapLayout } from '../db/worldViews'
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
  const positionOf = (m: RelationshipMap, key: string) => {
    const n = m.nodes.find((x) => x.id === w.id(key))!
    return { x: n.x, y: n.y }
  }
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

  it('lists the groups along the story, with their members at the point, leaving out ties against a group', () => {
    // The group stays on offer before anyone belongs to it, so the filter doesn't change as the slider moves.
    expect(map('b1', scene('b1.c1.s1', 'b1')).groups).toEqual([
      { id: w.guild.id, name: 'The Tide Guild', memberIds: [], allMemberIds: [w.id('mara')] }
    ])
    const m = map('b1')
    expect(m.groups).toEqual([{ id: w.guild.id, name: 'The Tide Guild', memberIds: [w.id('mara')], allMemberIds: [w.id('mara')] }])
    expect(belongs('member (lieutenant)')).toBe(true)
    expect(belongs('leader')).toBe(true)
    expect(belongs('sworn enemy')).toBe(false)
    expect(belongs('former member')).toBe(false)
  })

  it('says who can appear anywhere on the slider, so the map can be fitted to them all', () => {
    const early = map('b1', scene('b1.c1.s1', 'b1'))
    const ids = (m: ReturnType<typeof map>) => m.everyone.map((p) => p.id).sort()
    expect(ids(early)).toEqual(['kell', 'mara', 'tobin'].map(w.id).sort())
    expect(early.everyone.find((p) => p.id === w.id('kell'))).toEqual({ id: w.id('kell'), ...positionOf(map('b1'), 'kell') })
    // Mara Keeps Her Hand leaves Book 1 before Kell's Road: Kell never appears in it.
    expect(ids(map('keep'))).toEqual(['mara', 'tobin'].map(w.id).sort())
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

describe('the layout kept in the world', () => {
  it('is written when the map is first laid out, and keeps everyone in place after a restart', () => {
    const w = world()
    const first = relationshipMapOf(w.db, w.id('b1'), null, null)
    expect(repo.getMeta(w.db, MAP_LAYOUT_KEY)).not.toBeNull()
    const kept = readMapLayout(w.db)!
    for (const n of first.nodes) expect(kept.get(n.id)).toEqual({ x: n.x, y: n.y })

    // The app starts again (a new cache) after the memory added a relationship with a newcomer.
    const wren = repo.createEntry(w.db, 'character', { name: 'Wren' })
    mem.insertChange(w.db, {
      kind: 'relationship',
      payload: { otherId: w.id('tobin'), type: 'sister', feels: '', otherFeels: '' },
      entryId: wren.id,
      anchor: 'baseline',
      origin: 'adam'
    })
    const layout = createLayoutCache({ load: readMapLayout, save: writeMapLayout })
    const after = layout(w.db, worldGraph(loadMemoryData(w.db)))
    for (const n of first.nodes) expect(after.get(n.id)).toEqual({ x: n.x, y: n.y })
    expect(after.has(wren.id)).toBe(true)
    expect(readMapLayout(w.db)!.get(wren.id)).toEqual(after.get(wren.id))
  })

  it('is read again rather than rewritten when nothing changed', () => {
    const w = world()
    relationshipMapOf(w.db, w.id('b1'), null, null)
    let saves = 0
    const layout = createLayoutCache({ load: readMapLayout, save: () => void saves++ })
    layout(w.db, worldGraph(loadMemoryData(w.db)))
    expect(saves).toBe(0)
  })

  it('ignores a damaged layout', () => {
    const w = world()
    repo.setMeta(w.db, MAP_LAYOUT_KEY, '{not json')
    expect(readMapLayout(w.db)).toBeNull()
    expect(relationshipMapOf(w.db, w.id('b1'), null, null).nodes.length).toBe(3)
  })
})
