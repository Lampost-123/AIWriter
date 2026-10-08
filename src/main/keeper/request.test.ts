// The memory keeper's request reads the same from one chunk to the next where it can (the cache order of 8 October
// 2026): fixed E ids, the memory's lines in id order, relationships and who knows what before the memory. Invented
// story data only.
import { describe, expect, it } from 'vitest'
import type { EntryState, SceneCard } from '@shared/types'
import type { SceneMemory } from '../memory/types'
import { buildRequest, Ids, readingBudget, steadyIds, type ReadingChunk } from './request'
import type { Para } from './text'

const ent = (id: string, kind: EntryState['kind'], name: string, createdAt: string, summary = ''): EntryState =>
  ({
    id,
    kind,
    name,
    aliases: [],
    summary,
    description: '',
    tags: [],
    notes: '',
    fields: {},
    parentId: null,
    hardRule: false,
    createdAt,
    happened: [],
    changed: []
  }) as unknown as EntryState

// Made in this order: Pell, the mill, Wren, the lantern, Hobb, the ferry (names sort differently).
const pell = ent('c-pell', 'character', 'Pell Garrow', '2026-01-01T00:00:01Z', 'a ferryman with a bad knee')
const mill = ent('p-mill', 'place', 'Saltmill', '2026-01-01T00:00:02Z', 'a mill on the estuary')
const wren = ent('c-wren', 'character', 'Wren Abel', '2026-01-01T00:00:03Z', 'a miller’s apprentice')
const lantern = ent('i-lantern', 'item', 'the tin lantern', '2026-01-01T00:00:04Z', 'dented, smoking')
const hobb = ent('c-hobb', 'character', 'Hobb', '2026-01-01T00:00:05Z', 'the miller')
const ferry = ent('i-ferry', 'item', 'the flat ferry', '2026-01-01T00:00:06Z')
const all = [hobb, mill, pell, ferry, lantern, wren] // kind/name order, as the memory lists them

const memory = {
  storyId: 's',
  sceneId: 'sc',
  knows: '',
  previous: null,
  entries: all,
  firstHere: [],
  elsewhere: [],
  relationships: [
    { aId: 'c-wren', bId: 'c-pell', type: 'owes a debt to', aFeels: 'wary', bFeels: '', where: '' },
    { aId: 'c-wren', bId: 'c-hobb', type: 'apprentice of', aFeels: '', bFeels: '', where: '' }
  ],
  facts: [{ factId: 'f1', fact: 'Hobb sold the ferry to pay the tithe', knownBy: ['c-hobb'] }],
  threads: [],
  storySoFar: null,
  bringAbout: []
} as unknown as SceneMemory

const card: SceneCard = {
  povId: 'c-wren',
  presentIds: ['c-pell'],
  locationId: 'p-mill',
  when: 'dusk',
  beats: [],
  goal: '',
  conflict: '',
  outcome: '',
  mood: '',
  targetWords: 0,
  notes: '',
  whenSort: null,
  setsUpIds: [],
  paysOffIds: []
} as SceneCard

const chunk = (text: string): ReadingChunk => {
  const p: Para = { id: 'x', pid: null, text, hash: 'h', offset: 0 }
  return { pieces: [{ label: 'P1', text, para: p }], paras: [p], atRisk: [] }
}
const budget = readingBudget({ contextLength: 64000, maxOutput: null })!
const request = (text: string) => buildRequest({ where: 'Book 1, Ch 1, Sc 1', title: '', card, chunk: chunk(text), found: [], memory, budget })
const user = (text: string): string => request(text).messages[1].content
/** Each E id in the text spelt as the entry it stands for, so two requests can be compared whatever their ids. */
const resolved = (text: string): string => {
  const r = request(text)
  return r.messages[1].content.replace(/\bE\d+\b/g, (e) => `<${r.ids.entries.get(e)}>`)
}

