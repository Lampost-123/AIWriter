// What must stay true (step 4): built by the app from the stage and the codex entries in the scene, current values
// only, each with since when, capped, and sent right before the instruction to write. Invented test text only.
import { describe, expect, it } from 'vitest'
import type { EntryKind, EntryState, FactState } from '@shared/types'
import { defaultStyleGuide, emptySceneCard } from '@shared/defaults'
import type { SceneState } from '@shared/continuity'
import { MUST_GAPS, MUST_LEAD, MUST_MOST, MUST_SHORT, mustStayTrue, mustText, shortPlace, stageFor, type MustInput } from './mustStay'
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
    expect(lines).toContain('Wren is wearing: linen shirt, wool skirt, cloak off (over the beam) (since earlier in this scene)')
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

  it("from the codex: marks always, and a look changed during the story only as it is now, with where it changed", () => {
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
