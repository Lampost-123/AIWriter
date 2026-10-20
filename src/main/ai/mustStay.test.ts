// What must stay true (step 4): built by the app from the stage and the codex entries in the scene, current values
// only, each with since when, capped, and sent right before the instruction to write. Invented test text only.
import { describe, expect, it } from 'vitest'
import type { EntryKind, EntryState, FactState } from '@shared/types'
import { defaultStyleGuide, emptySceneCard } from '@shared/defaults'
import { pieceKey, thingKey, type SceneState } from '@shared/continuity'
import {
  MUST_CLOTHES,
  MUST_THINGS,
  MUST_BELIEFS,
  MUST_GAPS,
  MUST_KEY,
  MUST_ITEMS,
  MUST_LEAD,
  MUST_MOST,
  MUST_SHORT,
  MUST_SMALLEST,
  lastingCondition,
  mustLines,
  mustStayTrue,
  mustText,
  namesUpTo,
  shortPlace,
  stageFor,
  namedThere,
  stageInScene,
  type MustInput
} from './mustStay'
import { stageTold } from '../repair'
import { stageLines } from '../repair/prompts'
import type { Holding } from '../memory/items'
import { changedBy } from './contract'
import {
  assembleContext,
  MUST_BLOCK,
  MUST_PRIORITY,
  PLAN_BLOCK,
  prepareContext,
  SEND_ORDER,
  STAND_LEAD,
  stageReach,
  stageScope,
  timeSince,
  toldStage,
  WHY,
  type ContextInput
} from './context'
import { countRaw } from './tokens'
import { buildCalendar } from '../memory/calendar'

