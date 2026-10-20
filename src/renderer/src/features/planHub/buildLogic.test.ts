import { describe, expect, it } from 'vitest'
import type { BoardThread } from '@shared/contracts/worldViews'
import type { ChapterWritingPlan } from '@shared/contracts/chapterWriter'
import type { Outline } from '@shared/types'
import {
  buildRoute,
  castStatus,
  costWords,
  defaultSection,
  shownIdea,
  tabFor,
  estimateWords,
  ideaStatus,
  keptLines,
  lineStatus,
  minutesWords,
  nameAnswer,
  openThreadsInOrder,
  payoffWords,
  sceneDoes,
  sceneHead,
  threadsStatus,
  threeHeads,
  writeStep
} from './buildLogic'
import { rowsToOpen, storyLine } from './hubLogic'

/** A story: chapters with their scenes' words ("Chapter N" titles unless given). */
function story(chapters: { title?: string; goal?: string; words: number[]; titles?: string[] }[], acts = 0): Outline {
  return {
    story: { id: 'st' } as Outline['story'],
    acts: Array.from({ length: acts }, (_, i) => ({ id: `a${i + 1}`, title: `Act ${i + 1}` })) as Outline['acts'],
    chapters: chapters.map((c, i) => ({ id: `c${i + 1}`, title: c.title ?? `Chapter ${i + 1}`, goal: c.goal ?? '', actId: null })) as Outline['chapters'],
    scenes: chapters.flatMap((c, i) =>
      c.words.map((w, j) => ({ id: `c${i + 1}s${j + 1}`, chapterId: `c${i + 1}`, title: c.titles?.[j] ?? `Scene ${j + 1}`, position: j, wordCount: w }))
    ) as Outline['scenes']
  }
}

const thread = (t: Partial<BoardThread> & { name: string }): BoardThread =>
  ({ id: t.name, promise: '', column: 'open', setUp: null, paidOff: null, openChapters: 1, longOpen: false, ...t }) as BoardThread

describe('how each section of Build with AI stands', () => {
  it('Your idea: written (with a recipe), or not yet; the premise counts', () => {
    expect(ideaStatus({ plot: '', mine: [], recipe: null }, '')).toBe('not written yet')
    expect(ideaStatus({ plot: 'A ferryman owes the Duke.', mine: [], recipe: null })).toBe('written')
    expect(ideaStatus({ plot: '', mine: [], recipe: null }, 'A premise.')).toBe('written')
    expect(ideaStatus({ plot: 'x', mine: [], recipe: { id: 'r', tweaks: {} } })).toBe('written · follows a recipe')
  })

  it('Cast and world: who the world has, what is planned and not built, building, nobody', () => {
    expect(castStatus({ character: 6, place: 4, item: 2 }, null)).toBe('6 people, 4 places')
    expect(castStatus({ character: 1 }, null)).toBe('1 person')
    expect(castStatus({ place: 2, group: 1 }, null)).toBe('2 places, 1 group')
    expect(castStatus({}, null)).toBe('nobody yet')
    expect(castStatus(null, null)).toBe('')
    const planned = { codex: [{ on: true }, { on: true }, { on: false }] as never, built: null }
    expect(castStatus({}, planned)).toBe('2 planned, not built yet')
    expect(castStatus({ character: 3 }, planned)).toBe('3 people · 2 more planned')
    expect(castStatus({ character: 3 }, planned, true)).toBe('building…')
  })

  it('The story line: chapters written and planned, the empty first chapter as nothing planned', () => {
    expect(lineStatus(story([{ words: [300, 200] }, { words: [250, 0] }, { words: [0] }, { words: [] , goal: 'They cross.'}]))).toBe('Ch 1–2 written, Ch 3–4 planned')
    expect(lineStatus(story([{ words: [300] }]))).toBe('Ch 1 written')
    expect(lineStatus(story([{ words: [0] }]))).toBe('nothing planned yet')
    expect(lineStatus(story([{ words: [0], titles: ['The ford'] }]))).toBe('Ch 1 planned')
    expect(lineStatus(story([{ title: 'Grey Water', words: [0, 0] }, { title: 'The Long Night', words: [0] }]))).toBe('Ch 1–2 planned')
    expect(lineStatus({ ...story([{ words: [] }]), chapters: [], scenes: [], acts: [{ id: 'a1', title: 'Act 1' }] as Outline['acts'] })).toBe('1 act planned')
  })

  it('Threads: open and overdue', () => {
    expect(threadsStatus(null)).toBe('')
    expect(threadsStatus([])).toBe('none open')
    expect(threadsStatus([thread({ name: 'A' }), thread({ name: 'B', warn: 'overdue' }), thread({ name: 'C', column: 'resolved' }), thread({ name: 'D' })])).toBe('3 open, 1 overdue')
    expect(threadsStatus([thread({ name: 'A' }), thread({ name: 'B' })])).toBe('2 open')
  })

  it('opens a new story at Your idea, one under way at the story line', () => {
    expect(defaultSection('start')).toBe('idea')
    expect(defaultSection('planned')).toBe('line')
    expect(defaultSection('writing')).toBe('line')
  })

  it('shows Story line zoomed in, else the asked-for tab, else the one last chosen, else where the story stands', () => {
    expect(tabFor({ chapterId: 'c1', section: 'idea' }, 'cast', 'writing')).toBe('line')
    expect(tabFor({ sceneId: 's1' }, 'threads', 'start')).toBe('line')
    expect(tabFor({ section: 'threads' }, 'cast', 'writing')).toBe('threads')
    expect(tabFor({}, 'cast', 'writing')).toBe('cast')
    expect(tabFor({}, null, 'start')).toBe('idea')
    expect(tabFor({}, null, 'planned')).toBe('line')
  })

  it('shows the same idea in both boxes: the plot, the premise until anything is typed, an emptied box empty', () => {
    expect(shownIdea('A ferryman', false, 'The premise')).toBe('A ferryman')
    expect(shownIdea('', false, 'The premise')).toBe('The premise')
    expect(shownIdea('  ', false, 'The premise')).toBe('The premise')
    expect(shownIdea('', true, 'The premise')).toBe('')
  })
})

