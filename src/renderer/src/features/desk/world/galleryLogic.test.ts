import { describe, expect, it } from 'vitest'
import type { CodexCard } from '@shared/contracts/entryViews'
import { NO_FILTERS, GALLERY_KINDS, shownCards } from '@/features/codex/codexLogic'
import {
  appearsShort,
  artHue,
  gallerySections,
  galleryTabs,
  heroLayout,
  heroZoom,
  kindBanner,
  placeName,
  roleLabel,
  shortPlace,
  staggerDelay,
  tabClip,
  threadLine,
  threadState,
  variantOf,
  worldLine
} from './galleryLogic'

let n = 0
const card = (c: Partial<CodexCard> & Pick<CodexCard, 'name'>): CodexCard => ({
  id: `e${++n}`,
  kind: 'character',
  aliases: [],
  summary: '',
  tags: [],
  image: null,
  role: '',
  hardRule: false,
  scenes: 0,
  importance: 0,
  last: null,
  first: null,
  storyIds: [],
  ...c
})

// The sample world's shape: 4 characters, 3 places, a group, lore and 2 plot threads.
const world = [
  card({ name: 'Wren', role: 'protagonist', importance: 12, scenes: 4 }),
  card({ name: 'Edric', role: 'supporting', importance: 6, scenes: 3 }),
  card({ name: 'Iska', importance: 5, scenes: 3 }),
  card({ name: 'Ansel', importance: 2, scenes: 1 }),
  card({ name: 'Gullhaven', kind: 'place' }),
  card({ name: 'The Light', kind: 'place' }),
  card({ name: 'The Steps', kind: 'place' }),
  card({ name: 'The Board', kind: 'group' }),
  card({ name: 'Never dark', kind: 'lore', hardRule: true }),
  card({ name: 'The letter?', kind: 'thread' }),
  card({ name: 'Midwinter?', kind: 'thread' })
]

describe('the World room’s gallery', () => {
  it('has a tab for everything and each kind the world has, each counting what it holds', () => {
    const tabs = galleryTabs(world)
    expect(tabs.map((t) => [t.label, t.count])).toEqual([
      ['All', 11],
      ['Characters', 4],
      ['Places', 3],
      ['Groups', 1],
      ['Lore', 1],
      ['Plot threads', 2]
    ])
    // Each tab's count is what its page shows.
    for (const t of tabs) expect(shownCards(world, { ...NO_FILTERS, kind: t.kind }, 'name', GALLERY_KINDS)).toHaveLength(t.count)
    expect(worldLine(tabs)).toBe('4 characters · 3 places · 1 group · 1 lore · 2 plot threads')
    expect(galleryTabs([])).toEqual([{ kind: null, label: 'All', count: 0 }])
  })

  it('draws each kind as its own card, threads last, and the lead larger', () => {
    const sections = gallerySections(shownCards(world, NO_FILTERS, 'importance', GALLERY_KINDS), 'importance')
    expect(sections.map((s) => [s.kind, s.shape, s.label, s.cards.length])).toEqual([
      ['character', 'portrait', 'Characters', 4],
      ['place', 'landscape', 'Places', 3],
      ['group', 'parchment', 'Group', 1],
      ['lore', 'scroll', 'Lore', 1],
      ['thread', 'index', 'Plot threads', 2]
    ])
    expect(sections[0].featured).toBe(world[0].id)
    expect(sections[0].hint).toBe('most important first')
    expect(sections[4].hint).toBe('questions the story has asked')
    expect(sections.slice(1).every((s) => s.featured === null)).toBe(true)
    // Items, events and terms are plain paper.
    const plain = gallerySections([card({ name: 'Key', kind: 'item' }), card({ name: 'Ferry token', kind: 'glossary' })], 'name')
    expect(plain.map((s) => [s.shape, s.label])).toEqual([
      ['plain', 'Item'],
      ['plain', 'Glossary']
    ])
  })

  it('staggers 30ms apart, the eleventh and later together', () => {
    expect([0, 1, 2, 10, 11, 40].map(staggerDelay)).toEqual([0, 30, 60, 300, 300, 300])
    expect(staggerDelay(-3)).toBe(0)
  })

  it('clips the underline to the chosen tab', () => {
    expect(tabClip(600, { left: 0, width: 64 })).toBe('inset(0 546px 0 10px round 1px)')
    expect(tabClip(600, { left: 500, width: 100 }, 12)).toBe('inset(0 12px 0 512px round 1px)')
  })

  it('gives each entry its own steady colour near its kind’s', () => {
    const hue = artHue('character', 'abc')
    expect(artHue('character', 'abc')).toBe(hue)
    expect(Math.abs(hue - 266)).toBeLessThanOrEqual(16)
    const v = variantOf('xyz', 3)
    expect(v).toBeGreaterThanOrEqual(0)
    expect(v).toBeLessThan(3)
  })

  it('words a card’s foot, its role and a thread’s state', () => {
    expect(appearsShort({ scenes: 0 })).toBe('not in a scene yet')
    expect(appearsShort({ scenes: 1 })).toBe('in 1 scene')
    expect(appearsShort({ scenes: 1200 })).toBe('in 1,200 scenes')
    expect(shortPlace('Book 1, Ch 2, Sc 1')).toBe('Ch 2, Sc 1')
    expect(shortPlace('the start of Book 2')).toBe('the start of Book 2')
    expect(roleLabel({ kind: 'character', role: ' protagonist ' })).toBe('Protagonist')
    expect(roleLabel({ kind: 'place', role: 'x' })).toBe('')
    const at = (label: string) => ({ label, storyId: 'b', sceneId: 's', planned: false })
    expect(threadState(null).label).toBe('Not set up yet')
    expect(threadState({ column: 'open' })).toEqual({ label: 'Open', tone: 'open' })
    expect(threadLine({ column: 'open', setUp: at('Book 1, Ch 2, Sc 1'), paidOff: null, openChapters: 1 })).toBe(
      'Set up in Ch 2, Sc 1 · no payoff written yet'
    )
    expect(threadLine({ column: 'open', setUp: at('Book 1, Ch 2, Sc 1'), paidOff: null, openChapters: 6 })).toBe(
      'Set up in Ch 2, Sc 1 · open for 6 chapters'
    )
    expect(threadLine({ column: 'resolved', setUp: at('Book 1, Ch 1, Sc 2'), paidOff: at('Book 1, Ch 2, Sc 1'), openChapters: null })).toBe(
      'Opened Ch 1, Sc 2 · resolved Ch 2, Sc 1'
    )
    expect(threadLine({ column: 'planned', setUp: null, paidOff: null, openChapters: null })).toBe('Not on a scene card or in a scene yet')
  })
})

