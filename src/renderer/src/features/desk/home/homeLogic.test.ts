import { describe, expect, it } from 'vitest'
import type { CodexCard } from '@shared/contracts/entryViews'
import type { BoardThread } from '@shared/contracts/worldViews'
import type { Chapter, MemoryStatus, SceneMeta, SceneStatus } from '@shared/types'
import {
  bookKicker,
  castOf,
  chapterAria,
  chapterShelf,
  checkLine,
  coverHue,
  homeScale,
  homeTwoColumns,
  hueOfId,
  lastLines,
  memoryLine,
  nextPlannedScene,
  readingOrder,
  sceneWhere,
  statsLabel,
  storyStats,
  threadRows,
  threadsAside
} from './homeLogic'

const ch = (id: string, position: number, title: string): Chapter => ({ id, storyId: 'st', title, goal: '', position, actId: null })
const sc = (id: string, chapterId: string, position: number, status: SceneStatus, wordCount: number, title = id): SceneMeta => ({
  id,
  chapterId,
  title,
  position,
  status,
  wordCount,
  updatedAt: '2026-10-08T10:00:00.000Z',
  acceptedAt: null,
  memoryState: 'current'
})

// The sample world's shape, with a planned fifth scene (made-up titles).
const outline = {
  chapters: [ch('c1', 0, 'The Night Ferry'), ch('c2', 1, 'The Drowned Steps')],
  scenes: [
    sc('s2', 'c1', 1, 'done', 272, 'A Letter for the Keeper'),
    sc('s1', 'c1', 0, 'done', 299, 'Lighting the Lamp'),
    sc('s3', 'c2', 0, 'done', 246, 'What the Letter Said'),
    sc('s4', 'c2', 1, 'drafted', 288, 'Low Tide'),
    sc('s5', 'c2', 2, 'planned', 0, 'Fog on the Quay')
  ]
}

