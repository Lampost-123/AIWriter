// Where the story flows put what they write among the changes at a story's start (order.ts).

import { describe, expect, it } from 'vitest'
import type { Change, ChangeData, ID, Origin } from '@shared/types'
import { between, insertInOrder, movedPosition, placeCast, positionBefore, type CastDraft } from './order'

let made = 0
function at(position: number, entryId: ID, data: ChangeData, origin: Origin = 'adam'): Change {
  return {
    ...data,
    id: `c${++made}`,
    entryId,
    anchor: 'story-start',
    storyId: 's',
    sceneId: null,
    position,
    origin,
    runId: null,
    createdAt: '',
    updatedAt: ''
  } as Change
}

const full = (names: Record<ID, string> = {}): Extract<ChangeData, { kind: 'full' }> => ({
  kind: 'full',
  payload: {
    description: 'As it is at the start.',
    knows: [],
    relationships: Object.entries(names).map(([otherId, type]) => ({ otherId, type, feels: '', otherFeels: '' }))
  }
})
const draft = (entryId: ID, names: Record<ID, string> = {}, old: Change | null = null): CastDraft => ({
  entryId,
  payload: full(names).payload,
  old
})
const update = (note: string): ChangeData => ({ kind: 'update', payload: { note } })

/** Everything at the start once placed, in order: drafts as 'draft:<entry>', the rest by id. */
function placed(here: Change[], drafts: CastDraft[]): { order: string[]; moved: ID[]; at: Map<ID, number> } {
  const p = placeCast(here, drafts)
  const replaced = new Set(drafts.flatMap((d) => (d.old ? [d.old.id] : [])))
  const items = [
    ...here.filter((c) => !replaced.has(c.id)).map((c) => ({ key: c.id, position: p.moved.get(c.id) ?? c.position })),
    ...drafts.map((d) => ({ key: `draft:${d.entryId}`, position: p.at.get(d.entryId)! }))
  ]
  // No two share a position, so the positions alone give the order.
  expect(new Set(items.map((i) => i.position)).size).toBe(items.length)
  return { order: items.sort((a, b) => a.position - b.position).map((i) => i.key), moved: [...p.moved.keys()], at: p.at }
}

describe('placeCast', () => {
  it('puts a draft after the starting description it names and before what is already there about its entry', () => {
    // Mara's earlier draft names Tobin; Tobin's new draft names the mill, drafted with it.
    const mara = at(0, 'mara', full({ tobin: 'neighbour' }), 'ai')
    const p = placed([mara], [draft('tobin', { mill: 'works at' }), draft('mill')])
    expect(p.order).toEqual(['draft:mill', 'draft:tobin', mara.id])
    expect(p.moved).toEqual([])
    expect([p.at.get('mill'), p.at.get('tobin')]).toEqual([-2, -1])
  })

  it('moves an earlier draft past changes about other entries when it must, never past one about its own', () => {
    // Mara and the mill were drafted in an earlier run; Tobin, drafted now, names the mill.
    const mara = at(0, 'mara', full({ tobin: 'neighbour' }), 'ai')
    const mill = at(1, 'mill', full(), 'ai')
    const p = placed([mara, mill], [draft('tobin', { mill: 'works at' })])
    expect(p.order).toEqual([mill.id, 'draft:tobin', mara.id])
    expect(p.moved).toHaveLength(1)

    // With Adam's note on the mill before its drafted description, that stays before it.
    const note = at(1, 'mill', update('was sold'))
    const later = at(2, 'mill', full(), 'ai')
    const q = placed([mara, note, later], [draft('tobin', { mill: 'works at' })])
    expect(q.order).toEqual([note.id, later.id, 'draft:tobin', mara.id])
    expect(q.moved).toEqual([mara.id])
  })

  it("never moves Adam's changes: his changes about the draft's own entry win over a relationship it names", () => {
    const sworn = at(0, 'tobin', { kind: 'relationship', payload: { otherId: 'mara', type: 'sworn brother', feels: '', otherFeels: '' } })
    const knows = at(1, 'tobin', { kind: 'knowledge', payload: { factId: 'f1', fact: 'The rope is frayed.' } })
    const millByAdam = at(2, 'mill', full())
    expect(placed([sworn, knows, millByAdam], [draft('tobin', { mill: 'works at' })]).order).toEqual([
      'draft:tobin',
      sworn.id,
      knows.id,
      millByAdam.id
    ])

    // When there is room after his description of the mill, it goes there (between two of his, as a fraction).
    const first = at(0, 'mill', full())
    const then = at(1, 'tobin', update('is twelve'))
    const p = placed([first, then], [draft('tobin', { mill: 'works at' })])
    expect(p.order).toEqual([first.id, 'draft:tobin', then.id])
    expect(p.at.get('tobin')).toBe(0.5)
  })

  it('keeps what it can of a ring of drafts naming each other one way, and leaves two naming each other in turn', () => {
    // A names B, B names C, C names A: one of them can't hold, the other two do.
    expect(placed([], [draft('a', { b: 'x' }), draft('b', { c: 'x' }), draft('c', { a: 'x' })]).order).toEqual([
      'draft:c',
      'draft:b',
      'draft:a'
    ])
    expect(placed([], [draft('a', { b: 'x' }), draft('b', { a: 'x' })]).order).toEqual(['draft:a', 'draft:b'])
  })

  it('drafted again, keeps its place when it can and goes before what it would wipe when it must', () => {
    const old = at(5, 'mara', full(), 'ai')
    expect(placed([old], [draft('mara', {}, old)]).at.get('mara')).toBe(5)

    const rival = at(3, 'mara', { kind: 'relationship', payload: { otherId: 'tobin', type: 'rival', feels: '', otherFeels: '' } })
    const again = placed([rival, old], [draft('mara', {}, old)])
    expect(again.order).toEqual(['draft:mara', rival.id])
    expect(again.at.get('mara')).toBe(2)
  })
})

describe('positions', () => {
  it('goes strictly between two neighbours, as a fraction only when they are next to each other', () => {
    expect([between(null, null), between(null, 3), between(3, null), between(1, 5), between(1, 2)]).toEqual([0, 2, 4, 2, 1.5])
  })

  it('goes just before the first change picked, or after them all', () => {
    const here = [at(0, 'a', update('one')), at(1, 'b', update('two')), at(4, 'b', update('three'))]
    expect(positionBefore(here, (c) => c.entryId === 'b')).toBe(0.5)
    expect(positionBefore(here, (c) => c.entryId === 'a')).toBe(-1)
    expect(positionBefore(here, (c) => c.entryId === 'z')).toBeNull()
    const added = at(0.5, 'b', update('new'))
    insertInOrder(here, added)
    expect(here.map((c) => c.position)).toEqual([0, 0.5, 1, 4])
  })

  it("moves a change from a book before the new story's own, in the book's order among those moved from it", () => {
    const own = [at(0, 'mara', update('is twelve')), at(1, 'tobin', update('keeps the ferry'))]
    expect(movedPosition(own, 3, new Map())).toBe(-1)
    // One moved before, from the book's position 3: one from position 6 goes after it, one from 1 before it.
    const moved = at(-1, 'mara', update('moved to the coast'), 'ai')
    const here = [moved, ...own]
    const fromBook = new Map([[moved.id, 3]])
    expect(movedPosition(here, 6, fromBook)).toBe(-0.5)
    expect(movedPosition(here, 1, fromBook)).toBe(-2)
    expect(movedPosition([], 1, fromBook)).toBe(0)
  })
})
