import { describe, expect, it } from 'vitest'
import type { StoryPlacement } from '@shared/api'
import { dbWorld, KNOWS, pureWorld, theWorld, type WorldSpec } from '../../../tests/unit/testWorld'
import type { WorldShape } from '../memory/types'
import {
  describe as describeStory,
  leadsInto,
  mightFollow,
  placementOf,
  previewStory,
  readingOrder,
  seriesChain,
  startingHere,
  suggestStart,
  suggestion,
  suggestTitle
} from './rules'

const placed = (p: Partial<StoryPlacement> & Pick<StoryPlacement, 'kind'>): StoryPlacement => ({
  startStoryId: null,
  startAt: 'end',
  startRefId: null,
  endAt: null,
  endRefId: null,
  leadsIntoId: null,
  ...p
})
const after = (id: string): StoryPlacement => placed({ kind: 'continues', startStoryId: id })

/** The fixed test world without some of its stories. */
const without = (...keys: string[]): WorldSpec => ({ ...theWorld, stories: theWorld.stories.filter((s) => !keys.includes(s.key)) })

const preview = (
  shape: WorldShape,
  storyId: string | null,
  placement: StoryPlacement,
  title = 'New story',
  seriesId: string | null = 'reach'
) => previewStory(shape, { storyId, title, seriesId, placement })

describe('the preview sentence', () => {
  it('says what every story of the test world knows at its start, as the spec writes it', () => {
    for (const w of [pureWorld(), dbWorld()]) {
      for (const [key, sentence] of Object.entries(KNOWS)) {
        const node = w.shape.stories.find((s) => s.id === w.id(key))!
        const p = preview(w.shape, node.id, placementOf(node), node.title, node.seriesId)
        expect(p.problem, key).toBeNull()
        expect(p.knows, key).toBe(sentence)
      }
    }
  })

  it('says the same for a new story placed like any story that is not a side story', () => {
    const w = pureWorld()
    for (const key of Object.keys(KNOWS)) {
      const node = w.shape.stories.find((s) => s.id === key)!
      if (node.kind === 'side') continue
      expect(preview(w.shape, null, placementOf(node)).knows, key).toBe(KNOWS[key])
    }
  })

  it('updates as the choice changes, without saving anything', () => {
    const w = pureWorld()
    const before = JSON.stringify(w.shape)
    expect(
      preview(w.shape, null, placed({ kind: 'side', startStoryId: 'b2', startAt: 'chapter', startRefId: 'b2.c3', endAt: 'end' })).knows
    ).toBe("This story knows what happened in: Book 1; Kell's Road; The Quiet Year; Book 2 up to the end of Ch 3; Ash; Ember.")
    expect(preview(w.shape, null, placed({ kind: 'side', startStoryId: 'b1', startAt: 'chapter', startRefId: 'b1.c2' })).knows).toBe(
      "This story knows what happened in: Book 1 up to the end of Ch 2; Kell's Road."
    )
    expect(preview(w.shape, null, placed({ kind: 'own' })).knows).toBe('This story knows only the starting setup.')
    expect(JSON.stringify(w.shape)).toBe(before)
  })

  it('refuses a story that would follow on from itself, in plain words', () => {
    const w = pureWorld()
    const p = preview(w.shape, 'b1', after('kr'), 'Book 1')
    expect(p.problem).toBe("Book 1 can't continue after Kell's Road, because Kell's Road starts during Book 1.")
    expect(p.knows).toBe('')
    expect(preview(w.shape, null, placed({ kind: 'side' })).problem).toBe('A side story needs a story to run alongside.')
    expect(preview(w.shape, 'gone', after('b1')).problem).toBe('That story no longer exists.')
  })
})

