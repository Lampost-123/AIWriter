import { describe, expect, it } from 'vitest'
import type { AsOfStop, RelationshipState } from '@shared/types'
import { asOfLead, asOfOrigins, asOfProfile, asOfRelations, chosenStop } from './asOfViewLogic'

describe('an entry as of a point', () => {
  it('shows only what has something in it, by group, with what has changed by then marked', () => {
    const p = asOfProfile(
      {
        summary: 'Older now',
        description: '',
        fields: { eyes: 'green', hair: '  ', role: 'protagonist', motivation: 'Find her brother' },
        changed: ['eyes', 'summary']
      },
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

  it('says above it whether anything has changed by then, and that Adam wrote it when he made it', () => {
    expect(asOfLead({ changedCount: 2 }, 3, false)).toBe('What has changed by this point is marked.')
    expect(asOfLead({ changedCount: 0 }, 1, false)).toBe('Nothing written here has changed by this point.')
    // Never a claim that Adam wrote what the memory keeper found, and no name in the middle of the sentence.
    expect(asOfLead({ changedCount: 0 }, 0, false)).toBe('Nothing has changed by this point.')
    expect(asOfLead({ changedCount: 1 }, 1, true)).toBe('You wrote this. What has changed by this point is marked.')
    expect(asOfLead({ changedCount: 0 }, 0, true)).toBe('You wrote this, and none of it has changed by this point.')
  })

  it('says who each value still as written came from: the story, the AI, or Adam where the entry isn’t his', () => {
    const state = {
      summary: 'Ferrywoman',
      description: 'Tall',
      fields: { eyes: 'one grey eye', hair: 'dark', motivation: 'Find her brother' },
      changed: ['eyes']
    }
    const found = { ...state, origin: 'text' as const, fieldOrigins: { hair: 'adam' as const, motivation: 'ai' as const } }
    const p = asOfProfile(found, 'character')
    // Changed by then: marked "Changed" instead.
    expect([...asOfOrigins(found, p)]).toEqual([
      ['summary', 'text'],
      ['description', 'text'],
      ['hair', 'adam'],
      ['motivation', 'ai']
    ])
    // An entry Adam made says once that he wrote it: only what came from elsewhere has a note.
    const mine = { ...state, origin: 'adam' as const, fieldOrigins: { hair: 'text' as const } }
    expect([...asOfOrigins(mine, asOfProfile(mine, 'character'))]).toEqual([['hair', 'text']])
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
