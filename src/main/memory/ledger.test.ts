// The who-knows-what ledger (long story memory fix 9): since when and how each character knows a fact, what they believe
// that isn't true, scene by scene, and the one-look-up question a rule can ask. Small worlds written as plain data; every
// name and fact is invented.

import { describe, expect, it } from 'vitest'
import type { ChangeData, KnowledgePayload } from '@shared/types'
import { pureWorld, type ChangeSpec, type EntrySpec, type WorldSpec } from '../../../tests/unit/testWorld'
import { learnedHow, ledgerOf } from './ledger'

const who = (key: string, name: string): EntrySpec => ({ key, kind: 'character', name, made: { origin: 'adam' }, exists: [{ kind: 'world' }] })
const at = (entry: string, place: ChangeSpec['at'], data: ChangeData, origin: ChangeSpec['origin'] = 'text'): ChangeSpec => ({ entry, at: place, data, origin })
const knows = (factId: string, fact: string, more: Partial<KnowledgePayload> = {}): ChangeData => ({ kind: 'knowledge', payload: { factId, fact, ...more } })

/** Book 1: three chapters of two scenes each; Book 2 after it. */
const world = (changes: ChangeSpec[]): WorldSpec => ({
  name: 'Ledger',
  series: [{ key: 's', name: 'Ledger' }],
  stories: [
    { key: 'b1', title: 'Book 1', series: 's', chapters: [2, 2, 2] },
    { key: 'b2', title: 'Book 2', series: 's', chapters: [1], start: { story: 'b1', at: 'end' } }
  ],
  entries: [who('m', 'Mara'), who('t', 'Tobin'), who('a', 'Ash')],
  changes,
  answers: []
})

describe('how someone learned something', () => {
  it('as the words say, else what was said or seen tells it', () => {
    expect(learnedHow('t', { how: 'saw' })).toEqual({ how: 'saw' })
    expect(learnedHow('t', { how: 'told', from: 'a' })).toEqual({ how: 'told', from: 'a' })
    // Who told them only goes with being told or overhearing, and never themselves.
    expect(learnedHow('t', { how: 'read', from: 'a' })).toEqual({ how: 'read' })
    expect(learnedHow('t', { how: 'told', from: 't' })).toEqual({ how: 'told' })
    const said = { kind: 'secret' as const, by: 'm', words: '“The will is in the chapel.”', heard: ['t'] }
    expect(learnedHow('t', { said })).toEqual({ how: 'told', from: 'm' })
    expect(learnedHow('m', { said })).toEqual({ how: 'said' })
    expect(learnedHow('t', { seen: true })).toEqual({ how: 'saw' })
    expect(learnedHow('t', { from: 'a' })).toEqual({ how: 'told', from: 'a' })
    expect(learnedHow('t', {})).toEqual({})
  })
})

describe('the ledger, scene by scene', () => {
  const w = pureWorld(
    world([
      at('m', 'baseline', knows('heir', 'Mara is the heir'), 'adam'),
      at('t', { scene: 'b1.c1.s2' }, knows('will', 'The will was burned', { how: 'saw', there: ['t'] })),
      at('a', { scene: 'b1.c2.s1' }, knows('will', 'The will was burned', { how: 'told', from: 't' })),
      // Told again later: still known since the first time.
      at('a', { scene: 'b1.c3.s1' }, knows('will', 'The will was burned', { how: 'read' })),
      at('t', { scene: 'b1.c2.s2' }, knows('letter', 'The letter is genuine', { wrong: true, how: 'told', from: 'a' }))
    ])
  )

  it('says since which scene and how each one knows a fact', () => {
    const s = w.state('b2')
    const will = s.facts.find((f) => f.factId === 'will')!
    expect(will.knownBy.sort()).toEqual(['a', 't'])
    expect(will.since?.t).toMatchObject({ where: 'Book 1, Ch 1, Sc 2', sceneId: 'b1.c1.s2', how: 'saw' })
    expect(will.since?.a).toMatchObject({ where: 'Book 1, Ch 2, Sc 1', sceneId: 'b1.c2.s1', how: 'told', from: 't' })
    expect(will.since!.a.at).toBeGreaterThan(will.since!.t.at)
    // Adam's own, from the starting setup.
    expect(s.facts.find((f) => f.factId === 'heir')?.since).toEqual({ m: { at: -1, where: '' } })
  })

  it('a redraft of an earlier scene sees only what was known by then', () => {
    const before = ledgerOf(w.state('b1', 'b1.c2.s1'))
    expect(before.couldKnow('t', 'will')).toMatchObject({ knows: true })
    expect(before.couldKnow('a', 'will')).toEqual({ knows: false, believesWrongly: false, since: null })
    expect(ledgerOf(w.state('b1', 'b1.c1.s2')).couldKnow('t', 'will').knows).toBe(false)
    expect(ledgerOf(w.state('b1', 'b1.c2.s2')).couldKnow('a', 'will')).toMatchObject({ knows: true, since: { how: 'told', from: 't' } })
  })

  it('keeps a false belief apart from what is known: never a fact, never a secret', () => {
    const s = w.state('b2')
    expect(s.facts.some((f) => f.factId === 'letter')).toBe(false)
    expect(s.beliefs).toEqual([
      { factId: 'letter', fact: 'The letter is genuine', believedBy: ['t'], since: { t: expect.objectContaining({ how: 'told', from: 'a', where: 'Book 1, Ch 2, Sc 2' }) }, at: expect.any(Number) }
    ])
    const l = ledgerOf(s)
    expect(l.couldKnow('t', 'letter')).toMatchObject({ knows: false, believesWrongly: true })
    expect(l.believes('t').map((k) => k.fact)).toEqual(['The letter is genuine'])
    expect(l.believes('m')).toEqual([])
    expect(l.knows('a').map((k) => k.factId)).toEqual(['will'])
    expect(l.whoKnows('will').sort()).toEqual(['a', 't'])
    expect(l.whoKnows('letter')).toEqual([])
  })
})