describe('the open threads, as the Threads section lists them', () => {
  it('overdue first, then due now, then quiet ones, then the rest, the quietest first in each; the closed left out', () => {
    const order = openThreadsInOrder([
      thread({ name: 'calm', quietScenes: 1 }),
      thread({ name: 'quiet', quietScenes: 8 }),
      thread({ name: 'due', due: { state: 'now', chapterId: 'c', label: 'Ch 3', from: 'adam' } }),
      thread({ name: 'resolved', column: 'resolved' }),
      thread({ name: 'overdue', warn: 'overdue', quietScenes: 2 }),
      thread({ name: 'calmer', quietScenes: 3 })
    ]).map((t) => t.name)
    expect(order).toEqual(['overdue', 'due', 'quiet', 'calmer', 'calm'])
  })

  it('Plan its payoff says what to plan in Adam’s words', () => {
    expect(payoffWords({ name: 'The drowned bell', promise: 'Who rang it?' })).toBe('Move toward paying off the plot thread “The drowned bell” (Who rang it).')
    expect(payoffWords({ name: 'The debt', promise: '' })).toBe('Move toward paying off the plot thread “The debt”.')
  })
})

describe('every older way in lands in its section', () => {
  it('the Story builder’s steps, the outline helper, a chapter’s plan, a recipe story’s plan and the summary build', () => {
    expect(buildRoute({ kind: 'storyBuilder', storyId: 's', step: 'idea' }, 's')).toEqual({ kind: 'planHub', storyId: 's', section: 'idea' })
    expect(buildRoute({ kind: 'storyBuilder', storyId: 's', step: 'codex' }, 's')).toEqual({ kind: 'planHub', storyId: 's', section: 'cast' })
    expect(buildRoute({ kind: 'storyBuilder', storyId: 's', step: 'outline' }, 's')).toEqual({ kind: 'planHub', storyId: 's', section: 'line' })
    // Done, or no step: where the story stands (Build with AI decides).
    expect(buildRoute({ kind: 'storyBuilder', storyId: 's', step: 'done' }, 's')).toEqual({ kind: 'planHub', storyId: 's' })
    expect(buildRoute({ kind: 'storyBuilder', storyId: 's' }, 's')).toEqual({ kind: 'planHub', storyId: 's' })
    expect(buildRoute({ kind: 'outline', storyId: 's' }, 's')).toEqual({ kind: 'planHub', storyId: 's', section: 'line' })
    expect(buildRoute({ kind: 'outline', storyId: 's', chapterId: 'c2' }, 's')).toEqual({ kind: 'planHub', storyId: 's', section: 'line', chapterId: 'c2', open: 'plan' })
    expect(buildRoute({ kind: 'recipePlan', storyId: 's', recipeId: 'r' }, 's')).toEqual({ kind: 'planHub', storyId: 's', section: 'line', recipeId: 'r' })
    // The World builder's summary build: Cast and world's "From a summary" with a story open; its own page with none.
    expect(buildRoute({ kind: 'worldBuilder' }, 's')).toEqual({ kind: 'planHub', storyId: 's', section: 'cast', summary: true })
    expect(buildRoute({ kind: 'worldBuilder' }, null)).toEqual({ kind: 'worldBuilder' })
    // Anything else is itself.
    const hub = { kind: 'planHub' as const, storyId: 's', at: 'next-scene' as const }
    expect(buildRoute(hub, 's')).toBe(hub)
    expect(buildRoute({ kind: 'codex' }, 's')).toEqual({ kind: 'codex' })
  })

  it('opens the rows that hold a chapter or a scene asked for', () => {
    const o = story([{ words: [300] }, { words: [200, 0] }, { words: [0, 0] }, { words: [0] }])
    const rows = storyLine(o)
    expect(rowsToOpen(rows, { chapterId: 'c1' })).toEqual({ rowKeys: ['written:c1'], chapterIds: [], chapterId: 'c1' })
    expect(rowsToOpen(rows, { chapterId: 'c3' })).toEqual({ rowKeys: ['planned'], chapterIds: ['c3'], chapterId: 'c3' })
    expect(rowsToOpen(rows, { sceneId: 'c4s1' })).toEqual({ rowKeys: ['planned'], chapterIds: ['c4'], chapterId: 'c4' })
    // The chapter being written shows already.
    expect(rowsToOpen(rows, { chapterId: 'c2' })).toEqual({ rowKeys: [], chapterIds: [], chapterId: 'c2' })
    expect(rowsToOpen(rows, { sceneId: 'c2s2' })).toEqual({ rowKeys: [], chapterIds: [], chapterId: 'c2' })
  })
})

