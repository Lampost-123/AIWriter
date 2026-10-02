import { describe, expect, it } from 'vitest'
import { MAP_GAP, type MapLink, type MapNode, type RelationshipMap } from '@shared/contracts/worldViews'
import {
  along,
  cardPlace,
  clearSpots,
  countText,
  feelsText,
  FIT_PAD,
  fitView,
  labelsAt,
  MAX_ZOOM,
  MIN_ZOOM,
  openingView,
  OPENING_ZOOM,
  PORTRAIT,
  portraitScale,
  READABLE_ZOOM,
  reveal,
  SMALL_CAST,
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
  groups: [
    { id: 'watch', name: 'The Watch', memberIds: ['mara', 'wren'], allMemberIds: ['mara', 'wren'], hadMembers: true, joinsLater: false }
  ],
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

describe('a big cast', () => {
  // prettier-ignore
  const FIRST = ['Ash', 'Bryn', 'Cato', 'Dara', 'Elsa', 'Finn', 'Gus', 'Hale']
  // prettier-ignore
  const FAMILY = ['Arden', 'Blythe', 'Corran', 'Dunmore', 'Ellery', 'Fallow', 'Graves', 'Holt', 'Ives', 'Jessop', 'Keane', 'Lorne', 'Marsh']
  const TYPES = ['sister', 'rival', 'owes money', 'old friend', 'mentor']

  /**
   * 104 characters in families of eight, each family round a ring, everyone tied to the next round and
   * to the head of the family, and the heads tied in a chain: 181 relationships. Nobody is closer than
   * MAP_GAP to anyone, as the layout keeps them.
   */
  const cast = (): { nodes: MapNode[]; ties: ReturnType<typeof visibleGraph>['ties'] } => {
    const nodes: MapNode[] = []
    const links: MapLink[] = []
    FAMILY.forEach((family, f) => {
      const [cx, cy] = [(f % 5) * 420, Math.floor(f / 5) * 420]
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        const [x, y] = [Math.round(cx + Math.cos(a) * 140), Math.round(cy + Math.sin(a) * 140)]
        nodes.push({ id: `${f}.${i}`, name: `${FIRST[i]} ${family}`, image: null, x, y })
        links.push(link(`${f}.${i}`, `${f}.${(i + 1) % 8}`, TYPES[(f + i) % 5]))
        if (i > 1 && i < 7) links.push(link(`${f}.0`, `${f}.${i}`, TYPES[(f + i + 2) % 5]))
      }
      if (f > 0) links.push(link(`${f - 1}.0`, `${f}.0`, 'old friend'))
    })
    return visibleGraph({ ...map, nodes, links, groups: [] }, null)
  }
  const { nodes, ties } = cast()
  const closest = Math.min(...nodes.flatMap((a, i) => nodes.slice(i + 1).map((b) => Math.hypot(a.x - b.x, a.y - b.y))))

  it('never draws portraits over each other, at any zoom', () => {
    expect(closest).toBeGreaterThanOrEqual(MAP_GAP)
    for (let k = MIN_ZOOM; k <= MAX_ZOOM; k += 0.01) expect(PORTRAIT * portraitScale(k)).toBeLessThan(closest * k)
    // Portraits shrink with the map only as far as 60% while there is room for that.
    expect(portraitScale(0.4)).toBe(0.6)
    expect(portraitScale(1.5)).toBe(1.5)
  })

  // The room the map has in a 1280 by 800 window, and in a 960 by 600 one.
  for (const [width, height] of [
    [1008, 560],
    [688, 378]
  ]) {
    it(`opens where names and words can be read, around the best-connected character, at ${width} by ${height}`, () => {
      expect(fitView(nodes, width, height).k).toBeLessThan(READABLE_ZOOM)
      const v = openingView(nodes, nodes, ties, width, height)
      expect(v.k).toBe(OPENING_ZOOM)
      const inWindow = (p: { x: number; y: number }): boolean => {
        const [x, y] = [p.x * v.k + v.tx, p.y * v.k + v.ty]
        return x >= 0 && x <= width && y >= 0 && y <= height - FIT_PAD.bottom / 2
      }
      // The best-connected character is in the window: a head of a family inside the chain, the first by name.
      const degree = (id: string): number => ties.filter((t) => t.a.id === id || t.b.id === id).length
      const best = [...nodes].sort((a, b) => degree(b.id) - degree(a.id) || a.name.localeCompare(b.name))[0]
      expect(best.name).toBe('Ash Blythe')
      expect(inWindow(best)).toBe(true)
      const shown = labelsAt(nodes, ties, v.k)
      const names = nodes.filter((n) => shown.names.has(n.id) && inWindow(n)).length
      const words = ties.filter((t) => shown.ties.has(t.key) && inWindow(along(t, shown.ties.get(t.key)!))).length
      // Fitted to everyone, only 13 names and 7 words show at 1008 by 560, and 5 names and no words at 688 by 378.
      expect(names).toBeGreaterThanOrEqual(width > 900 ? 40 : 20)
      expect(words).toBeGreaterThanOrEqual(width > 900 ? 15 : 6)
      // No empty space past the cast's edges where the cast is bigger than the window.
      const left = Math.min(...nodes.map((n) => n.x * v.k + v.tx))
      const right = Math.max(...nodes.map((n) => n.x * v.k + v.tx))
      expect(left).toBeLessThanOrEqual(FIT_PAD.x + 0.01)
      expect(right).toBeGreaterThanOrEqual(width - FIT_PAD.x - 0.01)
    })
  }

  it('opens fitted to everyone when they can be read that way', () => {
    const few = visibleGraph(map, null)
    expect(openingView(map.nodes, few.nodes, few.ties, 1000, 800)).toEqual(fitView(map.nodes, 1000, 800))
    expect(openingView([], [], [], 400, 300)).toEqual(fitView([], 400, 300))
  })

  it('opens a small cast fitted to everyone even in the smallest window, so no one counted is off screen', () => {
    // One family of eight, spread out as the layout spreads a long chain, in the room a 960 by 600 window leaves.
    const family = nodes.filter((n) => n.id.startsWith('0.')).map((n, i) => ({ ...n, x: n.x + i * 3 * MAP_GAP }))
    const small = visibleGraph({ ...map, nodes: family, links: [], groups: [] }, null)
    expect(family.length).toBeLessThanOrEqual(SMALL_CAST)
    expect(fitView(family, 688, 378).k).toBeLessThan(READABLE_ZOOM)
    const v = openingView(family, small.nodes, small.ties, 688, 378)
    expect(v).toEqual(fitView(family, 688, 378))
    for (const n of family) {
      const [x, y] = [n.x * v.k + v.tx, n.y * v.k + v.ty]
      expect(x).toBeGreaterThanOrEqual(FIT_PAD.x - 0.01)
      expect(x).toBeLessThanOrEqual(688 - FIT_PAD.x + 0.01)
      expect(y).toBeLessThanOrEqual(378 - FIT_PAD.bottom + 0.01)
    }
  })
})

