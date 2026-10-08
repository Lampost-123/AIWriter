import { describe, expect, it } from 'vitest'
import type { ContextBlock, ContextEntry, Summary } from '@shared/types'
import {
  blockState,
  blockStateNote,
  briefingEntries,
  budgetView,
  closingTokens,
  entryDetail,
  hiddenScope,
  keepTouched,
  orderBlocks,
  pinCalls,
  quietReason,
  scopeIdFor,
  usedSummaries,
  withMode,
  withNewPin,
  withPin
} from './contextLogic'

const block = (id: string, priority: number, extra: Partial<ContextBlock> = {}): ContextBlock => ({
  id,
  priority,
  title: id,
  text: '',
  tokens: 10,
  entryIds: [],
  dropped: false,
  ...extra
})

describe('the parts of the briefing add up to its size', () => {
  it('lists the closing instruction (and what each message takes) as what is left over', () => {
    const budget = { used: 2613, available: 27666, contextLength: 32000, reserved: 1134 }
    const blocks = [block('a', 1, { tokens: 999 }), block('b', 2, { tokens: 1475 }), block('c', 3, { tokens: 400, dropped: true })]
    // The parts left out take no room; the rest add up with the closing row to the size shown.
    expect(closingTokens({ blocks, budget })).toBe(139)
    expect(closingTokens({ blocks: [block('a', 1, { tokens: 3000 })], budget })).toBe(0)
  })
})

const entry = (entryId: string, extra: Partial<ContextEntry> = {}): ContextEntry => ({
  entryId,
  name: entryId,
  kind: 'character',
  blockId: 'present',
  why: 'On the scene card',
  pinned: null,
  hidden: false,
  label: null,
  ...extra
})

const summary = (level: Summary['level'], targetId: string, text: string): Summary => ({
  level,
  targetId,
  text,
  origin: 'text',
  stale: false,
  updatedAt: '2026-10-02T10:00:00Z'
})

describe('budgetView', () => {
  it('works out the share and the fill', () => {
    expect(budgetView({ used: 2500, available: 10000 })).toMatchObject({ share: 0.25, fill: 25, percentText: '25%', tight: false })
  })

  it('turns amber above 90%', () => {
    expect(budgetView({ used: 9000, available: 10000 }).tight).toBe(false)
    expect(budgetView({ used: 9001, available: 10000 }).tight).toBe(true)
    expect(budgetView({ used: 12000, available: 10000 })).toMatchObject({ fill: 100, percentText: '120%', tight: true })
  })

  it('always shows a little fill when anything is used, and copes with no room', () => {
    expect(budgetView({ used: 3, available: 100000 }).fill).toBe(1)
    expect(budgetView({ used: 0, available: 100000 }).fill).toBe(0)
    expect(budgetView({ used: 10, available: 0 })).toMatchObject({ fill: 100, percentText: 'No room', tight: true, noRoom: true })
    expect(budgetView({ used: 0, available: 0 })).toMatchObject({ percentText: 'No room', noRoom: true })
    expect(budgetView({ used: 10, available: 100 }).noRoom).toBe(false)
  })
})

