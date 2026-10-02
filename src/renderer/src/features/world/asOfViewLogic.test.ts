import { describe, expect, it } from 'vitest'
import type { AsOfStop, ChangeData, ChangeView, Origin, RelationshipState, SourceLink } from '@shared/types'
import {
  asOfHappened,
  asOfLead,
  asOfNote,
  asOfOrigins,
  asOfProfile,
  asOfRelations,
  chosenStop,
  knowsSource,
  relationSource
} from './asOfViewLogic'

/** A change as an entry page lists it: before any story, or in a scene ("Book 1, Ch 2, Sc 1"). */
function change(id: string, entryId: string, data: ChangeData, origin: Origin, where = '', links: SourceLink[] = []): ChangeView {
  return {
    ...data,
    id,
    entryId,
    anchor: where ? 'scene' : 'baseline',
    storyId: where ? 'b1' : null,
    sceneId: where ? `scene of ${where}` : null,
    position: 0,
    origin,
    runId: null,
    createdAt: '',
    updatedAt: '',
    where: where || 'Before any story',
    links
  }
}

const link = (quote: string, sceneId = 's2'): SourceLink => ({
  id: quote,
  factKind: 'change',
  factId: 'c',
  field: null,
  sceneId,
  sceneVersion: 1,
  paragraphId: null,
  start: 0,
  end: quote.length,
  quote,
  state: 'ok'
})

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
    // One he made with fields drafted by AI (a builder's) isn't all his writing: his own values say so too.
    const built = { ...state, origin: 'adam' as const, fieldOrigins: { hair: 'ai' as const, motivation: 'ai' as const } }
    expect([...asOfOrigins(built, asOfProfile(built, 'character'))]).toEqual([
      ['summary', 'adam'],
      ['description', 'adam'],
      ['hair', 'ai'],
      ['motivation', 'ai']
    ])
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
      { otherId: 'tobin', text: 'Rival of Tobin', feels: 'Mara feels: wary', where: 'Book 1, Ch 2, Sc 1', source: null },
      { otherId: 'guild', text: 'The Guild: employer of Mara', feels: 'Mara feels: loyal', where: '', source: null }
    ])
  })

  it('words what has happened as Changes over time does', () => {
    expect(
      asOfHappened([
        { note: 'lost her left hand', where: 'Book 1, Ch 2, Sc 1', changeId: 'c1' },
        { note: ' took the ferry ', where: 'the start of Book 2', changeId: 'c2' },
        { note: 'was born', where: '', changeId: 'c3' }
      ])
    ).toEqual([
      { changeId: 'c1', where: 'Book 1, Ch 2, Sc 1', note: 'Lost her left hand' },
      { changeId: 'c2', where: 'The start of Book 2', note: 'Took the ferry' },
      { changeId: 'c3', where: 'Before any story', note: 'Was born' }
    ])
  })

  it('finds who made each relationship as it is at a point: the change that set it there', () => {
    const rel = (otherId: string, type: string, feels = ''): ChangeData => ({
      kind: 'relationship',
      payload: { otherId, type, feels, otherFeels: '' }
    })
    const changes = [
      change('c1', 'mara', rel('tobin', 'friend'), 'adam'),
      change('c2', 'mara', rel('tobin', 'rival', 'wary'), 'text', 'Book 1, Ch 2, Sc 1', [link('Mara would never trust him again.')]),
      change('c3', 'guild', rel('mara', 'employer'), 'ai'),
      change('c4', 'tobin', rel('mara', 'rival'), 'adam', 'Book 1, Ch 2, Sc 1')
    ]
    const at = (r: Partial<RelationshipState>): RelationshipState => ({
      aId: 'mara',
      bId: 'tobin',
      type: '',
      aFeels: '',
      bFeels: '',
      where: '',
      ...r
    })
    // Before the change in the scene: Adam's, from the start.
    expect(relationSource(at({ type: 'friend' }), changes)?.origin).toBe('adam')
    // After it: read from the story, with its words.
    expect(relationSource(at({ type: 'rival', aFeels: 'wary', where: 'Book 1, Ch 2, Sc 1' }), changes)).toMatchObject({
      origin: 'text',
      links: [{ quote: 'Mara would never trust him again.' }]
    })
    // Written on the other entry, and from the other side.
    expect(relationSource(at({ aId: 'guild', bId: 'mara', type: 'employer' }), changes)?.origin).toBe('ai')
    expect(relationSource(at({ aId: 'tobin', bId: 'mara', type: 'rival', where: 'Book 1, Ch 2, Sc 1' }), changes)?.origin).toBe('adam')
    // Set by a fresh description of the entry in a scene.
    const husband: ChangeData = {
      kind: 'full',
      payload: { description: '', knows: [], relationships: [{ otherId: 'tobin', type: 'husband', feels: '', otherFeels: '' }] }
    }
    const full = change('c5', 'mara', husband, 'ai', 'Book 2, Ch 1, Sc 1')
    expect(relationSource(at({ type: 'husband', where: 'Book 2, Ch 1, Sc 1' }), [...changes, full])?.origin).toBe('ai')
    // Nothing says just that there.
    expect(relationSource(at({ type: 'enemy' }), changes)).toBeNull()
    expect(relationSource(at({ type: 'rival', aFeels: 'wary' }), changes)).toBeNull()
  })

  it('finds how a character came to know a fact, when it can be told', () => {
    const learns = (factId: string, forgets = false): ChangeData => ({ kind: 'knowledge', payload: { factId, fact: factId, forgets } })
    const changes = [
      change('c1', 'mara', learns('heir'), 'adam'),
      change('c2', 'mara', learns('map'), 'text', 'Book 1, Ch 1, Sc 2', [link('She had seen the map.')]),
      change('c3', 'tobin', learns('heir'), 'text', 'Book 1, Ch 1, Sc 2'),
      change('c4', 'mara', learns('map', true), 'text', 'Book 1, Ch 1, Sc 3'),
      change('c5', 'mara', learns('ring'), 'ai', 'Book 1, Ch 1, Sc 1'),
      change('c6', 'mara', learns('ring'), 'ai', 'Book 1, Ch 1, Sc 3'),
      change('c7', 'mara', learns('key'), 'text', 'Book 1, Ch 1, Sc 1'),
      change('c8', 'mara', learns('key'), 'text', 'Book 1, Ch 1, Sc 3')
    ]
    expect(knowsSource('mara', 'heir', changes)?.origin).toBe('adam')
    expect(knowsSource('mara', 'map', changes)?.links[0].quote).toBe('She had seen the map.')
    // Learned more than once, the same way: Adam's or the AI's either way.
    expect(knowsSource('mara', 'ring', changes)?.origin).toBe('ai')
    // Read from the story more than once: which words count here can't be told.
    expect(knowsSource('mara', 'key', changes)).toBeNull()
    expect(knowsSource('mara', 'nothing', changes)).toBeNull()
    // From a fresh description.
    const heir = { factId: 'heir', fact: 'heir' }
    const full = change('c9', 'kell', { kind: 'full', payload: { description: '', knows: [heir], relationships: [] } }, 'ai')
    expect(knowsSource('kell', 'heir', [...changes, full])?.origin).toBe('ai')
  })

  it('says under each who made it: the words, the AI, or Adam where the entry isn’t all his', () => {
    expect(asOfNote({ origin: 'text', links: [link('Mara waited.')] }, true)).toMatchObject({ kind: 'words', quote: 'Mara waited.' })
    expect(asOfNote({ origin: 'ai', links: [] }, true)).toEqual({ kind: 'ai' })
    expect(asOfNote({ origin: 'adam', links: [] }, false)).toEqual({ kind: 'adam' })
    // On his own entry the line at the top says he wrote it, once.
    expect(asOfNote({ origin: 'adam', links: [] }, true)).toBeNull()
    expect(asOfNote(null, false)).toBeNull()
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
