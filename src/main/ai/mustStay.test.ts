// What must stay true (step 4): built by the app from the stage and the codex entries in the scene, current values
// only, each with since when, capped, and sent right before the instruction to write. Invented test text only.
import { describe, expect, it } from 'vitest'
import type { EntryKind, EntryState, FactState } from '@shared/types'
import { defaultStyleGuide, emptySceneCard } from '@shared/defaults'
import { pieceKey, thingKey, type SceneState } from '@shared/continuity'
import {
  MUST_CLOTHES,
  MUST_THINGS,
  MUST_GAPS,
  MUST_ITEMS,
  MUST_LEAD,
  MUST_MOST,
  MUST_SHORT,
  mustStayTrue,
  mustText,
  shortPlace,
  stageFor,
  stageInScene,
  type MustInput
} from './mustStay'
import { stageTold } from '../repair'
import { stageLines } from '../repair/prompts'
import type { Holding } from '../memory/items'
import { assembleContext, MUST_BLOCK, PLAN_BLOCK, prepareContext, stageReach, WHY, type ContextInput } from './context'
import { countRaw } from './tokens'

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
    // Person by person, then the scene.
    expect(lines.findIndex((l) => l.startsWith('Osric'))).toBeGreaterThan(lines.findLastIndex((l) => l.includes('Wren')))
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

  it('cuts a long value short, never since when it holds', () => {
    const wren = entry('character', 'Wren', { fields: { marks: `scars ${'and more scars '.repeat(40)}`.trim() }, changedWhere: { marks: 'The Mill, Ch 4, Sc 1' } })
    const [line] = mustStayTrue(base({ people: [wren], stand: null, reach: 'none' }))
    expect(line.endsWith('… (since Ch 4, Sc 1)')).toBe(true)
    expect(line.length).toBeLessThan(360)
  })

  it(`is capped at ${MUST_MOST} lines, keeping what matters most; the short form holds ${MUST_SHORT}, none of who knows what`, () => {
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
    const short = mustStayTrue(base({ people, stand, facts, short: true }))
    expect(short).toHaveLength(MUST_SHORT)
    expect(short.join('\n')).not.toContain('Kept from ')
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
    expect(must.text).toContain('- Wren: left arm in a sling (since Ch 2, Sc 4)')
    expect(must.text).toContain('- Wren: a burn scar on her right hand')
    // Only the closing instruction comes after it.
    const at = user.indexOf('## Must stay true')
    expect(user.indexOf('## ', at + 3)).toBe(-1)
    expect(user.slice(at)).toContain('Carry the scene on now, from the end of the scene so far.')
    expect(user.trimEnd().endsWith('- Never contradict the facts given above.')).toBe(true)
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
    expect(user.indexOf('- Never contradict the facts given above.')).toBeLessThan(user.indexOf('My notes before I write'))
    expect(p.blocks.find((b) => b.id === PLAN_BLOCK.id)).toMatchObject({ title: PLAN_BLOCK.title, dropped: false })
    // Sent as it is, not under a heading.
    expect(user).not.toContain(`## ${PLAN_BLOCK.title}`)
    expect(p.entries?.find((e) => e.entryId === weir.id)).toMatchObject({ why: WHY.plan, blockId: 'mentioned' })
    expect(user).toContain('The weir')
    expect(p.entries?.find((e) => e.entryId === hidden.id)).toMatchObject({ hidden: true, blockId: null })
    // No plan: nothing after the closing instruction.
    expect(assembleContext(inp, countRaw).messages[1].content.trimEnd().endsWith('- Never contradict the facts given above.')).toBe(true)
  })
})
