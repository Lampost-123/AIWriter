import { describe, expect, it } from 'vitest'
import type { MapLink, MapTieEvent, MapTieHistory } from '@shared/contracts/worldViews'
import type { AsOfStop } from '@shared/types'
import {
  arcOf,
  changeWords,
  chapterSpans,
  hull,
  hullPath,
  medalScale,
  moodOf,
  nextOver,
  rankOf,
  roomFor,
  sidesOf,
  sinceOf,
  spreadView,
  temperature,
  tieKind,
  tieWords,
  warmth,
  withLeaving,
  zoomAbout
} from './deskMapLogic'

const link = (aId: string, bId: string, type: string, aFeels = '', bFeels = ''): MapLink => ({ aId, bId, type, aFeels, bFeels, where: '' })

describe('kinds of tie', () => {
  it('reads the kind from the relationship’s words', () => {
    expect(tieKind(['daughter'])).toBe('family')
    expect(tieKind(['godfather'])).toBe('family')
    expect(tieKind(['married'])).toBe('love')
    expect(tieKind(['in love'])).toBe('love')
    expect(tieKind(['old friend'])).toBe('friend')
    expect(tieKind(['apprentice'])).toBe('mentor')
    expect(tieKind(['works for'])).toBe('duty')
    expect(tieKind(['uneasy allies'])).toBe('duty')
    expect(tieKind(['member (harbourmaster)'])).toBe('duty')
    expect(tieKind(['owes money'])).toBe('duty')
    expect(tieKind(['rival'])).toBe('rival')
    expect(tieKind(['knows of'])).toBe('other')
    expect(tieKind([''])).toBe('other')
  })

  it('lets an enmity win over the rest: a sworn enemy, an estranged rival brother', () => {
    expect(tieKind(['sworn enemy'])).toBe('rival')
    expect(tieKind(['brother', 'rival'])).toBe('rival')
    expect(tieKind(['ex-wife'])).toBe('love')
  })

  it('words a pair’s relationships once each', () => {
    expect(tieWords([link('a', 'b', 'rival'), link('a', 'b', 'owes money'), link('b', 'a', 'rival')])).toBe('rival, owes money')
  })
})

describe('warmth of feelings', () => {
  it('reads warm, cold and mixed feelings, and a "not" turns a word round', () => {
    expect(moodOf('Trusts him, though he is the Board’s man')).toBe('warm')
    expect(moodOf('Admires her nerve')).toBe('warm')
    expect(moodOf('Fond and worried; thinks she carries too much')).toBe('warm')
    expect(moodOf('Proud of her, and ashamed to need her')).toBe('mixed')
    expect(moodOf('Doesn’t trust her yet, but needs her')).toBe('cold')
    expect(moodOf('resentful and jealous')).toBe('cold')
    expect(moodOf('')).toBeNull()
    expect(warmth('thinks about the weather')).toBeNull()
  })

  it('pairs both sides’ feelings from the pair’s own sides, whichever way each relationship was noted', () => {
    const links = [link('edric', 'wren', 'father', 'proud, ashamed', 'protective'), link('wren', 'edric', 'keeper’s daughter', 'worried', '')]
    const [w, e] = sidesOf(links, 'wren', 'edric')
    expect(w).toMatchObject({ from: 'wren', to: 'edric', feels: 'protective; worried' })
    expect(e).toMatchObject({ from: 'edric', to: 'wren', feels: 'proud, ashamed', mood: 'mixed' })
  })

  it('says how a tie feels overall: warm, tense, lopsided or mixed', () => {
    const t = (a: string, b: string) => temperature(sidesOf([link('x', 'y', 'friend', a, b)], 'x', 'y'))
    expect(t('fond', 'trusting')).toBe('warm')
    expect(t('wary', 'resentful')).toBe('tense')
    expect(t('admires her', 'doesn’t trust her')).toBe('lopsided')
    expect(t('proud and ashamed', '')).toBe('mixed')
    expect(t('', '')).toBeNull()
  })
})

