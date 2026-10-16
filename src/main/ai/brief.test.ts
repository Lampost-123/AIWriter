// The continuity brief before each scene (long story memory fix 14), the writer's side: how the brief is told and read
// back, the switch, its size, and its place in the writer's briefing (a late block right before the scene card, never
// left out), with the parts it says what matters of going short beside it so the briefing doesn't grow, the rest word
// for word as before, and nothing at all changed without one. Invented test text only.
import { describe, expect, it } from 'vitest'
import type { EntryKind, EntryState, FactState } from '@shared/types'
import type { SceneState } from '@shared/continuity'
import { defaultStyleGuide, emptySceneCard } from '@shared/defaults'
import type { StorySoFar } from '../memory/types'
import type { RecalledPassage } from '../retrieval/types'
import { assembleContext, MUST_BLOCK, MUST_PRIORITY, prepareContext, SEND_ORDER, type ContextInput } from './context'
import { countRaw } from './tokens'
import { CONTRACT_BLOCK } from './contract'
import { LEDGER_BLOCK } from './whoKnows'
import { MOST_SCALE } from './memoryRoom'
import {
  BRIEF_BLOCK,
  BRIEF_LEAD,
  BRIEF_LEAST,
  BRIEF_TITLES,
  briefSays,
  briefShortens,
  briefSize,
  briefText,
  briefTokens,
  briefWanted,
  readBriefText,
  type ContinuityBrief
} from './brief'

let seq = 0
const entry = (kind: EntryKind, name: string, extra: Partial<EntryState> = {}): EntryState => ({
  id: `b${++seq}`,
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
  originStoryId: null,
  originSceneId: null,
  originStart: false,
  byHand: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  happened: [],
  changed: [],
  ...extra
})

const BRIEF: ContinuityBrief = {
  parts: {
    matters: ['The survey case Wren carries: the weir plans are in it.'],
    keep: ['Wren’s left arm is in a sling (since Ch 2, Sc 4).', 'Ash drowned at the weir (Ch 1, Sc 2).'],
    knows: ['Osric doesn’t know the flour tax was forged; Wren does (since Ch 1, Sc 3).'],
    promises: ['Wren promised to bring the plans to the abbot by the thaw.'],
    time: ['Three weeks since the weir broke (Ch 1, Sc 2).']
  }
}

const words = (n: number, word: string): string => Array.from({ length: n }, (_, i) => `${word}${i % 7}`).join(' ')

/** A story so far long enough that its short form says less. */
function longStory(): StorySoFar {
  const scenes = Array.from({ length: 36 }, (_, i) => {
    const ch = Math.floor(i / 4) + 1
    return {
      sceneId: `s${i}`,
      chapterId: `c${ch}`,
      label: `The Mill, Ch ${ch}, Sc ${(i % 4) + 1}`,
      text: `By the end, ${words(70, 'flour')}.`
    }
  })
  return { scenes, chapters: [], stories: [], series: [], leadsInto: null }
}

const passages = (n: number): RecalledPassage[] =>
  Array.from({ length: n }, (_, i) => ({
    where: `The Mill, Ch 1, Sc ${i + 1}`,
    text: words(160, 'sluice'),
    kind: 'scene' as const,
    order: i
  }))

const stand = (): SceneState => ({
  time: 'late evening',
  weather: '',
  light: '',
  characters: [
    {
      where: 'the mill loft',
      wearing: '',
      posture: '',
      holding: 'the survey case',
      condition: 'left arm in a sling',
      mood: '',
      lastAction: '',
      name: 'Wren'
    }
  ],
  said: { 'wren|condition': { quote: 'her arm in its sling', sceneId: 'sc-2-4' } }
})

