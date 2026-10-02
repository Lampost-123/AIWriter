import { describe, expect, it } from 'vitest'
import type { Entry, FactVersion } from '@shared/types'
import { PLACE_GROUPS } from '@shared/fields'
import { earlierVersions, entryDiff, versionLabel, whenLabel } from './historyLogic'

const entry = (patch: Partial<Entry> = {}): Entry => ({
  id: 'mara',
  kind: 'character',
  name: 'Mara',
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
  byHand: true,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  ...patch
})

let n = 0
const version = (
  v: number,
  origin: FactVersion['origin'],
  at: string,
  data: unknown = entry(),
  factKind: FactVersion['factKind'] = 'entry'
): FactVersion => ({
  id: `v${++n}`,
  factKind,
  factId: factKind === 'entry' ? 'mara' : 'change-1',
  entryId: 'mara',
  version: v,
  data,
  origin,
  runId: origin === 'adam' ? null : 'run-1',
  createdAt: at
})

describe('earlierVersions', () => {
  it('leaves out the newest (the page as it is now) and the entry’s changes', () => {
    const list = [
      version(3, 'text', '2026-10-02T12:00:00.000Z'),
      version(1, 'adam', '2026-10-01T09:00:00.000Z', entry(), 'change'),
      version(2, 'adam', '2026-10-02T10:00:00.000Z'),
      version(1, 'text', '2026-10-01T10:00:00.000Z')
    ]
    expect(earlierVersions(list, 'mara').map((v) => [v.version, v.origin])).toEqual([
      [2, 'adam'],
      [1, 'text']
    ])
  })

  it('shows a burst of Adam’s typing once, as it ended', () => {
    const list = [
      version(6, 'text', '2026-10-02T15:00:00.000Z'),
      version(5, 'adam', '2026-10-02T14:10:00.000Z'),
      version(4, 'adam', '2026-10-02T14:09:00.000Z'),
      version(3, 'adam', '2026-10-02T14:02:00.000Z'),
      version(2, 'text', '2026-10-02T11:00:00.000Z'),
      version(1, 'adam', '2026-10-01T09:00:00.000Z')
    ]
    expect(earlierVersions(list, 'mara').map((v) => v.version)).toEqual([5, 2, 1])
  })
})

describe('versionLabel', () => {
  it('says who made each version, in plain words', () => {
    expect(versionLabel({ origin: 'adam', version: 3, data: {} }, null)).toBe('Changed by you')
    expect(versionLabel({ origin: 'text', version: 3, data: {} }, 'Book 1, Ch 3, Sc 2')).toBe('Updated from Book 1, Ch 3, Sc 2')
    expect(versionLabel({ origin: 'text', version: 3, data: {} }, null)).toBe('Updated from your story')
    expect(versionLabel({ origin: 'ai', version: 2, data: {} }, null)).toBe('Drafted by AI')
    expect(versionLabel({ origin: 'adam', version: 1, data: {} }, null)).toBe('Created by you')
    expect(versionLabel({ origin: 'text', version: 1, data: {} }, 'Book 1, Ch 1, Sc 1')).toBe('Found in Book 1, Ch 1, Sc 1')
    expect(versionLabel({ origin: 'adam', version: 4, data: null }, null)).toBe('Moved to Recently deleted by you')
  })
})

describe('whenLabel', () => {
  const now = new Date(2026, 9, 2, 16, 30)
  it('says today and yesterday, then the date', () => {
    expect(whenLabel(new Date(2026, 9, 2, 14, 2).toISOString(), now)).toBe('Today, 14:02')
    expect(whenLabel(new Date(2026, 9, 1, 9, 5).toISOString(), now)).toBe('Yesterday, 09:05')
    expect(whenLabel(new Date(2026, 6, 12, 8, 0).toISOString(), now)).toBe('12 Jul, 08:00')
    expect(whenLabel(new Date(2025, 9, 12, 8, 0).toISOString(), now)).toBe('12 Oct 2025')
    expect(whenLabel('not a date', now)).toBe('')
  })
})

describe('entryDiff', () => {
  it('lists only what differs, with the page’s labels and in its order', () => {
    const then = entry({ kind: 'place', name: 'Eel Street', summary: 'Wet', fields: { atmosphere: 'Quiet' }, parentId: 'varn' })
    const now = entry({
      kind: 'place',
      name: 'Eel Street',
      summary: 'Wet and loud',
      fields: { atmosphere: 'Busy' },
      parentId: null,
      notes: 'Check the map'
    })
    const rows = entryDiff(then, now, PLACE_GROUPS, (id) => (id === 'varn' ? 'Varn' : '?'))
    expect(rows.map((r) => [r.label, r.then, r.now])).toEqual([
      ['Short summary', 'Wet', 'Wet and loud'],
      ['Inside', 'Varn', ''],
      ['Atmosphere', 'Quiet', 'Busy'],
      ['Private notes', '', 'Check the map']
    ])
  })

  it('finds nothing when they match', () => {
    expect(entryDiff(entry({ aliases: ['M'] }), entry({ aliases: ['M'] }), [], () => '')).toEqual([])
  })
})
