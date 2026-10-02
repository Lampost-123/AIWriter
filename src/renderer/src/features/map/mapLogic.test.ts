import { describe, expect, it } from 'vitest'
import type { MapLink, RelationshipMap } from '@shared/contracts/worldViews'
import { countText, feelsText, fitView, MAX_ZOOM, MIN_ZOOM, reveal, tieLabel, tieName, visibleGraph, whereText, zoomAt } from './mapLogic'

const link = (aId: string, bId: string, type: string, l: Partial<MapLink> = {}): MapLink => ({
  aId,
  bId,
  type,
  aFeels: '',
  bFeels: '',
  where: '',
  ...l
})

const map: RelationshipMap = {
  storyId: 'b1',
  at: { kind: 'end', storyId: 'b1' },
  label: 'End of Book 1',
  stops: [],
  nodes: [
    { id: 'hal', name: 'Hal', image: null, x: 300, y: 0 },
    { id: 'mara', name: 'Mara', image: null, x: 0, y: 0 },
    { id: 'tobin', name: 'Tobin', image: null, x: 100, y: 200 },
    { id: 'wren', name: 'Wren', image: null, x: -100, y: -200 }
  ],
  links: [
    link('mara', 'tobin', 'friend', { aFeels: 'guilty', bFeels: 'betrayed', where: 'Book 1, Ch 2, Sc 2' }),
    link('tobin', 'mara', 'owes money'),
    link('mara', 'wren', 'sister'),
    link('hal', 'tobin', '')
  ],
  groups: [{ id: 'watch', name: 'The Watch', memberIds: ['mara', 'wren'] }],
  any: true
}
const name = (id: string): string => map.nodes.find((n) => n.id === id)?.name ?? 'Someone'

describe('who the map shows', () => {
  it('shows everyone, with one line per pair however many relationships they have', () => {
    const { nodes, ties } = visibleGraph(map, null)
    expect(nodes).toHaveLength(4)
    expect(ties).toHaveLength(3)
    const pair = ties.find((t) => t.links.length === 2)!
    expect(tieLabel(pair)).toBe('friend, owes money')
  })

  it('shows only a group’s members, and the lines between them', () => {
    const { nodes, ties } = visibleGraph(map, 'watch')
    expect(nodes.map((n) => n.id)).toEqual(['mara', 'wren'])
    expect(ties.map(tieLabel)).toEqual(['sister'])
    expect(visibleGraph(map, 'gone').nodes).toEqual([])
  })

  it('says how each feels and where it changed, in plain words', () => {
    const [friend] = map.links
    expect(feelsText(friend, name)).toEqual(['Mara feels guilty', 'Tobin feels betrayed'])
    expect(feelsText(map.links[2], name)).toEqual([])
    expect(whereText(friend)).toBe('Last changed in Book 1, Ch 2, Sc 2')
    expect(whereText(map.links[2])).toBe('Since before the story begins')
    const pair = visibleGraph(map, null).ties.find((t) => t.links.length === 2)!
    expect(tieName(pair, name)).toBe('Mara and Tobin: friend. Mara feels guilty. Tobin feels betrayed; owes money.')
    expect(countText(1, 2)).toBe('1 character, 2 relationships')
  })
})

describe('moving about the map', () => {
  it('fits everyone into the window, centred, never zoomed in past life size', () => {
    const v = fitView(map.nodes, 1000, 800)
    expect(v.k).toBeLessThanOrEqual(1)
    // The middle of the characters sits in the middle of the window.
    expect(100 * v.k + v.tx).toBeCloseTo(500)
    expect(0 * v.k + v.ty).toBeCloseTo(400)
    const small = fitView(map.nodes, 200, 200)
    expect(small.k).toBeLessThan(v.k)
    expect(small.k).toBeGreaterThanOrEqual(MIN_ZOOM)
    expect(fitView([], 400, 300)).toEqual({ tx: 200, ty: 150, k: 1 })
  })

  it('zooms about a point, keeping it where it is, within limits', () => {
    const v = { tx: 40, ty: 30, k: 1 }
    const z = zoomAt(v, 2, 240, 130)
    expect(z.k).toBe(2)
    // The map point under (240, 130) before is still under it.
    expect((240 - v.tx) / v.k).toBeCloseTo((240 - z.tx) / z.k)
    expect((130 - v.ty) / v.k).toBeCloseTo((130 - z.ty) / z.k)
    expect(zoomAt(v, 100, 0, 0).k).toBe(MAX_ZOOM)
    expect(zoomAt(v, 0.0001, 0, 0).k).toBe(MIN_ZOOM)
    expect(zoomAt({ tx: 0, ty: 0, k: MAX_ZOOM }, 2, 0, 0)).toEqual({ tx: 0, ty: 0, k: MAX_ZOOM })
  })

  it('brings a character reached with Tab into view, and leaves the view alone when it is already there', () => {
    const v = { tx: 0, ty: 0, k: 1 }
    expect(reveal(v, 500, 300, 1000, 800)).toBe(v)
    const moved = reveal(v, 1200, -50, 1000, 800)
    expect(1200 + moved.tx).toBe(1000 - 80)
    expect(-50 + moved.ty).toBe(80)
  })
})