function briefingInput(over: Partial<ContextInput> = {}): ContextInput {
  const wren = entry('character', 'Wren', { summary: 'A miller’s daughter.' })
  const osric = entry('character', 'Osric Hale', { summary: 'The reeve.' })
  const facts: FactState[] = [
    {
      factId: 'f1',
      fact: 'The flour tax was forged.',
      knownBy: [wren.id],
      at: 4,
      since: { [wren.id]: { at: 4, where: 'The Mill, Ch 1, Sc 3', how: 'saw' } }
    },
    {
      factId: 'f2',
      fact: 'The weir gate is rotten.',
      knownBy: [wren.id],
      at: 6,
      since: { [wren.id]: { at: 6, where: 'The Mill, Ch 2, Sc 1', how: 'saw' } }
    }
  ]
  return {
    style: { ...defaultStyleGuide(), pov: 'Close third person', tense: 'Past tense', spelling: 'UK' },
    scene: {
      title: 'The hatch',
      card: { ...emptySceneCard(), povId: wren.id, presentIds: [wren.id, osric.id], beats: ['Osric climbs up to the loft'] }
    },
    memory: {
      storyId: 'mill',
      sceneId: 'here',
      knows: '',
      previous: {
        sceneId: 'sc-2-4',
        title: 'Before',
        text: 'The sleet came on.',
        storyId: 'mill',
        storyTitle: 'The Mill',
        otherStory: null
      },
      entries: [wren, osric],
      firstHere: [],
      elsewhere: [],
      relationships: [],
      facts,
      threads: [],
      storySoFar: longStory(),
      bringAbout: []
    },
    pins: [],
    blockModes: {},
    world: { themes: '', tone: '' },
    series: null,
    story: { title: 'The Mill', premise: '', themes: '', tone: '' },
    options: { direction: '', targetWords: 800, creativity: 'balanced' },
    contextLength: 64_000,
    continuity: stand(),
    stageWhere: { 'sc-2-4': 'The Mill, Ch 2, Sc 4' },
    recall: { sticky: [], found: [], passages: passages(9), said: [] },
    ...over
  }
}

const block = (p: ReturnType<typeof assembleContext>, id: string) => p.blocks.find((b) => b.id === id)

describe('the switch', () => {
  it('is on unless Adam turns it off; AIWRITE_BRIEF=off always turns it off', () => {
    expect(briefWanted({}, {})).toBe(true)
    expect(briefWanted({ continuityBrief: true }, {})).toBe(true)
    expect(briefWanted({ continuityBrief: false }, {})).toBe(false)
    expect(briefWanted({ continuityBrief: true }, { AIWRITE_BRIEF: 'off' })).toBe(false)
    expect(briefWanted({}, { AIWRITE_BRIEF: 'on' })).toBe(true)
  })
})