let seq = 0
const entry = (kind: EntryKind, name: string, extra: Partial<EntryState> = {}): EntryState => ({
  id: `e${++seq}`,
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

const blank = { where: '', wearing: '', posture: '', holding: '', condition: '', mood: '', lastAction: '' }

/** Where things stand: Wren in the mill loft (from Ch 3, Sc 2), her arm in a sling (Ch 2, Sc 4), cloak off just now. */
function stage(): SceneState {
  return {
    time: 'late evening',
    weather: 'sleet',
    light: 'one tallow candle',
    characters: [
      {
        ...blank,
        name: 'Wren',
        where: 'the mill loft, by the hatch',
        wearing: 'linen shirt, wool skirt, cloak off (over the beam)',
        posture: 'kneeling at the hatch, facing the stairs',
        holding: 'a lantern in her right hand',
        condition: 'left arm in a sling',
        mood: 'wary'
      },
      { ...blank, name: 'Osric Hale', where: 'the foot of the stairs', condition: 'a cut lip' }
    ],
    said: {
      'wren|where': { quote: 'up in the loft by the hatch', sceneId: 'sc-3-2' },
      'wren|wearing': { quote: 'she threw the cloak over the beam', sceneId: 'here' },
      'wren|condition': { quote: 'her arm in its sling', sceneId: 'sc-2-4' },
      'wren|holding': { quote: 'the lantern swung in her right hand', sceneId: 'sc-3-2' },
      'osric hale|condition': { quote: 'his lip still bleeding', sceneId: 'other-book' },
      '|time': { quote: 'the late bell had long gone', sceneId: 'sc-3-2' }
    }
  }
}

const PLACES = { 'sc-3-2': 'The Mill, Ch 3, Sc 2', 'sc-2-4': 'The Mill, Ch 2, Sc 4', 'other-book': 'River Days, Ch 9, Sc 1' }

function base(over: Partial<MustInput> = {}): MustInput {
  const wren = entry('character', 'Wren')
  const osric = entry('character', 'Osric Hale', { aliases: ['the miller'] })
  return { stand: stage(), reach: 'here', people: [wren, osric], named: [], facts: [], sceneId: 'here', storyTitle: 'The Mill', places: PLACES, ...over }
}

describe('what must stay true', () => {
  it('holds the stage as it is now, each value with where it became true', () => {
    const lines = mustStayTrue(base())
    expect(lines).toContain('Wren: left arm in a sling (since Ch 2, Sc 4)')
    // Each piece its own line (step 2b; here read from a state kept before it, in one line), what is off first.
    expect(lines).toContain('Wren: cloak off (over the beam) (since earlier in this scene)')
    expect(lines).toContain('Wren is wearing: linen shirt (since earlier in this scene)')
    expect(lines).toContain('Wren is wearing: wool skirt (since earlier in this scene)')
    expect(lines).toContain('Wren is holding: a lantern in her right hand (since Ch 3, Sc 2)')
    expect(lines).toContain('Where Wren is: the mill loft, by the hatch (since Ch 3, Sc 2)')
    // No words kept for it (Adam set it, or it carried on from before step 2): no since.
    expect(lines).toContain('How Wren is placed: kneeling at the hatch, facing the stairs')
    // Another story's place keeps its title.
    expect(lines).toContain('Osric Hale: a cut lip (since River Days, Ch 9, Sc 1)')
    expect(lines).toContain('Time: late evening (since Ch 3, Sc 2)')
    expect(lines).toContain('Light: one tallow candle')
    // Mood and the last thing done aren't facts to keep to.
    expect(lines.join('\n')).not.toContain('wary')
    // What the scene is most likely to break first (2026-10-15: here the injuries), then person by person, then the scene.
    expect(lines.slice(0, 2)).toEqual(['Wren: left arm in a sling (since Ch 2, Sc 4)', 'Osric Hale: a cut lip (since River Days, Ch 9, Sc 1)'])
    const rest = lines.slice(2)
    expect(rest[0]).toContain('Wren')
    expect(rest.findIndex((l) => /^(Time|Light|Weather): /.test(l))).toBeGreaterThan(rest.findLastIndex((l) => l.includes('Wren')))
    expect(lines.at(-1)).toMatch(/^(Time|Light|Weather): /)
  })

  it('at the start of a scene: no positions or time of day (the card sets those); a later day: only how people are', () => {
    const start = mustStayTrue(base({ reach: 'start' })).join('\n')
    expect(start).toContain('Wren: left arm in a sling')
    expect(start).toContain('Wren is wearing: ')
    expect(start).toContain('Wren is holding: ')
    expect(start).not.toContain('Where Wren is')
    expect(start).not.toContain('How Wren is placed')
    expect(start).not.toContain('Time: ')
    const later = mustStayTrue(base({ reach: 'later' }))
    expect(later).toEqual(['Wren: left arm in a sling (since Ch 2, Sc 4)', 'Osric Hale: a cut lip (since River Days, Ch 9, Sc 1)'])
    expect(mustStayTrue(base({ reach: 'none' }))).toEqual([])
    expect(mustStayTrue(base({ stand: null }))).toEqual([])
  })

  it('finds a character on the stage by another name or by first name alone', () => {
    const s = stage()
    expect(stageFor({ name: 'Wren Calloway', aliases: [] }, s)?.name).toBe('Wren')
    expect(stageFor({ name: 'Osric', aliases: [] }, s)?.name).toBe('Osric Hale')
    expect(stageFor({ name: 'The Miller', aliases: ['Osric Hale'] }, s)?.name).toBe('Osric Hale')
    expect(stageFor({ name: 'Bram', aliases: [] }, s)).toBeNull()
    expect(shortPlace('The Mill, Ch 3, Sc 2', 'The Mill')).toBe('Ch 3, Sc 2')
    expect(shortPlace('River Days, Ch 9, Sc 1', 'The Mill')).toBe('River Days, Ch 9, Sc 1')
  })

  it('from the codex: marks always, and a look changed during the story only as it is now, with where it changed', () => {
    const wren = entry('character', 'Wren', {
      // The profile's typical clothing is a detail to show, not a fact: the stage says what she wears now.
      fields: { marks: 'a burn scar across the back of her right hand', hair: 'cropped short', eyes: 'grey', clothing: 'a blue cloak' },
      changed: ['hair', 'marks'],
      changedWhere: { hair: 'The Mill, Ch 5, Sc 1' }
    })
    const lines = mustStayTrue(base({ people: [wren] }))
    expect(lines).toContain('Wren: a burn scar across the back of her right hand')
    expect(lines).toContain('Wren, hair: cropped short (since Ch 5, Sc 1)')
    const all = lines.join('\n')
    expect(all).not.toContain('grey')
    expect(all).not.toContain('blue cloak')
  })

  it('says who in the briefing is dead, and what some in the scene know that others do not', () => {
    const wren = entry('character', 'Wren')
    const osric = entry('character', 'Osric Hale')
    const abbot = entry('character', 'Abbot Fen', {
      happened: [
        { note: 'Fell ill in the winter', where: 'The Mill, Ch 1, Sc 1', changeId: 'a' },
        { note: 'Died of the fever.', where: 'The Mill, Ch 2, Sc 1', changeId: 'b' }
      ]
    })
    const facts: FactState[] = [
      { factId: 'f1', fact: 'The flour tax was forged.', knownBy: [wren.id] },
      { factId: 'f2', fact: 'The weir is failing', knownBy: [wren.id, osric.id] },
      { factId: 'f3', fact: 'Osric owes the abbey', knownBy: [osric.id] }
    ]
    const lines = mustStayTrue(base({ people: [wren, osric], named: [abbot], facts, stand: null, reach: 'none' }))
    // Kept from the others, who must not learn it here (the point-of-view character not even in thought).
    expect(lines).toEqual([
      'Abbot Fen is dead: Died of the fever (since Ch 2, Sc 1)',
      'Kept from Wren: Osric owes the abbey (Osric Hale knows it). Wren must not learn, guess or think it here unless the scene card says so',
      'Kept from Osric Hale: The flour tax was forged (Wren knows it). Osric Hale must not learn, guess or think it here unless the scene card says so'
    ])
    // The most lately learned first, whatever order the people or the facts come in.
    const learned = mustStayTrue(
      base({
        people: [wren, osric],
        facts: [{ ...facts[0], at: 9 }, facts[1], { ...facts[2], at: 4 }, { factId: 'f4', fact: 'The mill is mortgaged', knownBy: [wren.id], at: 12 }],
        stand: null,
        reach: 'none'
      })
    )
    expect(learned.map((l) => l.split(':')[1].trim())).toEqual(['The mill is mortgaged (Wren knows it). Osric Hale must not learn, guess or think it here unless the scene card says so', 'The flour tax was forged (Wren knows it). Osric Hale must not learn, guess or think it here unless the scene card says so', 'Osric owes the abbey (Osric Hale knows it). Wren must not learn, guess or think it here unless the scene card says so'])
  })

  it('keeps a secret from anyone in the scene (fix 9), and says what someone here believes wrongly, after the secrets', () => {
    const wren = entry('character', 'Wren')
    const osric = entry('character', 'Osric Hale')
    const bryn = entry('character', 'Bryn')
    const facts: FactState[] = [{ factId: 'f1', fact: 'The flour tax was forged.', knownBy: [wren.id, osric.id], at: 3 }]
    const beliefs = [{ factId: 'b1', fact: 'The abbot is alive', believedBy: [osric.id], since: { [osric.id]: { at: 5, where: 'The Mill, Ch 2, Sc 1' } }, at: 5 }]
    const only = mustStayTrue(base({ people: [wren, osric], facts, beliefs, stand: null, reach: 'none' }))
    expect(only).toEqual([
      "Osric Hale wrongly believes: The abbot is alive (it isn't true). Osric Hale takes it as true here unless the scene card says otherwise"
    ])
    // Bryn is in the scene (named in it so far, or on the stage): the secret is kept from him too, and comes first.
    const all = mustStayTrue(base({ people: [wren, osric], knowers: [wren, osric, bryn], facts, beliefs, stand: null, reach: 'none' }))
    expect(all).toEqual([
      'Kept from Bryn: The flour tax was forged (Wren and Osric Hale know it). Bryn must not learn, guess or think it here unless the scene card says so',
      "Osric Hale wrongly believes: The abbot is alive (it isn't true). Osric Hale takes it as true here unless the scene card says otherwise"
    ])
    expect(mustStayTrue(base({ people: [wren, osric], knowers: [wren, osric, bryn], facts, beliefs, stand: null, reach: 'none', smallest: true }))).toEqual([
      'Kept from Bryn: The flour tax was forged (Wren and Osric Hale know it)',
      "Osric Hale wrongly believes: The abbot is alive (it isn't true)"
    ])
    // Beliefs have their own seat (MUST_BELIEFS): three secrets don't take it (fix 9 review), in the full form, the short
    // one and the smallest.
    const many = Array.from({ length: MUST_GAPS }, (_, i) => ({ factId: `k${i}`, fact: `Secret ${i}`, knownBy: [wren.id] }))
    const crowd = base({ people: [wren, osric], facts: many, beliefs, stand: null, reach: 'none' })
    for (const form of [{}, { short: true }, { smallest: true }]) {
      const lines = mustStayTrue({ ...crowd, ...form })
      expect(lines.filter((l) => l.startsWith('Kept from ')).length, JSON.stringify(form)).toBeGreaterThan(0)
      expect(lines.some((l) => l.startsWith('Osric Hale wrongly believes: The abbot is alive')), JSON.stringify(form)).toBe(true)
    }
    const two = [
      ...beliefs,
      { factId: 'b2', fact: 'The mill is safe', believedBy: [wren.id], since: { [wren.id]: { at: 7, where: 'The Mill, Ch 3, Sc 1' } }, at: 7 },
      { factId: 'b3', fact: 'The road is open', believedBy: [wren.id], since: { [wren.id]: { at: 1, where: 'The Mill, Ch 1, Sc 1' } }, at: 1 }
    ]
    const lines = mustStayTrue({ ...crowd, beliefs: two })
    expect(lines.filter((l) => l.includes(' wrongly believes: '))).toEqual([
      "Wren wrongly believes: The mill is safe (it isn't true). Wren takes it as true here unless the scene card says otherwise",
      "Osric Hale wrongly believes: The abbot is alive (it isn't true). Osric Hale takes it as true here unless the scene card says otherwise"
    ])
    expect(lines.filter((l) => l.includes(' wrongly believes: '))).toHaveLength(MUST_BELIEFS)
  })

  it('names a crowd only so far, in a secret kept from many (fix 9 review)', () => {
    const people = Array.from({ length: 6 }, (_, i) => entry('character', `Person ${i}`))
    const facts = [{ factId: 'x', fact: 'The bridge is out', knownBy: [people[0].id, people[1].id, people[2].id, people[3].id, people[4].id] }]
    expect(mustStayTrue(base({ people: [people[0], people[5]], knowers: people, facts, stand: null, reach: 'none' }))).toEqual([
      'Kept from Person 5: The bridge is out (Person 0, Person 1, Person 2 and 2 more know it). Person 5 must not learn, guess or think it here unless the scene card says so'
    ])
    expect(namesUpTo(['A', 'B', 'C', 'D'])).toBe('A, B, C and D')
    expect(namesUpTo(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C and 2 more')
  })

  it('cuts a long value short, never since when it holds', () => {
    const wren = entry('character', 'Wren', { fields: { marks: `scars ${'and more scars '.repeat(40)}`.trim() }, changedWhere: { marks: 'The Mill, Ch 4, Sc 1' } })
    const [line] = mustStayTrue(base({ people: [wren], stand: null, reach: 'none' }))
    expect(line.endsWith('… (since Ch 4, Sc 1)')).toBe(true)
    expect(line.length).toBeLessThan(360)
  })

  it(`is capped at ${MUST_MOST} lines, keeping what matters most; the short form holds ${MUST_SHORT}, what is most likely broken first`, () => {
    const people = Array.from({ length: 8 }, (_, i) => entry('character', `Person ${i}`))
    const stand: SceneState = {
      time: 'noon',
      weather: '',
      light: '',
      characters: people.map((p, i) => ({ ...blank, name: p.name, condition: `bruised ${i}`, where: `room ${i}`, posture: `sitting ${i}` }))
    }
    const facts = [{ factId: 'x', fact: 'The bridge is out', knownBy: [people[0].id] }]
    const lines = mustStayTrue(base({ people, stand, facts }))
    expect(lines).toHaveLength(MUST_MOST)
    // Every injury first, then where people are; positions and the time didn't make the cut.
    for (let i = 0; i < 8; i++) expect(lines).toContain(`Person ${i}: bruised ${i}`)
    expect(lines.join('\n')).not.toContain('sitting')
    expect(lines.join('\n')).not.toContain('Time: ')
    expect(lines.filter((l) => l.startsWith('Kept from '))).toHaveLength(1)
    // The secret and the first injuries lead, in the full form and the short one (2026-10-15).
    expect(lines.slice(0, MUST_KEY)).toEqual([
      // A crowd is named only so far (fix 9 review).
      'Kept from Person 1, Person 2, Person 3 and 4 more: The bridge is out (Person 0 knows it). Person 1, Person 2, Person 3 and 4 more must not learn, guess or think it here unless the scene card says so',
      'Person 0: bruised 0',
      'Person 1: bruised 1',
      'Person 2: bruised 2',
      'Person 3: bruised 3'
    ])
    const short = mustStayTrue(base({ people, stand, facts, short: true }))
    expect(short).toHaveLength(MUST_SHORT)
    expect(short.slice(0, MUST_KEY)).toEqual(lines.slice(0, MUST_KEY))
    // At most a few "does not know" lines.
    const many = Array.from({ length: 6 }, (_, i) => ({ factId: `k${i}`, fact: `Secret ${i}`, knownBy: [people[0].id] }))
    expect(mustStayTrue(base({ people: people.slice(0, 2), stand: null, reach: 'none', facts: many }))).toHaveLength(MUST_GAPS)
  })

  it('says what someone in the scene gave away or lost however long ago, and what they got back: only how it is now', () => {
    const wren = entry('character', 'Wren')
    const osric = entry('character', 'Osric Hale')
    const h = (item: string, has: boolean, at: number, how: string, where: string, extra: Partial<Holding> = {}): Holding => ({
      personId: wren.id,
      person: 'Wren',
      itemId: item,
      item: `the ${item}`,
      words: [item],
      has,
      again: false,
      how,
      where,
      at,
      ...extra
    })
    const compass = h('compass', false, 70, 'gave her brass compass to Mother Agate as a toll', 'The Mill, Ch 2, Sc 7')
    const lines = mustStayTrue(base({ people: [wren, osric], stand: null, reach: 'none', holdings: [compass] }))
    expect(lines).toEqual(['Wren: no longer has the compass (gave her brass compass to Mother Agate as a toll; since Ch 2, Sc 7)'])
    const back = h('compass', true, 200, 'got the compass back from Mother Agate', 'The Mill, Ch 5, Sc 20', { again: true })
    expect(mustStayTrue(base({ people: [wren], stand: null, reach: 'none', holdings: [back] }))).toEqual([
      'Wren: has the compass again (got the compass back from Mother Agate; since Ch 5, Sc 20)'
    ])
    // Only for those in the scene.
    expect(mustStayTrue(base({ people: [osric], stand: null, reach: 'none', holdings: [compass] }))).toEqual([])
    // At most a few, the items the scene names first; what is gone before what is had.
    const many = [
      h('lantern', false, 10, 'dropped the lantern in the weir', 'The Mill, Ch 1, Sc 2'),
      h('bead', true, 90, 'bought a blue glass bead', 'The Mill, Ch 3, Sc 13'),
      h('knife', false, 40, 'lost the knife', 'The Mill, Ch 2, Sc 4'),
      h('ledger', false, 30, 'burned the ledger', 'The Mill, Ch 1, Sc 3'),
      h('map', false, 20, 'gave the map to Osric', 'The Mill, Ch 1, Sc 2'),
      compass
    ]
    const about = 'Fog on the fell. Wren needs a bearing: the compass?'
    const capped = mustStayTrue(base({ people: [wren], stand: null, reach: 'none', holdings: many, about }))
    expect(capped).toHaveLength(MUST_ITEMS)
    expect(capped[0]).toContain('no longer has the compass')
    expect(capped.join('\n')).not.toContain('the bead')
    // The short form keeps one the scene names; in the full form one not named comes after what is worn and held, and
    // before where people are.
    const short = mustStayTrue(base({ people: [wren], holdings: [compass], about, short: true }))
    expect(short).toContain('Wren: no longer has the compass (gave her brass compass to Mother Agate as a toll; since Ch 2, Sc 7)')
    const ranked = mustStayTrue(base({ people: [wren], holdings: [compass] }))
    expect(ranked.findIndex((l) => l.includes('no longer has'))).toBeGreaterThan(ranked.findIndex((l) => l.startsWith('Wren is holding')))
    expect(ranked.findIndex((l) => l.includes('no longer has'))).toBeLessThan(ranked.findIndex((l) => l.startsWith('Where Wren is')))
    // Each line says what it is about, so a scene contract never also keeps what its change list changes (fix 13's review).
    const [line] = mustLines(base({ people: [wren, osric], stand: null, reach: 'none', holdings: [compass] }))
    expect(line.about).toEqual({ holding: compass })
    expect(changedBy(line, ['Mother Agate hands the compass back to Wren'])).toBe(true)
    expect(changedBy(line, ['Wren crosses the fell in the fog'])).toBe(false)
  })

  it('is told only the people in the scene, and a time that still holds; the stage as kept stays whole', () => {
    // The trap run (Adam, 2026-10-07): Bryn and "the boy" from earlier scenes sat in an inn scene's stage.
    const s = stage()
    s.characters.push(
      { ...blank, name: 'Bryn Tally', where: 'gone south in her cart', holding: 'the reins' },
      { ...blank, name: 'the boy', where: 'up the valley with the herd' },
      { ...blank, name: 'Mother Rook', where: 'the kitchen', holding: 'a jug' }
    )
    s.said = { ...s.said, 'bryn tally|holding': { quote: 'took up the reins', sceneId: 'sc-1-1' }, '|light': { quote: 'she lit the candle', sceneId: 'here' } }
    const kept = JSON.parse(JSON.stringify(s)) as SceneState
    const wren = entry('character', 'Wren')
    const osric = entry('character', 'Osric Hale', { aliases: ['the miller'] })
    const cast = [wren, osric, entry('character', 'Bryn Tally'), entry('character', 'Mother Rook'), entry('character', 'Mother Agate')]
    const scope = { sceneId: 'here', timeCarries: false, onCard: [wren], cast, words: 'The miller came up the ladder. Mother Rook called up from the kitchen.' }
    const told = stageInScene(s, scope)!
    // On the card, named by another name, named in the scene's words; not Bryn or the boy from other scenes.
    expect(told.characters.map((c) => c.name)).toEqual(['Wren', 'Osric Hale', 'Mother Rook'])
    expect(told.said?.['bryn tally|holding']).toBeUndefined()
    // The time from the scene before doesn't hold here; the light from this scene's own words does.
    expect(told).toMatchObject({ time: '', weather: '', light: 'one tallow candle' })
    expect(told.said?.['|time']).toBeUndefined()
    expect(stageInScene(s, { ...scope, timeCarries: true })).toMatchObject({ time: 'late evening', weather: 'sleet' })
    // A first name counts only when no one else here shares it: "Mother" could be Mother Agate.
    expect(stageInScene(s, { ...scope, words: 'Mother Agate waved.' })!.characters.map((c) => c.name)).toEqual(['Wren'])
    expect(stageInScene(s, { ...scope, words: 'Bryn came back for her whip.' })!.characters.map((c) => c.name)).toContain('Bryn Tally')
    // Someone only thought of, talked of or told as far away is never in the scene, whatever the stage lists
    // (stand-in test, 2026-10-19); named as there in another line of the words, they are.
    const only = (words: string): string[] => stageInScene(s, { ...scope, words })!.characters.map((c) => c.name)
    expect(only('Wren thought of Mother Rook and her kitchen.')).not.toContain('Mother Rook')
    expect(only('“Mother Rook would know,” Wren said.')).not.toContain('Mother Rook')
    expect(only('Wren thought of Mother Rook.\nMother Rook called up from the kitchen.')).toContain('Mother Rook')
    expect(namedThere('She missed Bryn Tally.', 'Bryn Tally')).toBe(false)
    expect(namedThere('Bryn Tally came in out of the rain.', 'Bryn Tally')).toBe(true)
    // Carrying on with no one on the card: everyone told, no one else.
    const lines = mustStayTrue(base({ stand: told, people: [] })).join('\n')
    expect(lines).toContain('Where Mother Rook is: the kitchen')
    expect(lines).not.toContain('Bryn')
    expect(lines).not.toContain('Time: ')
    expect(s).toEqual(kept)
    expect(stageInScene(null, scope)).toBeNull()
  })

  it('piece by piece: a few pieces of clothing a person and a few things in the place, those the scene names first', () => {
    // Step 2b (Adam, 2026-10-07).
    const s: SceneState = {
      time: '',
      weather: '',
      light: '',
      things: [
        { name: 'the stove', state: 'lit' },
        { name: 'the survey case', state: 'on the windowsill' },
        { name: 'the trapdoor', state: 'shut' },
        { name: 'the back door', state: 'barred from inside' }
      ],
      characters: [
        {
          ...blank,
          name: 'Wren',
          touching: "her hand on Osric's arm",
          sees: "can't see the yard",
          clothes: [
            { name: 'linen shirt', state: 'on' },
            { name: 'wool skirt', state: 'on' },
            { name: 'grey coat', state: 'on, buttoned to the throat' },
            { name: 'boots', state: 'off, by the hatch' },
            { name: 'scarf', state: 'on' }
          ]
        }
      ],
      said: {
        [pieceKey('Wren', 'boots')]: { quote: 'kicked her boots off by the hatch', sceneId: 'here' },
        [thingKey('the survey case')]: { quote: 'set the case on the windowsill', sceneId: 'sc-3-2' }
      }
    }
    const lines = mustStayTrue(base({ stand: s, about: 'Wren pulls her scarf up and reaches for the case.' }))
    const worn = lines.filter((l) => l.startsWith('Wren is wearing') || l.startsWith('Wren: '))
    // At most MUST_CLOTHES a person: the one named, then what is off, then what is on in some way.
    expect(worn).toEqual([
      'Wren is wearing: scarf on',
      'Wren: boots off, by the hatch (since earlier in this scene)',
      'Wren is wearing: grey coat on, buttoned to the throat'
    ])
    expect(worn).toHaveLength(MUST_CLOTHES)
    // At most MUST_THINGS things: the one named, then those changed most lately.
    const things = lines.filter((l) => /^The /.test(l))
    expect(things).toEqual([
      'The survey case: on the windowsill (since Ch 3, Sc 2)',
      'The back door: barred from inside',
      'The trapdoor: shut'
    ])
    expect(things).toHaveLength(MUST_THINGS)
    expect(lines).toContain("Who Wren is touching: her hand on Osric's arm")
    expect(lines).toContain("What Wren can see or hear: can't see the yard")
    // A new scene's start: clothes and the things in the place (the stage has things only when it is the same place),
    // never who touched or saw whom.
    const start = mustStayTrue(base({ stand: s, reach: 'start' })).join('\n')
    expect(start).toContain('The back door: barred from inside')
    expect(start).toContain('Wren: boots off, by the hatch')
    expect(start).not.toContain('touching')
    expect(start).not.toContain('see or hear')
    expect(mustStayTrue(base({ stand: s, reach: 'later' })).join('\n')).not.toContain('The back door')
    // Told only the people in the scene, the things in the place keep their words.
    const told = stageInScene(s, { sceneId: 'here', timeCarries: false, onCard: [{ name: 'Wren', aliases: [] }], cast: [], words: '' })!
    expect(told.said?.[thingKey('the survey case')]?.quote).toBe('set the case on the windowsill')
    expect(
      stageInScene({ ...s, characters: [] }, { sceneId: 'here', timeCarries: false, onCard: [], cast: [], words: '' })?.things
    ).toHaveLength(4)
  })

  it('plain clothes never crowd out what people hold or the things in the place; the short form has one piece a person', () => {
    // The review of step 2b (2026-10-07): two people each with a cloak and boots off and a shirt on, a held case and a
    // barred door, and the short list was six clothing lines.
    const dressed = (name: string, more: Partial<SceneState['characters'][number]> = {}) => ({
      ...blank,
      name,
      clothes: [
        { name: 'cloak', state: 'off, over the chair' },
        { name: 'boots', state: 'off, by the door' },
        { name: 'shirt', state: 'on' }
      ],
      ...more
    })
    const s: SceneState = {
      time: '',
      weather: '',
      light: '',
      things: [{ name: 'the door', state: 'barred from inside' }],
      characters: [dressed('Wren', { holding: 'the survey case' }), dressed('Osric Hale'), dressed('Tobin')]
    }
    const wren = entry('character', 'Wren')
    const osric = entry('character', 'Osric Hale')
    const tobin = entry('character', 'Tobin')
    const short = mustStayTrue(base({ stand: s, people: [wren, osric], short: true }))
    expect(short.length).toBeLessThanOrEqual(MUST_SHORT)
    expect(short).toContain('Wren is holding: the survey case')
    expect(short).toContain('The door: barred from inside')
    expect(short.filter((l) => l.startsWith('Wren: ') || l.startsWith('Wren is wearing'))).toHaveLength(1)
    expect(short.filter((l) => l.startsWith('Osric Hale: ') || l.startsWith('Osric Hale is wearing'))).toHaveLength(1)
    // The full list with three people, each placed too: what is held and the door stay, above plain clothes.
    const placed: SceneState = { ...s, characters: s.characters.map((c) => ({ ...c, where: 'the parlour' })) }
    const full = mustStayTrue(base({ stand: placed, people: [wren, osric, tobin] }))
    expect(full).toHaveLength(MUST_MOST)
    expect(full).toContain('Wren is holding: the survey case')
    expect(full).toContain('The door: barred from inside')
  })

  it('the case slip: the case on the sill comes before what people no longer have, and never beside a strap still on', () => {
    // The trap run (Adam, 2026-10-07): twelve lines of injuries and "no longer has" left out the survey case on the
    // sill, and a case strap still "on, case on her back" was told beside it; the writer put the case against her hip.
    const wren = entry('character', 'Wren Hollis', { fields: { marks: 'burn from wrist to elbow' } })
    const ash = entry('character', 'Ash Penrose', { fields: { marks: 'thin pink line from cheekbone to jaw' } })
    const s: SceneState = {
      time: 'night',
      weather: 'rain',
      light: 'low firelight',
      things: [{ name: 'the survey case', state: 'on the windowsill, flat' }],
      characters: [
        {
          ...blank,
          name: 'Wren Hollis',
          condition: 'burned arm',
          holding: 'the case under her arm; a candle',
          clothes: [
            { name: 'case strap', state: 'on, case on her back, strap buckled' },
            { name: 'bandage', state: 'on, over the burn' }
          ]
        },
        { ...blank, name: 'Ash Penrose', condition: 'wet through' }
      ],
      said: { [thingKey('the survey case')]: { quote: 'She set the case down flat on the sill', sceneId: 'here' } }
    }
    const lost = (person: EntryState, item: string, at: number): Holding => ({
      personId: person.id,
      person: person.name,
      itemId: item,
      item: `the ${item}`,
      words: [item],
      has: false,
      again: false,
      how: `lost the ${item}`,
      where: `The Mill, Ch 1, Sc ${at}`,
      at
    })
    const holdings = [lost(wren, 'survey', 1), lost(wren, 'watch', 2), lost(wren, 'compass', 3), lost(ash, 'pony', 4)]
    const about = 'Wren sleeps an hour with the survey and the watch and the compass on her mind; the pony is at the farrier.'
    const lines = mustStayTrue(base({ stand: s, people: [wren, ash], holdings, about }))
    expect(lines).toContain('The survey case: on the windowsill, flat (since earlier in this scene)')
    expect(lines).toContain('Wren Hollis is holding: a candle')
    expect(lines.join('\n')).not.toContain('case strap')
    expect(lines.join('\n')).not.toContain('under her arm')
    // Short, with less room: what is held and the case on the sill come before what is gone, and that before old marks.
    const short = mustStayTrue(base({ stand: s, people: [wren, ash], holdings, about, short: true }))
    expect(short).toHaveLength(MUST_SHORT)
    expect(short).toContain('The survey case: on the windowsill, flat (since earlier in this scene)')
    expect(short).toContain('Wren Hollis is holding: a candle')
    expect(short.filter((l) => l.includes('no longer has'))).toHaveLength(2)
    expect(short.join('\n')).not.toContain('burn from wrist to elbow')
  })

  it('reads with its lead, or none in the short form', () => {
    expect(mustText(['A', 'B'], 'here')).toBe(`${MUST_LEAD.here}\n- A\n- B`)
    expect(mustText(['A'], 'start')).toBe(`${MUST_LEAD.start}\n- A`)
    expect(mustText(['A'], null)).toBe('- A')
  })
})

// ---------- In the briefing ----------

function draftInput(over: Partial<ContextInput> = {}): ContextInput {
  const wren = entry('character', 'Wren', { fields: { marks: 'a burn scar on her right hand' } })
  const osric = entry('character', 'Osric Hale')
  const loft = entry('place', 'The mill loft')
  const weir = entry('place', 'The weir', { summary: 'Failing stones below the mill.' })
  const hidden = entry('item', 'The ledger', { summary: 'Kept out by Adam.' })
  return {
    style: { ...defaultStyleGuide(), pov: 'Close third person', tense: 'Past tense', spelling: 'UK' },
    scene: { title: 'The hatch', card: { ...emptySceneCard(), povId: wren.id, presentIds: [wren.id, osric.id], locationId: loft.id, beats: ['Osric climbs up'] } },
    memory: {
      storyId: 'mill',
      sceneId: 'here',
      knows: '',
      previous: { sceneId: 'sc-3-2', title: 'Before', text: 'The sleet came on.', storyId: 'mill', storyTitle: 'The Mill', otherStory: null },
      entries: [wren, osric, loft, weir, hidden],
      firstHere: [],
      elsewhere: [],
      relationships: [],
      facts: [],
      threads: [],
      storySoFar: { scenes: [], chapters: [], stories: [], series: [], leadsInto: null },
      bringAbout: []
    },
    pins: [{ id: 'p', entryId: hidden.id, scope: 'scene', scopeId: 'here', action: 'hide' }],
    blockModes: {},
    world: { themes: '', tone: '' },
    series: null,
    story: { title: 'The Mill', premise: '', themes: '', tone: '' },
    options: { direction: '', targetWords: 800, creativity: 'balanced', addBelow: true },
    contextLength: 64_000,
    continuity: stage(),
    continuityAtSoFar: true,
    stageWhere: PLACES,
    ...over
  }
}

describe('what must stay true in a draft', () => {
  it('goes last, right before the instruction to write, with the full briefing above it', () => {
    const p = assembleContext(draftInput(), countRaw)
    const ids = p.blocks.filter((b) => !b.dropped).map((b) => b.id)
    expect(ids.slice(-2)).toEqual(['continuity', MUST_BLOCK])
    const user = p.messages[1].content
    const must = p.blocks.find((b) => b.id === MUST_BLOCK)!
    expect(must.title).toBe('Must stay true')
    expect(must.text.startsWith(MUST_LEAD.here)).toBe(true)
    // The stage block right above says where things stand at this same moment: the list doesn't say it again (Adam,
    // 2026-10-08), and keeps what the stage doesn't say.
    expect(p.blocks.find((b) => b.id === 'continuity')!.text).toContain('left arm in a sling')
    expect(must.text).not.toContain('left arm in a sling')
    expect(must.text).toContain('- Wren: a burn scar on her right hand')
    // Only the closing instruction comes after it, ending with what happens now.
    const at = user.indexOf('## Must stay true')
    expect(user.indexOf('## ', at + 3)).toBe(-1)
    expect(user.slice(at)).toContain('Carry the scene on now, from the end of the scene so far.')
    expect(user.trimEnd().endsWith('Osric climbs up')).toBe(true)
  })

  it('a new scene keeps to how people are as the scene before ended; nothing at all when nothing is known', () => {
    // The same day by both cards' When: injuries, clothes and what people hold.
    const fresh = draftInput({ continuityAtSoFar: false })
    fresh.scene.card.when = 'Day 3, midnight'
    fresh.memory.previous = { ...fresh.memory.previous!, when: 'Day 3, dusk' }
    expect(stageReach(fresh)).toBe('start')
    const text = assembleContext(fresh, countRaw).blocks.find((b) => b.id === MUST_BLOCK)!.text
    expect(text.startsWith(MUST_LEAD.start)).toBe(true)
    expect(text).not.toContain('Where Wren is')
    expect(text).toContain('Wren is wearing: ')
    // A later day, or a gap that isn't known: only how people are.
    const later = draftInput({ continuityAtSoFar: false })
    later.scene.card.when = 'Day 4'
    later.memory.previous = { ...later.memory.previous!, when: 'Day 2, night' }
    expect(stageReach(later)).toBe('later')
    for (const [now, then] of [
      ['Three weeks later', 'Day 2, night'],
      ['', ''],
      ['Spring', 'Winter'],
      ['Day 2', '']
    ]) {
      const gap = draftInput({ continuityAtSoFar: false })
      gap.scene.card.when = now
      gap.memory.previous = { ...gap.memory.previous!, when: then }
      expect(stageReach(gap), `${now} after ${then}`).toBe('later')
    }
    const unknown = draftInput({ continuityAtSoFar: false })
    const lines = assembleContext(unknown, countRaw).blocks.find((b) => b.id === MUST_BLOCK)!.text
    expect(lines).toContain('Wren: left arm in a sling')
    expect(lines).not.toContain('Wren is wearing')
    // Another story before this one: none of its stage.
    const other = draftInput({ continuityAtSoFar: false })
    other.memory.previous = { ...other.memory.previous!, otherStory: { ended: true, timeGap: '' } }
    expect(stageReach(other)).toBe('none')
    const none = draftInput({ continuity: null, continuityAtSoFar: false })
    none.memory.entries = none.memory.entries.map((e) => ({ ...e, fields: {} }))
    expect(prepareContext(none).blocks.find((b) => b.id === MUST_BLOCK)).toBeUndefined()
  })

  it('reads the same day on the story calendar, and keeps to the cards where it can’t tell (fix 11)', () => {
    /** A draft of the last of `whens`, after the one before it, with the whole story's calendar or (`alone`) none. */
    const at = (whens: string[], alone = false): ContextInput => {
      const inp = draftInput({ continuityAtSoFar: false, options: { direction: '', targetWords: 800, creativity: 'balanced' } })
      const n = whens.length
      inp.scene.card.when = whens[n - 1]
      inp.memory.previous = { ...inp.memory.previous!, when: whens[n - 2] }
      if (!alone) {
        const cal = buildCalendar(whens.map((when, i) => ({ id: `s${i + 1}`, story: 'mill', when })))
        inp.calendar = { here: cal.dates.get(`s${n}`)!, previous: cal.dates.get(`s${n - 1}`)!, landmarks: [], ages: [] }
      }
      return inp
    }
    // "That night" is the same day as "Day 3, dusk": what people wear and hold carries.
    expect(stageReach(at(['Day 3, dusk', 'That night'], true))).toBe('start')
    // The same words on two days are two days.
    expect(stageReach(at(['Day 3', 'The next day', 'The next day']))).toBe('later')
    // Only the whole story's calendar knows "The next morning" is Day 4.
    expect(stageReach(at(['Day 3, evening', 'The next morning', 'Day 4, noon']))).toBe('start')
    expect(stageReach(at(['Day 3, evening', 'The next morning', 'Day 4, noon'], true))).toBe('later')
    // Where the calendar can't tell, both cards' "Day N", as before.
    expect(stageReach(at(['Day 3 of the voyage', 'Day 3 of the siege'], true))).toBe('start')
    // The time of day carries at the same moment only.
    const carries = (inp: ContextInput): boolean => stageScope(inp.scene.card, inp.memory, [], inp.calendar).timeCarries
    expect(carries(at(['Day 3, evening', 'Later that evening']))).toBe(true)
    expect(carries(at(['Day 3', 'The next day', 'The next day']))).toBe(false)
    expect(carries(at(['Day 3, evening', 'That night']))).toBe(false)
    expect(carries(at(['Day 5', 'Day 5'], true))).toBe(true)
    expect(carries(at(['Spring', 'Spring'], true))).toBe(true)
  })

  it('tells the story date on the scene card and the time since in what must stay true from the same sums, late (fix 11)', () => {
    const whens = ['Day 3, evening', 'The next morning', 'Three weeks later']
    const cal = buildCalendar(whens.map((when, i) => ({ id: `s${i + 1}`, story: 'mill', when })))
    const plain = draftInput({ continuityAtSoFar: false, options: { direction: '', targetWords: 800, creativity: 'balanced' } })
    plain.scene.card.when = whens[2]
    plain.memory.previous = { ...plain.memory.previous!, when: whens[1] }
    const dated: ContextInput = { ...plain, calendar: { here: cal.dates.get('s3')!, previous: cal.dates.get('s2')!, landmarks: [], ages: [] } }
    const p = assembleContext(dated, countRaw)
    const text = (id: string, q = p): string => q.blocks.find((b) => b.id === id)?.text ?? ''
    expect(text('scene-card')).toContain('When: Three weeks later\nStory date: Day 25 (3 weeks since the scene before)\nMake the time that has passed fit')
    expect(text(MUST_BLOCK)).toContain('Time: 3 weeks since the scene before (Day 4, morning); this scene is Day 25')
    // Every block sent before the scene card reads the same with the calendar or without it (the cache).
    const q = assembleContext(plain, countRaw)
    const before = SEND_ORDER.slice(0, SEND_ORDER.indexOf('scene-card'))
    for (const id of before) expect(text(id), id).toBe(text(id, q))
  })

  it('the compass case: given away in scene 7, still gone at scene 23, though it is long out of her last few events', () => {
    const inp = draftInput({ continuityAtSoFar: false, continuity: null })
    const [wren] = inp.memory.entries
    const agate = entry('character', 'Mother Agate')
    const compass = entry('item', 'The brass compass', { aliases: ["Wren's compass"], summary: "Wren's grandmother's brass pocket compass." })
    const at = (sc: number) => ({ where: `The Mill, Ch ${Math.ceil(sc / 4)}, Sc ${sc}`, at: sc * 10 })
    wren.happened = [
      { note: "gave her grandmother's brass compass to Mother Agate as a toll", changeId: 'c7', ...at(7) },
      ...Array.from({ length: 19 }, (_, i) => ({ note: `walked on through the rain, day ${i}`, changeId: `w${i}`, ...at(8 + i) }))
    ]
    inp.memory.entries = [...inp.memory.entries, agate, compass]
    const p = assembleContext(inp, countRaw)
    const must = p.blocks.find((b) => b.id === MUST_BLOCK)!.text
    expect(must).toContain("- Wren: no longer has the brass compass (gave her grandmother's brass compass to Mother Agate as a toll; since Ch 2, Sc 7)")
    // Osric, there too, never had it: nothing about him.
    expect(must).not.toContain('Osric Hale: no longer')
    // The card doesn't name it, so the entry stays out of the briefing; the list still says it is gone.
    expect(p.entries?.some((e) => e.entryId === compass.id)).toBe(false)
  })

  it('an item is found by its main word on the card, in the beats or in the scene so far, unless another entry shares it', () => {
    const inp = draftInput()
    const compass = entry('item', 'The brass compass')
    inp.memory.entries = [...inp.memory.entries, compass]
    inp.scene.card.beats = ['Fog comes down on the fell; Wren reaches for the compass']
    expect(assembleContext(inp, countRaw).entries?.find((e) => e.entryId === compass.id)).toMatchObject({ why: WHY.beats, blockId: 'mentioned' })
    // Named only in the scene so far that Add below carries on from.
    const soFar = draftInput({ soFar: 'Wren turned the compass over in her hands.' })
    soFar.memory.entries = [...soFar.memory.entries, compass]
    expect(assembleContext(soFar, countRaw).entries?.find((e) => e.entryId === compass.id)).toMatchObject({ why: WHY.soFar })
    // Another entry has "compass" in its name too: "the compass" could be either, so neither is brought in by it.
    const inn = entry('place', 'The Compass Rose')
    const both = draftInput({ soFar: 'Wren turned the compass over in her hands.' })
    both.memory.entries = [...both.memory.entries, compass, inn]
    const got = assembleContext(both, countRaw).entries ?? []
    expect(got.some((e) => e.entryId === compass.id || e.entryId === inn.id)).toBe(false)
    // A common word never finds an item by itself ("eye" for the Dragon's Eye).
    const eye = entry('item', "The Dragon's Eye")
    const common = draftInput({ soFar: 'She rubbed her eye.' })
    common.memory.entries = [...common.memory.entries, eye]
    expect((assembleContext(common, countRaw).entries ?? []).some((e) => e.entryId === eye.id)).toBe(false)
  })

  it('the check of the new words is told the same stage as the writer: no W line about someone from another scene', () => {
    // The trap run (Adam, 2026-10-07): a stale line about "the boy", from an earlier scene, raised a wrong question.
    const inp = draftInput()
    inp.continuity!.characters.push({ ...blank, name: 'the boy', where: 'up the valley with the herd' })
    const lines = stageLines(stageTold({ input: inp }, true))
    expect(lines.some((l) => l.who === 'the boy')).toBe(false)
    expect(lines.some((l) => l.who === 'Wren' && l.field === 'holding')).toBe(true)
    // Nor the time of the scene before, here with no When on either card.
    expect(lines.some((l) => l.field === 'time')).toBe(false)
    expect(assembleContext(inp, countRaw).messages[1].content).not.toContain('the boy')
    // Named in the scene so far: there.
    inp.soFar = 'Wren could hear the boy whistling below.'
    expect(stageLines(stageTold({ input: inp }, true)).some((l) => l.who === 'the boy')).toBe(true)
    // The kept stage is untouched.
    expect(inp.continuity!.characters.at(-1)!.name).toBe('the boy')
  })

  it('the plan goes after the closing instruction, and brings in what it asked for that Adam has not kept out', () => {
    const inp = draftInput()
    const [, , , weir, hidden] = inp.memory.entries
    const p = assembleContext({ ...inp, plan: { needs: [weir.id, hidden.id], text: 'My notes before I write:\n1. Osric climbs up.\nNow the prose itself:' } }, countRaw)
    const user = p.messages[1].content
    expect(user.endsWith('My notes before I write:\n1. Osric climbs up.\nNow the prose itself:')).toBe(true)
    expect(user.indexOf('What happens now')).toBeLessThan(user.indexOf('My notes before I write'))
    expect(p.blocks.find((b) => b.id === PLAN_BLOCK.id)).toMatchObject({ title: PLAN_BLOCK.title, dropped: false })
    // Sent as it is, not under a heading.
    expect(user).not.toContain(`## ${PLAN_BLOCK.title}`)
    expect(p.entries?.find((e) => e.entryId === weir.id)).toMatchObject({ why: WHY.plan, blockId: 'mentioned' })
    expect(user).toContain('The weir')
    expect(p.entries?.find((e) => e.entryId === hidden.id)).toMatchObject({ hidden: true, blockId: null })
    // No plan: nothing after the closing instruction, whose last words are what happens now.
    expect(assembleContext(inp, countRaw).messages[1].content.trimEnd().endsWith('Osric climbs up')).toBe(true)
  })
})

describe('what a scene is most likely to break comes first, and stays (2026-10-15)', () => {
  // A scene crowded with what people wear and hold and the things in the place, beside someone dead, a secret, an
  // injury and days gone by.
  function crowded(over: Partial<MustInput> = {}): MustInput {
    const wren = entry('character', 'Wren')
    const osric = entry('character', 'Osric Hale')
    const abbot = entry('character', 'Abbot Fen', { happened: [{ note: 'Died of the fever.', where: 'The Mill, Ch 2, Sc 1', changeId: 'd' }] })
    const pieces = ['grey cloak', 'linen shirt', 'wool skirt', 'boots', 'gloves']
    const stand: SceneState = {
      time: '',
      weather: '',
      light: '',
      characters: [
        { ...blank, name: 'Wren', holding: 'a lantern', condition: 'left arm in a sling', clothes: pieces.map((name) => ({ name, state: 'on' })) },
        { ...blank, name: 'Osric Hale', holding: 'a ledger', clothes: pieces.map((name) => ({ name: `his ${name}`, state: 'on, wet through' })) }
      ],
      things: [
        { name: 'the door', state: 'barred' },
        { name: 'the lamp', state: 'lit' },
        { name: 'the ledger box', state: 'open on the table' }
      ]
    }
    const facts: FactState[] = [{ factId: 'f', fact: 'The flour tax was forged', knownBy: [wren.id] }]
    return base({ stand, reach: 'start', people: [wren, osric], named: [abbot], facts, elapsed: 'Time: the scene before was Day 3, dusk; this scene is Day 5', ...over })
  }

  it('opens with who is dead, what is kept from someone here, injuries and how much time has passed', () => {
    const lines = mustStayTrue(crowded())
    expect(lines.slice(0, 4)).toEqual([
      'Abbot Fen is dead: Died of the fever (since Ch 2, Sc 1)',
      'Kept from Osric Hale: The flour tax was forged (Wren knows it). Osric Hale must not learn, guess or think it here unless the scene card says so',
      'Wren: left arm in a sling',
      'Time: the scene before was Day 3, dusk; this scene is Day 5'
    ])
    expect(lines.length).toBeLessThanOrEqual(MUST_MOST)
    // The rest still follows: what people hold, the things in the place.
    expect(lines).toContain('Wren is holding: a lantern')
  })

  it('keeps them in its short form, where who knows what used to be left out, and in a smallest form for very little room', () => {
    const short = mustStayTrue(crowded({ short: true }))
    expect(short).toHaveLength(MUST_SHORT)
    expect(short.slice(0, 4)).toEqual(mustStayTrue(crowded()).slice(0, 4))
    const smallest = mustStayTrue(crowded({ smallest: true }))
    expect(smallest).toEqual([
      'Abbot Fen is dead: Died of the fever (since Ch 2, Sc 1)',
      'Kept from Osric Hale: The flour tax was forged (Wren knows it)',
      'Wren: left arm in a sling'
    ])
    expect(smallest).toHaveLength(MUST_SMALLEST)
  })

  it(`holds ${MUST_KEY} of them at most, one of each kind first`, () => {
    const people = Array.from({ length: 6 }, (_, i) => entry('character', `Person ${i}`))
    const stand: SceneState = { time: '', weather: '', light: '', characters: people.map((p, i) => ({ ...blank, name: p.name, condition: `bruised ${i}` })) }
    const lines = mustStayTrue(base({ people, stand, reach: 'later', elapsed: 'Time: the scene before was Day 1; this scene is Day 9' }))
    const key = lines.slice(0, MUST_KEY)
    expect(key[0]).toBe('Person 0: bruised 0')
    // Time passing isn't crowded out by six injuries.
    expect(key).toContain('Time: the scene before was Day 1; this scene is Day 9')
    expect(lines).toHaveLength(7)
  })

  it('says how much time has passed only at a new scene whose When differs from the one before', () => {
    const at = (when: string, before: string, over: Partial<ContextInput> = {}): string => {
      const inp = draftInput({ continuityAtSoFar: false, options: { direction: '', targetWords: 800, creativity: 'balanced' }, ...over })
      inp.scene.card.when = when
      inp.memory.previous = { ...inp.memory.previous!, when: before }
      return timeSince(inp, stageReach(inp))
    }
    expect(at('Day 5', 'Day 3, dusk')).toBe('Time: 2 days since the scene before (Day 3, dusk); this scene is Day 5')
    // Read on the story calendar: that night is the same day; a When it can't read keeps both cards' words.
    expect(at('That night', 'Day 3, dusk')).toBe('Time: the same day as the scene before (Day 3, dusk); this scene is Day 3, night')
    expect(at('Spring', 'Winter')).toBe('Time: the scene before was Winter; this scene is Spring')
    expect(at('Day 3', 'Day 3')).toBe('')
    expect(at('Day 3, dusk', 'Day 3, dusk')).toBe('')
    expect(at('', 'Day 3')).toBe('')
    expect(at('Day 4', '')).toBe('')
    // Carrying on inside the scene: no time has passed.
    expect(at('Day 5', 'Day 3', { continuityAtSoFar: true })).toBe('')
    // A story's first scene after another: that story's time gap.
    const first = draftInput({ continuityAtSoFar: false, options: { direction: '', targetWords: 800, creativity: 'balanced' } })
    first.memory.previous = { ...first.memory.previous!, storyId: 'river', storyTitle: 'River Days', otherStory: { ended: true, timeGap: 'Twenty years.' } }
    expect(timeSince(first, stageReach(first))).toBe('Time since River Days: Twenty years')
  })

  it('is never left out of a draft, however little room there is', () => {
    expect(MUST_PRIORITY).toBe(2)
    for (const contextLength of [3_000, 4_096, 8_000, 64_000]) {
      const inp = draftInput({ contextLength, options: { direction: '', targetWords: 600, creativity: 'balanced', addBelow: true } })
      const p = assembleContext(inp, countRaw)
      const must = p.blocks.find((b) => b.id === MUST_BLOCK)!
      expect({ contextLength, dropped: must.dropped }).toEqual({ contextLength, dropped: false })
      expect(p.messages[1].content).toContain('## Must stay true')
    }
  })
})

// ---------- Clothes and positions across a time jump (code review, 2026-10-16) ----------
// Live on DeepSeek Flash: after a night scene in the inn's upstairs room, a "Day 2, morning, kitchen" scene was told
// "lying on her side under the quilt… dress off, trousers off, keep to this", and every later scene "Mara Venn, typical
// clothing: nothing (since Ch 1, Sc 2)". Invented test text only.

describe('what the scene before left, told only as far as it carries here (2026-10-16)', () => {
  const blankOf = { where: '', posture: '', holding: '', condition: '', mood: '', lastAction: '' }
  /** Where things stand as the night scene ended ('night'): both in bed, most of their clothes off. */
  const night = (): SceneState => ({
    time: 'night',
    weather: 'rain',
    light: 'a candle burning down',
    things: [{ name: 'the candle', state: 'on the washstand, burnt low' }],
    characters: [
      {
        ...blankOf,
        name: 'Mara Venn',
        where: 'the upstairs room, in the narrow bed',
        posture: 'lying on her side under the quilt, her head on his chest',
        touching: 'her head on Ash Penrose’s chest',
        holding: 'nothing',
        condition: 'a bruise on her left knee',
        mood: 'content',
        lastAction: 'fell asleep',
        clothes: [
          { name: 'green dress', state: 'off, over the chair' },
          { name: 'grey stockings', state: 'off, at the foot of the bed' },
          { name: 'silver locket', state: 'on' }
        ]
      },
      {
        ...blankOf,
        name: 'Ash Penrose',
        where: 'the upstairs room, in the narrow bed',
        posture: 'lying on his back, his arm round her shoulders',
        holding: 'his pocket watch',
        clothes: [
          { name: 'trousers', state: 'off, on the floor' },
          { name: 'linen shirt', state: 'off, on the floor' }
        ]
      }
    ],
    said: {
      'mara venn|where': { quote: 'they lay back together on the narrow bed', sceneId: 'night' },
      'mara venn|posture': { quote: 'she lay on her side under the quilt', sceneId: 'night' },
      'mara venn|touching': { quote: 'her head on his chest', sceneId: 'night' },
      'mara venn|condition': { quote: 'a bruise coming up on her knee', sceneId: 'night' },
      'mara venn|clothes:green dress': { quote: 'she stepped out of it and laid it over the chair', sceneId: 'night' },
      'ash penrose|where': { quote: 'they lay back together on the narrow bed', sceneId: 'night' },
      'ash penrose|holding': { quote: 'his watch still in his hand', sceneId: 'night' },
      'ash penrose|clothes:trousers': { quote: 'then his trousers', sceneId: 'night' },
      '|time': { quote: 'the candle burned down', sceneId: 'night' },
      '|thing:candle': { quote: 'the candle burned down', sceneId: 'night' }
    }
  })
  const mara = (): EntryState =>
    entry('character', 'Mara Venn', {
      origin: 'text',
      fields: { clothing: 'nothing', hair: 'loose' },
      changed: ['clothing', 'hair'],
      changedWhere: { clothing: 'The Lantern Inn, Ch 1, Sc 2', hair: 'The Lantern Inn, Ch 1, Sc 2' }
    })
  /** A draft of the scene after the night scene, with these cards' When; `soFar`: carrying on from this stage. */
  const after = (when: string, then: string, soFar?: SceneState): ContextInput => {
    const m = mara()
    const ash = entry('character', 'Ash Penrose')
    const inp = draftInput({
      continuity: soFar ?? night(),
      continuityAtSoFar: !!soFar,
      continuityAtStart: soFar ? night() : undefined,
      stageWhere: { night: 'The Lantern Inn, Ch 1, Sc 2' },
      story: { title: 'The Lantern Inn', premise: '', themes: '', tone: '' },
      options: { direction: '', targetWords: 800, creativity: 'balanced', addBelow: !!soFar }
    })
    inp.memory.entries = [m, ash]
    inp.memory.previous = { ...inp.memory.previous!, sceneId: 'night', when: then }
    inp.scene.card = { ...inp.scene.card, povId: m.id, presentIds: [m.id, ash.id], locationId: null, when, beats: ['Mara helps with breakfast'] }
    return inp
  }
  const blockText = (inp: ContextInput, id: string): string => assembleContext(inp, countRaw).blocks.find((b) => b.id === id)?.text ?? ''

  it('a later day: only injuries and what is in hand; no bed, no pose, no clothes off', () => {
    const inp = after('Day 2, morning', 'Day 1, night')
    expect(stageReach(inp)).toBe('later')
    const stand = blockText(inp, 'continuity')
    expect(stand).toContain('time has passed since')
    expect(stand).toContain('a bruise on her left knee')
    expect(stand).toContain('his pocket watch')
    for (const gone of ['narrow bed', 'lying', 'quilt', 'dress', 'stockings', 'locket', 'trousers', 'content', 'fell asleep', 'candle', 'nothing'])
      expect(stand, gone).not.toContain(gone)
    // Nor the plan's or the check's view of it: the same stage.
    const told = toldStage(inp)!
    expect(told.characters.flatMap((c) => c.clothes ?? [])).toEqual([])
    expect(Object.keys(told.said ?? {}).sort()).toEqual(['ash penrose|holding', 'mara venn|condition'])
    const must = blockText(inp, MUST_BLOCK)
    expect(must).not.toContain('typical clothing')
    expect(must).not.toContain('nothing')
  })

  it('later the same day: how people are, what they hold and what is still on; not where, how placed or what came off', () => {
    const inp = after('Day 1, late night', 'Day 1, night')
    expect(stageReach(inp)).toBe('start')
    const stand = blockText(inp, 'continuity')
    expect(stand).toContain('earlier the same day')
    expect(stand).toContain('a bruise on her left knee')
    expect(stand).toContain('silver locket on')
    expect(stand).toContain('the candle: on the washstand')
    for (const gone of ['narrow bed', 'lying', 'chest', 'dress', 'stockings', 'trousers', 'linen shirt', 'content', 'fell asleep'])
      expect(stand, gone).not.toContain(gone)
    const must = blockText(inp, MUST_BLOCK)
    expect(must).toContain('Mara Venn is wearing: silver locket on')
    expect(must).not.toContain('green dress')
  })

  it('the same moment: all of it', () => {
    const inp = after('Day 1, night', 'Day 1, night')
    const stand = blockText(inp, 'continuity')
    expect(stand.startsWith(STAND_LEAD)).toBe(true)
    for (const kept of ['narrow bed', 'lying on her side', 'green dress off', 'trousers off', 'silver locket on', 'fell asleep']) expect(stand, kept).toContain(kept)
  })

  it('carrying on in the morning scene: what the night left and the morning’s words haven’t said again stays out', () => {
    // The morning's words put Mara in the kitchen and her dress on; the night's stockings, and Ash's clothes, were never
    // said again. The stockings came off without words kept, as they were when the scene began.
    const now = night()
    now.characters[0] = {
      ...now.characters[0],
      where: 'the inn kitchen, by the range',
      posture: 'standing at the table',
      touching: '',
      clothes: [
        { name: 'grey stockings', state: 'off, at the foot of the bed' },
        { name: 'silver locket', state: 'on' },
        { name: 'green dress', state: 'on, laced to the throat' },
        { name: 'apron', state: 'on, borrowed from Mrs Dunn' }
      ]
    }
    now.said = {
      ...now.said,
      'mara venn|where': { quote: 'Mara came down to the kitchen', sceneId: 'here' },
      'mara venn|posture': { quote: 'she stood at the table', sceneId: 'here' },
      'mara venn|clothes:green dress': { quote: 'her green dress laced to the throat', sceneId: 'here' }
    }
    delete now.said['mara venn|touching']
    const inp = after('Day 2, morning', 'Day 1, night', now)
    const stand = blockText(inp, 'continuity')
    expect(stand).toContain('the inn kitchen, by the range')
    expect(stand).toContain('green dress on, laced to the throat')
    // Changed in this scene without words (not as it was when the scene began): this scene's own.
    expect(stand).toContain('apron on')
    for (const gone of ['stockings', 'locket', 'narrow bed', 'trousers', 'linen shirt', 'lying']) expect(stand, gone).not.toContain(gone)
  })

  it('says how people are only as far as it lasts: out of breath or spent is over by another moment', () => {
    // Live, 2026-10-16: "breath ragged, came" was told to the next morning, and kept by the contract as must not change.
    expect(lastingCondition('breath ragged, came')).toBe('')
    // The second live run: "slick", and a wet stocking kept as how she is.
    expect(lastingCondition('slick, catching her breath, asleep')).toBe('')
    expect(lastingCondition('stockings still damp at the ankle from the road')).toBe('')
    expect(lastingCondition('thighs burned, came')).toBe('thighs burned')
    expect(lastingCondition('left arm in a sling and out of breath')).toBe('left arm in a sling')
    expect(lastingCondition('bleeding from the scalp, dizzy')).toBe('bleeding from the scalp')
    expect(lastingCondition('a bruise on her left knee')).toBe('a bruise on her left knee')
    const later = after('Day 2, morning', 'Day 1, night')
    later.continuity!.characters[1].condition = 'breath ragged, a cut on his lip'
    const stand = blockText(later, 'continuity')
    expect(stand).toContain('condition: a cut on his lip')
    expect(stand).not.toContain('ragged')
    const now = after('Day 1, night', 'Day 1, night')
    now.continuity!.characters[1].condition = 'breath ragged, a cut on his lip'
    expect(blockText(now, 'continuity')).toContain('breath ragged, a cut on his lip')
  })

  it('never states typical clothing as a fact of now, though a look changed in the story still is', () => {
    const lines = mustStayTrue(base({ people: [mara()], storyTitle: 'The Lantern Inn' })).join('\n')
    expect(lines).not.toContain('typical clothing')
    expect(lines).not.toContain('usually wears')
    expect(lines).toContain('Mara Venn, hair: loose (since Ch 1, Sc 2)')
  })

  // Memory review, 2026-10-20 (Adam: Mary was told in Ch 3, Sc 2 to wear only a green jumper, and Ch 4 and 5 forgot it).
  const mary = (clothing = 'only the green jumper, from now on'): EntryState =>
    entry('character', 'Mary Dunn', {
      origin: 'text',
      fields: { clothing },
      changed: ['clothing'],
      changedWhere: { clothing: 'The Lantern Inn, Ch 3, Sc 2' }
    })

  it('says what someone usually wears now when the story set it, on a later day too, unless the stage says what is on', () => {
    const later = (people: EntryState[], stand: SceneState | null = null): string =>
      mustStayTrue(base({ stand, reach: 'later', people, storyTitle: 'The Lantern Inn' })).join('\n')
    expect(later([mary()])).toContain('Mary Dunn usually wears: only the green jumper (since Ch 3, Sc 2)')
    // Set at the start (no since), or only undressed for now: never.
    expect(later([entry('character', 'Mary Dunn', { fields: { clothing: 'a grey coat' }, changed: ['clothing'] })])).not.toContain('usually wears')
    expect(later([mary('nothing')])).not.toContain('usually wears')
    // What she has on right now is the stage's, piece by piece.
    const dressed: SceneState = {
      time: '',
      weather: '',
      light: '',
      characters: [{ ...blank, name: 'Mary Dunn', clothes: [{ name: 'green jumper', state: 'off, on the chair' }] }],
      said: { 'mary dunn|clothes:green jumper': { quote: 'the jumper over the chair', sceneId: 'here' } }
    }
    const here = mustStayTrue(base({ stand: dressed, reach: 'here', people: [mary()], storyTitle: 'The Lantern Inn' })).join('\n')
    expect(here).toContain('green jumper off')
    expect(here).not.toContain('usually wears')
    // The short form keeps it: a lasting rule is not a passing detail.
    const short = mustStayTrue(base({ stand: null, reach: 'later', people: [mary()], storyTitle: 'The Lantern Inn', short: true })).join('\n')
    expect(short).toContain('usually wears')
  })

  it('a Ch 4 scene days later is told the green jumper, in must stay true and as a fact in her profile', () => {
    const inp = after('Day 2, morning', 'Day 1, night')
    const m = mary()
    inp.memory.entries = [m, ...inp.memory.entries.slice(1)]
    inp.scene.card = { ...inp.scene.card, povId: m.id, presentIds: [m.id, ...inp.scene.card.presentIds.slice(1)] }
    expect(stageReach(inp)).toBe('later')
    expect(blockText(inp, MUST_BLOCK)).toContain('Mary Dunn usually wears: only the green jumper (since')
    const pov = blockText(inp, 'pov')
    const facts = pov.slice(pov.indexOf('Facts to keep to'))
    expect(facts.slice(0, facts.indexOf('\n\n') > 0 ? facts.indexOf('\n\n') : undefined)).toContain('Typical clothing: only the green jumper')
  })
})

describe('what the scene before left, carried across scenes (memory review, 2026-10-20)', () => {
  /** Mary pulled the green jumper on two scenes back (sc-2); sc-3 ran straight on; this is sc-4. */
  const stand = (): SceneState => ({
    time: 'evening',
    weather: '',
    light: '',
    characters: [{ ...blank, name: 'Mary', where: 'the hall', clothes: [{ name: 'green jumper', state: 'on' }, { name: 'boots', state: 'off, by the door' }] }],
    said: {
      'mary|clothes:green jumper': { quote: 'pulled on the green jumper', sceneId: 'sc-2' },
      'mary|clothes:boots': { quote: 'kicked her boots off by the door', sceneId: 'sc-2' },
      'mary|where': { quote: 'in the hall', sceneId: 'sc-3' }
    }
  })
  const scope = { sceneId: 'sc-4', previousSceneId: 'sc-3', onCard: [{ name: 'Mary', aliases: [] }], cast: [], words: 'Mary waits in the hall.' }
  /** `today`: the scenes before on the same day, by the story calendar. */
  const worn = (carried: 'moment' | 'day' | 'later', today: string[] = ['sc-3', 'sc-2']): string[] =>
    (stageInScene(stand(), { ...scope, timeCarries: carried === 'moment', carried, today: new Set(today) })?.characters[0]?.clothes ?? []).map((p) => p.name)

  it('keeps what is still on however many scenes ago it was put on that day, the same moment or later', () => {
    expect(worn('moment')).toEqual(['green jumper', 'boots'])
    // Later the same day: what is still on, not what came off (she may have put her boots back on).
    expect(worn('day')).toEqual(['green jumper'])
    // A later day: clothes are the scene card's and the profile's to say.
    expect(worn('later')).toEqual([])
  })

  it('never a piece put on days before, however the scenes run on (a hat on indoors, days later)', () => {
    // Scene 2 was an earlier day: only scene 3 is today.
    expect(worn('moment', ['sc-3'])).toEqual([])
    expect(worn('day', ['sc-3'])).toEqual([])
    // Nothing known of the days: only the scene before's words hold, as before.
    expect(worn('moment', [])).toEqual([])
  })
})
