import { describe, expect, it } from 'vitest'
import type { LibraryStory, LibraryWorld } from '@shared/contracts/library'
import {
  continueText,
  deletedLine,
  editedText,
  filterWorlds,
  goesText,
  holdsText,
  orderWorlds,
  storiesText,
  storyKinds,
  whenText,
  wordsText,
  worldLine
} from './startLogic'

const NOW = Date.parse('2026-10-03T12:00:00')
const story = (id: string, title: string, kind = ''): LibraryStory => ({ id, title, kind, words: 1000, editedAt: '' })
const world = (id: string, name: string, stories: LibraryStory[] = []): LibraryWorld => ({
  id,
  name,
  folder: `/lib/${name}`,
  stories,
  words: 0,
  openedAt: '',
  updatedAt: '',
  sample: false
})

describe('start screen words', () => {
  it('counts stories and words in plain words', () => {
    expect(storiesText(0)).toBe('No stories')
    expect(storiesText(1)).toBe('1 story')
    expect(storiesText(4)).toBe('4 stories')
    expect(wordsText(0)).toBe('No words yet')
    expect(wordsText(1)).toBe('1 word')
    expect(wordsText(212000)).toBe('212,000 words')
    expect(holdsText(4, 212000)).toBe('4 stories, 212,000 words')
    expect(holdsText(1, 0)).toBe('1 story, no words yet')
    expect(holdsText(0, 0)).toBe('no stories')
  })

  it('says when, ready to follow a verb', () => {
    expect(whenText('', NOW)).toBe('')
    expect(whenText('2026-10-03T11:55:00', NOW)).toBe('5 minutes ago')
    expect(whenText('2026-08-01T09:00:00', NOW)).toMatch(/^on /)
    expect(editedText('2026-10-03T11:59:50', NOW)).toBe('Edited just now')
    expect(editedText('', NOW)).toBe('')
  })

  it('sums up a world card in one line', () => {
    expect(worldLine({ stories: [story('a', 'A'), story('b', 'B')], words: 5300, openedAt: '2026-10-03T11:55:00' }, NOW)).toBe(
      '2 stories · 5,300 words · Opened 5 minutes ago'
    )
    expect(worldLine({ stories: [], words: 0, openedAt: '' }, NOW)).toBe('No stories · No words yet')
  })

  it('names plain stories Book 1, Book 2 in reading order and keeps the others’ own words', () => {
    const kinds = storyKinds([story('a', 'The Ford'), story('p', 'Before', 'Prequel to Book 1'), story('b', 'The Crossing'), story('s', 'Ash', 'Side story during Book 1')])
    expect(kinds).toEqual({ a: 'Book 1', p: 'Prequel to Book 1', b: 'Book 2', s: 'Side story during Book 1' })
  })

  it('says when a deleted world goes for good', () => {
    expect(goesText('2026-11-01T12:00:00', NOW)).toBe('Goes for good in 29 days')
    expect(goesText('2026-10-04T10:00:00', NOW)).toBe('Goes for good tomorrow')
    expect(goesText('2026-10-03T11:00:00', NOW)).toBe('Goes for good today')
    expect(deletedLine({ stories: 4, words: 212000, purgeAt: '2026-11-01T12:00:00' }, NOW)).toBe('4 stories, 212,000 words · Goes for good in 29 days')
  })

  it('says where Continue goes', () => {
    expect(continueText({ worldName: 'The Northern Reaches', storyTitle: 'Book 1', sceneTitle: 'The Ford', at: '2026-10-03T11:55:00' }, NOW)).toEqual({
      title: 'The Ford',
      where: 'Book 1 › The Northern Reaches · Left off 5 minutes ago'
    })
    expect(continueText({ worldName: 'Ash', storyTitle: 'Book 1', sceneTitle: '', at: '' }, NOW)).toEqual({ title: 'Book 1', where: 'Ash' })
  })
})

describe('start screen lists', () => {
  const worlds = [
    world('w1', 'The Northern Reaches', [story('s1', 'The Ford'), story('s2', 'Winter Crossing')]),
    world('w2', 'Émeraude', [story('s3', 'Ford of Tears')]),
    world('w3', 'Ashgrove', [story('s4', 'Kindling')])
  ]

  it('puts the open world first and keeps the rest in order', () => {
    expect(orderWorlds(worlds, 'w3').map((w) => w.id)).toEqual(['w3', 'w1', 'w2'])
    expect(orderWorlds(worlds, null).map((w) => w.id)).toEqual(['w1', 'w2', 'w3'])
    expect(orderWorlds(worlds, 'gone').map((w) => w.id)).toEqual(['w1', 'w2', 'w3'])
  })

  it('finds worlds by name, or by a story title (showing only those stories)', () => {
    expect(filterWorlds(worlds, '  ').map((s) => s.world.id)).toEqual(['w1', 'w2', 'w3'])
    expect(filterWorlds(worlds, 'emer')).toEqual([{ world: worlds[1], stories: worlds[1].stories, byStory: false }])
    const ford = filterWorlds(worlds, 'FORD')
    expect(ford.map((s) => [s.world.id, s.stories.map((x) => x.id), s.byStory])).toEqual([
      ['w1', ['s1'], true],
      ['w2', ['s3'], true]
    ])
    expect(filterWorlds(worlds, 'nothing like it')).toEqual([])
  })
})