describe('Write this chapter’s plan review', () => {
  it('says its step', () => {
    expect(writeStep(null).words).toBe('step 1 of 3: the plan')
    expect(writeStep('planning').no).toBe(1)
    expect(writeStep('review').no).toBe(1)
    expect(writeStep('drafting')).toEqual({ no: 2, words: 'step 2 of 3: writing' })
    expect(writeStep('checking')).toEqual({ no: 3, words: 'step 3 of 3: checking and fixing' })
    expect(writeStep('fixing').no).toBe(3)
  })

  it('says about how long and what it costs, plainly', () => {
    expect(estimateWords({ minutes: 6, cost: 0.09, free: false })).toBe('About 6 minutes · about 9 cents')
    expect(estimateWords({ minutes: 1, cost: 0.004, free: false })).toBe('About a minute · less than a cent')
    expect(estimateWords({ minutes: 12, cost: 0.011, free: false })).toBe('About 12 minutes · about 1 cent')
    expect(estimateWords({ minutes: 20, cost: 1.234, free: false })).toBe('About 20 minutes · about $1.23')
    expect(estimateWords({ minutes: 8, cost: null, free: false })).toBe('About 8 minutes · cost not known')
    expect(estimateWords({ minutes: 8, cost: 0, free: true })).toBe('About 8 minutes · free')
    expect(estimateWords(null)).toBe('')
    expect(minutesWords(80)).toBe('About 1 hour 20 minutes')
    expect(minutesWords(120)).toBe('About 2 hours')
    expect(costWords({ cost: 0.5, free: false })).toBe('about 50 cents')
  })

  it('keeps true what the plan says, else its scenes’ Keep to lines, each once', () => {
    const scenes = [
      { sceneId: 's1', label: 'Sc 1', does: '', threads: [], changes: [], keep: ['Ash: burn on the left forearm (since Ch 1, Sc 2)', 'Wren: grey coat'], text: 'What it must do: The ford.' },
      { sceneId: 's2', label: 'Sc 2', does: 'Bryn asks.', threads: [], changes: [], keep: ['wren: grey coat'], text: '' }
    ] as ChapterWritingPlan['scenes']
    expect(keptLines({ scenes })).toEqual(['Ash: burn on the left forearm (since Ch 1, Sc 2)', 'Wren: grey coat'])
    expect(keptLines({ scenes, kept: ['Ash: at the ford (since Ch 1, Sc 1)'] })).toEqual(['Ash: at the ford (since Ch 1, Sc 1)'])
    // What a scene does: its own words, else its part's first line.
    expect(sceneDoes(scenes[0])).toBe('The ford.')
    expect(sceneDoes(scenes[1])).toBe('Bryn asks.')
  })

  it('names the tiles and the scenes as the mock-up does', () => {
    expect(threeHeads('Wren')).toEqual({ wants: 'Wren wants', against: 'Against Wren', turn: 'How it turns' })
    expect(threeHeads(undefined)).toEqual({ wants: 'What they want', against: 'What stands in the way', turn: 'How it turns' })
    expect(sceneHead('Sc 1 “The ford”')).toBe('1 · The ford')
    expect(sceneHead('Sc 3')).toBe('Scene 3')
  })

  it('sends the chapter name only when Adam changed the one the plan picked; cleared, it says so', () => {
    expect(nameAnswer(undefined, '')).toEqual({})
    expect(nameAnswer(undefined, 'Typed anyway')).toEqual({})
    expect(nameAnswer('The Far Bank', 'The Far Bank ')).toEqual({})
    expect(nameAnswer('The Far Bank', '  Across the   Water ')).toEqual({ title: 'Across the Water' })
    expect(nameAnswer('The Far Bank', '   ')).toEqual({ title: '' })
  })
})
