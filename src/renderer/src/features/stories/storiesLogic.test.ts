import { describe, expect, it } from 'vitest'
import type { StoryPlacement } from '@shared/api'
import { defaultStyleGuide, defaultWritingPrefs } from '@shared/defaults'
import type { Outline, Story } from '@shared/types'
import {
  endOptions,
  endValue,
  firstBookOf,
  flowLine,
  flowStopped,
  gapLabel,
  inShelfOrder,
  KINDS,
  noGapReason,
  pointValue,
  readPoint,
  samePlacement,
  startOptions,
  styleRules,
  switchKind,
  withEnd,
  withStart,
  withStartStory
} from './storiesLogic'

const story = (id: string, patch: Partial<Story> = {}): Story => ({
  id,
  seriesId: 's1',
  title: id,
  premise: '',
  themes: '',
  tone: '',
  kind: 'continues',
  startStoryId: null,
  startAt: 'end',
  startRefId: null,
  endAt: null,
  endRefId: null,
  leadsIntoId: null,
  leadsIn: false,
  timeGap: '',
  position: 0,
  createdOrder: 0,
  style: {},
  createdAt: '',
  updatedAt: '',
  ...patch
})

const scene = (id: string, chapterId: string, title = '') => ({
  id,
  chapterId,
  title,
  position: 0,
  status: 'drafted' as const,
  wordCount: 0,
  updatedAt: '',
  acceptedAt: null,
  memoryState: 'current' as never
})

/** Book 1: Ch 1 (two scenes, the second called "Ashore"), Ch 2 "The ferry" (one scene). */
const outline: Outline = {
  story: story('b1', { title: 'Book 1' }),
  chapters: [
    { id: 'c1', storyId: 'b1', title: 'Chapter 1', goal: '', position: 0, actId: null },
    { id: 'c2', storyId: 'b1', title: 'The ferry', goal: '', position: 1, actId: null }
  ],
  scenes: [scene('c1s1', 'c1', 'Scene 1'), scene('c1s2', 'c1', 'Ashore'), scene('c2s1', 'c2')]
}

const continuesAfter = (id: string | null): StoryPlacement => ({
  kind: 'continues',
  startStoryId: id,
  startAt: 'end',
  startRefId: null,
  endAt: null,
  endRefId: null,
  leadsIntoId: null
})

describe('the four kinds', () => {
  it('each has a label and one sentence of help, in plain words', () => {
    expect(KINDS.map((k) => k.label)).toEqual(['Continues after', 'Side story during', 'Prequel to', 'Own version of events'])
    for (const k of KINDS) {
      expect(k.help).toMatch(/^[A-Z].*\.$/)
      expect(k.help).not.toMatch(/\b(line|main history|anchor|placement|kind)\b/i)
    }
  })
})

describe('start and end choices', () => {
  it('lists the beginning, each scene and chapter in reading order, and the end except for a side story', () => {
    expect(startOptions(outline, 'continues').map((o) => o.label)).toEqual([
      'At its beginning',
      'After Ch 1, Sc 1',
      'After Ch 1, Sc 2: Ashore',
      'After Ch 1',
      'After Ch 2, Sc 1',
      'After Ch 2: The ferry',
      'After its end'
    ])
    expect(startOptions(outline, 'side').map((o) => o.value)).not.toContain('end')
    expect(startOptions(null, 'own').map((o) => o.label)).toEqual(['At its beginning', 'After its end'])
  })

  it('lets a side story end only at or after the chapter it starts in', () => {
    expect(endOptions(outline, 'post').map((o) => o.label)).toEqual(['At its end', 'At the end of Ch 1', 'At the end of Ch 2: The ferry'])
    expect(endOptions(outline, 'chapter:c2').map((o) => o.label)).toEqual(['At its end', 'At the end of Ch 2: The ferry'])
    expect(endOptions(outline, 'scene:c1s2').map((o) => o.value)).toEqual(['end', 'chapter:c1', 'chapter:c2'])
  })

  it('lets a side story that starts at its book’s end (after a deleted story’s start) end only there', () => {
    expect(endOptions(outline, 'end').map((o) => o.label)).toEqual(['At its end'])
    const side: StoryPlacement = { ...continuesAfter('b1'), kind: 'side', startAt: 'end', endAt: 'chapter', endRefId: 'c1' }
    expect(endValue(side, outline)).toBe('end')
  })

  it('reads and writes points as one choice', () => {
    expect(pointValue('pre', null)).toBe('post')
    expect(pointValue('scene', 'c1s2')).toBe('scene:c1s2')
    expect(readPoint('chapter:c2')).toEqual({ at: 'chapter', refId: 'c2' })
    expect(readPoint('end')).toEqual({ at: 'end', refId: null })
    expect(readPoint('post')).toEqual({ at: 'post', refId: null })
  })

  it('moves a side story’s end back to its book’s end when the start passes it', () => {
    const side: StoryPlacement = { ...continuesAfter('b1'), kind: 'side', startAt: 'post', endAt: 'chapter', endRefId: 'c1' }
    expect(endValue(side, outline)).toBe('chapter:c1')
    const later = withStart(side, 'chapter:c2', outline)
    expect(later).toMatchObject({ startAt: 'chapter', startRefId: 'c2', endAt: 'end', endRefId: null })
    expect(withStart(side, 'scene:c1s1', outline)).toMatchObject({ endAt: 'chapter', endRefId: 'c1' })
    expect(withEnd(later, 'chapter:c2')).toMatchObject({ endAt: 'chapter', endRefId: 'c2' })
    expect(withEnd(later, 'end')).toMatchObject({ endAt: 'end', endRefId: null })
  })
})

