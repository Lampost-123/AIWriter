// The line's finer points (src/main/memory/line.ts), on small worlds written as plain data.
// The whole test world is in testWorld.test.ts.

import { describe, expect, it } from 'vitest'
import type { StoryPlacement } from '@shared/api'
import {
  buildLine,
  compareOrder,
  hostSpans,
  knowsSentence,
  placeLabel,
  placementProblem,
  previousSceneStep,
  scenesBefore,
  storyOrder
} from '../../src/main/memory/line'
import { pureWorld, type AnswerSpec, type StorySpec, type WorldSpec } from './testWorld'

const world = (stories: StorySpec[], answers: AnswerSpec[] = []): WorldSpec => ({
  name: 'Small',
  series: [{ key: 's', name: 'Small' }],
  stories,
  entries: [],
  changes: [],
  answers
})
const story = (key: string, title: string, chapters: number[], more: Partial<StorySpec> = {}): StorySpec => ({
  key,
  title,
  series: 's',
  chapters,
  ...more
})

describe('the line', () => {
  it("gives the spec's own sentence", () => {
    const w = pureWorld(
      world([
        story('b1', 'Book 1', [1, 1, 1]),
        story('kr', "Kell's Road", [1], {
          kind: 'side',
          start: { story: 'b1', at: 'chapter', ref: 'b1.c1' },
          end: { at: 'chapter', ref: 'b1.c2' }
        }),
        story('b2', 'Book 2', [1, 1, 1, 1, 1, 1], { start: { story: 'b1', at: 'end' } }),
        story('nov', 'A Novella', [1], { kind: 'side', start: { story: 'b2', at: 'chapter', ref: 'b2.c5' } })
      ])
    )
    expect(w.knows('nov')).toBe("This story knows what happened in: Book 1; Kell's Road; Book 2 up to the end of Ch 5.")
  })

  it('walks each story: start, start-of-story changes, scenes, chapter ends (empty chapters too), end', () => {
    const w = pureWorld(world([story('b1', 'Book 1', [1, 0, 1])]))
    const steps = w.line('b1', 'end').steps.map((s) => [s.type, 'sceneId' in s ? s.sceneId : 'chapterId' in s ? s.chapterId : s.storyId])
    expect(steps).toEqual([
      ['start', 'b1'],
      ['start-changes', 'b1'],
      ['scene', 'b1.c1.s1'],
      ['chapter-end', 'b1.c1'],
      ['chapter-end', 'b1.c2'],
      ['scene', 'b1.c3.s1'],
      ['chapter-end', 'b1.c3'],
      ['end', 'b1']
    ])
    expect(w.line('b1', 'start').steps.map((s) => s.type)).toEqual(['start', 'start-changes'])
    expect(w.line('b1', 'b1.c3.s1').steps.map((s) => s.type)).toEqual(['start', 'start-changes', 'scene', 'chapter-end', 'chapter-end'])
    expect(w.line('b1', 'b1.c3.s1').segments).toEqual([
      { storyId: 'b1', via: 'line', addedIn: null, whole: false, stop: { at: 'chapter', refId: 'b1.c2' } }
    ])
    expect(w.line('b1', 'b1.c1.s1').segments[0].stop).toEqual({ at: 'post', refId: null })
    expect(w.line('b1', 'end').segments[0]).toMatchObject({ whole: true, stop: null })
    expect(() => buildLine(w.shape, { storyId: 'b1', before: 'nope' })).toThrow()
  })

  it('cuts stories where the next one starts: before or after its start-of-story changes, after a chapter or a scene', () => {
    const w = pureWorld(
      world([
        story('b1', 'Book 1', [2, 2]),
        story('pre', 'Before', [1], { kind: 'prequel', start: { story: 'b1', at: 'pre' } }),
        story('post', 'Alongside', [1], { kind: 'side', start: { story: 'b1', at: 'post' } }),
        story('ch', 'After Ch 1', [1], { kind: 'own', start: { story: 'b1', at: 'chapter', ref: 'b1.c1' } }),
        story('sc', 'After Sc', [1], { kind: 'own', start: { story: 'b1', at: 'scene', ref: 'b1.c2.s1' } })
      ])
    )
    expect(w.line('pre', 'start').steps.map((s) => `${s.type}:${s.storyId}`)).toEqual(['start:b1', 'start:pre', 'start-changes:pre'])
    expect(w.knows('pre')).toBe('This story knows only the starting setup.')
    expect(w.line('post', 'start').steps.map((s) => `${s.type}:${s.storyId}`)).toEqual([
      'start:b1',
      'start-changes:b1',
      'start:post',
      'start-changes:post'
    ])
    expect(w.knows('post')).toBe('This story knows what happened in: the start of Book 1.')
    expect(w.knows('ch')).toBe('This story knows what happened in: Book 1 up to the end of Ch 1.')
    expect(w.knows('sc')).toBe('This story knows what happened in: Book 1 up to Ch 2, Sc 1.')
  })

  it('"after the last scene of Ch 2" comes before "after Ch 2"', () => {
    const w = pureWorld(
      world([
        story('b1', 'Book 1', [2, 2, 1]),
        story('kr', "Kell's Road", [1], {
          kind: 'side',
          start: { story: 'b1', at: 'chapter', ref: 'b1.c1' },
          end: { at: 'chapter', ref: 'b1.c2' }
        }),
        story('a', 'After the scene', [1], { kind: 'own', start: { story: 'b1', at: 'scene', ref: 'b1.c2.s2' } }),
        story('b', 'After the chapter', [1], { kind: 'own', start: { story: 'b1', at: 'chapter', ref: 'b1.c2' } })
      ])
    )
    expect(w.knows('a')).toBe('This story knows what happened in: Book 1 up to Ch 2, Sc 2.')
    // An end point exactly at a stop point counts.
    expect(w.knows('b')).toBe("This story knows what happened in: Book 1 up to the end of Ch 2; Kell's Road.")
  })

  it('adds side stories whole, with side stories that end inside them, never twice, never the story itself', () => {
    const w = pureWorld(
      world([
        story('b1', 'Book 1', [1, 1]),
        story('side', 'Side', [2], { kind: 'side', start: { story: 'b1', at: 'post' } }),
        story('inner', 'Inner', [1], { kind: 'side', start: { story: 'side', at: 'post' }, end: { at: 'chapter', ref: 'side.c1' } }),
        story('zero', 'Zero', [1], {
          kind: 'side',
          start: { story: 'b1', at: 'chapter', ref: 'b1.c1' },
          end: { at: 'chapter', ref: 'b1.c1' }
        }),
        story('b2', 'Book 2', [1], { start: { story: 'b1', at: 'end' } }),
        story('after', 'After Zero', [1], { start: { story: 'zero', at: 'end' } })
      ])
    )
    const b2 = w.line('b2', 'start')
    expect(b2.segments.map((s) => [s.storyId, s.via, s.addedIn])).toEqual([
      ['b1', 'line', null],
      ['zero', 'side', 'b1'],
      ['side', 'side', 'b1'],
      ['inner', 'side', 'side'],
      ['b2', 'line', null]
    ])
    expect(knowsSentence(w.shape, b2)).toBe('This story knows what happened in: Book 1; Zero; Side; Inner.')
    // A side story that ends where it starts is not added to its own walk...
    expect(w.line('zero', 'start').segments.map((s) => s.storyId)).toEqual(['b1', 'zero'])
    // ...and a story continuing after it walks it once, on its chain.
    expect(w.line('after', 'start').segments.map((s) => [s.storyId, s.via])).toEqual([
      ['b1', 'line'],
      ['zero', 'line'],
      ['after', 'line']
    ])
    // Side stories that end inside the story being drafted count once they have ended.
    expect(w.knows('b1', 'b1.c2.s1')).toBe('This story knows what happened in: Zero.')
  })

  it("orders side stories ending at the same point by start, then creation, and Adam's order first", () => {
    const stories = [
      story('h', 'Host', [1, 1, 1]),
      story('late', 'Late', [1], { kind: 'side', start: { story: 'h', at: 'chapter', ref: 'h.c1' }, end: { at: 'chapter', ref: 'h.c2' } }),
      story('early', 'Early', [1], { kind: 'side', start: { story: 'h', at: 'post' }, end: { at: 'chapter', ref: 'h.c2' } }),
      story('early2', 'Early too', [1], { kind: 'side', start: { story: 'h', at: 'post' }, end: { at: 'chapter', ref: 'h.c2' } }),
      story('next', 'Next', [1], { start: { story: 'h', at: 'end' } })
    ]
    expect(pureWorld(world(stories)).knows('next')).toBe('This story knows what happened in: Host; Early; Early too; Late.')
    const lateFirst: AnswerSpec = { kind: 'side-order', key: (id) => `${id('h')}:chapter:${id('h.c2')}`, value: (id) => [id('late')] }
    expect(pureWorld(world(stories, [lateFirst])).knows('next')).toBe('This story knows what happened in: Host; Late; Early; Early too.')
  })

  it('treats a chapter or scene that is not in the story as its start, after its start-of-story changes', () => {
    const w = pureWorld(
      world([story('b1', 'Book 1', [1]), story('x', 'X', [1], { kind: 'own', start: { story: 'b1', at: 'chapter', ref: 'gone' } })])
    )
    expect(w.knows('x')).toBe('This story knows what happened in: the start of Book 1.')
  })

  it('adds a side story whose end is before its start at its start', () => {
    const w = pureWorld(
      world([
        story('h', 'Host', [1, 1]),
        story('odd', 'Odd', [1], { kind: 'side', start: { story: 'h', at: 'chapter', ref: 'h.c2' }, end: { at: 'chapter', ref: 'h.c1' } }),
        story('next', 'Next', [1], { start: { story: 'h', at: 'end' } })
      ])
    )
    expect(w.knows('next')).toBe('This story knows what happened in: Host; Odd.')
  })

  it('never follows a broken chain round for ever', () => {
    const w = pureWorld(
      world([story('a', 'A', [1], { start: { story: 'b', at: 'end' } }), story('b', 'B', [1], { start: { story: 'a', at: 'end' } })])
    )
    expect(w.knows('a')).toBe('This story knows what happened in: B.')
  })

  it('finds the previous scene, and every earlier scene that counts', () => {
    const w = pureWorld(
      world([
        story('b1', 'Book 1', [1, 1]),
        story('side', 'Side', [1], { kind: 'side', start: { story: 'b1', at: 'post' }, end: { at: 'chapter', ref: 'b1.c1' } }),
        story('b2', 'Book 2', [1], { start: { story: 'b1', at: 'end' } })
      ])
    )
    expect(previousSceneStep(w.line('b2', 'b2.c1.s1'))?.sceneId).toBe('b1.c2.s1')
    expect(scenesBefore(w.shape, 'b2.c1.s1')).toEqual(['b1.c1.s1', 'side.c1.s1', 'b1.c2.s1'])
    expect(scenesBefore(w.shape, 'b1.c1.s1')).toEqual([])
    expect(scenesBefore(w.shape, 'nope')).toEqual([])
  })
})