describe('how it is told', () => {
  it('to the writer: the lead, then each list under its heading in order; short: what matters and what must not be contradicted', () => {
    const full = briefText(BRIEF)
    expect(full.startsWith(BRIEF_LEAD.record)).toBe(true)
    expect(full).toContain(`${BRIEF_TITLES.matters}:\n- The survey case Wren carries: the weir plans are in it.`)
    expect(full).toContain(
      `${BRIEF_TITLES.keep}:\n- Wren’s left arm is in a sling (since Ch 2, Sc 4).\n- Ash drowned at the weir (Ch 1, Sc 2).`
    )
    const order = (['matters', 'keep', 'knows', 'promises', 'time'] as const).map((p) => full.indexOf(`${BRIEF_TITLES[p]}:`))
    expect(order).toEqual([...order].sort((a, b) => a - b))
    const short = briefText(BRIEF, true)
    expect(short).toContain(BRIEF_TITLES.keep)
    expect(short).not.toContain(BRIEF_TITLES.knows)
    expect(short).not.toContain(BRIEF_TITLES.time)
    // Read with the book so far, word for word: the lead says so.
    expect(briefText({ ...BRIEF, book: true }).startsWith(BRIEF_LEAD.book)).toBe(true)
    // Nothing to say: no text, and an empty list is left out.
    expect(briefText(null)).toBe('')
    expect(briefText({ parts: { matters: [' ', ''] } })).toBe('')
    expect(briefSays({ parts: {} })).toBe(false)
    expect(briefText({ parts: { time: ['Day 3.'], matters: [] } })).not.toContain(BRIEF_TITLES.matters)
  })

  it('is read back from a record as it was written (the Context tab shows the last one)', () => {
    expect(readBriefText(briefText(BRIEF))).toEqual(BRIEF)
    expect(readBriefText(briefText({ ...BRIEF, book: true }))).toEqual({ ...BRIEF, book: true })
    expect(readBriefText(briefText(BRIEF, true))).toEqual({ parts: { matters: BRIEF.parts.matters, keep: BRIEF.parts.keep } })
    expect(readBriefText('')).toBeNull()
    expect(readBriefText('Something else entirely.\n- a line')).toBeNull()
  })

  it('is about 1,000 tokens on the smallest models, growing with the room to 2,000', () => {
    expect(briefTokens(1)).toBe(1_000)
    expect(briefTokens(0)).toBe(1_000)
    expect(briefTokens(MOST_SCALE)).toBe(2_000)
    expect(briefTokens(9)).toBe(2_000)
    const mid = briefTokens(2.3)
    expect(mid).toBeGreaterThan(1_000)
    expect(mid).toBeLessThan(2_000)
    expect(mid % 100).toBe(0)
  })

  it('is asked to be about as long as what goes short beside it frees, between 1,000 tokens and the writer’s room', () => {
    expect(briefSize(MOST_SCALE, 0)).toBe(BRIEF_LEAST)
    expect(briefSize(MOST_SCALE, 1_560)).toBe(1_500)
    expect(briefSize(MOST_SCALE, 9_000)).toBe(2_000)
    expect(briefSize(1, 9_000)).toBe(1_000)
    expect(briefSize(2.3, 9_000)).toBe(briefTokens(2.3))
    expect(briefSize(1, -50)).toBe(BRIEF_LEAST)
  })

  it('says which parts go short beside it: who knows what only when it says who knows what', () => {
    expect(briefShortens(null)).toEqual([])
    expect(briefShortens({ parts: {} })).toEqual([])
    expect(briefShortens(BRIEF)).toEqual(['story-so-far', 'recalled', LEDGER_BLOCK.id])
    expect(briefShortens({ parts: { keep: ['x'] } })).toEqual(['story-so-far', 'recalled'])
  })
})

