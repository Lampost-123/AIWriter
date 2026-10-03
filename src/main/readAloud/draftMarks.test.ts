import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DraftMarks, FORGET_AFTER_MS, MARK_AFTER_MS, type DraftMarksDeps } from './draftMarks'
import { labelOf, markedEnough } from './labels'

/** A scene's page as TipTap saves it: paragraphs with their ids. */
const doc = (...paras: [string, string][]) => ({
  type: 'doc',
  content: paras.map(([pid, text]) => ({ type: 'paragraph', attrs: { pid }, content: [{ type: 'text', text }] }))
})

const ADAM = doc(['a1', 'She left the docks at dusk.'], ['a2', 'The rain followed her.'])
const DRAFTED = doc(
  ['a1', 'She left the docks at dusk.'],
  ['a2', 'The rain followed her.'],
  ['d1', '“You came,” he said.'],
  ['d2', '“I said I would.” She did not sit.']
)

function setup(over: Partial<DraftMarksDeps> = {}) {
  const marked: { sceneId: string; pids: string[]; all: string[] }[] = []
  const state = { wanted: true, drafting: false, saved: ADAM as unknown }
  const marks = new DraftMarks({
    wanted: () => state.wanted,
    drafting: () => state.drafting,
    savedDoc: () => state.saved,
    mark: (sceneId, paragraphs, pids) => marked.push({ sceneId, pids, all: paragraphs.map((p) => p.pid) }),
    ...over
  })
  return { marks, marked, state }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('marking a draft as it lands', () => {
  it('marks the paragraphs a draft added, a few seconds after its last words are saved, and not before it ends', () => {
    const { marks, marked, state } = setup()
    // Generate starts (the page as saved is the "before"); its words stream in and are saved as they come.
    marks.aiChange('s1')
    state.drafting = true
    marks.saved('s1', doc(['a1', 'She left the docks at dusk.'], ['a2', 'The rain followed her.'], ['d1', '“You came,”']))
    vi.advanceTimersByTime(MARK_AFTER_MS * 2)
    expect(marked).toEqual([])
    // The draft ends and its last words are saved: only the new paragraphs are marked, once.
    state.drafting = false
    marks.draftEnded('s1')
    marks.saved('s1', DRAFTED)
    vi.advanceTimersByTime(MARK_AFTER_MS - 1)
    expect(marked).toEqual([])
    vi.advanceTimersByTime(1)
    expect(marked).toEqual([{ sceneId: 's1', pids: ['d1', 'd2'], all: ['a1', 'a2', 'd1', 'd2'] }])
    // Adam's typing afterwards is his own: it is marked a little ahead of the reading, not here.
    marks.saved('s1', doc(['a1', 'She left the docks at dusk, cold.'], ['d1', '“You came,” he said.']))
    vi.advanceTimersByTime(MARK_AFTER_MS * 2)
    expect(marked).toHaveLength(1)
    expect(marks.waiting()).toEqual([])
  })

  it('marks the words an AI change rewrote (an accepted edit, a picked variant), from the page History kept before it', () => {
    const { marks, marked } = setup()
    marks.aiChange('s1', DRAFTED)
    marks.saved(
      's1',
      doc(['a1', 'She left the docks at dusk.'], ['a2', 'The rain hunted her down the lane.'], ['d1', '“You came,” he said.'])
    )
    vi.advanceTimersByTime(MARK_AFTER_MS)
    expect(marked.map((m) => m.pids)).toEqual([['a2']])
  })

  it('marks nothing when nobody would use the marks: read aloud is off and not set up, and the labels are hidden', () => {
    const { marks, marked, state } = setup()
    state.wanted = false
    marks.aiChange('s1')
    marks.saved('s1', DRAFTED)
    vi.advanceTimersByTime(MARK_AFTER_MS * 2)
    expect(marked).toEqual([])
    expect(marks.waiting()).toEqual([])
    // Turned off while the draft was being written: nothing is marked either.
    state.wanted = true
    marks.aiChange('s2')
    state.wanted = false
    marks.saved('s2', DRAFTED)
    vi.advanceTimersByTime(MARK_AFTER_MS)
    expect(marked).toEqual([])
  })

  it('never fails the draft or the save: a failure is only logged', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const { marks } = setup({
        mark: () => {
          throw new Error('The AI service is busy.')
        },
        savedDoc: () => {
          throw new Error('The world closed.')
        }
      })
      expect(() => marks.aiChange('s1')).not.toThrow()
      marks.aiChange('s2', ADAM)
      expect(() => marks.saved('s2', DRAFTED)).not.toThrow()
      expect(() => vi.advanceTimersByTime(MARK_AFTER_MS)).not.toThrow()
      expect(warn).toHaveBeenCalled()
      const broken = new DraftMarks({
        wanted: () => {
          throw new Error('Settings could not be read.')
        },
        drafting: () => false,
        savedDoc: () => null,
        mark: () => undefined
      })
      expect(() => broken.aiChange('s1')).not.toThrow()
    } finally {
      warn.mockRestore()
    }
  })

  it('lets an AI change go that never went in, so Adam’s own typing later isn’t taken for it', () => {
    const { marks, marked } = setup()
    marks.aiChange('s1', ADAM)
    vi.advanceTimersByTime(FORGET_AFTER_MS + 1)
    marks.saved('s1', DRAFTED)
    vi.advanceTimersByTime(MARK_AFTER_MS)
    expect(marked).toEqual([])
    expect(marks.waiting()).toEqual([])
  })

  it('keeps the page from before the first change when a second comes before marking, and forgets all when the world closes', () => {
    const { marks, marked } = setup()
    marks.aiChange('s1', ADAM)
    marks.aiChange('s1', DRAFTED)
    marks.saved('s1', DRAFTED)
    vi.advanceTimersByTime(MARK_AFTER_MS)
    expect(marked.map((m) => m.pids)).toEqual([['d1', 'd2']])
    marks.aiChange('s2', ADAM)
    marks.saved('s2', DRAFTED)
    marks.forget()
    vi.advanceTimersByTime(MARK_AFTER_MS)
    expect(marked).toHaveLength(1)
  })
})

