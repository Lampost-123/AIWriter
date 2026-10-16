// The free rule-based checks (long story memory fix 8), each with the cases it must flag and, as much, the ones it must
// not: someone remembered or spoken of, a flashback, a date that isn't known, two people named alike, a record that isn't
// sure. Invented test text only.
import { describe, expect, it } from 'vitest'
import type { Change, EntryState, FactState, ID } from '@shared/types'
import type { SceneState } from '@shared/continuity'
import { ledgerOf } from '../memory/ledger'
import { buildCalendar, goingBack } from '../memory/calendar'
import {
  ageClashes,
  ageGiven,
  agesHere,
  deadHere,
  goneItem,
  inHand,
  itemWords,
  knowsEarly,
  POV_NAMED_WORDS,
  povHere,
  ruleFindings,
  timeBack,
  type RuleScene
} from './rules'

let changeNo = 0
type Happened = { note: string; where?: string; at?: number }
function entry(id: ID, kind: string, name: string, more: Partial<EntryState> & { did?: Happened[] } = {}): EntryState {
  const { did, ...rest } = more
  return {
    id,
    kind,
    name,
    aliases: [],
    summary: '',
    description: '',
    tags: [],
    fields: {},
    parentId: null,
    changed: [],
    happened: (did ?? []).map((h, i) => ({ note: h.note, where: h.where ?? '', at: h.at ?? i, changeId: `c${++changeNo}` })),
    ...rest
  } as never
}

const DIED = { note: 'died in the fire', where: 'Book 1, Ch 1, Sc 2', at: 1 }
const mara = entry('mara', 'character', 'Mara', { fields: { pronouns: 'she/her' } })
const tobin = entry('tobin', 'character', 'Tobin')
const deadTobin = entry('tobin', 'character', 'Tobin', { did: [DIED] })
const ash = entry('ash', 'character', 'Ash')
const compass = entry('compass', 'item', 'The brass compass')

const LABELS: Record<ID, string> = { s2: 'Ch 1, Sc 2', s4: 'Ch 2, Sc 4' }
const AT: Record<string, ID> = { 'Book 1, Ch 1, Sc 2': 's2' }

function scene(over: Partial<RuleScene> = {}): RuleScene {
  const entries = over.entries ?? [mara, tobin]
  return {
    sceneId: 'here',
    text: '',
    card: { povId: null, presentIds: [], notes: '', beats: [], goal: '', conflict: '', outcome: '' },
    placeName: '',
    entries,
    relationships: [],
    people: entries.filter((e) => e.kind === 'character').map((e) => ({ id: e.id, name: e.name, aliases: e.aliases })),
    called: [],
    here: [],
    facts: [],
    ledger: ledgerOf({ facts: over.facts ?? [] }),
    stage: null,
    pov: '',
    place: (w) => w.replace(/^Book 1, /, ''),
    sceneLabel: (id) => LABELS[id] ?? id,
    date: null,
    sceneAt: (w) => AT[w] ?? null,
    dateOf: () => null,
    back: null,
    age: () => null,
    meanwhile: [],
    ...over
  }
}

/** A stage as a scene ends: each character's values, read from `from` (this scene unless said). */
function stage(characters: { name: string; from?: ID; [field: string]: string | undefined }[]): SceneState {
  const said: NonNullable<SceneState['said']> = {}
  const list = characters.map(({ name, from, ...values }) => {
    for (const [k, v] of Object.entries(values)) if (v) said[`${name.toLowerCase()}|${k}`] = { quote: v, sceneId: from ?? 'here' }
    return { name, where: '', posture: '', holding: '', condition: '', mood: '', lastAction: '', ...values }
  })
  return { time: '', weather: '', light: '', characters: list, said }
}

const messages = (s: RuleScene, rule = ruleFindings) => rule(s).map((f) => f.message)