describe('in the writer’s briefing', () => {
  it('without a brief: no block, nothing short for it, and the briefing exactly as before', () => {
    const inp = briefingInput()
    const before = assembleContext(inp, countRaw)
    expect(assembleContext({ ...inp, brief: null }, countRaw)).toEqual(before)
    expect(block(before, BRIEF_BLOCK.id)).toBeUndefined()
    expect(before.blocks.some((b) => b.shortFor)).toBe(false)
    expect(prepareContext(inp).briefShortens).toBeUndefined()
    // Nothing to say is no brief.
    expect(assembleContext({ ...inp, brief: { parts: { keep: [] } } }, countRaw)).toEqual(before)
  })

  it('a late block right before the scene card, never left out; the story so far, the passages and who knows what go short', () => {
    const off = assembleContext(briefingInput(), countRaw)
    const on = assembleContext(briefingInput({ brief: BRIEF }), countRaw)
    const b = block(on, BRIEF_BLOCK.id)!
    expect(b.title).toBe('Continuity brief')
    expect(b.priority).toBe(MUST_PRIORITY)
    expect(b.dropped).toBe(false)
    expect(b.text).toBe(briefText(BRIEF))
    expect(SEND_ORDER.indexOf(BRIEF_BLOCK.id)).toBe(SEND_ORDER.indexOf('scene-card') - 1)
    expect(SEND_ORDER.indexOf(BRIEF_BLOCK.id)).toBe(SEND_ORDER.indexOf(LEDGER_BLOCK.id) + 1)
    const user = on.messages[1].content
    expect(user.indexOf('## Continuity brief')).toBeGreaterThan(user.indexOf('## Who knows what'))
    expect(user.indexOf('## Continuity brief')).toBeLessThan(user.indexOf('## Scene card'))
    // In full without it, short beside it, saying why.
    for (const id of ['story-so-far', 'recalled', LEDGER_BLOCK.id]) {
      expect(block(off, id)!.short, id).toBe(false)
      expect(block(on, id), id).toMatchObject({ short: true, shortFor: 'brief', dropped: false })
      expect(block(on, id)!.tokens, id).toBeLessThan(block(off, id)!.tokens)
    }
    // What must stay true, the scene card and the stage stay word for word.
    for (const id of [MUST_BLOCK, 'scene-card', 'continuity']) expect(block(on, id)?.text, id).toBe(block(off, id)?.text)
  })

  it('the scene’s contract stays whole beside it', () => {
    const off = assembleContext(briefingInput({ contract: { asks: 'scene' } }), countRaw)
    const on = assembleContext(briefingInput({ contract: { asks: 'scene' }, brief: BRIEF }), countRaw)
    expect(block(on, CONTRACT_BLOCK.id)!.text).toBe(block(off, CONTRACT_BLOCK.id)!.text)
    const ids = on.blocks.filter((b) => !b.dropped).map((b) => b.id)
    expect(ids.indexOf(BRIEF_BLOCK.id)).toBeLessThan(ids.indexOf(CONTRACT_BLOCK.id))
  })

  it('who knows what stays in full when the brief says nothing of it; Adam’s Full wins', () => {
    const noKnows = assembleContext(briefingInput({ brief: { parts: { keep: BRIEF.parts.keep } } }), countRaw)
    expect(block(noKnows, LEDGER_BLOCK.id)!.short).toBe(false)
    expect(block(noKnows, 'story-so-far')!.shortFor).toBe('brief')
    const full = assembleContext(briefingInput({ brief: BRIEF, blockModes: { 'story-so-far': 'full' } }), countRaw)
    expect(block(full, 'story-so-far')).toMatchObject({ short: false, mode: 'full' })
    expect(block(full, 'story-so-far')!.shortFor).toBeUndefined()
  })

  it('a later book keeps its story so far whole: the brief’s reader read only this book word for word (fix 14’s review)', () => {
    expect(briefShortens(BRIEF, { earlierBooks: true })).toEqual(['recalled', LEDGER_BLOCK.id])
    const book2 = briefingInput()
    book2.memory.storySoFar = {
      ...book2.memory.storySoFar,
      stories: [
        {
          storyId: 'book-1',
          title: 'Book 1',
          meanwhile: false,
          cut: false,
          text: 'By the end, the weir was rebuilt and Wren had left the mill.'
        }
      ]
    }
    const off = assembleContext(book2, countRaw)
    const on = assembleContext({ ...book2, brief: BRIEF }, countRaw)
    expect(block(on, 'story-so-far')).toMatchObject({ short: false })
    expect(block(on, 'story-so-far')!.text).toBe(block(off, 'story-so-far')!.text)
    expect(block(on, 'recalled')!.shortFor).toBe('brief')
  })

  it('doesn’t grow the briefing by saying things twice: in a long story it is smaller with the brief than without', () => {
    const off = assembleContext(briefingInput(), countRaw)
    const on = assembleContext(briefingInput({ brief: BRIEF }), countRaw)
    expect(on.budget.used).toBeLessThan(off.budget.used)
  })

  it('every block before who knows what reads the same from one step to the next with a brief (the cache)', () => {
    const one = assembleContext(briefingInput({ brief: BRIEF }), countRaw)
    const other: ContinuityBrief = { parts: { matters: ['Something else matters at this step.'], knows: ['Osric still doesn’t know.'] } }
    const two = assembleContext(briefingInput({ brief: other }), countRaw)
    const steady = SEND_ORDER.slice(0, SEND_ORDER.indexOf(BRIEF_BLOCK.id))
    for (const id of steady) expect(block(two, id)?.text, id).toBe(block(one, id)?.text)
  })

  it('is never left out, even for a model with very little room, nor is what must stay true', () => {
    const small = assembleContext(briefingInput({ brief: BRIEF, contextLength: 4_096, recall: null }), countRaw)
    const b = block(small, BRIEF_BLOCK.id)!
    expect(b.dropped).toBe(false)
    expect(block(small, MUST_BLOCK)!.dropped).toBe(false)
  })
})
