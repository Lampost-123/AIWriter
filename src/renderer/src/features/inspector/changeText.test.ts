import { describe, expect, it } from 'vitest'
import type { Change, ChangeData } from '@shared/types'
import { describeChange } from './changeText'

const names: Record<string, string> = { mara: 'Mara', tobin: 'Tobin', ring: 'The missing ring' }
const nameOf = (id: string): string => names[id] ?? 'Someone'

const change = (entryId: string, data: ChangeData): Change => ({
  ...data,
  id: 'c1',
  entryId,
  anchor: 'scene',
  storyId: 'b1',
  sceneId: 's1',
  position: 0,
  origin: 'text',
  runId: null,
  createdAt: '2026-10-02T10:00:00Z',
  updatedAt: '2026-10-02T10:00:00Z'
})

describe('describeChange', () => {
  it('says what changes for an entry', () => {
    expect(describeChange(change('mara', { kind: 'update', payload: { note: 'loses her left hand.' } }), nameOf)).toBe(
      'Mara: loses her left hand'
    )
    expect(describeChange(change('mara', { kind: 'update', payload: { note: '  ' } }), nameOf)).toBe('Mara: changes')
    expect(
      describeChange(change('mara', { kind: 'full', payload: { description: 'A new Mara', knows: [], relationships: [] } }), nameOf)
    ).toBe('Mara: starts this story as newly described')
  })

  it('names both sides of a relationship', () => {
    const rel = (type: string, ended = false): Change =>
      change('mara', { kind: 'relationship', payload: { otherId: 'tobin', type, feels: '', otherFeels: '', ended } })
    expect(describeChange(rel('rivals'), nameOf)).toBe('Mara and Tobin: rivals')
    expect(describeChange(rel(''), nameOf)).toBe('Mara and Tobin: a new bond')
    expect(describeChange(rel('friends', true), nameOf)).toBe('Mara and Tobin: no longer friends')
    expect(describeChange(rel('', true), nameOf)).toBe('Mara and Tobin: their bond ends')
  })

  it('says who learns or forgets what', () => {
    expect(describeChange(change('tobin', { kind: 'knowledge', payload: { factId: 'f1', fact: 'Mara is the heir.' } }), nameOf)).toBe(
      'Tobin learns: Mara is the heir'
    )
    expect(
      describeChange(change('tobin', { kind: 'knowledge', payload: { factId: 'f1', fact: 'the password', forgets: true } }), nameOf)
    ).toBe('Tobin forgets: the password')
  })

  it('says when a plot thread opens or is resolved', () => {
    expect(describeChange(change('ring', { kind: 'thread', payload: { status: 'open', note: '' } }), nameOf)).toBe('The missing ring opens')
    expect(describeChange(change('ring', { kind: 'thread', payload: { status: 'resolved', note: 'found in the well.' } }), nameOf)).toBe(
      'The missing ring is resolved: found in the well'
    )
  })

  it('copes with an entry it has no name for', () => {
    expect(describeChange(change('gone', { kind: 'update', payload: { note: 'leaves' } }), nameOf)).toBe('Someone: leaves')
  })
})