describe('changing what a story is', () => {
  it('keeps the story it was placed against where that makes sense', () => {
    const p = continuesAfter('b2')
    expect(switchKind(p, 'side', 'b9', 'b1')).toMatchObject({ kind: 'side', startStoryId: 'b2', startAt: 'post', endAt: 'end' })
    expect(switchKind(p, 'prequel', 'b9', 'b1')).toMatchObject({ kind: 'prequel', startStoryId: 'b1', startAt: 'pre' })
    expect(switchKind(p, 'own', 'b9', 'b1')).toMatchObject({ kind: 'own', startStoryId: null })
    expect(switchKind(continuesAfter(null), 'side', 'b9', 'b1')).toMatchObject({ startStoryId: 'b9' })
  })

  it('starts again from the new story’s beginning (or end, for "Continues after")', () => {
    const side: StoryPlacement = {
      ...continuesAfter('b1'),
      kind: 'side',
      startAt: 'chapter',
      startRefId: 'c1',
      endAt: 'chapter',
      endRefId: 'c2'
    }
    expect(withStartStory(side, 'b2')).toMatchObject({
      startStoryId: 'b2',
      startAt: 'post',
      startRefId: null,
      endAt: 'end',
      endRefId: null
    })
    expect(withStartStory({ ...continuesAfter('b1'), startAt: 'chapter', startRefId: 'c1' }, 'b2')).toMatchObject({
      startAt: 'end',
      startRefId: null
    })
  })

  it('compares only what matters for each kind', () => {
    expect(samePlacement(continuesAfter('b1'), { ...continuesAfter('b1'), endAt: 'end' })).toBe(true)
    expect(samePlacement(continuesAfter(null), { ...continuesAfter(null), startAt: 'post' })).toBe(true)
    expect(samePlacement(continuesAfter('b1'), continuesAfter('b2'))).toBe(false)
    const side: StoryPlacement = { ...continuesAfter('b1'), kind: 'side', startAt: 'post', endAt: 'end' }
    expect(samePlacement(side, { ...side, endAt: 'chapter', endRefId: 'c1' })).toBe(false)
  })
})

describe('the time-gap label', () => {
  const stories = [story('b1', { title: 'Book 3' })]
  it('names the story it comes after', () => {
    expect(gapLabel(continuesAfter('b1'), stories)).toBe('Time since Book 3 ended')
    expect(gapLabel({ ...continuesAfter('b1'), startAt: 'chapter', startRefId: 'c1' }, stories)).toBe('Time since that point')
    expect(gapLabel({ ...continuesAfter('b1'), kind: 'own' }, stories)).toBe('Time since Book 3 ended')
  })
  it('has none for side stories, prequels, or a story at the beginning of the world', () => {
    expect(gapLabel({ ...continuesAfter('b1'), kind: 'side', startAt: 'post' }, stories)).toBeNull()
    expect(gapLabel({ ...continuesAfter('b1'), kind: 'prequel', startAt: 'pre' }, stories)).toBeNull()
    expect(gapLabel(continuesAfter(null), stories)).toBeNull()
  })
})

describe('the first book of a series', () => {
  it('is the first that continues from outside the series', () => {
    const stories = [
      story('a1', { seriesId: 'A' }),
      story('a2', { seriesId: 'A', startStoryId: 'a1' }),
      story('p', { seriesId: 'B', kind: 'side', startStoryId: 'a1', startAt: 'post' }),
      story('b2', { seriesId: 'B', startStoryId: 'a2' }),
      story('b3', { seriesId: 'B', startStoryId: 'b2' })
    ]
    expect(firstBookOf(stories, 'A')).toBe('a1')
    expect(firstBookOf(stories, 'B')).toBe('b2')
    expect(firstBookOf(stories, 'C')).toBeNull()
  })
})

