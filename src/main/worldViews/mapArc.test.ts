// The desk's relationship map: each relationship's arc along a story, what changed at a stop, the titles on the
// timeline strip and dragging a character, on the fixed test world (tests/unit/testWorld.ts): Mara and Tobin are
// friends before any story and enemies from Book 2, Ch 2, Sc 2.
import { describe, expect, it } from 'vitest'
import type { AsOf } from '@shared/types'
import * as mem from '../db/memory'
import { dbWorld } from '../../../tests/unit/testWorld'
import { moveMapCharacter, relationshipMapOf, resetMapLayout } from './index'
import { changesAt } from './mapArc'
import type { MapTieHistory } from '@shared/contracts/worldViews'

function world() {
  const w = dbWorld()
  const rel = (from: string, other: string, type: string, feels: string, otherFeels: string, scene?: string, ended = false) =>
    mem.insertChange(w.db, {
      kind: 'relationship',
      payload: { otherId: w.id(other), type, feels, otherFeels, ...(ended ? { ended } : {}) },
      entryId: w.id(from),
      anchor: scene ? 'scene' : 'baseline',
      sceneId: scene ? w.id(scene) : null,
      origin: 'adam'
    })
  rel('kell', 'mara', 'owes money', 'ashamed', 'patient', 'b1.c2.s1')
  rel('kell', 'mara', 'old debt', 'ashamed', 'patient', 'b2.c1.s1', true)
  return w
}

describe('the desk map’s arc of each relationship', () => {
  const w = world()
  const scene = (key: string, seenIn: string): AsOf => ({ kind: 'scene', storyId: w.id(key.split('.')[0]), sceneId: w.id(key), seenIn: w.id(seenIn) })
  const map = (story: string, at: AsOf | null = null) => relationshipMapOf(w.db, w.id(story), at, null)
  const pair = (h: MapTieHistory[], a: string, b: string) =>
    h.find((x) => (x.aId === w.id(a) && x.bId === w.id(b)) || (x.aId === w.id(b) && x.bId === w.id(a)))!

  it('lists every change to a relationship in order, both feelings from the pair’s side, with where and its stop', () => {
    const m = map('b2', scene('b2.c2.s2', 'b2'))
    const d = m.detail!
    const mt = pair(d.history, 'mara', 'tobin')
    expect(mt.aId < mt.bId).toBe(true)
    expect(mt.events.map((e) => [e.type, e.where])).toEqual([
      ['friend', ''],
      ['enemy', 'Book 2, Ch 2, Sc 2']
    ])
    expect(mt.events[0].stop).toBe(-1)
    // Tobin feels betrayed, Mara guilty, from the pair's own a and b.
    const enemy = mt.events[1]
    const tobinFeels = mt.aId === w.id('tobin') ? enemy.aFeels : enemy.bFeels
    expect(tobinFeels).toBe('betrayed')
    // Its stop is the slider's stop for that scene.
    expect(m.stops[enemy.stop].sceneId).toBe(w.id('b2.c2.s2'))
    expect(enemy.sceneId).toBe(w.id('b2.c2.s2'))
  })

  it('notes where a relationship ends', () => {
    const d = map('b2').detail!
    const km = pair(d.history, 'kell', 'mara')
    expect(km.events.map((e) => [e.type, e.ended])).toEqual([
      ['owes money', false],
      ['old debt', true]
    ])
  })

  it('says what changed at a stop since the one before: new, changed and ended relationships', () => {
    const at = map('b2', scene('b2.c2.s2', 'b2'))
    expect(at.detail!.here).toEqual([
      expect.objectContaining({ what: 'changed', type: 'enemy', before: 'friend' })
    ])
    const ended = map('b2', scene('b2.c1.s1', 'b2'))
    expect(ended.detail!.here).toEqual([expect.objectContaining({ what: 'ended', before: 'owes money' })])
    const quiet = map('b2', scene('b2.c2.s1', 'b2'))
    expect(quiet.detail!.here).toEqual([])
  })

  it('treats the same words set again as no change', () => {
    const h: MapTieHistory[] = [
      {
        aId: 'a',
        bId: 'b',
        events: [
          { stop: 0, sceneId: null, where: 'x', type: 'friend', aFeels: 'fond', bFeels: '', ended: false },
          { stop: 2, sceneId: null, where: 'y', type: 'friend', aFeels: 'fond', bFeels: '', ended: false }
        ]
      }
    ]
    expect(changesAt(h, 2)).toEqual([])
    expect(changesAt(h, 0)).toEqual([{ aId: 'a', bId: 'b', what: 'new', type: 'friend', before: '' }])
  })

  it('names each stop’s scene and chapter for the timeline strip, and which stop is shown', () => {
    const m = map('b2', scene('b2.c2.s2', 'b2'))
    const d = m.detail!
    expect(d.stops).toHaveLength(m.stops.length)
    expect(m.stops[d.atStop].sceneId).toBe(w.id('b2.c2.s2'))
    expect(d.stops[d.atStop].title).toBeTruthy()
    expect(d.stops[d.atStop].chapterId).toBe(w.id('b2.c2'))
  })

  it('remembers a character dragged to a new place', () => {
    const before = map('b2')
    const mara = before.nodes.find((n) => n.id === w.id('mara'))!
    moveMapCharacter(w.db, mara.id, mara.x + 333.4, mara.y - 120.6)
    const after = map('b2')
    expect(after.nodes.find((n) => n.id === mara.id)).toMatchObject({ x: mara.x + 333, y: mara.y - 121 })
    // Everyone else stays put.
    const tobin = before.nodes.find((n) => n.id === w.id('tobin'))!
    expect(after.nodes.find((n) => n.id === tobin.id)).toMatchObject({ x: tobin.x, y: tobin.y })
    expect(() => moveMapCharacter(w.db, 'nobody', 0, 0)).toThrow()
  })

  it('resets dragged characters to where the layout put them, and says where they were for an undo', () => {
    const start = map('b2')
    const tobin = start.nodes.find((n) => n.id === w.id('tobin'))!
    moveMapCharacter(w.db, tobin.id, tobin.x + 200, tobin.y)
    moveMapCharacter(w.db, tobin.id, tobin.x + 300, tobin.y)
    expect(map('b2').detail!.moved).toContain(tobin.id)
    const undo = resetMapLayout(w.db)
    expect(undo).toContainEqual({ id: tobin.id, x: tobin.x + 300, y: tobin.y })
    const after = map('b2')
    expect(after.nodes.find((n) => n.id === tobin.id)).toMatchObject({ x: tobin.x, y: tobin.y })
    expect(after.detail!.moved).toEqual([])
    expect(resetMapLayout(w.db)).toEqual([])
  })
})
