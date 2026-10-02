import { describe, expect, it } from 'vitest'
import type { MapLink, MapNode, RelationshipMap } from '@shared/contracts/worldViews'
import {
  along,
  countText,
  feelsText,
  FIT_PAD,
  fitView,
  labelsAt,
  MAX_ZOOM,
  MIN_ZOOM,
  reveal,
  tieLabel,
  tieName,
  visibleGraph,
  whereText,
  zoomAt
} from './mapLogic'

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
  groups: [{ id: 'watch', name: 'The Watch', memberIds: ['mara', 'wren'], allMemberIds: ['mara', 'wren'] }],
  everyone: [],
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
  it('fits everyone into the window, centred in the room left for names and the buttons, never zoomed in past life size', () => {
    const v = fitView(map.nodes, 1000, 800)
    expect(v.k).toBeLessThanOrEqual(1)
    // The middle of the characters sits in the middle of the room left once the help line and zoom
    // buttons along the bottom have theirs.
    expect(100 * v.k + v.tx).toBeCloseTo(500)
    expect(0 * v.k + v.ty).toBeCloseTo(FIT_PAD.top + (800 - FIT_PAD.top - FIT_PAD.bottom) / 2)
    // Everyone is inside that room.
    for (const n of map.nodes) {
      expect(n.x * v.k + v.tx).toBeGreaterThanOrEqual(FIT_PAD.x - 0.01)
      expect(n.y * v.k + v.ty).toBeLessThanOrEqual(800 - FIT_PAD.bottom + 0.01)
    }
    const small = fitView(map.nodes, 300, 300)
    expect(small.k).toBeLessThan(v.k)
    expect(small.k).toBeGreaterThanOrEqual(MIN_ZOOM)
    expect(fitView([], 400, 300)).toEqual({ tx: 200, ty: 150, k: 1 })
    // A window smaller than the room it keeps still centres the map.
    expect(fitView([{ x: 0, y: 0 }], 100, 100)).toMatchObject({ tx: 50, ty: 50 })
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

describe('names and words on the map', () => {
  /** A ring of characters around a busy one, each tied to it. */
  const star = (n: number, radius: number): { nodes: MapNode[]; ties: ReturnType<typeof visibleGraph>['ties'] } => {
    const nodes: MapNode[] = [{ id: 'hub', name: 'Hub', image: null, x: 0, y: 0 }]
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const [x, y] = [Math.round(Math.cos(a) * radius), Math.round(Math.sin(a) * radius)]
      nodes.push({ id: `c${i}`, name: `Character ${i}`, image: null, x, y })
    }
    const m: RelationshipMap = { ...map, nodes, links: nodes.slice(1).map((x) => link('hub', x.id, 'knows')), groups: [] }
    return visibleGraph(m, null)
  }

  it('shows every name and word when there is room', () => {
    const { nodes, ties } = visibleGraph(map, null)
    const shown = labelsAt(nodes, ties, 1)
    expect(shown.names.size).toBe(4)
    // The line with no words has nothing to show.
    expect(shown.ties.size).toBe(2)
  })

  it('shows fewer when zoomed out, the best-connected first, and never on top of a portrait', () => {
    const { nodes, ties } = star(12, 300)
    expect(labelsAt(nodes, ties, 1).names.size).toBe(13)
    const far = labelsAt(nodes, ties, 0.2)
    expect(far.names.size).toBeLessThan(13)
    expect(far.names.size).toBeGreaterThan(0)
    expect(far.names.has('hub')).toBe(true)
    // Words on a line too short to hold them, between two portraits, stay hidden.
    expect(labelsAt(nodes, ties, 0.12).ties.size).toBe(0)
  })

  it('moves a line’s words along it when its middle is taken, never onto a portrait', () => {
    // Wren stands in the middle of the line between Mara and Tobin.
    const m: RelationshipMap = {
      ...map,
      nodes: [
        { id: 'mara', name: 'Mara', image: null, x: 0, y: 0 },
        { id: 'wren', name: 'Wren', image: null, x: 200, y: 0 },
        { id: 'tobin', name: 'Tobin', image: null, x: 400, y: 0 }
      ],
      links: [link('mara', 'tobin', 'sister')],
      groups: []
    }
    const { nodes, ties } = visibleGraph(m, null)
    const at = labelsAt(nodes, ties, 1).ties.get(ties[0].key)!
    expect(at).not.toBe(0.5)
    const spot = along(ties[0], at)
    expect(Math.abs(spot.x - 200)).toBeGreaterThan(22 + 27)
    expect(spot.y).toBe(0)
  })
})