describe('the still-running note', () => {
  it('names a side story of the same book still running where this one starts, with where it could end first', () => {
    const w = pureWorld()
    const ember = preview(w.shape, 'ember', placementOf(w.shape.stories.find((s) => s.id === 'ember')!), 'Ember')
    expect(ember.stillRunning).toEqual([
      { storyId: 'ash', title: 'Ash', endFirst: { endRefId: 'b2.c1', label: 'End Ash after Ch 1', chapter: 'Ch 1' } }
    ])
  })

  it('is gone from a new story’s preview once Adam chooses to end that story first, which the sentence then knows', () => {
    const w = pureWorld()
    const draft = {
      storyId: null,
      title: 'Thorn',
      seriesId: 'reach',
      placement: placementOf(w.shape.stories.find((s) => s.id === 'ember')!)
    }
    expect(previewStory(w.shape, draft).stillRunning.map((r) => r.title)).toEqual(['Ash', 'Ember'])
    const ended = previewStory(w.shape, { ...draft, endFirst: [{ storyId: 'ash', endRefId: 'b2.c1' }] })
    expect(ended.stillRunning.map((r) => r.title)).toEqual(['Ember'])
    expect(ended.knows).toBe(
      "This story knows what happened in: Book 1; Kell's Road; The Quiet Year; Book 2 up to the end of Ch 1; Ash. Does not know: Ember, which is still running here."
    )
    const both = previewStory(w.shape, {
      ...draft,
      endFirst: [
        { storyId: 'ash', endRefId: 'b2.c1' },
        { storyId: 'ember', endRefId: 'b2.c1' }
      ]
    })
    expect(both.stillRunning).toEqual([])
    expect(both.knows).toBe(
      "This story knows what happened in: Book 1; Kell's Road; The Quiet Year; Book 2 up to the end of Ch 1; Ash; Ember."
    )
    // Only side stories end first; nothing is saved.
    expect(previewStory(w.shape, { ...draft, endFirst: [{ storyId: 'b3', endRefId: 'b2.c1' }] }).knows).toBe(
      previewStory(w.shape, draft).knows
    )
    expect(w.shape.stories.find((s) => s.id === 'ash')!.endRefId).toBe('b2.c3')
  })

  it('is gone once that story ends first, and the sentence then knows it', () => {
    const w = pureWorld()
    const shape: WorldShape = { ...w.shape, stories: w.shape.stories.map((s) => (s.id === 'ash' ? { ...s, endRefId: 'b2.c1' } : s)) }
    const ember = preview(shape, 'ember', placementOf(shape.stories.find((s) => s.id === 'ember')!), 'Ember')
    expect(ember.stillRunning).toEqual([])
    expect(ember.knows).toBe("This story knows what happened in: Book 1; Kell's Road; The Quiet Year; Book 2 up to the end of Ch 1; Ash.")
  })

  it('offers no ending when no chapter ends before this story starts', () => {
    const w = pureWorld()
    const p = preview(w.shape, null, placed({ kind: 'side', startStoryId: 'b2', startAt: 'post', endAt: 'end' }))
    expect(p.stillRunning).toEqual([{ storyId: 'ash', title: 'Ash', endFirst: null }])
    expect(p.knows).toContain('Does not know: Ash, which is still running here.')
  })
})

describe('warnings', () => {
  const w = pureWorld()

  it('warns that continuing after a side story misses the rest of its book, and offers the two likely alternatives', () => {
    const p = preview(w.shape, null, after('kr'))
    expect(p.warnings).toEqual([
      {
        kind: 'after-side',
        message: "Kell's Road is a side story during Book 1, so this story would miss everything in Book 1 after Kell's Road starts.",
        options: [
          { label: 'Continue after Book 1 instead', placement: after('b1') },
          {
            label: 'Make it a side story during Book 1, after Ch 2',
            placement: placed({ kind: 'side', startStoryId: 'b1', startAt: 'chapter', startRefId: 'b1.c2', endAt: 'end' })
          }
        ]
      }
    ])
  })

  it('offers only "Continue after" when the side story runs to its book’s end', () => {
    const p = preview(w.shape, null, after('wolf'))
    expect(p.warnings.map((x) => x.options.map((o) => o.label))).toEqual([['Continue after Book 2 instead']])
  })

  it('asks whether a prequel to a book that is not first in its series meant "Continues after" the book before', () => {
    const p = preview(w.shape, null, placed({ kind: 'prequel', startStoryId: 'b2' }))
    expect(p.warnings).toEqual([
      {
        kind: 'prequel-not-first',
        message: "Book 2 isn't the first book of its series. Did you mean a story that continues after The Quiet Year?",
        options: [{ label: 'Continue after The Quiet Year', placement: after('qy') }]
      }
    ])
  })

  it('says nothing for a prequel to a first book, even one that follows another series', () => {
    expect(preview(w.shape, null, placed({ kind: 'prequel', startStoryId: 'b1' })).warnings).toEqual([])
    expect(preview(w.shape, null, placed({ kind: 'prequel', startStoryId: 'ld' }), 'X', 'dark').warnings).toEqual([])
    expect(preview(w.shape, null, after('b4')).warnings).toEqual([])
  })
})

