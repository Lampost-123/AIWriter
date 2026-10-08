import { describe, expect, it } from 'vitest'
import type { CodexCard } from '@shared/contracts/entryViews'
import {
  GALLERY_KINDS,
  NO_FILTERS,
  appearsLine,
  featuredCard,
  filterCards,
  filtersOn,
  groupCards,
  nothingMatches,
  roleChoices,
  shownCards,
  sortCards,
  tagChoices,
  tidyFilters
} from './codexLogic'

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
  storyIds: [],
  ...c
})

const last = (order: number) => ({ sceneId: `s${order}`, storyId: 'b1', label: `Book 1, Ch 1, Sc ${order + 1}`, order })

const mara = card({
  name: 'Mara',
  aliases: ['the ferrywoman'],
  tags: ['Family', 'the north'],
  role: 'protagonist',
  scenes: 3,
  importance: 9,
  last: last(4),
  storyIds: ['b1', 'b2']
})
const tobin = card({
  name: 'Tobin',
  summary: 'Runs the toll bridge',
  tags: ['family'],
  role: 'antagonist',
  scenes: 1,
  importance: 3,
  last: last(7),
  storyIds: ['b1']
})
const kell = card({ name: 'kell', role: 'Comic relief', storyIds: ['b2'] })
const eel = card({ name: 'Eelmouth', kind: 'place', tags: ['the north'], scenes: 2, importance: 4, last: last(2), storyIds: ['b1'] })
const rule = card({ name: 'Every spell costs a memory', kind: 'lore', hardRule: true })
const thread = card({ name: 'Who left the letter?', kind: 'thread', tags: ['family'] })
const all = [mara, tobin, kell, eel, rule, thread]

