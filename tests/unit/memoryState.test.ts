// State's finer points (src/main/memory/state.ts), on small worlds written as plain data.
// The whole test world is in testWorld.test.ts.

import { describe, expect, it } from 'vitest'
import type { ChangeData, EntryKind } from '@shared/types'
import { changesInScene, sideClashes, stateAt } from '../../src/main/memory/state'
import { pureWorld, type AnswerSpec, type ChangeSpec, type EntrySpec, type StorySpec, type WorldSpec } from './testWorld'

const story = (key: string, title: string, chapters: number[], more: Partial<StorySpec> = {}): StorySpec => ({
  key,
  title,
  series: 's',
  chapters,
  ...more
})
const who = (key: string, name: string, kind: EntryKind = 'character', more: Partial<EntrySpec> = {}): EntrySpec => ({
  key,
  kind,
  name,
  made: { origin: 'adam' },
  exists: [{ kind: 'world' }],
  ...more
})
const at = (entry: string, place: ChangeSpec['at'], data: ChangeData): ChangeSpec => ({ entry, at: place, data })
const rel = (otherId: string, type: string, extra: object = {}): ChangeData => ({
  kind: 'relationship',
  payload: { otherId, type, feels: `${type} feels`, otherFeels: `${type} other`, ...extra }
})

/** Book 1 (three chapters of one scene), a side story during it from after Ch 1 to after Ch 2, and Book 2 after it. */
const world = (entries: EntrySpec[], changes: ChangeSpec[], answers: AnswerSpec[] = []): WorldSpec => ({
  name: 'Small',
  series: [{ key: 's', name: 'Small' }],
  stories: [
    story('b1', 'Book 1', [1, 1, 1]),
    story('side', 'Side', [2], { kind: 'side', start: { story: 'b1', at: 'chapter', ref: 'b1.c1' }, end: { at: 'chapter', ref: 'b1.c2' } }),
    story('b2', 'Book 2', [1], { start: { story: 'b1', at: 'end' } })
  ],
  entries,
  changes,
  answers
})