describe('the grey line on a card', () => {
  const w = pureWorld()
  const line = (key: string): { summary: string; label: string | null } =>
    describeStory(w.shape, w.shape.stories.find((s) => s.id === key)!)

  it('is not there for stories that simply continue', () => {
    expect(line('b2')).toEqual({ summary: 'Continues after The Quiet Year', label: null })
    expect(line('kret')).toEqual({ summary: "Continues after Kell's Road", label: null })
    expect(line('ym2')).toEqual({ summary: 'Continues after Young Mara', label: null })
    expect(line('b1')).toEqual({ summary: 'Starts at the beginning of the world', label: null })
  })

  it('says what any other story is, in one line', () => {
    expect(line('wolf').label).toBe('Side story during Book 2, after Ch 5')
    expect(line('ash').label).toBe('Side story during Book 2, until the end of Ch 3')
    expect(line('ember').label).toBe('Side story during Book 2, after Ch 1 until the end of Ch 3')
    expect(line('s1').label).toBe('Side story during North 1')
    expect(line('ym').label).toBe('Prequel to Book 1')
    expect(line('keep').label).toBe('Own version of events, after Book 1, Ch 2, Sc 1')
    expect(line('other').label).toBe('Own version of events, from the beginning')
  })

  it('comes with every preview', () => {
    expect(preview(w.shape, null, placed({ kind: 'own', startStoryId: 'b1', startAt: 'end' })).label).toBe(
      'Own version of events, after Book 1'
    )
    expect(preview(w.shape, null, after('b4')).label).toBeNull()
  })
})

describe('shelf order', () => {
  it('is reading order: prequels before their book, side stories after their book and before the next, other beginnings by creation', () => {
    const w = pureWorld()
    expect(readingOrder(w.shape).map((id) => w.shape.stories.find((s) => s.id === id)!.title)).toEqual([
      'Young Mara',
      'Young Mara II',
      'Young Mara III',
      'Book 1',
      "Kell's Road",
      "Kell's Return",
      'Mara Keeps Her Hand',
      'The Quiet Year',
      'Book 2',
      'Ash',
      'Ember',
      'Wolf Winter',
      'Book 3',
      'Book 4',
      'Before the Dark',
      'The Long Dark',
      'Lantern',
      'Another Reach',
      'North 1',
      'South 1',
      'North 2',
      'South 2',
      'North 3',
      'South 3',
      'South 4'
    ])
  })

  it('moves a book after the story it now continues after, and lists every story once', () => {
    const w = pureWorld({
      ...theWorld,
      stories: theWorld.stories.map((s) => (s.key === 'b2' ? { ...s, start: { story: 'b1', at: 'end' } } : s))
    })
    const order = readingOrder(w.shape)
    expect(order.indexOf('b2')).toBeLessThan(order.indexOf('qy'))
    const loop: WorldShape = { ...w.shape, stories: w.shape.stories.map((s) => (s.id === 'b1' ? { ...s, startStoryId: 'b4' } : s)) }
    expect([...readingOrder(loop)].sort()).toEqual(w.shape.stories.map((s) => s.id).sort())
  })
})

