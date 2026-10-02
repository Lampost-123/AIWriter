import { describe, expect, it } from 'vitest'
import type { WorldBuildItem } from '@shared/contracts/worldBuilder'
import {
  WORLD_START,
  allUndone,
  costWords,
  doneWords,
  estimateWords,
  listWords,
  madeSections,
  madeWords,
  storyOf,
  whenOptions
} from './worldBuilderLogic'

const item = (p: Partial<WorldBuildItem> & Pick<WorldBuildItem, 'name'>): WorldBuildItem => ({
  lineId: p.name,
  what: 'entry',
  entryId: p.name,
  kind: 'character',
  detail: '',
  hardRule: false,
  otherId: null,
  undone: false,
  ...p
})

const MADE: WorldBuildItem[] = [
  item({ name: 'Mara Venn' }),
  item({ name: 'Tobin' }),
  item({ name: 'The Grey Coast', kind: 'place' }),
  item({ name: 'Magic', kind: 'lore', hardRule: true }),
  item({ name: 'Who sank the Merrow', kind: 'thread' }),
  item({ name: 'Tobin', what: 'relationship', kind: null, detail: 'Younger brother: Mara Venn', lineId: 'rel' }),
  item({ name: 'Themes', what: 'themes', kind: null, entryId: null, lineId: 'themes' }),
  item({ name: 'Tone', what: 'tone', kind: null, entryId: null, lineId: 'tone' })
]

describe('what a build made', () => {
  it('is grouped by kind in the order the build makes them, then relationships, then themes and tone', () => {
    const sections = madeSections(MADE)
    expect(sections.map((s) => s.label)).toEqual([
      'Characters',
      'Places',
      'Lore and rules',
      'Plot threads',
      'Relationships',
      'Themes and tone'
    ])
    expect(sections[0].items.map((i) => i.name)).toEqual(['Mara Venn', 'Tobin'])
    expect(sections[4].kind).toBeNull()
    expect(madeSections([])).toEqual([])
  })

  it('says what is still there, in plain words', () => {
    expect(madeWords(MADE)).toBe("5 entries, 1 relationship and the world's themes and tone")
    expect(madeWords([item({ name: 'A' }), item({ name: 'B', what: 'tone', kind: null })])).toBe("1 entry and the world's tone")
    expect(madeWords(MADE.map((m) => ({ ...m, undone: m.what !== 'entry' })))).toBe('5 entries')
    expect(listWords(['a', 'b', 'c'])).toBe('a, b and c')
    expect(listWords([])).toBe('')
  })

  it('says how the build ended', () => {
    expect(doneWords({ status: 'complete', made: MADE })).toBe(
      "Built and saved 5 entries, 1 relationship and the world's themes and tone. Your words are kept as you wrote them; the rest is drafted by AI."
    )
    expect(doneWords({ status: 'complete', made: [] })).toBe('Everything in your summary is in your world already, so nothing was added.')
    expect(doneWords({ status: 'cancelled', made: MADE.slice(0, 2) })).toBe('Cancelled. What was made before is kept: 2 entries.')
    expect(doneWords({ status: 'cancelled', made: [] })).toBe('Cancelled before anything was made.')
    expect(doneWords({ status: 'error', made: [] })).toBe('')
    const undone = MADE.map((m) => ({ ...m, undone: true }))
    expect(allUndone(undone)).toBe(true)
    expect(allUndone([])).toBe(false)
    expect(doneWords({ status: 'complete', made: undone })).toBe('The build was undone. Nothing it made is in your world now.')
  })

  it('says what it cost', () => {
    expect(costWords(0.0812)).toBe('It cost about $0.08.')
    expect(costWords(0.004)).toBe('It cost less than a cent.')
    expect(costWords(null)).toBe('')
  })
})

describe('before a build', () => {
  it('says roughly what it would cost, with which model', () => {
    expect(estimateWords({ cost: 0.1234, model: 'Anthropic: Claude Sonnet 4.5', problem: null, code: null })).toBe(
      'Estimated cost: about $0.12, with Claude Sonnet 4.5.'
    )
    expect(estimateWords({ cost: 0.002, model: 'fake/writer', problem: null, code: null })).toBe(
      'Estimated cost: less than a cent, with writer.'
    )
    expect(estimateWords({ cost: null, model: 'Local model', problem: null, code: null })).toBe("The cost isn't known for Local model.")
    expect(estimateWords({ cost: null, model: null, problem: 'Choose a writer model first.', code: 'no-writer-model' })).toBe('')
    expect(estimateWords(null)).toBe('')
  })

  it('offers the start of the world, or the start of a story', () => {
    const stories = [
      { id: 's1', title: 'Book 1' },
      { id: 's2', title: '  ' }
    ]
    expect(whenOptions(stories).map((o) => o.label)).toEqual([
      'From the start of the world',
      'From the start of Book 1',
      'From the start of Untitled story'
    ])
    expect(storyOf(WORLD_START, stories)).toBeNull()
    expect(storyOf('s2', stories)).toBe('s2')
    // A story deleted meanwhile counts as the start of the world.
    expect(storyOf('gone', stories)).toBeNull()
    expect(storyOf(null, stories)).toBeNull()
  })
})