describe('the words and card of a line pointed at', () => {
  const m: RelationshipMap = {
    ...map,
    nodes: [
      { id: 'mara', name: 'Mara', image: null, x: 0, y: 0 },
      { id: 'nell', name: 'Nell', image: null, x: 200, y: 10 },
      { id: 'tobin', name: 'Tobin', image: null, x: 400, y: 0 }
    ],
    links: [link('mara', 'tobin', 'mentor'), link('mara', 'nell', 'sister')],
    groups: []
  }
  const { nodes, ties } = visibleGraph(m, null)
  const mentor = ties.find((t) => tieLabel(t) === 'mentor')!

  it('sit clear of every portrait when the middle of the line is taken', () => {
    const at = clearSpots(nodes, [mentor], 1).get(mentor.key)!
    expect(at).not.toBe(0.5)
    expect(Math.abs(along(mentor, at).x - 200)).toBeGreaterThan(22 + 30)
    // With no clear spot at all, none is given.
    expect(clearSpots(nodes, [mentor], MIN_ZOOM).has(mentor.key)).toBe(false)
  })

  it('places the card under the words, or wherever it covers neither character', () => {
    const room = { width: 1000, height: 800 }
    const words = { x: 500, y: 300, width: 60 }
    const ends = (a: { x: number; y: number }, b: { x: number; y: number }) => [
      { x: a.x, y: a.y, name: 'Mara' },
      { x: b.x, y: b.y, name: 'Tobin' }
    ]
    const card = { width: 200, height: 90 }
    // A long, level line: under the words.
    expect(cardPlace(card, words, ends({ x: 300, y: 300 }, { x: 700, y: 300 }), 22, room)).toEqual({ left: 400, top: 316 })
    // Tobin just under the words, Mara far off: above them.
    expect(cardPlace(card, words, ends({ x: 100, y: 100 }, { x: 540, y: 380 }), 22, room)).toEqual({ left: 400, top: 194 })
    // A short, steep line, with one character just above the words and one just under: beside them.
    expect(cardPlace(card, words, ends({ x: 500, y: 200 }, { x: 510, y: 380 }), 22, room)).toEqual({ left: 540, top: 255 })
    // A short line slanting down to the right, with a character off each end of the words: off a corner,
    // to the side of the line away from both.
    const slant = ends({ x: 428, y: 251 }, { x: 572, y: 349 })
    const corner = cardPlace({ width: 186, height: 116 }, { x: 500, y: 300, width: 40 }, slant, 22, room)
    expect(corner).toEqual({ left: 306, top: 312 })
    // A short, level line: under both characters and their names.
    const level = ends({ x: 413, y: 300 }, { x: 587, y: 300 })
    expect(cardPlace({ width: 186, height: 116 }, { x: 500, y: 300, width: 40 }, level, 22, room)).toEqual({ left: 407, top: 351 })
    // With nowhere clear in a small window, wherever it covers least: here, as high as the window allows.
    const small = { width: 400, height: 300 }
    const boxed = ends({ x: 100, y: 150 }, { x: 300, y: 150 })
    expect(cardPlace({ width: 300, height: 120 }, { x: 200, y: 150, width: 40 }, boxed, 22, small)).toEqual({ left: 50, top: 8 })
    // Always inside the window.
    const edge = cardPlace(card, { x: 990, y: 790, width: 60 }, ends({ x: 0, y: 0 }, { x: 10, y: 10 }), 22, room)
    expect(edge.left + card.width).toBeLessThanOrEqual(room.width)
    expect(edge.top + card.height).toBeLessThanOrEqual(room.height)
  })
})