describe("a kind's own page", () => {
  it('grows a few cards to fill the room, in the rows that let them grow most, and brings more back towards life size', () => {
    const room = { width: 1400, height: 760 }
    const one = heroZoom('portrait', 2, room)
    const seven = heroZoom('portrait', 7, room)
    const many = heroZoom('portrait', 40, room)
    expect(one).toBe(1.6)
    expect(seven).toBeLessThan(one)
    expect(seven).toBeGreaterThan(1)
    expect(many).toBeGreaterThanOrEqual(1)
    expect(many).toBeLessThanOrEqual(1.25)
    // Never under life size, however narrow; never past the shape's most.
    expect(heroZoom('landscape', 3, { width: 600, height: 400 })).toBe(1)
    expect(heroZoom('scroll', 1, room)).toBe(1.15)
    // Five in a row on a wide page beat two short rows; the rows always fit the height left under the banner.
    expect(heroZoom('portrait', 5, { width: 1240, height: 530 })).toBeGreaterThan(1.1)
    const short = heroZoom('portrait', 8, { width: 2400, height: 560 })
    expect(262 * short).toBeLessThanOrEqual(560)
    expect(heroZoom('portrait', 0, room)).toBe(1)
    // Four places on a wide, tall page: two rows of two, as large as they go; never three and one left over.
    expect(heroLayout('landscape', 4, { width: 1570, height: 800 })).toEqual({ zoom: 1.5, cols: 2 })
    // On a short page they keep to one row.
    expect(heroLayout('landscape', 4, { width: 1570, height: 300 }).cols).toBeNull()
    for (const n of [3, 4, 5, 6, 7, 8, 9, 10]) {
      const { cols } = heroLayout('portrait', n, { width: 1600, height: 1000 })
      if (cols) expect((n - (Math.ceil(n / cols) - 1) * cols) * 2, `${n} in ${cols} columns`).toBeGreaterThanOrEqual(cols)
    }
  })

  it("titles a kind's banner from the world's name and states facts from its entries", () => {
    expect(placeName('Sample world: Gullhaven')).toBe('Gullhaven')
    expect(placeName('  ')).toBe('your world')
    const people = [
      card({ name: 'Wren', role: 'protagonist', scenes: 4, importance: 9 }),
      card({ name: 'Edric', role: 'supporting', scenes: 2, importance: 4 }),
      card({ name: 'Iska', role: 'Supporting', scenes: 3, importance: 5 }),
      card({ name: 'Ansel', role: 'minor', scenes: 0, importance: 1 })
    ]
    const b = kindBanner('character', people, 'Sample world: Gullhaven')
    expect(b.title).toBe('The people of Gullhaven')
    expect(b.facts).toEqual(['4 characters', '1 protagonist', '2 supporting', '1 minor', '1 not in a scene yet'])
    expect(b.most).toBe('Wren is in the most scenes (4)')
    expect(b.lead.map((c) => c.name)).toEqual(['Wren', 'Iska', 'Edric'])
    expect(b.appearances).toBe(9)

    const places = [card({ name: 'Town', kind: 'place', scenes: 3 }), card({ name: 'Light', kind: 'place', scenes: 2 })]
    const inside = kindBanner('place', places, 'Gullhaven', { parentOf: (id) => (id === places[1].id ? 'Town' : null) })
    expect(inside.facts).toEqual(['2 places', '1 inside Town'])

    const threads = [card({ name: 'Q1', kind: 'thread' }), card({ name: 'Q2', kind: 'thread' })]
    const t = kindBanner('thread', threads, 'Gullhaven', {
      threads: new Map([
        [threads[0].id, { column: 'open' as const }],
        [threads[1].id, { column: 'resolved' as const }]
      ])
    })
    expect(t.title).toBe('The questions the story has asked')
    expect(t.facts).toEqual(['2 plot threads', '1 open', '1 resolved'])
    expect(t.most).toBe('')
    expect(inside.most).toBe('Most often in a scene: Town (3)')
    expect(kindBanner('lore', [card({ name: 'Rule', kind: 'lore', hardRule: true })], 'Gullhaven').facts).toEqual(['1 lore', '1 hard rule'])
  })
})