describe('placement', () => {
  const w = pureWorld(
    world([
      story('b1', 'Book 1', [1, 1, 1]),
      story('kr', "Kell's Road", [1], {
        kind: 'side',
        start: { story: 'b1', at: 'chapter', ref: 'b1.c1' },
        end: { at: 'chapter', ref: 'b1.c2' }
      }),
      story('b2', 'Book 2', [1], { start: { story: 'b1', at: 'end' } }),
      story('b3', 'Book 3', [1], { start: { story: 'b2', at: 'end' } }),
      story('p', 'Young Mara', [1], { kind: 'prequel', start: { story: 'b1', at: 'pre' } })
    ])
  )
  const place = (p: Partial<StoryPlacement>): StoryPlacement => ({
    kind: 'continues',
    startStoryId: null,
    startAt: 'end',
    startRefId: null,
    endAt: null,
    endRefId: null,
    leadsIntoId: null,
    ...p
  })
  const problem = (id: string, p: Partial<StoryPlacement>) => placementProblem(w.shape, id, place(p))

  it('allows sensible placements', () => {
    expect(problem('b3', { startStoryId: 'kr' })).toBeNull()
    expect(problem('b2', {})).toBeNull()
    expect(
      problem('kr', { kind: 'side', startStoryId: 'b1', startAt: 'chapter', startRefId: 'b1.c1', endAt: 'chapter', endRefId: 'b1.c1' })
    ).toBeNull()
    expect(problem('p', { kind: 'prequel', startStoryId: 'b1', startAt: 'pre', leadsIntoId: 'b1' })).toBeNull()
  })

  it('refuses a story following on from itself, however long the chain', () => {
    expect(problem('b1', { kind: 'side', startStoryId: 'kr', startAt: 'post', endAt: 'end' })).toBe(
      "Book 1 can't start during Kell's Road, because Kell's Road starts during Book 1."
    )
    expect(problem('b1', { startStoryId: 'b2' })).toBe("Book 1 can't continue after Book 2, because Book 2 continues after Book 1.")
    expect(problem('b1', { startStoryId: 'b3' })).toBe("Book 1 can't continue after Book 3, because Book 3 follows on from Book 1.")
    expect(problem('b1', { kind: 'prequel', startStoryId: 'p', startAt: 'pre' })).toBe(
      "Book 1 can't be a prequel to Young Mara, because Young Mara is a prequel to Book 1."
    )
    expect(problem('b2', { kind: 'side', startStoryId: 'b2', startAt: 'post' })).toBe("Book 2 can't start during itself.")
  })

  it('refuses ends before starts, ends on stories that are not side stories, and places not in the story', () => {
    expect(
      problem('kr', { kind: 'side', startStoryId: 'b1', startAt: 'chapter', startRefId: 'b1.c2', endAt: 'chapter', endRefId: 'b1.c1' })
    ).toBe("Kell's Road can't end before it starts.")
    expect(problem('kr', { kind: 'side', startStoryId: 'b1', startAt: 'end', endAt: 'chapter', endRefId: 'b1.c3' })).toBe(
      "Kell's Road can't end before it starts."
    )
    expect(problem('b2', { startStoryId: 'b1', endAt: 'end' })).toBe('Only a side story can end partway through another story.')
    expect(problem('kr', { kind: 'side', startStoryId: 'b1', startAt: 'chapter', startRefId: 'b2.c1' })).toBe(
      "That chapter isn't in Book 1."
    )
    expect(problem('kr', { kind: 'side', startStoryId: 'b1', startAt: 'scene', startRefId: 'b1.c1' })).toBe("That scene isn't in Book 1.")
    expect(problem('kr', { kind: 'side', startStoryId: 'b1', startAt: 'chapter' })).toBe('Pick the chapter it starts after.')
    expect(problem('kr', { kind: 'side', startStoryId: 'b1', startAt: 'scene' })).toBe('Pick the scene it starts after.')
    expect(problem('kr', { kind: 'side', startStoryId: 'b1', startAt: 'post', endAt: 'chapter' })).toBe('Pick the chapter it ends after.')
    expect(problem('kr', { kind: 'side', startStoryId: 'b1', startAt: 'post', endAt: 'chapter', endRefId: 'b2.c1' })).toBe(
      "That chapter isn't in Book 1."
    )
    expect(problem('kr', { kind: 'side' })).toBe('A side story needs a story to run alongside.')
    expect(problem('p', { kind: 'prequel' })).toBe('A prequel needs the book it comes before.')
    expect(problem('b2', { startStoryId: 'gone' })).toBe('The story it starts in no longer exists.')
    expect(problem('p', { kind: 'prequel', startStoryId: 'b1', startAt: 'pre', leadsIntoId: 'p' })).toBe(
      "Young Mara can't lead into itself."
    )
    expect(problem('gone', {})).toBe('That story no longer exists.')
  })
})