describe('the story at a glance', () => {
  it('counts words, chapters, scenes and the scenes done', () => {
    const s = storyStats(outline)
    expect(s).toEqual({ words: 1105, chapters: 2, scenes: 5, done: 3 })
    expect(statsLabel(s)).toBe('1,105 words, 2 chapters, 5 scenes, 3 done')
  })

  it('reads the scenes chapter by chapter, each by position', () => {
    expect(readingOrder(outline).map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5'])
    expect(sceneWhere(outline, 's5')).toBe('Chapter Two, scene 3')
  })
})

describe('the shelf', () => {
  it('gives each chapter its numeral, label, dots and progress, and marks where Adam is', () => {
    const shelf = chapterShelf(outline, 's4')
    expect(shelf.map((c) => [c.numeral, c.label, c.title, c.done, c.scenes.length, c.words, c.state, c.current])).toEqual([
      ['I', 'Chapter One', 'The Night Ferry', 2, 2, 571, 'done', false],
      ['II', 'Chapter Two', 'The Drowned Steps', 1, 3, 534, 'progress', true]
    ])
    expect(shelf[1].scenes.map((s) => s.current)).toEqual([false, true, false])
    expect(chapterAria(shelf[1])).toBe('Chapter Two, The Drowned Steps. 1 of 3 scenes done, 534 words, you are in it. Open it on the story board.')
  })

  it('lets a prologue stand alone, and says so of a chapter with no scenes', () => {
    const shelf = chapterShelf({ chapters: [ch('p', 0, 'Prologue'), ch('e', 1, '')], scenes: [] }, null)
    expect(shelf[0]).toMatchObject({ label: 'Prologue', title: '', state: 'empty' })
    expect(shelf[1]).toMatchObject({ label: 'Chapter Two', title: '' })
    expect(chapterAria(shelf[1])).toBe('Chapter Two. No scenes yet. Open it on the story board.')
  })
})

describe('next scene ideas', () => {
  it('are for the first planned, empty scene after the one Adam is in', () => {
    expect(nextPlannedScene(outline, 's1')?.id).toBe('s5')
    expect(nextPlannedScene(outline, null)?.id).toBe('s5')
    // None after the last scene.
    expect(nextPlannedScene(outline, 's5')).toBeNull()
  })

  it('skip a planned scene that already has words', () => {
    const o = { ...outline, scenes: outline.scenes.map((s) => (s.id === 's5' ? { ...s, wordCount: 12 } : s)) }
    expect(nextPlannedScene(o, 's1')).toBeNull()
  })
})

describe('the last lines', () => {
  it('ends the scene’s text, starting at a sentence', () => {
    const text = 'The tide had turned an hour ago. Gulls argued over the quay. Nobody spoke on the walk back up the lane. Behind them the sea was coming back, one slow step at a time.'
    expect(lastLines(text, 22)).toBe('…Nobody spoke on the walk back up the lane. Behind them the sea was coming back, one slow step at a time.')
  })

  it('gives a short scene whole, and nothing for an empty one', () => {
    expect(lastLines('She waited.\n\nNothing came.')).toBe('She waited. Nothing came.')
    expect(lastLines('   ')).toBe('')
  })
})

describe('the plot threads', () => {
  const place = (sceneId: string | null, label: string) => ({ label, storyId: 'st', sceneId, planned: false })
  const t = (id: string, column: BoardThread['column'], extra: Partial<BoardThread> = {}): BoardThread => ({
    id,
    name: id,
    promise: '',
    column,
    setUp: null,
    paidOff: null,
    openChapters: null,
    longOpen: false,
    ...extra
  })

  it('puts open ones first, saying for how long, then planned, then resolved with where', () => {
    const rows = threadRows(
      {
        threads: [
          t('letter', 'resolved', { setUp: place('s2', 'Book 1, Ch 1, Sc 2'), paidOff: place('s3', 'The Keeper’s Light, Ch 2, Sc 1') }),
          t('midwinter', 'open', { setUp: place('s3', 'Book 1, Ch 2, Sc 1'), openChapters: 1 }),
          t('ferry', 'open', { setUp: place('s1', 'Book 1, Ch 1, Sc 1'), openChapters: 2 }),
          t('buoy', 'planned')
        ]
      },
      outline,
      's4'
    )
    expect(rows.map((r) => [r.id, r.state, r.note])).toEqual([
      ['midwinter', 'open', 'Open for 1 chapter'],
      ['ferry', 'open', 'Open for 2 chapters'],
      ['buoy', 'planned', 'Planned on the cards'],
      ['letter', 'resolved', 'Resolved in Ch 2, Sc 1']
    ])
    // Along the story: set up at scene 3 of 5 (0.5), running on to where Adam is (scene 4, 0.75).
    expect(rows[0]).toMatchObject({ from: 0.5, to: 0.75 })
    expect(rows[3]).toMatchObject({ from: 0.25, to: 0.5 })
    expect(threadsAside(rows)).toBe('2 open · 1 planned · 1 resolved')
  })
})

describe('the cast', () => {
  const card = (id: string, kind: CodexCard['kind'], importance: number, storyIds: string[] = ['st']): CodexCard => ({
    id,
    kind,
    name: id,
    aliases: [],
    summary: '',
    tags: [],
    image: null,
    role: '',
    hardRule: false,
    scenes: 0,
    importance,
    last: null,
    first: null,
    storyIds
  })

  it('names the story’s most important characters and counts its characters and places', () => {
    const cast = castOf(
      [card('Ansel', 'character', 2), card('Wren', 'character', 9), card('Elsewhere', 'character', 50, ['other']), card('Edric', 'character', 5), card('Gullhaven', 'place', 4), card('Light', 'place', 6)],
      'st',
      2
    )
    expect(cast.people.map((p) => p.name)).toEqual(['Wren', 'Edric'])
    expect(cast.line).toBe('3 characters · 2 places')
    expect(cast.places).toEqual(['Light', 'Gullhaven'])
    // The one left out is named for the cast's "+1".
    expect(cast.others).toEqual(['Ansel'])
  })
})

describe('the footer', () => {
  const status = (p: Partial<MemoryStatus>): MemoryStatus => ({ behind: 0, failed: 0, reading: null, error: null, lastUpdate: null, ...p })
  const now = Date.parse('2026-10-08T12:00:00.000Z')

  it('says how the memory stands', () => {
    expect(memoryLine(status({ lastUpdate: { at: '2026-10-08T10:00:00.000Z', runId: 'r', changes: 3 } }), now).text).toBe('Memory up to date · updated 2 hours ago')
    expect(memoryLine(status({ behind: 2 }), now)).toEqual({ text: 'Memory: 2 scenes to read', ok: true })
    expect(memoryLine(status({ failed: 1 }), now)).toEqual({ text: 'Memory not updated for 1 scene', ok: false })
    expect(memoryLine(status({ reading: { sceneId: 's', title: 'Low Tide' } }), now).text).toBe('Memory: reading “Low Tide”')
  })

  it('says how many issues are open', () => {
    expect(checkLine({})).toEqual({ text: 'No open issues', ok: true })
    expect(checkLine({ a: { count: 2, mustFix: 1 }, b: { count: 1, mustFix: 0 } })).toEqual({ text: '3 issues to look at · 1 must fix', ok: false })
  })
})

describe('the cover', () => {
  it('counts the main stories for its kicker; a prequel or side story says so', () => {
    const shelf = [
      { id: 'a', kind: 'continues' },
      { id: 'p', kind: 'prequel' },
      { id: 'b', kind: 'continues' },
      { id: 's', kind: 'side' }
    ]
    expect(bookKicker('a', shelf)).toBe('Book One')
    expect(bookKicker('b', shelf)).toBe('Book Two')
    expect(bookKicker('p', shelf)).toBe('A prequel')
    expect(bookKicker('s', shelf)).toBe('A side story')
  })

  it('takes a chosen hue, else the first genre’s, else one steady to the story', () => {
    expect(coverHue('x', ['fantasy'], 33)).toBe(33)
    expect(coverHue('x', ['nonsense', 'fantasy'])).toBe(285)
    expect(coverHue('story-1', [])).toBe(hueOfId('story-1'))
    expect(hueOfId('story-1')).toBe(hueOfId('story-1'))
    expect(hueOfId('story-1')).not.toBe(hueOfId('story-2'))
    expect(hueOfId('story-1')).toBeGreaterThanOrEqual(0)
    expect(hueOfId('story-1')).toBeLessThan(360)
  })
})

describe('homeScale: the home grows with a big screen', () => {
  it('stays its own size up to about 1920×1080 beside the spine, and in a small window', () => {
    expect(homeScale(1580, 1028)).toBe(1)
    expect(homeScale(1200, 800)).toBe(1)
    expect(homeScale(0, 0)).toBe(1)
  })
  it('grows on Adam’s 2560×1440, and as far as the height allows on a wide screen, never past its most', () => {
    expect(homeScale(2200, 1388)).toBeCloseTo(1.31, 2)
    // An ultrawide (3440 beside the spine): two columns, as wide as the room allows.
    expect(homeTwoColumns(3100)).toBe(true)
    expect(homeTwoColumns(2200)).toBe(false)
    expect(homeScale(3100, 1388)).toBe(1.32)
    expect(homeScale(2500, 1388)).toBe(1.07)
    expect(homeScale(3100, 1388, false)).toBe(1.31)
    expect(homeScale(4000, 2100)).toBe(1.32)
    // A tall narrow room: the width decides.
    expect(homeScale(1700, 2000)).toBe(1.06)
  })
})