describe('state', () => {
  it('learns and forgets facts, by fact id, with the latest wording', () => {
    const w = pureWorld(
      world(
        [who('t', 'Tobin')],
        [
          at('t', { scene: 'b1.c1.s1' }, { kind: 'knowledge', payload: { factId: 'f', fact: 'Mara is the heir.' } }),
          at('t', { scene: 'b1.c2.s1' }, { kind: 'knowledge', payload: { factId: 'f', fact: 'Mara is the true heir.' } }),
          at('t', { scene: 'b1.c3.s1' }, { kind: 'knowledge', payload: { factId: 'f', fact: '', forgets: true } })
        ]
      )
    )
    expect(w.state('b1', 'b1.c3.s1').facts).toEqual([{ factId: 'f', fact: 'Mara is the true heir.', knownBy: ['t'] }])
    expect(w.state('b2').facts).toEqual([])
  })

  it('keeps one relationship per pair, from either side, until it ends', () => {
    const w = pureWorld(
      world(
        [who('m', 'Mara'), who('t', 'Tobin')],
        [
          at('m', 'baseline', rel('t', 'friend')),
          at('t', { scene: 'b1.c1.s1' }, rel('m', 'rival')),
          at('m', { scene: 'b1.c3.s1' }, rel('t', 'over', { ended: true }))
        ]
      )
    )
    expect(w.state('b1', 'b1.c1.s1').relationships).toEqual([
      { aId: 'm', bId: 't', type: 'friend', aFeels: 'friend feels', bFeels: 'friend other', where: '' }
    ])
    expect(w.state('b1', 'b1.c2.s1').relationships).toEqual([
      { aId: 't', bId: 'm', type: 'rival', aFeels: 'rival feels', bFeels: 'rival other', where: 'Book 1, Ch 1, Sc 1' }
    ])
    expect(w.state('b2').relationships).toEqual([])
  })

  it('a full description clears relationships set from the other side too, and later changes still apply', () => {
    const w = pureWorld(
      world(
        [who('m', 'Mara', 'character', { description: 'Grown.' }), who('t', 'Tobin'), who('k', 'Kell')],
        [
          at('t', 'baseline', rel('m', 'friend')),
          at('k', 'baseline', { kind: 'knowledge', payload: { factId: 'f2', fact: 'Kell knows this.' } }),
          at('m', 'baseline', { kind: 'knowledge', payload: { factId: 'f1', fact: 'Old fact.' } }),
          at(
            'm',
            { start: 'b2' },
            {
              kind: 'full',
              payload: { description: 'Young again.', summary: 'Young.', knows: [], relationships: [rel('k', 'cousin').payload as never] }
            }
          ),
          at('m', { start: 'b2' }, { kind: 'update', payload: { note: 'grew up a little', fields: { age: '10' } } })
        ]
      )
    )
    const s = w.state('b2', 'b2.c1.s1')
    expect(s.entries.get('m')).toMatchObject({ description: 'Young again.', summary: 'Young.', fields: { age: '10' } })
    expect(s.entries.get('m')?.changed.sort()).toEqual(['age', 'description', 'summary'])
    expect(s.relationships.map((r) => [r.aId, r.bId, r.type])).toEqual([['m', 'k', 'cousin']])
    expect(s.facts).toEqual([{ factId: 'f2', fact: 'Kell knows this.', knownBy: ['k'] }])
  })

  it('applies changes at one place by position, then creation time', () => {
    const w = pureWorld(world([who('m', 'Mara')], []))
    const base = { entryId: 'm', anchor: 'scene' as const, storyId: 'b1', sceneId: 'b1.c1.s1', origin: 'adam' as const, runId: null }
    const change = (id: string, position: number, createdAt: string, hair: string) => ({
      ...base,
      id,
      position,
      createdAt,
      updatedAt: createdAt,
      kind: 'update' as const,
      payload: { note: hair, fields: { hair } }
    })
    const data = {
      ...w.data,
      changes: [
        change('c', 1, '2026-01-01T00:00:00Z', 'third'),
        change('b', 0, '2026-01-02T00:00:00Z', 'second'),
        change('a', 0, '2026-01-01T00:00:00Z', 'first')
      ]
    }
    const s = stateAt(data, w.shape, w.line('b1', 'b1.c2.s1'))
    expect(s.entries.get('m')?.happened.map((h) => h.note)).toEqual(['first', 'second', 'third'])
    expect(changesInScene(data, 'b1.c1.s1').map((c) => c.id)).toEqual(['a', 'b', 'c'])
  })

  it('reopens a resolved thread', () => {
    const w = pureWorld(
      world(
        [who('th', 'The missing key', 'thread', { exists: [{ kind: 'scene', scene: 'b1.c1.s1' }] })],
        [
          at('th', { scene: 'b1.c2.s1' }, { kind: 'thread', payload: { status: 'resolved', note: 'Found.' } }),
          at('th', { scene: 'b1.c3.s1' }, { kind: 'thread', payload: { status: 'open', note: 'Lost again.' } })
        ]
      )
    )
    expect(w.state('b1', 'b1.c2.s1').threads).toEqual([{ entryId: 'th', status: 'open', setUp: 'Book 1, Ch 1, Sc 1', paidOff: '' }])
    expect(w.state('b1', 'b1.c3.s1').threads).toEqual([
      { entryId: 'th', status: 'resolved', setUp: 'Book 1, Ch 1, Sc 1', paidOff: 'Book 1, Ch 2, Sc 1' }
    ])
    expect(w.state('b2').threads).toEqual([{ entryId: 'th', status: 'open', setUp: 'Book 1, Ch 1, Sc 1', paidOff: '' }])
    expect(
      w
        .state('b2')
        .entries.get('th')
        ?.happened.map((h) => h.note)
    ).toEqual(['Found.', 'Lost again.'])
  })

  it('decides who exists: no points counts as the starting setup; an earlier point means not "first here"', () => {
    const w = pureWorld(
      world(
        [
          who('none', 'No points', 'character', { exists: [] }),
          who('two', 'Two points', 'character', {
            exists: [
              { kind: 'story-pre', story: 'b1' },
              { kind: 'scene', scene: 'b1.c2.s1' }
            ]
          }),
          who('new', 'New here', 'item', { exists: [{ kind: 'scene', scene: 'b1.c2.s1' }] }),
          who('rel', 'Related', 'character', { exists: [{ kind: 'scene', scene: 'b1.c3.s1' }] })
        ],
        [at('new', 'baseline', rel('rel', 'holder'))]
      )
    )
    const s = w.state('b1', 'b1.c2.s1')
    expect([...s.entries.keys()].sort()).toEqual(['new', 'none', 'two'])
    expect([...s.firstHere]).toEqual(['new'])
    // A relationship counts only when both ends exist.
    expect(s.relationships).toEqual([])
    expect(w.state('b1', 'b1.c3.s1').firstHere).toEqual(new Set(['rel']))
    expect(w.state('b1', 'b1.c3.s1').relationships).toHaveLength(1)
  })

  describe('a side story and its host clashing', () => {
    const entries = [who('m', 'Mara'), who('t', 'Tobin')]
    const changes: ChangeSpec[] = [
      at('m', { scene: 'b1.c1.s1' }, { kind: 'update', payload: { note: 'before', fields: { eyes: 'grey' } } }),
      at(
        'm',
        { scene: 'side.c1.s1' },
        { kind: 'update', payload: { note: 'side eyes', fields: { eyes: 'blue' }, description: 'From the side.' } }
      ),
      at('t', { scene: 'side.c1.s2' }, rel('m', 'ally')),
      at('m', { scene: 'b1.c2.s1' }, { kind: 'update', payload: { note: 'host description', description: 'From the host.' } }),
      at('m', { scene: 'b1.c2.s1' }, rel('t', 'enemy'))
    ]

    it('the host wins where both changed the same thing; a change from before the side story started does not clash', () => {
      const s = pureWorld(world(entries, changes)).state('b2')
      expect(s.entries.get('m')?.description).toBe('From the host.')
      expect(s.entries.get('m')?.fields.eyes).toBe('blue')
      expect(s.relationships.map((r) => r.type)).toEqual(['enemy'])
      // Inside Book 1 after the side story ended, the same.
      expect(pureWorld(world(entries, changes)).state('b1', 'b1.c3.s1').entries.get('m')?.description).toBe('From the host.')
    })

    it("Adam's answer lets the side story win, for a relationship from either side's key", () => {
      const answers: AnswerSpec[] = [
        { kind: 'which-last', key: (id) => `${id('side')}:${id('m')}:description`, value: () => 'side' },
        { kind: 'which-last', key: (id) => `${id('side')}:${id('m')}:rel:${id('t')}`, value: () => 'side' }
      ]
      const s = pureWorld(world(entries, changes, answers)).state('b2')
      expect(s.entries.get('m')?.description).toBe('From the side.')
      expect(s.relationships.map((r) => r.type)).toEqual(['ally'])
      const host: AnswerSpec[] = [{ kind: 'which-last', key: (id) => `${id('side')}:${id('m')}:description`, value: () => 'host' }]
      expect(
        pureWorld(world(entries, changes, host))
          .state('b2')
          .entries.get('m')?.description
      ).toBe('From the host.')
    })

    it('lists the clashes for the "Which happened last?" question', () => {
      const w = pureWorld(
        world(entries, changes, [{ kind: 'which-last', key: (id) => `${id('side')}:${id('m')}:description`, value: () => 'side' }])
      )
      expect(sideClashes(w.data, w.shape, 'side')).toEqual([
        { entryId: 'm', aspect: 'description', answer: 'side' },
        { entryId: 't', aspect: 'rel:m', answer: null }
      ])
      expect(sideClashes(w.data, w.shape, 'b1')).toEqual([])
    })
  })
})