describe('the dead', () => {
  it('flags someone dead before the scene who speaks a line, with the line and where they died', () => {
    const s = scene({ entries: [mara, deadTobin], text: 'Mara pushed the door open. “You took your time,” said Tobin.' })
    const [f] = deadHere(s)
    expect(f).toMatchObject({
      rule: 'dead',
      kind: 'fact',
      severity: 'must-fix',
      quote: '“You took your time,” said Tobin.',
      message: 'Tobin died in Ch 1, Sc 2, but speaks here.',
      entryId: 'tobin'
    })
    expect(f.sources).toEqual([
      { kind: 'entry', entryId: 'tobin', name: 'Tobin', field: null },
      { kind: 'scene', sceneId: 's2', label: 'Ch 1, Sc 2' }
    ])
    // With the card's pronouns.
    const deadMara = entry('mara', 'character', 'Mara', { fields: { pronouns: 'she/her' }, did: [DIED] })
    expect(messages(scene({ entries: [deadMara, tobin], text: '“Go,” Mara said.' }), deadHere)).toEqual(['Mara died in Ch 1, Sc 2; she speaks here.'])
  })

  it('never flags someone remembered, spoken of, or spoken to', () => {
    const remembered = [
      'Mara thought of Tobin, and of the fire.',
      '“Tobin would have laughed,” Mara said.',
      '“Where is Tobin?” Mara asked.',
      'Tobin had said, “Never go back.”',
      'She remembered how Tobin said, “Go.”'
    ]
    for (const text of remembered) expect(deadHere(scene({ entries: [mara, deadTobin], text }))).toEqual([])
  })

  it('leaves a flashback, and a scene dated before the death, alone; an unknown date still counts by reading order', () => {
    const text = '“You took your time,” said Tobin.'
    const cal = buildCalendar([
      { id: 's2', story: 'b', when: 'Day 5' },
      { id: 'here', story: 'b', when: 'Flashback: Day 2' }
    ])
    expect(deadHere(scene({ entries: [deadTobin], text, date: cal.dates.get('here')!, dateOf: (id) => cal.dates.get(id) ?? null }))).toEqual([])
    // Dated before it without saying so (time-back says that): Tobin is alive then.
    const earlier = buildCalendar([
      { id: 's2', story: 'b', when: 'Day 5' },
      { id: 'here', story: 'b', when: 'Day 2' }
    ])
    expect(deadHere(scene({ entries: [deadTobin], text, date: earlier.dates.get('here')!, dateOf: (id) => earlier.dates.get(id) ?? null }))).toEqual([])
    // No dates at all: the memory has him dead before this scene, so it counts.
    expect(deadHere(scene({ entries: [deadTobin], text }))).toHaveLength(1)
  })

  it('leaves a dream, a ghost, a memory or a vision alone: in the line’s paragraph, on the card or in the When', () => {
    const line = '“You took your time,” said Tobin.'
    for (const text of [`In the dream, the stairs went on forever. ${line}`, `She remembered that night. ${line}`, `Tobin’s ghost stood by the fire. ${line}`])
      expect(deadHere(scene({ entries: [mara, deadTobin], text }))).toEqual([])
    // A paragraph of its own: the dream ends, and he speaks in the next.
    expect(deadHere(scene({ entries: [mara, deadTobin], text: `In the dream, the stairs went on forever.\nMara woke. ${line}` }))).toHaveLength(1)
    const card = (c: object) => ({ povId: 'tobin', presentIds: ['tobin'], notes: '', beats: [], goal: '', conflict: '', outcome: '', ...c })
    expect(deadHere(scene({ entries: [mara, deadTobin], text: line, card: card({ notes: 'Tobin’s ghost visits Mara.' }) }))).toEqual([])
    expect(deadHere(scene({ entries: [mara, deadTobin], text: line, card: card({ beats: ['Mara has a vision of the fire'] }) }))).toEqual([])
    expect(deadHere(scene({ entries: [mara, deadTobin], text: 'Rain.', card: card({ when: 'In a dream, Day 9' }) }))).toEqual([])
    expect(deadHere(scene({ entries: [mara, deadTobin], text: 'Rain.', card: card({}) }))).toHaveLength(1)
  })

  it('counts a scene the same day as the death as before it only when its time certainly comes first', () => {
    const text = '“You took your time,” said Tobin.'
    const at = (when: string) => {
      const cal = buildCalendar([
        { id: 's2', story: 'b', when: 'Day 3, 11pm' },
        { id: 'here', story: 'b', when }
      ])
      return scene({ entries: [deadTobin], text, date: cal.dates.get('here')!, dateOf: (id) => cal.dates.get(id) ?? null })
    }
    // "Night" may be the same hour as 11pm: not certainly before, so it still counts.
    expect(deadHere(at('Day 3, night'))).toHaveLength(1)
    expect(deadHere(at('Day 3, morning'))).toEqual([])
  })

  it('says nothing of a death the memory isn’t sure of, or one undone since', () => {
    const text = '“You took your time,” said Tobin.'
    const presumed = entry('tobin', 'character', 'Tobin', { did: [{ note: 'presumed dead after the wreck', where: 'Book 1, Ch 1, Sc 2' }] })
    const back = entry('tobin', 'character', 'Tobin', { did: [DIED, { note: 'not dead after all: found in the reeds', where: 'Book 1, Ch 1, Sc 3' }] })
    expect(deadHere(scene({ entries: [presumed], text }))).toEqual([])
    expect(deadHere(scene({ entries: [back], text }))).toEqual([])
  })

  it('tells two people named alike apart', () => {
    const deadMara = entry('mara', 'character', 'Mara', { did: [DIED] })
    const venn = entry('venn', 'character', 'Mara Venn')
    expect(deadHere(scene({ entries: [deadMara, venn], text: '“Go,” said Mara Venn.' }))).toEqual([])
    // An other name two people go by names neither.
    const captainA = entry('tobin', 'character', 'Tobin', { aliases: ['the Captain'], did: [DIED] })
    const captainB = entry('ash', 'character', 'Ash', { aliases: ['the Captain'] })
    expect(deadHere(scene({ entries: [captainA, captainB], text: '“Hold fast,” said the Captain.' }))).toEqual([])
  })

  it('flags someone dead up and about on the stage from this scene’s words, never a body or an earlier scene’s', () => {
    const s = (st: SceneState) => scene({ entries: [mara, deadTobin], text: 'Tobin climbed the stairs.', stage: st })
    expect(deadHere(s(stage([{ name: 'Tobin', lastAction: 'Tobin climbed the stairs' }])))).toMatchObject([
      { severity: 'must-fix', quote: 'Tobin climbed the stairs', message: 'Tobin died in Ch 1, Sc 2, but is up and about here.' }
    ])
    expect(deadHere(s(stage([{ name: 'Tobin', condition: 'dead, laid out on the table', posture: 'lying still' }])))).toEqual([])
    expect(deadHere(s(stage([{ name: 'Tobin', lastAction: 'climbed the stairs', from: 'earlier' }])))).toEqual([])
  })

  it('says it once a person, from the strongest sign: a line, then the point of view, then the card', () => {
    const card = (povId: ID | null, presentIds: ID[]) => ({ povId, presentIds, notes: '', beats: [], goal: '', conflict: '', outcome: '' })
    expect(messages(scene({ entries: [mara, deadTobin], text: '“Go,” said Tobin.', card: card('tobin', ['tobin']) }), deadHere)).toEqual([
      'Tobin died in Ch 1, Sc 2, but speaks here.'
    ])
    expect(deadHere(scene({ entries: [mara, deadTobin], text: 'Rain.', card: card('tobin', []) }))).toMatchObject([
      { severity: 'warning', message: 'Tobin died in Ch 1, Sc 2, but is this scene’s point of view.', quote: '' }
    ])
    expect(messages(scene({ entries: [mara, deadTobin], text: 'Rain.', card: card('mara', ['tobin']) }), deadHere)).toEqual([
      'Tobin died in Ch 1, Sc 2, but is on this scene’s card.'
    ])
  })
})