describe('medallions', () => {
  it('makes the protagonist the biggest, then by role, else by how many ties', () => {
    expect(rankOf('protagonist', 1, 5)).toBe('lead')
    expect(rankOf('Antagonist', 1, 5)).toBe('major')
    expect(rankOf('supporting', 9, 9)).toBe('support')
    expect(rankOf('minor', 9, 9)).toBe('minor')
    expect(rankOf('', 9, 9)).toBe('major')
    expect(rankOf('', 2, 9)).toBe('support')
    expect(rankOf('', 1, 9)).toBe('minor')
  })

  it('keeps medallions at life size until zoomed well out, and never tiny', () => {
    expect(medalScale(2)).toBe(1)
    expect(medalScale(0.8)).toBe(1)
    expect(medalScale(0.4)).toBeCloseTo(0.5)
    expect(medalScale(0.05)).toBe(0.42)
  })
})

describe('lines and fitting', () => {
  it('bows each line away from the middle of the map, its pill on the curve', () => {
    const { c, mid } = arcOf({ x: -100, y: 100 }, { x: 100, y: 100 }, { x: 0, y: 0 }, 'a|b')
    expect(c.y).toBeGreaterThan(100)
    expect(mid.y).toBeGreaterThan(100)
    expect(mid.x).toBeCloseTo(0)
    // The same pair always bows the same way.
    expect(arcOf({ x: -100, y: 100 }, { x: 100, y: 100 }, { x: 0, y: 0 }, 'a|b').d).toBe(arcOf({ x: -100, y: 100 }, { x: 100, y: 100 }, { x: 0, y: 0 }, 'a|b').d)
  })

  it('spreads a small cast over the whole canvas, and shrinks a big one to fit', () => {
    const pad = { left: 80, right: 80, top: 120, bottom: 80 }
    const small = spreadView([{ x: 0, y: 0 }, { x: 100, y: 100 }], 2000, 1200, pad)
    expect(small.k).toBe(2.4)
    const big = spreadView([{ x: -3000, y: -2000 }, { x: 3000, y: 2000 }], 2000, 1200, pad)
    expect(big.k).toBeCloseTo(1000 / 4000)
    // Centred in the room the pad leaves.
    expect(-3000 * big.k + big.tx).toBeGreaterThanOrEqual(80 - 0.01)
    expect(2000 * big.k + big.ty).toBeLessThanOrEqual(1200 - 80 + 0.01)
  })

  it('zooms about a point, keeping it still', () => {
    const v = zoomAbout({ tx: 10, ty: 20, k: 1 }, 2, 100, 100)
    expect(v.k).toBe(2)
    expect((100 - v.tx) / v.k).toBeCloseTo(90)
  })

  it('gives names and pills room most important first, never over a medallion or each other', () => {
    const shown = roomFor(
      [{ key: 'n1', x: 0, y: 0, r: 30 }],
      [
        { key: 'name1', owner: 'n1', x: 0, y: 40, w: 80, h: 20 },
        { key: 'pillA', x: 0, y: 44, w: 60, h: 20 },
        { key: 'pillB', x: 0, y: 0, w: 40, h: 20 },
        { key: 'pillC', x: 200, y: 0, w: 40, h: 20 }
      ]
    )
    expect([...shown]).toEqual(['name1', 'pillC'])
  })
})

describe('the keyboard', () => {
  const nodes = [
    { id: 'm', x: 0, y: 0 },
    { id: 'r', x: 200, y: 10 },
    { id: 'far', x: 600, y: 0 },
    { id: 'u', x: 10, y: -150 },
    { id: 'd', x: -20, y: 160 }
  ]
  it('moves to the nearest character in the arrow’s direction', () => {
    expect(nextOver(nodes, nodes[0], 'right')?.id).toBe('r')
    expect(nextOver(nodes, nodes[0], 'up')?.id).toBe('u')
    expect(nextOver(nodes, nodes[0], 'down')?.id).toBe('d')
    expect(nextOver(nodes, nodes[0], 'left')).toBeNull()
    expect(nextOver(nodes, nodes[1], 'right')?.id).toBe('far')
  })
})