describe('the codex', () => {
  it('leaves plot threads out (they have their own board)', () => {
    expect(filterCards(all, NO_FILTERS)).not.toContain(thread)
    expect(groupCards(filterCards(all, NO_FILTERS)).map((g) => g.label)).toEqual(['Characters', 'Places', 'Lore'])
  })

  it('filters by kind, tag, story and role, without minding case', () => {
    expect(filterCards(all, { ...NO_FILTERS, kind: 'place' })).toEqual([eel])
    expect(filterCards(all, { ...NO_FILTERS, tag: 'FAMILY' })).toEqual([mara, tobin])
    expect(filterCards(all, { ...NO_FILTERS, tag: 'the north', kind: 'character' })).toEqual([mara])
    expect(filterCards(all, { ...NO_FILTERS, storyId: 'b2' })).toEqual([mara, kell])
    expect(filterCards(all, { ...NO_FILTERS, role: 'comic relief' })).toEqual([kell])
    expect(filtersOn({ ...NO_FILTERS, query: ' ', tag: 'x', role: 'y' })).toBe(2)
  })

  it('searches names, other names and one-liners, names first', () => {
    expect(filterCards(all, { ...NO_FILTERS, query: 'ferry' })).toEqual([mara])
    expect(filterCards(all, { ...NO_FILTERS, query: 'toll' })).toEqual([tobin])
    expect(filterCards(all, { ...NO_FILTERS, query: 'zzz' })).toEqual([])
  })

  it('sorts by name, importance or last appearance, ties by name', () => {
    const list = [tobin, eel, kell, mara]
    expect(sortCards(list, 'name').map((c) => c.name)).toEqual(['Eelmouth', 'kell', 'Mara', 'Tobin'])
    expect(sortCards(list, 'importance').map((c) => c.name)).toEqual(['Mara', 'Eelmouth', 'Tobin', 'kell'])
    // Latest first; never seen last.
    expect(sortCards(list, 'last').map((c) => c.name)).toEqual(['Tobin', 'Mara', 'Eelmouth', 'kell'])
    const items = [card({ name: 'Item 10' }), card({ name: 'Item 9' }), card({ name: '' })]
    expect(sortCards(items, 'name').map((c) => c.name)).toEqual(['Item 9', 'Item 10', ''])
  })

  it('shows a search sorted by name with matching names first, A to Z within each; other sorts order them all', () => {
    const tess = card({ name: 'Tess', summary: 'Mara’s sister', importance: 5 })
    const amaryllis = card({ name: 'Amaryllis' })
    const marek = card({ name: 'Marek' })
    const list = [tess, amaryllis, marek, mara, tobin]
    const search = { ...NO_FILTERS, query: 'mar' }
    expect(shownCards(list, search, 'name').map((c) => c.name)).toEqual(['Mara', 'Marek', 'Amaryllis', 'Tess'])
    expect(shownCards(list, search, 'importance').map((c) => c.name)).toEqual(['Mara', 'Tess', 'Amaryllis', 'Marek'])
    expect(shownCards(list, NO_FILTERS, 'name').map((c) => c.name)).toEqual(['Amaryllis', 'Mara', 'Marek', 'Tess', 'Tobin'])
  })

  it('says what matched nothing in plain words', () => {
    expect(nothingMatches({ ...NO_FILTERS, query: 'zzz' })).toBe('Nothing in the codex matches your search.')
    expect(nothingMatches({ ...NO_FILTERS, tag: 'x' })).toBe('Nothing in the codex matches this filter.')
    expect(nothingMatches({ ...NO_FILTERS, tag: 'x', role: 'y' })).toBe('Nothing in the codex matches all of these filters.')
    expect(nothingMatches({ ...NO_FILTERS, query: 'zzz', kind: 'place' })).toBe('Nothing in the codex matches your search and this filter.')
  })

  it('groups by kind in a fixed order, keeping the sort within each', () => {
    const groups = groupCards(sortCards([eel, tobin, rule, mara], 'importance'))
    expect(groups.map((g) => [g.kind, g.cards.map((c) => c.name)])).toEqual([
      ['character', ['Mara', 'Tobin']],
      ['place', ['Eelmouth']],
      ['lore', ['Every spell costs a memory']]
    ])
  })

  it('offers each tag and role once, roles in story order then Adam’s own', () => {
    expect(tagChoices(all).map((c) => c.label)).toEqual(['Family', 'the north'])
    expect(roleChoices(all).map((c) => c.label)).toEqual(['Protagonist', 'Antagonist', 'Comic relief'])
  })

  it('says where each card appears in plain words', () => {
    expect(appearsLine(mara)).toBe('In 3 scenes · last in Book 1, Ch 1, Sc 5')
    expect(appearsLine(tobin)).toBe('In 1 scene · last in Book 1, Ch 1, Sc 8')
    expect(appearsLine(kell)).toBe('Not in a scene yet')
  })

  it('drops a filter whose tag, role or story is gone, keeping the same object otherwise', () => {
    const f = { ...NO_FILTERS, tag: 'family', role: 'minor', storyId: 'b9' }
    const have = { tags: tagChoices(all), roles: roleChoices(all), storyIds: ['b1'] }
    expect(tidyFilters(f, have)).toEqual({ ...f, role: null, storyId: null })
    const ok = { ...NO_FILTERS, tag: 'FAMILY' }
    expect(tidyFilters(ok, { tags: tagChoices(all), roles: [], storyIds: [] })).toBe(ok)
  })

  it('the desk’s World room keeps plot threads, after everything else', () => {
    expect(filterCards(all, NO_FILTERS, GALLERY_KINDS)).toContain(thread)
    expect(groupCards(shownCards(all, NO_FILTERS, 'name', GALLERY_KINDS), GALLERY_KINDS).map((g) => g.kind)).toEqual(['character', 'place', 'lore', 'thread'])
    expect(filterCards(all, { ...NO_FILTERS, kind: 'thread' }, GALLERY_KINDS)).toEqual([thread])
  })

  it('features the most important character, a protagonist first among equals', () => {
    expect(featuredCard(all)).toBe(mara.id)
    // Equal importance: the protagonist; then by name.
    const a = card({ name: 'Ada', importance: 4 })
    const b = card({ name: 'Bryn', importance: 4, role: 'Protagonist' })
    expect(featuredCard([a, b])).toBe(b.id)
    expect(featuredCard([b, card({ name: 'Cass', importance: 4, role: 'protagonist' })])).toBe(b.id)
    // Nobody stands out yet (no scenes, no protagonist), or only one character: none.
    expect(featuredCard([card({ name: 'Dee' }), card({ name: 'Eli' })])).toBeNull()
    expect(featuredCard([mara])).toBeNull()
    expect(featuredCard([eel, rule, mara])).toBeNull()
    // A protagonist not yet in a scene still leads.
    expect(featuredCard([card({ name: 'Fen' }), card({ name: 'Gil', role: 'protagonist' })])).not.toBeNull()
  })
})