describe('parts of the briefing', () => {
  it('says whether each part is full, short or left out', () => {
    expect(blockState(block('a', 1))).toBe('full')
    expect(blockState(block('a', 4, { short: true }))).toBe('short')
    expect(blockState(block('a', 9, { dropped: true, short: true }))).toBe('left-out')
  })

  it('explains why in plain words', () => {
    expect(blockStateNote(block('a', 4, { short: true, mode: 'short', hasShort: true }))).toMatch(/as you chose/)
    expect(blockStateNote(block('a', 4, { short: true, mode: 'auto', hasShort: true }))).toMatch(/to fit/)
    expect(blockStateNote(block('a', 4, { mode: 'full', hasShort: true }))).toMatch(/in full, as you chose/)
    expect(blockStateNote(block('a', 9, { dropped: true }))).toMatch(/wasn't room/)
  })

  it('lists parts by priority, keeping the order within one', () => {
    const list = [block('mentioned', 9), block('pov', 4), block('setting', 7), block('threads', 7), block('instructions', 1)]
    expect(orderBlocks(list).map((b) => b.id)).toEqual(['instructions', 'pov', 'setting', 'threads', 'mentioned'])
  })

  it("shows Adam's choice straight away", () => {
    const list = [block('pov', 4, { mode: 'auto' }), block('present', 5, { mode: 'auto' })]
    const next = withMode(list, 'pov', 'short')
    expect(next[0].mode).toBe('short')
    expect(next[1]).toBe(list[1])
  })
})

describe('briefingEntries', () => {
  it('splits the entries in the briefing from the ones kept out', () => {
    const { included, removed } = briefingEntries(
      { blocks: [], entries: [entry('mara'), entry('kell', { hidden: true, blockId: null, why: 'Kept out of this scene' })] },
      new Map()
    )
    expect(included.map((e) => e.entryId)).toEqual(['mara'])
    expect(removed.map((e) => e.entryId)).toEqual(['kell'])
  })

  it("reads older previews' parts when they don't list entries", () => {
    const blocks = [
      block('pov', 4, { title: 'Point-of-view character: Mara', entryIds: ['mara'] }),
      block('present', 5, { title: 'Others present', entryIds: ['mara', 'tobin'] }),
      block('mentioned', 9, { dropped: true, entryIds: ['kell'] })
    ]
    const known = new Map([['tobin', { name: 'Tobin', kind: 'character' as const }]])
    const { included, removed } = briefingEntries({ blocks }, known)
    expect(included.map((e) => [e.entryId, e.name, e.blockId])).toEqual([
      ['mara', 'Unnamed', 'pov'],
      ['tobin', 'Tobin', 'present']
    ])
    expect(removed).toEqual([])
  })
})

describe('pins', () => {
  it('knows where a removed entry was kept out', () => {
    expect(hiddenScope({ why: 'Kept out of this scene' })).toBe('scene')
    expect(hiddenScope({ why: 'Kept out of this story' })).toBe('story')
    expect(hiddenScope({ why: 'Kept out of every scene' })).toBe('world')
  })

  it('gives each scope its id', () => {
    expect(scopeIdFor('scene', 's1', 'st1')).toBe('s1')
    expect(scopeIdFor('story', 's1', 'st1')).toBe('st1')
    expect(scopeIdFor('world', 's1', 'st1')).toBeNull()
  })

  it('shows a pin or a removal straight away', () => {
    const list = [entry('mara'), entry('tobin')]
    const pinned = withPin(list, 'mara', 'story', 'pin')
    expect(pinned[0]).toMatchObject({ pinned: 'story', hidden: false, why: 'On the scene card' })
    expect(pinned[1]).toBe(list[1])
    const moved = withPin([entry('ring', { why: 'Pinned for this scene', pinned: 'scene' })], 'ring', 'world', 'pin')
    expect(moved[0]).toMatchObject({ pinned: 'world', why: 'Pinned for every scene' })
    const hidden = withPin(list, 'tobin', 'scene', 'hide')
    expect(hidden[1]).toMatchObject({ hidden: true, blockId: null, pinned: null, why: 'Kept out of this scene' })
    expect(withPin(hidden, 'tobin', 'scene', null)[1].hidden).toBe(false)
    expect(withPin(pinned, 'mara', 'story', null)[0].pinned).toBeNull()
  })
})

describe('pinning', () => {
  it('pins for one scope only, clearing the pin the entry had', () => {
    expect(pinCalls(null, 'story')).toEqual([{ scope: 'story', action: 'pin' }])
    expect(pinCalls('scene', 'world')).toEqual([
      { scope: 'world', action: 'pin' },
      { scope: 'scene', action: null }
    ])
    expect(pinCalls('story', 'story')).toEqual([{ scope: 'story', action: 'pin' }])
  })

  it('adds an entry pinned from outside the briefing', () => {
    const list = [entry('mara')]
    const next = withNewPin(list, { entryId: 'ring', name: 'The ring', kind: 'item' }, 'scene')
    expect(next).toHaveLength(2)
    expect(next[1]).toMatchObject({ entryId: 'ring', pinned: 'scene', hidden: false, why: 'Pinned for this scene' })
    expect(withNewPin(list, { entryId: 'mara', name: 'Mara', kind: 'character' }, 'world')).toHaveLength(1)
  })
})

describe('entryDetail', () => {
  it('says what the entry is and why it is there', () => {
    expect(entryDetail({ why: 'On the scene card', label: null, pinned: null }, 'Character', false)).toBe('Character · On the scene card')
    expect(entryDetail({ why: 'Named in the beats', label: null, pinned: 'story' }, 'Item', false)).toBe(
      'Item · Named in the beats · pinned for this story'
    )
    expect(entryDetail({ why: 'Pinned for this story', label: 'not in the story yet at this point', pinned: 'story' }, 'Item', true)).toBe(
      "Item · Pinned for this story · not in the story yet at this point · left out: there wasn't room"
    )
  })
})

describe('quietReason', () => {
  it('turns a part that is still being built into plain words', () => {
    expect(quietReason(new Error('Something went wrong: Not built yet'))).toMatch(/isn't ready yet/)
    expect(quietReason(new Error('That scene no longer exists.'))).toBe('That scene no longer exists.')
    expect(quietReason(undefined)).toBe('Something went wrong.')
  })
})

describe('usedSummaries', () => {
  const book1 = summary('story', 'b1', 'Mara loses her hand at the ford and swears to find the Duke.')
  const ch1 = summary('chapter', 'c1', 'Tobin takes the ferry north.')
  const ch2 = summary('chapter', 'c2', 'The Duke’s men burn the mill.\nMara hides in the reeds.')
  const sc9 = summary('scene', 's9', 'Kell lies about the ring.')
  const unused = summary('chapter', 'c7', 'Nothing to do with this scene.')
  const text = [
    '### Book 1',
    book1.text,
    '',
    '### Earlier in Book 2',
    `Ch 1: ${ch1.text}`,
    '',
    `Ch 2: ${ch2.text}`,
    '',
    '### Most recently',
    `Ch 3, Sc 2: ${sc9.text}`
  ].join('\n')

  it('finds each summary the part was built from, in reading order, with its label', () => {
    const used = usedSummaries(text, [sc9, unused, ch2, book1, ch1])
    expect(used.map((u) => [u.summary.targetId, u.label])).toEqual([
      ['b1', 'Book 1'],
      ['c1', 'Ch 1'],
      ['c2', 'Ch 2'],
      ['s9', 'Ch 3, Sc 2']
    ])
  })

  it("doesn't mind spacing, and skips empty or repeated summaries", () => {
    const spaced = summary('chapter', 'c1', '  Tobin   takes the\nferry north.  ')
    const used = usedSummaries(text, [spaced, spaced, summary('scene', 'x', ' ')])
    expect(used.map((u) => u.summary.targetId)).toEqual(['c1'])
  })

  it('finds nothing in an empty part', () => {
    expect(usedSummaries('', [book1])).toEqual([])
  })

  it('keeps the summary Adam is editing in its place when it no longer matches', () => {
    const before = usedSummaries(text, [book1, ch1, ch2])
    const after = usedSummaries(text.replace(ch1.text, 'Tobin misses the ferry.'), [book1, ch2])
    expect(after.map((u) => u.summary.targetId)).toEqual(['b1', 'c2'])
    expect(keepTouched(before, after, new Set()).map((u) => u.summary.targetId)).toEqual(['b1', 'c2'])
    expect(keepTouched(before, after, new Set(['chapter:c1'])).map((u) => u.summary.targetId)).toEqual(['b1', 'c1', 'c2'])
  })
})
