import { describe, expect, it } from 'vitest'
import type { AsOfStop, RelationshipState } from '@shared/types'
import { asOfProfile, asOfRelations, chosenStop } from './asOfViewLogic'

describe('an entry as of a point', () => {
  it('shows only what has something in it, by group, with what has changed by then marked', () => {
    const p = asOfProfile(
      { summary: 'Older now', description: '', fields: { eyes: 'green', hair: '  ', role: 'protagonist', motivation: 'Find her brother' }, changed: ['eyes', 'summary'] },
      'character'
    )
    expect(p.summary).toEqual({ key: 'summary', label: 'Short summary', value: 'Older now', changed: true })
    expect(p.description).toBeNull()
    expect(p.groups.map((g) => [g.label, g.rows.map((r) => [r.label, r.value, r.changed])])).toEqual([
      ['Basics', [['Role in the story', 'Protagonist', false]]],
      ['Looks', [['Eyes', 'green', true]]],
      ['Goals and arc', [['Current motivation', 'Find her brother', false]]]
    ])
    expect(p.changedCount).toBe(2)
  })

  it('reads relationships from the entry’s side, whichever side they were written from', () => {
    const names: Record<string, string> = { mara: 'Mara', tobin: 'Tobin', guild: 'The Guild' }
    const rows: RelationshipState[] = [
      { aId: 'mara', bId: 'tobin', type: 'rival', aFeels: 'wary', bFeels: '', where: 'Book 1, Ch 2, Sc 1' },
      { aId: 'guild', bId: 'mara', type: 'employer', aFeels: '', bFeels: 'loyal', where: '' },
      { aId: 'mara', bId: 'gone', type: 'sister', aFeels: '', bFeels: '', where: '' },
      { aId: 'tobin', bId: 'guild', type: 'member', aFeels: '', bFeels: '', where: '' }
    ]
    expect(asOfRelations(rows, 'mara', (id) => names[id] ?? null)).toEqual([
      { otherId: 'tobin', text: 'Rival of Tobin', feels: 'Mara feels: wary', where: 'Book 1, Ch 2, Sc 1' },
      { otherId: 'guild', text: 'The Guild: employer of Mara', feels: 'Mara feels: loyal', where: '' }
    ])
  })

  it('stays on the point Adam chose, or starts at the scene he is in', () => {
    const stop = (sceneId: string | null): AsOfStop => ({
      at: sceneId ? { kind: 'scene', storyId: 'b1', sceneId, seenIn: 'b1' } : { kind: 'start', storyId: 'b1', seenIn: 'b1' },
      label: sceneId ?? 'Start of Book 1',
      storyId: 'b1',
      sceneId,
      changes: 0
    })
    const stops = [stop(null), stop('s1'), stop('s2'), stop('s3')]
    expect(chosenStop(stops, { kind: 'scene', storyId: 'b1', sceneId: 's1' }, 's3')?.sceneId).toBe('s1')
    expect(chosenStop(stops, null, 's2')?.sceneId).toBe('s2')
    // A chosen scene that was deleted: back to where Adam is.
    expect(chosenStop(stops, { kind: 'scene', storyId: 'b1', sceneId: 'gone' }, 's2')?.sceneId).toBe('s2')
    expect(chosenStop(stops, null, 'elsewhere')?.sceneId).toBe('s3')
    expect(chosenStop([], null, 's1')).toBeNull()
  })
})