describe('things in hand', () => {
  const items = [mara, tobin, compass]

  it('flags one thing in two people’s hands at the end of the scene, from this scene’s words', () => {
    const st = stage([
      { name: 'Mara', holding: 'the brass compass' },
      { name: 'Tobin', holding: 'the compass, in his fist' }
    ])
    expect(inHand(scene({ entries: items, stage: st, text: 'Mara held the brass compass. Tobin had the compass, in his fist.' }))).toMatchObject([
      { rule: 'two-hands', kind: 'continuity', message: 'Mara and Tobin both hold the brass compass at the end of this scene.', quote: 'the compass, in his fist' }
    ])
  })

  it('never flags a thing held together, one held in an earlier scene, nothing held, or no stage', () => {
    const run = (st: SceneState | null) => inHand(scene({ entries: items, stage: st, text: 'x' }))
    expect(run(stage([{ name: 'Mara', holding: 'the brass compass' }, { name: 'Tobin', holding: 'the brass compass, both of them pulling' }]))).toEqual([])
    expect(run(stage([{ name: 'Mara', holding: 'the brass compass' }, { name: 'Tobin', holding: 'the brass compass', from: 'earlier' }]))).toEqual([])
    expect(run(stage([{ name: 'Mara', holding: 'the brass compass' }, { name: 'Tobin', holding: 'nothing' }]))).toEqual([])
    expect(run(null)).toEqual([])
  })

  it('flags a thing the memory has destroyed or lost held here, unless something since brings it back', () => {
    const st = stage([{ name: 'Tobin', holding: 'the brass compass' }])
    const smashed = entry('compass', 'item', 'The brass compass', { did: [{ note: 'smashed against the rocks', where: 'Book 1, Ch 1, Sc 2' }] })
    expect(messages(scene({ entries: [mara, tobin, smashed], stage: st, text: 'x' }), inHand)).toEqual([
      'The brass compass was destroyed in Ch 1, Sc 2, but Tobin holds it here.'
    ])
    const lost = entry('compass', 'item', 'The brass compass', { did: [{ note: 'lost in the river', where: 'Book 1, Ch 1, Sc 2' }] })
    expect(messages(scene({ entries: [mara, tobin, lost], stage: st, text: 'x' }), inHand)).toEqual([
      'The brass compass was lost in Ch 1, Sc 2 and not found since, but Tobin holds it here.'
    ])
    const found = entry('compass', 'item', 'The brass compass', { did: [{ note: 'lost in the river' }, { note: 'found in the reeds by Ash' }] })
    expect(inHand(scene({ entries: [mara, tobin, found], stage: st, text: 'x' }))).toEqual([])
    const both = entry('compass', 'item', 'The brass compass', { did: [{ note: 'lost in the river and found again by Ash' }] })
    expect(inHand(scene({ entries: [mara, tobin, both], stage: st, text: 'x' }))).toEqual([])
    // Lost to someone isn't gone; and a scene whose memory says something of it brings it back there.
    const won = entry('compass', 'item', 'The brass compass', { did: [{ note: 'lost to Bryn at cards' }] })
    expect(inHand(scene({ entries: [mara, tobin, won], stage: st, text: 'x' }))).toEqual([])
    const here = [{ kind: 'update', entryId: 'compass', payload: { note: 'dug out of the mud' } } as unknown as Change]
    expect(inHand(scene({ entries: [mara, tobin, lost], stage: st, here, text: 'x' }))).toEqual([])
  })

  it('never counts a body’s grip, a ghost’s or a dream’s as a hand', () => {
    const dagger = entry('dagger', 'item', 'The bone dagger')
    const both = (tobinHolds: string, more: object = {}) =>
      inHand(scene({ entries: [mara, deadTobin, dagger], stage: stage([{ name: 'Mara', holding: 'the bone dagger' }, { name: 'Tobin', holding: tobinHolds, ...more }]), text: 'x' }))
    expect(both('the bone dagger, still gripped')).toEqual([])
    const living = [mara, tobin, dagger]
    const run = (tobinHolds: string, more: object = {}) =>
      inHand(scene({ entries: living, stage: stage([{ name: 'Mara', holding: 'the bone dagger' }, { name: 'Tobin', holding: tobinHolds, ...more }]), text: 'x' }))
    expect(run('the bone dagger', { condition: 'dead, slumped over the table' })).toEqual([])
    expect(run('the bone dagger, in a dream')).toEqual([])
    expect(run('the bone dagger')).toHaveLength(1)
  })

  it('never finds one thing by a bare word another thing has in its name', () => {
    const letter = entry('letter', 'item', 'The letter')
    const bryns = entry('bryns', 'item', 'Bryn’s letter')
    expect(itemWords([letter, bryns], new Map()).get('letter')).toEqual(['The letter'])
    const st = stage([
      { name: 'Mara', holding: 'the letter' },
      { name: 'Tobin', holding: 'Bryn’s letter' }
    ])
    expect(inHand(scene({ entries: [mara, tobin, letter, bryns], stage: st, text: 'x' }))).toEqual([])
    const key = entry('key', 'item', 'The key')
    const cellar = entry('cellar', 'item', 'The cellar key')
    const keys = stage([
      { name: 'Mara', holding: 'the key' },
      { name: 'Tobin', holding: 'the cellar key' }
    ])
    expect(inHand(scene({ entries: [mara, tobin, key, cellar], stage: keys, text: 'x' }))).toEqual([])
  })

  it('leaves a thing destroyed later alone in a flashback, or a scene dated before it went', () => {
    const smashed = entry('compass', 'item', 'The brass compass', { did: [{ note: 'smashed against the rocks', where: 'Book 1, Ch 1, Sc 2' }] })
    const st = stage([{ name: 'Tobin', holding: 'the brass compass' }])
    const cal = buildCalendar([
      { id: 's2', story: 'b', when: 'Day 5' },
      { id: 'here', story: 'b', when: 'Flashback: Day 1' }
    ])
    expect(inHand(scene({ entries: [mara, tobin, smashed], stage: st, text: 'x', date: cal.dates.get('here')!, dateOf: (id) => cal.dates.get(id) ?? null }))).toEqual([])
  })

  it('reads a character’s own note that they destroyed it, and someone getting it later', () => {
    const heads = ['The brass compass', 'brass compass', 'compass']
    const smasher = entry('mara', 'character', 'Mara', { did: [{ note: 'smashed the brass compass on the hearth', where: 'Book 1, Ch 1, Sc 2', at: 1 }] })
    expect(goneItem(compass, [smasher, compass], [], heads)).toEqual({ how: 'destroyed', where: 'Book 1, Ch 1, Sc 2' })
    const finder = entry('ash', 'character', 'Ash', { did: [{ note: 'took the compass from the ruins', at: 2 }] })
    expect(goneItem(compass, [smasher, finder, compass], [], heads)).toBeNull()
    // "Lost her temper" is no thing lost.
    expect(goneItem(compass, [entry('mara', 'character', 'Mara', { did: [{ note: 'lost her temper' }] }), compass], [], heads)).toBeNull()
  })
})