describe('the suggested start in the New story dialog', () => {
  it('continues after the last book of the series’ chain (side stories, prequels and own versions are not in it)', () => {
    const w = pureWorld()
    expect(seriesChain(w.shape, 'reach').map((s) => s.id)).toEqual(['b1', 'qy', 'b2', 'b3', 'b4'])
    expect(suggestStart(w.shape, 'reach', null)).toEqual(after('b4'))
    expect(suggestStart(w.shape, 'north', null)).toEqual(after('n3'))
    expect(suggestStart(w.shape, 'dark', null)).toEqual(after('ld'))
  })

  it('follows the first on the shelf where two books continue after the same one', () => {
    const w = pureWorld({
      ...theWorld,
      stories: theWorld.stories.map((s) => (s.key === 'b2' ? { ...s, start: { story: 'b1', at: 'end' } } : s))
    })
    expect(seriesChain(w.shape, 'reach').map((s) => s.id)).toEqual(['b1', 'b2', 'b3', 'b4'])
  })

  it('for a series running alongside another, is a side story during that series’ next book, from its start', () => {
    const w = pureWorld(without('s3', 's4'))
    expect(suggestStart(w.shape, 'south', null)).toEqual(placed({ kind: 'side', startStoryId: 'n3', startAt: 'post', endAt: 'end' }))
    // Kell's Road runs during Book 1, so the Kell series runs alongside The Reach.
    expect(suggestStart(pureWorld().shape, 'kell', null)).toEqual(
      placed({ kind: 'side', startStoryId: 'qy', startAt: 'post', endAt: 'end' })
    )
  })

  it('continues after that series’ last book when it has no next one, and after its own books from then on', () => {
    expect(suggestStart(pureWorld(without('s4')).shape, 'south', null)).toEqual(after('n3'))
    expect(suggestStart(pureWorld().shape, 'south', null)).toEqual(after('s4'))
  })

  it('for a new or empty series, is the suggestion for the series Adam last worked in', () => {
    const w = pureWorld()
    expect(suggestStart(w.shape, null, 'n2')).toEqual(after('n3'))
    expect(suggestStart(w.shape, 'empty-series', 'ash')).toEqual(after('b4'))
    expect(suggestStart(w.shape, null, 'ym3')).toEqual(after('b4'))
  })

  it('starts at the beginning of the world when there is nothing to go by', () => {
    expect(suggestStart({ stories: [], answers: [] }, null, null)).toEqual(placed({ kind: 'continues' }))
  })

  it('suggests the next number for the title, never one already taken', () => {
    const w = pureWorld()
    expect(suggestTitle(w.shape, 'reach')).toBe('Book 5')
    expect(suggestTitle(w.shape, 'north')).toBe('North 4')
    expect(suggestTitle(w.shape, 'south')).toBe('South 5')
    expect(suggestTitle(w.shape, 'dark')).toBe('The Long Dark 2')
    expect(suggestTitle(w.shape, null, 'The Far Shore')).toBe('The Far Shore')
    expect(suggestTitle(w.shape, null, 'North')).toBe('North')
  })

  it('comes with its preview', () => {
    const s = suggestion(pureWorld().shape, { seriesId: 'reach', fromStoryId: 'b1' })
    expect(s.title).toBe('Book 5')
    expect(s.preview.summary).toBe('Continues after Book 4')
    expect(s.preview.knows).toBe(
      "This story knows what happened in: Book 1; Kell's Road; The Quiet Year; Book 2; Ash; Ember; Wolf Winter; Book 3; Book 4."
    )
  })
})

describe('what story settings shows', () => {
  it('asks "Should Book 2 now continue after it?" of an earlier book of the series that continues after the same story', () => {
    const before = pureWorld({
      ...theWorld,
      stories: theWorld.stories.map((s) => (s.key === 'b2' ? { ...s, start: { story: 'b1', at: 'end' } } : s))
    })
    expect(mightFollow(before.shape, 'qy')).toEqual([{ storyId: 'b2', title: 'Book 2' }])
    expect(mightFollow(before.shape, 'b2')).toEqual([])
    // Once Book 2 continues after The Quiet Year, there is nothing to ask.
    expect(mightFollow(pureWorld().shape, 'qy')).toEqual([])
  })

  it('never asks it of a book in another series', () => {
    const w = pureWorld()
    const shape: WorldShape = {
      ...w.shape,
      stories: [
        ...w.shape.stories,
        { ...w.shape.stories.find((s) => s.id === 'b4')!, id: 'b5', title: 'Book 5', startStoryId: 'b4', createdOrder: 99 }
      ]
    }
    expect(mightFollow(shape, 'b5')).toEqual([])
  })

  it('names the stories that start in a story, and where they would start without it', () => {
    const w = pureWorld()
    expect(startingHere(w.shape, 'kr')).toEqual([{ storyId: 'kret', title: "Kell's Return", wouldStart: 'after Book 1, Ch 1' }])
    expect(startingHere(w.shape, 'qy')).toEqual([{ storyId: 'b2', title: 'Book 2', wouldStart: 'after Book 1' }])
    expect(startingHere(w.shape, 'b1').map((s) => s.wouldStart)).toEqual(Array(4).fill('at the beginning of the world'))
    expect(startingHere(w.shape, 'b4')).toEqual([{ storyId: 'ld', title: 'The Long Dark', wouldStart: 'after Book 3' }])
  })

  it('says which story of a prequel chain leads into the book', () => {
    const w = pureWorld()
    const book = { storyId: 'b1', title: 'Book 1' }
    expect(leadsInto(w.shape, 'ym')).toEqual({ book, leader: { storyId: 'ym3', title: 'Young Mara III' }, marked: false })
    expect(leadsInto(w.shape, 'ym2')).toEqual({ book, leader: { storyId: 'ym3', title: 'Young Mara III' }, marked: false })
    expect(leadsInto(w.shape, 'b2')).toBeNull()
    const marked: WorldShape = { ...w.shape, stories: w.shape.stories.map((s) => (s.id === 'ym2' ? { ...s, leadsIn: true } : s)) }
    expect(leadsInto(marked, 'ym3')).toEqual({ book, leader: { storyId: 'ym2', title: 'Young Mara II' }, marked: true })
  })
})
