// The continuity brief's material on the open world (long story memory fix 14, its review): with no room for the plan and
// a brief together (a small memory model), no brief and the plan as it was; the open plot threads as many as the memory
// model has room for; and the book so far read from the world, at most BOOK_MOST tokens of its newest whole chapters
// however much the memory model reads. Invented test text only.
import { describe, expect, it, vi } from 'vitest'

vi.mock('../settings', () => ({ getSettings: () => ({ planFirst: true, continuityBrief: true }) }))
vi.mock('../keeper', () => ({ memoryModel: () => ({ error: 'none' }) }))
vi.mock('../usage/gate', () => ({ pausedNote: () => null }))
vi.mock('../world', () => ({ maybeCurrentWorld: () => null }))

import type { EntryKind, EntryState } from '@shared/types'
import { defaultStyleGuide, emptySceneCard } from '@shared/defaults'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import { estimateTokens } from '../keeper/text'
import type { ContextInput } from '../ai/context'
import { openThreadsMost } from '../ai/openThreads'
import { memoryScale } from '../ai/memoryRoom'
import { BOOK_MOST, bookPart } from './brief'
import type { PlanMaterial } from './plan'
import { withBrief } from './index'

let seq = 0
const entry = (kind: EntryKind, name: string, extra: Partial<EntryState> = {}): EntryState =>
  ({
    id: `w${++seq}`,
    kind,
    name,
    aliases: [],
    summary: '',
    description: '',
    tags: [],
    notes: '',
    fields: {},
    parentId: null,
    hardRule: false,
    origin: 'adam',
    fieldOrigins: {},
    happened: [],
    changed: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...extra
  }) as EntryState

function input(sceneId: string, storyTitle: string, threads = 0): ContextInput {
  const wren = entry('character', 'Wren', { summary: 'A miller’s daughter.' })
  const open = Array.from({ length: threads }, (_, i) => entry('thread', `Thread ${i + 1}`, { fields: { promise: `Promise ${i + 1}` } }))
  return {
    style: { ...defaultStyleGuide(), pov: 'Close third person', tense: 'Past tense', spelling: 'UK' },
    scene: { title: 'The hatch', card: { ...emptySceneCard(), povId: wren.id, presentIds: [wren.id], beats: ['Wren climbs up'] } },
    memory: {
      storyId: 'mill',
      sceneId,
      knows: '',
      previous: null,
      entries: [wren, ...open],
      firstHere: [],
      elsewhere: [],
      relationships: [],
      facts: [],
      threads: open.map((t) => ({ entryId: t.id, status: 'open' as const, setUp: '', paidOff: '' })),
      storySoFar: { scenes: [], chapters: [], stories: [], series: [], leadsInto: null },
      bringAbout: []
    },
    pins: [],
    blockModes: {},
    world: { themes: '', tone: '' },
    series: null,
    story: { title: storyTitle, premise: '', themes: '', tone: '' },
    options: { direction: '', targetWords: 800, creativity: 'balanced' },
    contextLength: 64_000
  }
}

const PLAIN: PlanMaterial = {
  ask: 'Write the scene now.',
  card: 'Scene: The hatch\nPoint of view: Wren\nBeats, in order:\n1. Wren climbs up',
  direction: '',
  focus: '',
  must: '',
  reach: 'none',
  stand: '',
  standTitle: 'Where things stand',
  standNote: '',
  before: null,
  inBriefing: [],
  others: [],
  people: ['Wren'],
  secrets: [],
  calls: 'Wren climbs up',
  threads: 'the writer’s few'
}

const briefing = (inp: ContextInput) => ({ input: inp, preview: { blocks: [] }, prepared: {} })

describe('the brief’s material on the open world (fix 14’s review)', () => {
  it('a small memory model with many open threads: the plan as it was, with no brief; more room, as many threads as it allows', () => {
    const db = memoryWorld()
    const inp = input('here', 'The Mill', 40)
    // No room for the plan and a brief together: the plan alone, exactly as it was.
    expect(withBrief(db, 'here', briefing(inp), PLAIN, 3_000)).toBe(PLAIN)
    // The 16,000-token guess: a brief, and the threads the memory model has room for (not all 40).
    const m = withBrief(db, 'here', briefing(inp), PLAIN, 16_000)
    expect(m.brief).toBeDefined()
    expect(m.threads!.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(openThreadsMost(memoryScale(16_000)))
    const big = withBrief(db, 'here', briefing(inp), PLAIN, 1_000_000)
    expect(big.threads!.split('\n').filter((l) => l.startsWith('- ')).length).toBeLessThan(40)
  })

  it('the book so far from the world: its newest whole chapters within BOOK_MOST tokens, however much the model reads', () => {
    const db = memoryWorld()
    const story = repo.listStories(db)[0]
    const first = repo.getOutline(db, story.id)
    const chapters = [first.chapters[0].id, ...[2, 3, 4, 5].map((n) => repo.createChapter(db, story.id, { title: `Chapter ${n}` }).id)]
    // Chapters 1 to 4: two scenes of about 30,000 tokens each; the scene being written opens chapter 5.
    for (const [i, chapterId] of chapters.slice(0, 4).entries()) {
      const scenes =
        i === 0
          ? [first.scenes[0].id, repo.createScene(db, chapterId).id]
          : [repo.createScene(db, chapterId).id, repo.createScene(db, chapterId).id]
      for (const id of scenes) repo.saveSceneText(db, id, null, `Chapter ${i + 1}. ${'The river ran high. '.repeat(5_500)}`)
    }
    const here = repo.createScene(db, chapters[4]).id
    const m = withBrief(db, here, briefing(input(here, story.title)), PLAIN, 1_000_000)
    const book = m.brief!.book!
    expect(book.map((s) => s.chapter)).toEqual(['Ch 3', 'Ch 3', 'Ch 4', 'Ch 4'])
    expect(m.brief!.bookFrom).toBe('Ch 3')
    expect(estimateTokens(bookPart(book, true, m.brief!.bookFrom))).toBeLessThanOrEqual(BOOK_MOST + 50)
    // A model that reads less than 200,000 tokens never gets the book.
    expect(withBrief(db, here, briefing(input(here, story.title)), PLAIN, 128_000).brief!.book).toBeNull()
  })
})