describe('the point of view', () => {
  const card = { povId: 'mara', presentIds: [], notes: '', beats: [], goal: '', conflict: '', outcome: '' }
  const long = (body: string) => Array.from({ length: Math.ceil(POV_NAMED_WORDS / 10) + 1 }, () => body).join(' ')

  it('flags a point of view another scene has somewhere else at the same clock time', () => {
    const cal = buildCalendar([{ id: 'here', story: 'b', when: 'Day 3, 9pm' }])
    const s = scene({ card, placeName: 'the Castle', date: cal.dates.get('here')!, meanwhile: [{ sceneId: 's4', label: 'Ch 2, Sc 4', people: ['mara'], place: 'the Inn' }] })
    expect(povHere(s)).toMatchObject([
      {
        rule: 'pov-elsewhere',
        kind: 'timeline',
        message: 'Mara is the point of view here, at the Castle, but Ch 2, Sc 4 has her at the Inn at the same moment (Day 3 · 9pm).',
        sources: [
          { kind: 'entry', entryId: 'mara' },
          { kind: 'scene', sceneId: 's4' }
        ]
      }
    ])
    // Not when she isn't there, nor in a flashback.
    expect(povHere({ ...s, meanwhile: [{ ...s.meanwhile[0], people: ['tobin'] }] })).toEqual([])
    const back = buildCalendar([{ id: 'here', story: 'b', when: 'Flashback: Day 3, 9pm' }])
    expect(povHere({ ...s, date: back.dates.get('here')! })).toEqual([])
    // Nor in a dream.
    expect(povHere({ ...s, card: { ...card, notes: 'Mara dreams she is in the Castle.' } })).toEqual([])
  })

  it('flags a long third-person scene that never names its point of view, as minor', () => {
    expect(povHere(scene({ card, text: long('The rain came down on the roofs of the town all night.') }))).toMatchObject([
      { rule: 'pov-unnamed', severity: 'minor', message: 'Mara is this scene’s point of view, but the scene never names her.' }
    ])
  })

  it('never flags a scene that names them however it does, a short one, or one told in the first person', () => {
    const rain = 'The rain came down on the roofs of the town all night.'
    expect(povHere(scene({ card, text: `${long(rain)} Mara slept.` }))).toEqual([])
    const red = { ...mara, aliases: ['Red'] }
    expect(povHere(scene({ card, entries: [red, tobin], text: `${long(rain)} Red slept.` }))).toEqual([])
    expect(povHere(scene({ card, called: [{ entryId: 'mara', words: 'the girl' }], text: `${long(rain)} The girl slept.` }))).toEqual([])
    expect(povHere(scene({ card, text: rain }))).toEqual([])
    expect(povHere(scene({ card, text: `${long(rain)} I slept, and my dreams kept me up.` }))).toEqual([])
    expect(povHere(scene({ card, pov: 'First person, past tense', text: long(rain) }))).toEqual([])
    // Dead: the dead rule says it.
    expect(povHere(scene({ card, entries: [entry('mara', 'character', 'Mara', { did: [DIED] })], text: long(rain) }))).toEqual([])
  })
})

