import { describe, expect, it } from 'vitest'
import type { Chapter, Outline, SceneMeta } from '@shared/types'
import { playingLabel, playingPlace, playingScene } from './playing'
import type { ReadingBar, ReadingPhase } from './session'

const bar = (phase: ReadingPhase): ReadingBar => ({ phase, who: '', how: '', note: '', fix: null })

const chapter = (id: string, title: string, position: number): Chapter => ({ id, title, position }) as Chapter
const scene = (id: string, chapterId: string, title: string): SceneMeta => ({
  id,
  chapterId,
  title,
  position: 0,
  status: 'drafted',
  wordCount: 100,
  updatedAt: '',
  acceptedAt: null,
  memoryState: 'current'
})

const outline = {
  story: { id: 'story' },
  chapters: [chapter('c1', 'Chapter 1', 0), chapter('c2', 'The Crossing', 1), chapter('c3', '', 2)],
  scenes: [scene('s1', 'c1', 'The Ferry'), scene('s2', 'c2', 'Night'), scene('s3', 'c3', '  ')]
} as unknown as Outline

describe('playingScene', () => {
  it('is the scene read while lines are got ready, play, wait or are paused', () => {
    for (const phase of ['starting', 'playing', 'waiting', 'paused'] as const) expect(playingScene({ sceneId: 's1', bar: bar(phase) })).toBe('s1')
  })

  it('is nothing once reading has stopped, finished or hit a problem, or the bar is closed', () => {
    for (const phase of ['stopped', 'finished', 'problem'] as const) expect(playingScene({ sceneId: 's1', bar: bar(phase) })).toBeNull()
    expect(playingScene({ sceneId: 's1', bar: null })).toBeNull()
    expect(playingScene({ sceneId: null, bar: bar('playing') })).toBeNull()
  })
})

describe('playingPlace', () => {
  it('names the chapter by its number, and in full with its title when it has its own', () => {
    expect(playingPlace(outline, 's1')).toEqual({ chapterId: 'c1', chapter: 'Chapter 1', chapterName: 'Chapter 1', scene: 'The Ferry' })
    expect(playingPlace(outline, 's2')).toEqual({ chapterId: 'c2', chapter: 'Chapter 2', chapterName: 'Chapter 2: The Crossing', scene: 'Night' })
  })

  it('calls a scene with no title an untitled scene', () => {
    expect(playingPlace(outline, 's3')).toEqual({ chapterId: 'c3', chapter: 'Chapter 3', chapterName: 'Chapter 3', scene: 'Untitled scene' })
  })

  it('is nothing when no scene is read, or the outline does not have it yet', () => {
    expect(playingPlace(outline, null)).toBeNull()
    expect(playingPlace(outline, 'gone')).toBeNull()
    expect(playingPlace(null, 's1')).toBeNull()
  })
})

describe('playingLabel', () => {
  it('says whether it is playing or paused', () => {
    expect(playingLabel(false)).toBe('Playing aloud')
    expect(playingLabel(true)).toBe('Reading aloud, paused')
  })
})
