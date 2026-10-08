import { describe, expect, it } from 'vitest'
import type { MemoryCheckItem } from '@shared/types'
import { CHECK_GROUPS, checkCountLabel, dropChecks, groupChecks, keptToast, removedToast, showsWords } from './checkLogic'

let n = 0
const item = (group: MemoryCheckItem['group'], extra: Partial<MemoryCheckItem> = {}): MemoryCheckItem => ({
  key: `k${++n}`,
  group,
  fact:
    group === 'summary'
      ? { kind: 'summary', sceneId: 's1' }
      : group === 'note'
        ? { kind: 'note', logId: `l${n}` }
        : group === 'guess'
          ? { kind: 'field', entryId: 'e1', field: 'hair' }
          : { kind: 'change', changeId: `c${n}` },
  entryId: group === 'summary' ? null : 'e1',
  entryName: group === 'summary' ? '' : 'Mara',
  entryKind: group === 'summary' ? null : 'character',
  text: 'Lost her knife in the river',
  sceneId: 's1',
  where: 'Book 1, Ch 1, Sc 1',
  quote: group === 'summary' || group === 'guess' ? '' : 'Mara lost her knife in the river.',
  paragraphId: group === 'summary' || group === 'guess' ? null : 'p2',
  canRemove: group !== 'summary',
  ...extra
})

describe('the memory check list, grouped', () => {
  it('puts each kind under its own heading, in a fixed order, leaving out empty ones', () => {
    const groups = groupChecks([item('note'), item('guess'), item('unconfirmed'), item('guess')])
    expect(groups.map((g) => [g.id, g.items.length])).toEqual([
      ['unconfirmed', 1],
      ['guess', 2],
      ['note', 1]
    ])
    expect(groupChecks([])).toEqual([])
  })

  it('names every group in plain words, with a line saying what it means', () => {
    for (const g of CHECK_GROUPS) {
      expect(g.title).not.toMatch(/entity|generation|LLM|origin|link/i)
      expect(g.help.length).toBeGreaterThan(20)
    }
    expect(CHECK_GROUPS.map((g) => g.id)).toEqual(['unconfirmed', 'guess', 'summary', 'note'])
  })

  it('counts what is waiting for a look', () => {
    expect(checkCountLabel(0)).toBe('Nothing to check')
    expect(checkCountLabel(1)).toBe('1 thing to check')
    expect(checkCountLabel(4)).toBe('4 things to check')
  })

  it('offers Show me only where there are words or a scene to show', () => {
    expect(showsWords(item('unconfirmed'))).toBe(true)
    expect(showsWords(item('summary'))).toBe(true)
    expect(showsWords(item('guess', { sceneId: null }))).toBe(false)
  })

  it('takes rows out of the list after Keep or Remove, and leaves the rest', () => {
    const a = item('guess')
    const b = item('guess')
    const c = item('note')
    expect(dropChecks([a, b, c], [a.key, c.key]).map((i) => i.key)).toEqual([b.key])
  })

  it('says what Keep and Remove did, briefly', () => {
    expect(keptToast([item('unconfirmed')])).toBe("Kept. It's yours now, and stays as it is when the words change.")
    expect(keptToast([item('guess')])).toBe("Kept. It's yours now.")
    expect(keptToast([item('summary')])).toBe('Kept. The summary stays until the scene changes again.')
    expect(keptToast([item('note')])).toBe('Kept as you wrote it.')
    expect(keptToast([item('guess'), item('guess'), item('guess')])).toBe("Kept 3. They're yours now.")
    expect(removedToast(item('guess', { text: 'Hair: black' }))).toBe('Removed “Hair: black” from Mara.')
    expect(removedToast(item('unconfirmed', { entryName: '' }))).toBe('Removed “Lost her knife in the river”.')
  })
})