describe('the style the AI gets for a story', () => {
  it('tags each rule with where it comes from', () => {
    const prefs = { ...defaultWritingPrefs(), avoidWords: ['suddenly'] }
    const world = { ...defaultStyleGuide(), tense: 'Present tense', avoidPhrases: ['Suddenly', 'very'] }
    const storyStyle = { proseStyle: 'Spare and cold.', avoidPhrases: ['grin'] }
    const rules = styleRules(prefs, world, storyStyle)
    const tagOf = (key: string): string | undefined => rules.find((r) => r.key === key)?.tag
    expect(tagOf('pov')).toBe('My preferences')
    expect(tagOf('tense')).toBe('World')
    expect(tagOf('proseStyle')).toBe('This story')
    expect(tagOf('spelling')).toBe('My preferences')
    expect(rules.find((r) => r.key === 'spelling')?.value).toBe('UK spelling')
    // Phrases add up: each level lists the ones it adds.
    expect(rules.filter((r) => r.label === 'Phrases to avoid').map((r) => [r.tag, r.value])).toEqual([
      ['My preferences', 'suddenly'],
      ['World', 'very'],
      ['This story', 'grin']
    ])
    expect(rules.some((r) => r.key === 'notes')).toBe(false)
  })
})

describe('the story flows’ quiet line', () => {
  it('says what is happening, then how it went', () => {
    const gap = (about?: string): string => flowLine({ flow: 'time-gap', state: 'running', message: null }, about)
    expect(gap('200 years')).toBe('Working out what changed in the 200 years…')
    expect(gap()).toBe('Working out what changed before this story starts…')
    expect(gap('a decade')).toBe('Working out what changed over a decade…')
    // Once the flow says what it is doing, its own words are used.
    expect(flowLine({ flow: 'time-gap', state: 'running', message: 'Working out what changed over the winter…' }, '1 winter')).toBe(
      'Working out what changed over the winter…'
    )
    expect(flowLine({ flow: 'starting-cast', state: 'running', message: null })).toBe('Drafting how each of them starts…')
    expect(flowLine({ flow: 'when', state: 'running', message: null }, 'Book 2')).toBe(
      'Working out when the changes at the start of Book 2 happened…'
    )
    expect(flowLine({ flow: 'when', state: 'done', message: 'Added 4 changes, listed under What changed.' })).toBe(
      'Added 4 changes, listed under What changed.'
    )
    expect(flowLine({ flow: 'when', state: 'failed', message: 'This isn’t ready yet.' })).toBe('This isn’t ready yet.')
    expect(flowLine({ flow: 'when', state: 'failed', message: null })).toMatch(/Try again/)
  })

  it('reads a time gap the way Adam typed it, and leaves out what isn’t plainly a length of time', () => {
    const running = (gap: string): string => flowLine({ flow: 'time-gap', state: 'running', message: null }, gap)
    expect(running('200 years later')).toBe('Working out what changed in the 200 years…')
    expect(running('Three months')).toBe('Working out what changed in the three months…')
    expect(running('1 year')).toBe('Working out what changed over the year…')
    expect(running('One winter.')).toBe('Working out what changed over the winter…')
    expect(running('A hundred years')).toBe('Working out what changed over a hundred years…')
    expect(running('over a century')).toBe('Working out what changed over a century…')
    expect(running('the long winter')).toBe('Working out what changed before this story starts…')
    expect(running('after the war')).toBe('Working out what changed before this story starts…')
  })

  it('knows a flow Adam stopped, which gets no tick', () => {
    expect(flowStopped({ state: 'done', message: 'Stopped. Nothing was changed.' })).toBe(true)
    expect(flowStopped({ state: 'done', message: 'Stopped. Nothing more was changed.' })).toBe(true)
    expect(flowStopped({ state: 'done', message: 'Added 4 changes, listed under What changed.' })).toBe(false)
    expect(flowStopped({ state: 'running', message: null })).toBe(false)
  })
})

describe('the story menu', () => {
  it('lists the stories in reading order, with any the order doesn’t know yet after the others', () => {
    const stories = ['b1', 'b2', 'qy', 'new'].map((id) => story(id))
    expect(inShelfOrder(stories, ['b1', 'qy', 'b2']).map((s) => s.id)).toEqual(['b1', 'qy', 'b2', 'new'])
    expect(inShelfOrder(stories, []).map((s) => s.id)).toEqual(['b1', 'b2', 'qy', 'new'])
  })
})

describe('the line in place of the time gap', () => {
  it('says why there is no gap to fill in', () => {
    const p: StoryPlacement = {
      kind: 'side',
      startStoryId: 'b1',
      startAt: 'post',
      startRefId: null,
      endAt: 'end',
      endRefId: null,
      leadsIntoId: null
    }
    expect(noGapReason(p)).toMatch(/^A side story runs alongside its story/)
    expect(noGapReason({ ...p, kind: 'prequel', startAt: 'pre' })).toMatch(/^A prequel is set before its book/)
    expect(noGapReason({ ...p, kind: 'own', startStoryId: null })).toMatch(/^It starts at the beginning of the world/)
  })
})