describe('time running backwards', () => {
  it('flags a scene dated before the scene before it, with how far, and says how to mark a flashback', () => {
    const cal = buildCalendar([
      { id: 's2', story: 'b', when: 'Day 6' },
      { id: 'here', story: 'b', when: 'Day 4' }
    ])
    const [back] = goingBack(cal)
    const s = scene({ date: cal.dates.get('here')!, dateOf: (id) => cal.dates.get(id) ?? null, back: { beforeId: back.beforeId, elapsed: back.elapsed } })
    expect(timeBack(s)).toMatchObject([
      {
        rule: 'time-back',
        kind: 'timeline',
        message: 'This scene is dated Day 4, 2 days before the scene before it (Ch 1, Sc 2: Day 6). If it’s a flashback, start its When with “Flashback”.',
        sources: [{ kind: 'scene', sceneId: 's2', label: 'Ch 1, Sc 2' }]
      }
    ])
  })

  it('says nothing when the calendar doesn’t say it goes back (a flashback, or a date it can’t place)', () => {
    for (const when of ['Flashback: Day 4', 'after the wedding', '']) {
      const cal = buildCalendar([
        { id: 's2', story: 'b', when: 'Day 6' },
        { id: 'here', story: 'b', when }
      ])
      expect(goingBack(cal)).toEqual([])
    }
    expect(timeBack(scene())).toEqual([])
  })
})

