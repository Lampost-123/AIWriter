// What must stay true, leaner about the dead (overhaul, 2026-10-19). Live (16 Oct, DeepSeek Flash) everyone dead in the
// briefing had a line of their own, at the head of the list, and crowded out what the scene was about. Now a full line
// only for the dead this scene could bring in (on the card, on the stage, named in the card's words, the direction or the
// scene so far, or tied to someone here); the rest are named on one "Also dead: …" line, still at the head of the list, so
// none is ever brought back. Invented names throughout.
import { describe, expect, it } from 'vitest'
import type { EntryKind, EntryState, RelationshipState } from '@shared/types'
import type { SceneState } from '@shared/continuity'
import { MUST_DEAD_NAMES, MUST_KEY, MUST_SMALLEST, mustLines, mustStayTrue, type MustInput } from './mustStay'
import { changedBy } from './contract'

let seq = 0
const entry = (kind: EntryKind, name: string, extra: Partial<EntryState> = {}): EntryState => ({
  id: `d${++seq}`,
  kind,
  name,
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
  byHand: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  happened: [],
  changed: [],
  ...extra
})

const died = (name: string, how = 'Drowned in the flood.', extra: Partial<EntryState> = {}): EntryState =>
  entry('character', name, { happened: [{ note: how, where: 'The Mill, Ch 2, Sc 1', changeId: `c-${name}` }], ...extra })

const wren = entry('character', 'Wren')
const osric = entry('character', 'Osric Hale')

function input(over: Partial<MustInput> = {}): MustInput {
  return { stand: null, reach: 'none', people: [wren, osric], named: [], facts: [], sceneId: 'here', storyTitle: 'The Mill', places: {}, ...over }
}

describe('the dead in what must stay true', () => {
  it('gives a line of their own only to the dead the scene could bring in, and names the rest on one line', () => {
    const fen = died('Abbot Fen', 'Died of the fever.')
    const bryn = died('Bryn')
    const cole = died('Cole')
    const dara = died('Dara')
    const lines = mustStayTrue(input({ named: [fen, bryn, cole, dara], about: 'Wren lays flowers on the Abbot Fen’s grave.' }))
    expect(lines).toEqual(['Abbot Fen is dead: Died of the fever (since Ch 2, Sc 1)', 'Also dead: Bryn, Cole and Dara'])
  })

  it('counts the card, the stage, the direction or the scene so far, and someone tied to a person here', () => {
    const onCard = died('Ash')
    const onStage = died('Bryn')
    const named = died('Cole')
    const father = died('Dara', 'Hanged at the crossroads.', { summary: 'Wren’s father, the old miller.' })
    const tied = died('Edda')
    const far = [died('Fenn'), died('Gale')]
    const stand: SceneState = {
      time: '',
      weather: '',
      light: '',
      characters: [{ name: 'Bryn', where: 'under the mill wheel', wearing: '', posture: '', holding: '', condition: 'dead', mood: '', lastAction: '' }]
    }
    const ties: Pick<RelationshipState, 'aId' | 'bId'>[] = [{ aId: osric.id, bId: tied.id }]
    const lines = mustStayTrue(
      input({ people: [wren, osric, onCard], named: [onStage, named, father, tied, ...far], stand, about: 'Osric speaks of Cole at last.', ties })
    )
    for (const who of ['Ash', 'Bryn', 'Cole', 'Dara', 'Edda']) expect(lines.some((l) => l.startsWith(`${who} is dead: `))).toBe(true)
    expect(lines).toContain('Also dead: Fenn and Gale')
    expect(lines.filter((l) => /is dead|Also dead/.test(l))).toHaveLength(6)
  })

  it('keeps a lone one’s own line, as before (it is one line either way)', () => {
    const fen = died('Abbot Fen', 'Died of the fever.')
    expect(mustStayTrue(input({ named: [fen] }))).toEqual(['Abbot Fen is dead: Died of the fever (since Ch 2, Sc 1)'])
  })

  it('no longer lets them crowd out what the scene is most likely to break, and keeps the line in the smallest form', () => {
    const many = Array.from({ length: 6 }, (_, i) => died(`Ghost ${i + 1}`))
    const stand: SceneState = { time: '', weather: '', light: '', characters: [{ name: 'Wren', where: '', wearing: '', posture: '', holding: '', condition: 'left arm in a sling', mood: '', lastAction: '' }] }
    const facts = [{ factId: 'f', fact: 'The flour tax was forged', knownBy: [wren.id] }]
    const o = input({ named: many, stand, reach: 'later', facts, elapsed: 'Time: the scene before was Day 3; this scene is Day 5' })
    const lines = mustStayTrue(o)
    // Before: six "is dead" lines, five of them first. Now one, then the secret, the injury and the time.
    expect(lines.slice(0, 4)).toEqual([
      'Also dead: Ghost 1, Ghost 2, Ghost 3, Ghost 4, Ghost 5 and Ghost 6',
      'Kept from Osric Hale: The flour tax was forged (Wren knows it). Osric Hale must not learn, guess or think it here unless the scene card says so',
      'Wren: left arm in a sling',
      'Time: the scene before was Day 3; this scene is Day 5'
    ])
    expect(lines.slice(0, MUST_KEY).filter((l) => l.startsWith('Also dead'))).toHaveLength(1)
    const smallest = mustStayTrue({ ...o, smallest: true })
    expect(smallest).toHaveLength(MUST_SMALLEST)
    expect(smallest[0]).toBe('Also dead: Ghost 1, Ghost 2, Ghost 3, Ghost 4, Ghost 5 and Ghost 6')
  })

  it(`names ${MUST_DEAD_NAMES} at most, and the line is a "dead" line about all of them for the scene's contract`, () => {
    const many = Array.from({ length: 12 }, (_, i) => died(`Ghost ${i + 1}`))
    const [line] = mustLines(input({ named: many })).filter((l) => l.kind === 'dead')
    expect(line.text).toBe('Also dead: Ghost 1, Ghost 2, Ghost 3, Ghost 4, Ghost 5, Ghost 6, Ghost 7, Ghost 8 and 4 more')
    expect(line.entryIds).toEqual(many.map((e) => e.id))
    // A change that says one of them is dead again doesn't take the line out of what must not change.
    expect(changedBy(line, ['Wren brings in the bread.'])).toBe(false)
  })
})
