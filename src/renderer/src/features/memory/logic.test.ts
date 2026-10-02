import { describe, expect, it } from 'vitest'
import type { MemoryLogItem, MemoryStatus } from '@shared/types'
import { groupHeading, groupLog, keeperState, markUndone, pointsToSettings, readingNote } from './logic'

const status = (s: Partial<MemoryStatus>): MemoryStatus => ({ behind: 0, reading: null, error: null, ...s })

let n = 0
const item = (sceneId: string | null, where: string, extra: Partial<MemoryLogItem> = {}): MemoryLogItem => ({
  id: `m${++n}`,
  sceneId,
  text: 'Mara: lost her left hand',
  action: 'added',
  what: 'change',
  entryId: 'e1',
  changeId: null,
  quote: '',
  where,
  createdAt: '2026-10-02T10:00:00Z',
  undone: false,
  ...extra
})

describe('keeperState', () => {
  it('is idle when nothing is known or nothing is happening', () => {
    expect(keeperState(null)).toBe('idle')
    expect(keeperState(status({}))).toBe('idle')
    // Scenes waiting their turn (Adam is still typing) don't make the bar busy.
    expect(keeperState(status({ behind: 3 }))).toBe('idle')
  })

  it('shows reading over an older error, and the error otherwise', () => {
    expect(keeperState(status({ reading: { sceneId: 's1', title: 'The ferry' } }))).toBe('reading')
    expect(keeperState(status({ reading: { sceneId: 's1', title: 'The ferry' }, error: 'No memory model' }))).toBe('reading')
    expect(keeperState(status({ error: 'Choose a memory model in Settings > Models.' }))).toBe('error')
  })
})

describe('readingNote', () => {
  it('names the scene and how many are waiting', () => {
    expect(readingNote(status({ reading: { sceneId: 's1', title: 'The ferry' }, behind: 1 }))).toBe(
      'Reading “The ferry”. Click to see what the memory has changed.'
    )
    expect(readingNote(status({ reading: { sceneId: 's1', title: '' }, behind: 2 }))).toMatch(
      /^Reading “Untitled scene”, then 1 more scene\./
    )
    expect(readingNote(status({ reading: { sceneId: 's1', title: 'A' }, behind: 4 }))).toMatch(/then 3 more scenes\./)
  })
})

describe('pointsToSettings', () => {
  it('spots a next step in Settings', () => {
    expect(pointsToSettings('Choose a memory model in Settings > Models.')).toBe(true)
    expect(pointsToSettings('Your OpenRouter credit has run out. Top up and try again.')).toBe(false)
  })
})

describe('groupLog', () => {
  it('groups items next to each other from the same scene, keeping the order', () => {
    const a1 = item('a', 'Book 1, Ch 1, Sc 2')
    const a2 = item('a', 'Book 1, Ch 1, Sc 2')
    const b1 = item('b', 'Book 1, Ch 1, Sc 1')
    const a3 = item('a', 'Book 1, Ch 1, Sc 2')
    const groups = groupLog([a1, a2, b1, a3])
    expect(groups.map((g) => [g.sceneId, g.items.map((i) => i.id)])).toEqual([
      ['a', [a1.id, a2.id]],
      ['b', [b1.id]],
      ['a', [a3.id]]
    ])
    expect(new Set(groups.map((g) => g.key)).size).toBe(3)
  })

  it('groups items that are not about one scene by where they are about', () => {
    const c1 = item(null, 'Book 1, Ch 2')
    const c2 = item(null, 'Book 1, Ch 2')
    const s1 = item(null, 'Book 1')
    const groups = groupLog([c1, c2, s1])
    expect(groups.map((g) => [g.where, g.items.length])).toEqual([
      ['Book 1, Ch 2', 2],
      ['Book 1', 1]
    ])
  })

  it('gives every group a heading', () => {
    expect(groupHeading(groupLog([item('a', ' Book 2, Ch 1, Sc 1 ')])[0])).toBe('Book 2, Ch 1, Sc 1')
    expect(groupHeading(groupLog([item('a', '')])[0])).toBe('A scene')
    expect(groupHeading(groupLog([item(null, '')])[0])).toBe('Across the story')
  })

  it('is empty for an empty list', () => {
    expect(groupLog([])).toEqual([])
  })
})

describe('markUndone', () => {
  it('greys one item and leaves the rest alone', () => {
    const list = [item('a', 'x'), item('a', 'x')]
    const next = markUndone(list, list[1].id)
    expect(next[0]).toBe(list[0])
    expect(next[1].undone).toBe(true)
    expect(list[1].undone).toBe(false)
  })
})