describe('ages', () => {
  const was = { age: { lo: 39, hi: 40, about: false }, basis: "34 at the story's start", born: false, given: 34 }

  it('flags an age set in this scene, or given on the card, a year or more from what the memory works out', () => {
    const here = [{ kind: 'update', entryId: 'mara', payload: { note: 'turned thirty-five', fields: { age: '35' } } } as unknown as Change]
    expect(agesHere(scene({ here, age: () => was }))).toMatchObject([
      {
        rule: 'age',
        kind: 'timeline',
        message: 'Mara is 35 here, but the memory says 34 at the story’s start, so 39 or 40 by now.',
        sources: [{ kind: 'entry', entryId: 'mara', field: 'age' }],
        field: 'age'
      }
    ])
    const card = { povId: 'mara', presentIds: [], notes: 'Mara, 35, waits by the gate.', beats: [], goal: '', conflict: '', outcome: '' }
    expect(messages(scene({ card, age: () => was }), agesHere)).toEqual(['The scene card says Mara is 35, but the memory says 34 at the story’s start, so 39 or 40 by now.'])
  })

  it('never flags an age that fits, a guess, the past, or one the memory can’t work out', () => {
    const at = (age: string) => [{ kind: 'update', entryId: 'mara', payload: { note: '', fields: { age } } } as unknown as Change]
    expect(agesHere(scene({ here: at('40'), age: () => was }))).toEqual([])
    expect(agesHere(scene({ here: at('about 35'), age: () => was }))).toEqual([])
    expect(agesHere(scene({ here: at('35'), age: () => null }))).toEqual([])
    const card = { povId: 'mara', presentIds: [], notes: 'Mara was 5 when the war began.', beats: [], goal: '', conflict: '', outcome: '' }
    expect(agesHere(scene({ card, age: () => was }))).toEqual([])
  })

  it('reads an age a text gives, and allows a year either way when the sum is only about right', () => {
    expect(ageGiven('Mara (17) waits.', ['Mara'])).toBe(17)
    expect(ageGiven('Then Mara is seventeen.', ['Mara'])).toBe(17)
    expect(ageGiven('A seventeen-year-old Mara waits.', ['Mara'])).toBe(17)
    expect(ageGiven('Mara is 17 minutes late.', ['Mara'])).toBeNull()
    expect(ageGiven('Mara is ready.', ['Mara'])).toBeNull()
    expect(ageClashes(38, { lo: 39, hi: 40, about: false })).toBe(true)
    expect(ageClashes(38, { lo: 39, hi: 40, about: true })).toBe(false)
    expect(ageClashes(37, { lo: 39, hi: 40, about: true })).toBe(true)
  })
})