describe('places in plain words', () => {
  const w = pureWorld(world([story('b1', 'Book 1', [1, 3]), story('b2', 'Book 2', [1], { start: { story: 'b1', at: 'end' } })]))

  it('counts live chapters and scenes from 1', () => {
    expect(placeLabel(w.shape, { storyId: 'b1', sceneId: 'b1.c2.s3' })).toBe('Book 1, Ch 2, Sc 3')
    expect(placeLabel(w.shape, { storyId: 'b1', chapterId: 'b1.c2' })).toBe('Book 1, Ch 2')
    expect(placeLabel(w.shape, { storyId: 'b2' })).toBe('the start of Book 2')
    expect(placeLabel(w.shape, { storyId: 'b1', sceneId: 'gone' })).toBe('a deleted scene in Book 1')
  })

  it('puts places in story order', () => {
    const order = storyOrder(w.shape)
    const places = [
      { storyId: 'b2', sceneId: 'b2.c1.s1' },
      { storyId: 'b1', sceneId: 'b1.c2.s1' },
      { storyId: 'b2' },
      { storyId: 'b1' },
      { storyId: 'b1', sceneId: 'b1.c1.s1' }
    ]
    const sorted = [...places].sort((a, b) => compareOrder(order(a), order(b)))
    expect(sorted).toEqual([places[3], places[4], places[1], places[2], places[0]])
    expect(order({ storyId: 'gone' })).toEqual([Infinity])
  })

  it('finds what a host did while its side story ran', () => {
    const h = pureWorld(
      world([
        story('h', 'Host', [1, 1, 1]),
        story('s', 'Side', [1], { kind: 'side', start: { story: 'h', at: 'chapter', ref: 'h.c1' }, end: { at: 'chapter', ref: 'h.c2' } }),
        story('p', 'From the start', [1], { kind: 'side', start: { story: 'h', at: 'pre' }, end: { at: 'chapter', ref: 'h.c1' } })
      ])
    )
    expect(hostSpans(h.shape)('s')).toEqual({ hostId: 'h', startChanges: false, sceneIds: ['h.c2.s1'] })
    expect(hostSpans(h.shape)('p')).toEqual({ hostId: 'h', startChanges: true, sceneIds: ['h.c1.s1'] })
    expect(hostSpans(h.shape)('h')).toBeNull()
  })
})