describe("the memory keeper's request, in an order a provider can reuse", () => {
  it('gives each entry the same E id whatever the chunk names, fixed by when it was made', () => {
    const a = request('Hobb lit the tin lantern.')
    const b = request('The flat ferry was gone.')
    expect(steadyIds(all)).toEqual(['c-pell', 'p-mill', 'c-wren', 'i-lantern', 'c-hobb', 'i-ferry'])
    for (const r of [a, b]) {
      expect(r.ids.byEntry.get('c-pell')).toBe('E1')
      expect(r.ids.byEntry.get('c-wren')).toBe('E3')
      expect(r.ids.byEntry.get('c-hobb')).toBe('E5')
    }
    expect(a.ids.byEntry.get('i-lantern')).toBe('E4')
    expect(b.ids.byEntry.get('i-ferry')).toBe('E6')
  })

  it('sends relationships and who knows what before the memory, and the memory in E id order', () => {
    const u = user('Hobb lit the tin lantern.')
    const at = (s: string): number => u.indexOf(s)
    expect(at('Relationships:')).toBeGreaterThanOrEqual(0)
    expect(at('Relationships:')).toBeLessThan(at('Facts (who knows what):'))
    expect(at('Facts (who knows what):')).toBeLessThan(at('## Memory at this point'))
    expect(at('## Memory at this point')).toBeLessThan(at('## Scene: '))
    const memoryLines = u.split('## Memory at this point\n')[1].split('\n\n')[0].split('\n')
    const nums = memoryLines.map((l) => Number(/^- E(\d+) /.exec(l)?.[1]))
    expect(nums).toEqual([...nums].sort((x, y) => x - y))
    expect(nums.every((n) => n > 0)).toBe(true)
  })

  // Checked line for line against the request as built before this order (8e8a8d7), ids resolved, when it was made.
  it('tells the same things as before, only in another order: each section once, the same lines in each', () => {
    const u = resolved('Hobb lit the tin lantern.')
    const sections = u.split('\n\n')
    const heads = sections.map((s) => s.split('\n')[0])
    expect(heads).toEqual(['Relationships:', 'Facts (who knows what):', '## Memory at this point', '## Scene: Book 1, Ch 1, Sc 1'])
    const lines = (head: string): string[] => sections.find((s) => s.startsWith(head))!.split('\n').slice(1).sort()
    expect(lines('Relationships:')).toEqual(['- <c-wren> and <c-hobb>: apprentice of', '- <c-wren> and <c-pell>: owes a debt to (<c-wren>: wary; <c-pell>: -)'].sort())
    expect(lines('Facts (who knows what):')).toEqual(['- K1 "Hobb sold the ferry to pay the tithe": known by <c-hobb>'])
    // In full: those the card lists and the chunk names; the rest by name only.
    const memory = lines('## Memory at this point')
    expect(memory).toHaveLength(6)
    for (const id of ['c-pell', 'p-mill', 'c-wren', 'i-lantern', 'c-hobb']) expect(memory.find((l) => l.startsWith(`- <${id}> `))).toMatch(/\. /)
    expect(memory.find((l) => l.startsWith('- <i-ferry> '))).toBe('- <i-ferry> item "the flat ferry"')
  })

  it('reads word for word the same up to the memory line that changes, when another chunk names other things', () => {
    const a = user('Hobb lit the tin lantern.')
    const b = user('Hobb looked for the flat ferry.')
    let i = 0
    while (i < a.length && a[i] === b[i]) i++
    // Everything up to the lantern's line (in full in one, named only in the other) is shared, relationships and who
    // knows what included.
    const shared = a.slice(0, i)
    expect(shared).toContain('Facts (who knows what):\n- K1 ')
    expect(shared).toContain('## Memory at this point\n- E1 character "Pell Garrow". a ferryman with a bad knee\n')
    expect(shared.endsWith('- E4 item "the tin lantern"')).toBe(true)
  })

  it('an Ids with no order numbers entries as before: E1, E2... as they are named', () => {
    const ids = new Ids()
    expect(ids.peek('a')).toBe('E1')
    expect(ids.entry('b')).toBe('E1')
    expect(ids.entry('a')).toBe('E2')
    expect(ids.peek('c')).toBe('E3')
  })

  it('an entry outside the order gets the next id after it, never one already fixed', () => {
    const ids = new Ids(['x', 'y'])
    expect(ids.peek('z')).toBe('E3')
    expect(ids.entry('y')).toBe('E2')
    expect(ids.entry('z')).toBe('E3')
    expect(ids.entry('w')).toBe('E4')
    expect(ids.entry('x')).toBe('E1')
    expect(ids.entries.get('E4')).toBe('w')
  })
})