describe('the labels "Show speakers and tone" shows', () => {
  it('names each voice once, with how it is said when known, and leaves bare narration out beside a line', () => {
    expect(labelOf([{ who: 'Narrator', how: '' }])).toBe('Narrator')
    expect(labelOf([{ who: 'Narrator', how: 'hushed, slowly' }])).toBe('Narrator · hushed, slowly')
    expect(
      labelOf([
        { who: 'Mara', how: 'sharp, quickly' },
        { who: 'Narrator', how: '' },
        { who: 'Mara', how: 'sharp, quickly' }
      ])
    ).toBe('Mara · sharp, quickly')
    expect(
      labelOf([
        { who: 'Mara', how: 'quiet' },
        { who: 'Tobin', how: '' },
        { who: 'Narrator', how: 'tense' },
        { who: 'Someone', how: '' }
      ])
    ).toBe('Mara · quiet; Tobin; Narrator · tense; …')
    expect(labelOf([])).toBe('')
  })

  it('shows a paragraph only once its marks are in', () => {
    const text = '“Out,” he said.'
    expect(markedEnough(text, undefined, { tone: true, unplaced: false })).toBe(false)
    expect(markedEnough(text, { speakers: { out: 'Tomas' } }, { tone: true, unplaced: false })).toBe(false)
    expect(
      markedEnough(
        text,
        { speakers: { out: 'Tomas' }, delivery: { out: { tone: 'flat' }, '~he said': {} } },
        { tone: true, unplaced: false }
      )
    ).toBe(true)
    // Without Mark who says what, only who speaks matters: the rules, or the AI for a line they can't place.
    expect(markedEnough(text, undefined, { tone: false, unplaced: false })).toBe(true)
    expect(markedEnough(text, undefined, { tone: false, unplaced: true })).toBe(false)
  })
})