describe('a group’s region', () => {
  it('draws round the outside of its members', () => {
    const h = hull([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 5 },
      { x: 10, y: 10 },
      { x: 0, y: 10 }
    ])
    expect(h).toHaveLength(4)
    expect(hullPath([{ x: 1, y: 2 }])).toBe('M1,2 l0.01,0')
    expect(hullPath([{ x: 0, y: 0 }, { x: 4, y: 4 }])).toBe('M0,0 L4,4')
  })
})

describe('time', () => {
  const ev = (stop: number, type: string, ended = false): MapTieEvent => ({ stop, sceneId: `s${stop}`, where: stop < 0 ? '' : `Ch 1, Sc ${stop}`, type, aFeels: '', bFeels: '', ended })

  it('says since when a tie has held, past any break', () => {
    const events = [ev(-1, 'friend'), ev(2, 'rival'), ev(4, 'rival', true), ev(6, 'ally'), ev(8, 'friend')]
    expect(sinceOf(events, 3)).toMatchObject({ first: { type: 'friend', stop: -1 }, last: { type: 'rival' } })
    expect(sinceOf(events, 5)).toBeNull()
    expect(sinceOf(events, 9)).toMatchObject({ first: { stop: 6 }, last: { stop: 8 } })
    expect(sinceOf(events, -2)).toBeNull()
  })

  it('groups the timeline strip’s stops by chapter', () => {
    const stops = Array.from({ length: 5 }, (_, i) => ({ label: `${i}` }) as AsOfStop)
    const info = [
      { title: '', chapterId: null, chapter: '' },
      { title: 'One', chapterId: 'c1', chapter: 'The Night Ferry' },
      { title: 'Two', chapterId: 'c1', chapter: 'The Night Ferry' },
      { title: 'Three', chapterId: 'c2', chapter: 'The Drowned Steps' },
      { title: 'Four', chapterId: 'c2', chapter: 'The Drowned Steps' }
    ]
    expect(chapterSpans(stops, info)).toEqual([
      { chapterId: 'c1', title: 'The Night Ferry', from: 1, to: 2, n: 1 },
      { chapterId: 'c2', title: 'The Drowned Steps', from: 3, to: 4, n: 2 }
    ])
  })

  it('words what changed at a stop', () => {
    const name = (id: string) => ({ w: 'Wren', i: 'Iska', m: 'Mara', t: 'Tobin', k: 'Kell' })[id] ?? id
    expect(changeWords([], name)).toEqual({ lead: '', lines: [], more: 0 })
    expect(changeWords([{ aId: 'i', bId: 'w', what: 'new', type: 'uneasy allies', before: '' }], name)).toEqual({
      lead: 'New',
      lines: ['Iska and Wren: uneasy allies'],
      more: 0
    })
    // Named in the order of their names, whichever way round the pair was noted.
    expect(changeWords([{ aId: 'w', bId: 'i', what: 'new', type: 'ally', before: '' }], name).lines).toEqual(['Iska and Wren: ally'])
    const many = changeWords(
      [
        { aId: 'm', bId: 't', what: 'changed', type: 'rival', before: 'friend' },
        { aId: 'k', bId: 'm', what: 'ended', type: 'owes money', before: 'owes money' },
        { aId: 'i', bId: 'w', what: 'new', type: 'ally', before: '' }
      ],
      name
    )
    expect(many.lead).toBe('Changed')
    expect(many.lines).toEqual(['Mara and Tobin: friend → rival', 'Kell and Mara: no longer owes money'])
    expect(many.more).toBe(1)
  })

  it('keeps a tie that left for its exit, then drops it', () => {
    const a = { key: 'a' }
    const b = { key: 'b' }
    const first = withLeaving(new Map(), [a, b], 0, 140)
    const second = withLeaving(first, [a], 100, 140)
    expect(second.get('b')?.leaving).toBe(100)
    expect(withLeaving(second, [a], 200, 140).has('b')).toBe(true)
    expect(withLeaving(second, [a], 260, 140).has('b')).toBe(false)
    expect(withLeaving(second, [a, b], 120, 140).get('b')?.leaving).toBeNull()
  })

  it('history types line up', () => {
    const h: MapTieHistory = { aId: 'a', bId: 'b', events: [ev(1, 'x')] }
    expect(h.events[0].where).toBe('Ch 1, Sc 1')
  })
})
