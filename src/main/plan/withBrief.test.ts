// The continuity brief's material on the open world (long story memory fix 14, its review; trimmed 2026-10-20): with no
// room for the plan and a brief together (a small memory model), no brief and the plan as it was; the open plot threads as
// many as the memory model has room for; and never the book so far, however much the memory model reads: the chapters in
// short and the scenes around word for word, within RECORD_MOST. Invented test text only.
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
import { RECORD_MOST, partText } from './brief'
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

  it('never the book so far: the chapters in short (not those "Already happened" tells), the scenes around word for word, within RECORD_MOST however much the model reads (2026-10-20)', () => {
    const db = memoryWorld()
    const story = repo.listStories(db)[0]
    const first = repo.getOutline(db, story.id)
    // A long book in the world: its words are never read for the plan.
    for (const id of [first.scenes[0].id, repo.createScene(db, first.chapters[0].id).id])
      repo.saveSceneText(db, id, null, `${'The river ran high. '.repeat(5_500)}`)
    const here = repo.createScene(db, repo.createChapter(db, story.id, { title: 'Chapter 5' }).id).id
    const inp = input(here, story.title)
    const long = Array.from({ length: 400 }, () => 'Wren climbed to the loft and waited for the knock.').join(' ')
    inp.soFar = long
    inp.memory.previous = { sceneId: 'p', title: 'The weir', text: long, storyId: 'mill', storyTitle: story.title, label: `${story.title}, Ch 4, Sc 2`, otherStory: null }
    inp.memory.storySoFar = {
      ...inp.memory.storySoFar,
      chapters: [3, 4].map((n) => ({ chapterId: `c${n}`, label: `${story.title}, Ch ${n}`, text: `In chapter ${n} the river ran high.` }))
    }
    const core = { people: [], recent: ['Ch 4, Sc 1: The weir broke.', 'Ch 4, Sc 2: Wren ran.'], threads: [] }
    const m = withBrief(db, here, briefing(inp), { ...PLAIN, core }, 1_000_000)
    const parts = [...m.brief!.record, ...m.brief!.late]
    const all = parts.map((p) => partText(p)).join('\n\n')
    expect(all).not.toContain('The river ran high.')
    expect(all).toContain('### Ch 3\nIn chapter 3 the river ran high.')
    expect(all).not.toContain('### Ch 4')
    expect(parts.map((p) => p.title)).toEqual(expect.arrayContaining([expect.stringMatching(/^The scene before, word for word \(Ch 4, Sc 2: The weir\)/), 'The scene so far, word for word']))
    expect(estimateTokens(all)).toBeLessThanOrEqual(RECORD_MOST)
  })
})