describe('forgetting, ending and learning the truth', () => {
  it('a forgotten fact, learned again, is known since the new learning', () => {
    const w = pureWorld(
      world([
        at('t', { scene: 'b1.c1.s1' }, knows('f', 'The ferry is closed', { how: 'saw' })),
        at('t', { scene: 'b1.c2.s1' }, knows('f', '', { forgets: true })),
        at('t', { scene: 'b1.c3.s1' }, knows('f', 'The ferry is closed', { how: 'told', from: 'm' }))
      ])
    )
    expect(w.state('b1', 'b1.c3.s1').facts).toEqual([])
    expect(w.state('b2').facts[0].since?.t).toMatchObject({ where: 'Book 1, Ch 3, Sc 1', how: 'told', from: 'm' })
  })

  it('a belief ends when the words say so, or turns into knowledge when the same fact is learned as true', () => {
    const ending: ChangeSpec = {
      ...at('t', { scene: 'b1.c1.s1' }, knows('f', 'The bridge is safe', { wrong: true })),
      data: knows('f', 'The bridge is safe', { wrong: true })
    }
    const w = pureWorld(world([ending, at('t', { scene: 'b1.c3.s1' }, knows('g', 'Ash lied', { wrong: true }))]))
    // An end (B1) on the belief, as the memory keeper's "end" item makes.
    w.data.changes[0] = { ...w.data.changes[0], until: { sceneId: 'b1.c2.s1', when: '', origin: 'text', quote: 'It was not safe.', paragraphId: null } }
    expect(w.state('b1', 'b1.c2.s1').beliefs.map((b) => b.factId)).toEqual(['f'])
    expect(w.state('b1', 'b1.c2.s2').beliefs.map((b) => b.factId)).toEqual([])

    const turned = pureWorld(
      world([at('t', { scene: 'b1.c1.s1' }, knows('f', 'The bridge is safe', { wrong: true })), at('t', { scene: 'b1.c2.s1' }, knows('f', 'The bridge is safe'))])
    )
    const s = turned.state('b2')
    expect(s.beliefs).toEqual([])
    expect(s.facts[0]).toMatchObject({ factId: 'f', knownBy: ['t'], since: { t: { where: 'Book 1, Ch 2, Sc 1' } } })
  })

  it('a full description starts what they know and believe again', () => {
    const w = pureWorld(
      world([
        at('t', { scene: 'b1.c1.s1' }, knows('f', 'The bridge is safe', { wrong: true })),
        at('t', { scene: 'b1.c1.s1' }, knows('g', 'Ash lied')),
        at('t', { start: 'b2' }, { kind: 'full', payload: { description: 'Older.', knows: [{ factId: 'h', fact: 'The war is over' }], relationships: [] } })
      ])
    )
    const s = w.state('b2', 'b2.c1.s1')
    expect(s.beliefs).toEqual([])
    expect(s.facts.map((f) => [f.factId, f.since?.t?.where])).toEqual([['h', 'the start of Book 2']])
  })
})