describe('knowing too soon', () => {
  const heir: FactState = { factId: 'f1', fact: 'Mara is the heir.', knownBy: ['ash'], backed: true, at: 1, since: {} }
  const saidBy = (who: ID, kind = 'secret', more: object = {}) =>
    ({
      kind: 'knowledge',
      entryId: who,
      payload: { factId: 'f1', fact: 'Mara is the heir', said: { kind, by: 'tobin', words: '“Mara is the heir,” Tobin said.', heard: ['ash'] }, ...more }
    }) as unknown as Change
  const text = 'Ash waited. “Mara is the heir,” Tobin said.'
  const s = (over: Partial<RuleScene>) => scene({ entries: [mara, tobin, ash], facts: [heir], text, here: [saidBy('tobin'), saidBy('ash')], ...over })

  it('flags someone who tells a secret the memory has no sign they learned, when others knew it', () => {
    expect(knowsEarly(s({}))).toMatchObject([
      {
        rule: 'knows-early',
        kind: 'knowledge',
        quote: '“Mara is the heir,” Tobin said.',
        message: 'Tobin says “Mara is the heir” here, but nothing in the memory shows Tobin learning it first. Ash knows it.',
        entryId: 'tobin'
      }
    ])
  })

  it('counts a learning in a scene told later but dated before this one, and never asks in a flashback or a memory', () => {
    const cal = buildCalendar([
      { id: 'here', story: 'b', when: 'Day 5' },
      { id: 'later', story: 'b', when: 'Flashback: Day 2' },
      { id: 'after', story: 'b', when: 'Day 9' }
    ])
    const dated = { date: cal.dates.get('here')!, dateOf: (id: ID) => cal.dates.get(id) ?? null }
    expect(knowsEarly(s({ ...dated, learnedIn: () => ['later'] }))).toEqual([])
    expect(knowsEarly(s({ ...dated, learnedIn: () => ['after'] }))).toHaveLength(1)
    // Undated: reading order decides, as the ledger does.
    expect(knowsEarly(s({ learnedIn: () => ['later'] }))).toHaveLength(1)
    const back = buildCalendar([{ id: 'here', story: 'b', when: 'Flashback: Day 5' }])
    expect(knowsEarly(s({ date: back.dates.get('here')! }))).toEqual([])
    expect(knowsEarly(s({ text: 'She remembered it all. “Mara is the heir,” Tobin said.' }))).toEqual([])
  })

  it('never flags someone who knew it, learned it earlier in the scene, or a record that isn’t sure', () => {
    // Knew it as the scene began.
    expect(knowsEarly(s({ facts: [{ ...heir, knownBy: ['ash', 'tobin'] }] }))).toEqual([])
    // Told earlier in the scene.
    const told = { kind: 'knowledge', entryId: 'tobin', payload: { factId: 'f1', fact: 'Mara is the heir', how: 'told', from: 'ash' } } as unknown as Change
    expect(knowsEarly(s({ here: [told, saidBy('tobin')] }))).toEqual([])
    // Who knows it doesn't rest on who was there; no one knew it (he starts it); a promise; how the words say he learned it.
    expect(knowsEarly(s({ facts: [{ ...heir, backed: false }] }))).toEqual([])
    expect(knowsEarly(s({ facts: [] }))).toEqual([])
    expect(knowsEarly(s({ here: [saidBy('tobin', 'promise')] }))).toEqual([])
    expect(knowsEarly(s({ here: [saidBy('tobin', 'secret', { how: 'guessed' })] }))).toEqual([])
    // A secret about himself.
    expect(knowsEarly(s({ facts: [{ ...heir, fact: 'Tobin is the heir.' }] }))).toEqual([])
  })
})

describe('every rule', () => {
  it('runs them all and keeps going past one that fails', () => {
    const s = scene({ entries: [mara, deadTobin], text: '“Go,” said Tobin.' })
    const broken = {
      ...s,
      get stage(): never {
        throw new Error('broken')
      }
    }
    expect(ruleFindings(broken as RuleScene).map((f) => f.rule)).toEqual(['dead'])
  })
})
