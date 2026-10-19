// Each scene's contract (long story memory fix 13): what must be true at the start, what must change and what must not
// change, built by the app from what must stay true's own lines and the scene card (or the plan). Invented test text only.
import { describe, expect, it } from 'vitest'
import type { EntryKind, EntryState, FactState } from '@shared/types'
import { defaultStyleGuide, emptySceneCard } from '@shared/defaults'
import type { SceneState } from '@shared/continuity'
import { assembleContext, MUST_BLOCK, MUST_PRIORITY, prepareContext, SEND_ORDER, type ContextInput } from './context'
import { countRaw } from './tokens'
import {
  CONTRACT_BLOCK,
  CONTRACT_LEAD,
  CONTRACT_MOST,
  contractSays,
  contractText,
  contractWanted,
  mostlyIn,
  changedBy,
  mustChange,
  partTitle,
  saysFact,
  sceneContract,
  toneOnly,
  type ContractFrom
} from './contract'
import type { MustLine } from './mustStay'

let seq = 0
const person = (name: string, extra: Partial<EntryState> = {}): EntryState =>
  ({ id: `p${++seq}`, kind: 'character' as EntryKind, name, aliases: [], summary: '', tags: [], fields: {}, ...extra }) as EntryState

const line = (kind: MustLine['kind'], text: string, entryIds: string[] = []): MustLine => ({ kind, text, entryIds })

function from(over: Partial<ContractFrom> = {}): ContractFrom {
  return {
    asks: 'scene',
    must: [],
    people: [],
    card: { beats: [], outcome: '' },
    threads: [],
    direction: '',
    facts: [],
    storyTitle: 'The Mill',
    ...over
  }
}

describe('the switch', () => {
  it('is on unless Adam turns it off; AIWRITE_CONTRACT=off always turns it off', () => {
    expect(contractWanted({}, {})).toBe(true)
    expect(contractWanted({ sceneContracts: true }, {})).toBe(true)
    expect(contractWanted({ sceneContracts: false }, {})).toBe(false)
    expect(contractWanted({ sceneContracts: true }, { AIWRITE_CONTRACT: 'off' })).toBe(false)
    expect(contractWanted({}, { AIWRITE_CONTRACT: 'on' })).toBe(true)
  })
})

describe('what must change', () => {
  const card = { beats: ['Mara reaches the gate', '  ', 'Tobin tells her the letter is forged'], outcome: 'Mara turns back for the mill' }

  it('a whole scene: each beat in order, then the outcome, then the plot threads the card sets up or pays off', () => {
    const got = mustChange(
      from({
        card,
        threads: [
          { entryId: 't1', name: 'The forged letter', role: 'pays off' },
          { entryId: 't2', name: 'The miller’s debt', role: 'sets up' }
        ]
      })
    )
    expect(got.map((c) => c.text)).toEqual([
      'Mara reaches the gate',
      'Tobin tells her the letter is forged',
      'By the end: Mara turns back for the mill',
      'The plot thread “The forged letter” is paid off.',
      'The plot thread “The miller’s debt” is set up.'
    ])
    expect(got[3].entryIds).toEqual(['t1'])
  })

  it('holds a handful at most, keeping room for the threads', () => {
    const beats = Array.from({ length: 9 }, (_, i) => `Beat number ${i + 1} happens here`)
    const got = mustChange(from({ card: { beats, outcome: '' }, threads: [{ entryId: 't', name: 'The debt', role: 'pays off' }] }))
    expect(got).toHaveLength(CONTRACT_MOST.change)
    expect(got.at(-1)!.text).toContain('The debt')
    expect(got[0].text).toBe('Beat number 1 happens here')
  })

  it('Add below: the author’s direction, else the next beat not on the page yet; no threads', () => {
    const threads = [{ entryId: 't1', name: 'The forged letter', role: 'pays off' as const }]
    expect(mustChange(from({ asks: 'stretch', card, threads, direction: 'Tobin hides the letter in his coat' })).map((c) => c.text)).toEqual([
      'Tobin hides the letter in his coat'
    ])
    const soFar = 'Mara reached the gate at last, out of breath.'
    expect(mustChange(from({ asks: 'stretch', card, threads, soFar })).map((c) => c.text)).toEqual(['Tobin tells her the letter is forged'])
    // Every beat on the page and no direction: nothing to bring about.
    expect(mustChange(from({ asks: 'stretch', card: { beats: ['Mara reaches the gate'], outcome: '' }, soFar }))).toEqual([])
  })

  it('a direction that only says how it should read is nothing that must change (review, 2026-10-16)', () => {
    for (const d of ['Make it darker', 'more dialogue, a faster pace', 'Tone it down a bit.', 'Keep it tense and quiet', 'Less description'])
      expect(toneOnly(d)).toBe(true)
    for (const d of ['Make it darker: Tobin dies', 'Mara slams the gate', 'Tobin is angrier', '']) expect(toneOnly(d)).toBe(false)
    expect(mustChange(from({ card, direction: 'Make it darker' })).map((c) => c.text)).toEqual([
      'Mara reaches the gate',
      'Tobin tells her the letter is forged',
      'By the end: Mara turns back for the mill'
    ])
    // Add below: the next beat not on the page, as with no direction.
    const soFar = 'Mara reached the gate at last, out of breath.'
    expect(mustChange(from({ asks: 'stretch', card, soFar, direction: 'darker, and slower' })).map((c) => c.text)).toEqual(['Tobin tells her the letter is forged'])
    expect(mustChange(from({ asks: 'continue', card, direction: 'more tension' }))).toEqual([])
  })

  it('a beat: that beat; Continue: what happens next, or nothing', () => {
    expect(mustChange(from({ asks: 'beat', card, focus: 'Tobin tells her the letter is forged' })).map((c) => c.text)).toEqual([
      'Tobin tells her the letter is forged'
    ])
    expect(mustChange(from({ asks: 'continue', card, direction: 'Mara slams the gate' })).map((c) => c.text)).toEqual(['Mara slams the gate'])
    expect(mustChange(from({ asks: 'continue', card }))).toEqual([])
  })

  it('the plan’s words stand for the card’s where they say the same; the rest of the card, and a thread the plan doesn’t name, stay', () => {
    const got = mustChange(
      from({
        card,
        planned: ['Tobin admits the letter is forged', '', 'Mara heads back to the mill'],
        threads: [
          { entryId: 't1', name: 'The forged letter', role: 'pays off' },
          { entryId: 't2', name: 'The miller’s debt', role: 'sets up' }
        ]
      })
    )
    // The second beat, the outcome and the first thread are what the plan says; reaching the gate it doesn't (fix 13's
    // review: the plan never pushes the card out).
    expect(got.map((c) => c.text)).toEqual([
      'Tobin admits the letter is forged',
      'Mara heads back to the mill',
      'Mara reaches the gate',
      'The plot thread “The miller’s debt” is set up.'
    ])
  })
})

describe('what must change, after the review (fix 13)', () => {
  const card = { beats: ['Mara reaches the gate', 'Tobin tells her the letter is forged'], outcome: 'Mara turns back for the mill' }

  it('the outcome keeps its place however many beats there are', () => {
    const beats = Array.from({ length: 9 }, (_, i) => `Beat number ${i + 1} happens here`)
    const threads = [
      { entryId: 't1', name: 'The debt', role: 'pays off' as const },
      { entryId: 't2', name: 'The flood', role: 'sets up' as const }
    ]
    const got = mustChange(from({ card: { beats, outcome: 'Mara turns back for the mill' }, threads })).map((c) => c.text)
    expect(got).toEqual([
      'Beat number 1 happens here',
      'Beat number 2 happens here',
      'By the end: Mara turns back for the mill',
      'The plot thread “The debt” is paid off.',
      'The plot thread “The flood” is set up.'
    ])
    // A beat that only says the outcome again is the one left out, not the outcome.
    const again = mustChange(from({ card: { beats: ['Mara reaches the gate', 'Mara turns back for the mill'], outcome: 'Mara turns back for the mill' } }))
    expect(again.map((c) => c.text)).toEqual(['Mara reaches the gate', 'By the end: Mara turns back for the mill'])
  })

  it('a whole scene’s direction comes first, and stands for the beats it speaks to', () => {
    const got = mustChange(from({ card, direction: 'They never reach the gate: Tobin turns them back at the bridge' })).map((c) => c.text)
    expect(got).toEqual([
      'They never reach the gate: Tobin turns them back at the bridge',
      'Tobin tells her the letter is forged',
      'By the end: Mara turns back for the mill'
    ])
    // The plan's line that says the direction again isn't said twice.
    const planned = mustChange(from({ card, direction: 'Tobin tells her the letter is forged', planned: ['Tobin admits the letter is forged', 'Mara reaches the gate at dusk'] }))
    expect(planned.map((c) => c.text)).toEqual(['Tobin tells her the letter is forged', 'Mara reaches the gate at dusk', 'By the end: Mara turns back for the mill'])
  })

  it('a steered beat is the beat with the author’s note for it', () => {
    const got = mustChange(from({ asks: 'beat', card, focus: 'Mara reaches the gate (the author’s note for it: she arrives soaked and late)' }))
    expect(got.map((c) => c.text)).toEqual(['Mara reaches the gate (the author’s note for it: she arrives soaked and late)'])
  })
})

describe('what must not change never goes against what must change (fix 13’s review)', () => {
  const mara = person('Mara')
  const tobin = person('Tobin')
  const key: MustLine = {
    kind: 'gotNamed',
    text: 'Mara: has the brass key (Tobin gave it to her; since Ch 2, Sc 1)',
    entryIds: [mara.id, 'key'],
    about: { holding: { words: ['brass key', 'key'] } }
  }
  const door: MustLine = { kind: 'thingNamed', text: 'The door: barred from inside', entryIds: [], about: { thing: { name: 'the door', state: 'barred from inside' } } }
  const belief: MustLine = {
    kind: 'belief',
    text: 'Mara wrongly believes: Tobin is loyal to her (it isn’t true). Mara takes it as true here unless the scene card says otherwise',
    entryIds: [mara.id],
    about: { words: 'Tobin is loyal to her', who: ['Mara'], learns: true }
  }
  const secret: MustLine = {
    kind: 'gap',
    text: 'Kept from Tobin: The ledger is forged (Mara knows it). Tobin must not learn, guess or think it here unless the scene card says so',
    entryIds: [tobin.id],
    about: { words: 'The ledger is forged', who: ['Tobin'], learns: true }
  }
  const sling: MustLine = { kind: 'condition', text: 'Mara: left arm in a sling (since Ch 2, Sc 4)', entryIds: [mara.id], about: { words: 'left arm in a sling', who: ['Mara'] } }
  const dead: MustLine = { kind: 'dead', text: 'Ash is dead: drowned at the weir (since Ch 1, Sc 2)', entryIds: ['ash'], about: { words: 'drowned at the weir', who: [] } }
  const all = [key, door, belief, secret, sling, dead]
  const keeps = (beats: string[]): string[] =>
    sceneContract(from({ must: all, people: [mara, tobin], card: { beats, outcome: '' } }))!
      .items.filter((i) => i.part === 'keep')
      .map((i) => i.text.split(':')[0])

  it('nothing changes: every line is kept', () => {
    expect(keeps(['Mara waits by the window'])).toEqual(['Ash is dead', 'Kept from Tobin', 'Mara', 'Mara wrongly believes'])
  })

  it('a key handed over, a door unbarred, the sling taken off: not kept as well', () => {
    expect(changedBy(key, ['Mara hands the brass key to Ash'])).toBe(true)
    expect(changedBy(door, ['Tobin unbars the door and slips out'])).toBe(true)
    expect(changedBy(sling, ['The sling comes off Mara’s left arm at last'])).toBe(true)
    expect(keeps(['Mara hands the brass key to Ash', 'Tobin unbars the door', 'The sling comes off Mara’s left arm'])).toEqual([
      'Ash is dead',
      'Kept from Tobin',
      'Mara wrongly believes'
    ])
  })

  it('someone told the secret, or learning the truth of what they believe: not kept as well', () => {
    expect(changedBy(secret, ['Mara tells Tobin the truth about the ledger'])).toBe(true)
    expect(changedBy(secret, ['Tobin finds out about the ledger'])).toBe(true)
    expect(changedBy(belief, ['Mara learns the truth about Tobin'])).toBe(true)
    expect(changedBy(belief, ['Mara discovers Tobin was never loyal'])).toBe(true)
    // Not about the secret, or not the one it's kept from: still kept.
    expect(changedBy(secret, ['Tobin admits he lied about the ledger'])).toBe(false)
    expect(changedBy(secret, ['Mara learns the ledger is in the safe'])).toBe(false)
    expect(changedBy(belief, ['Mara learns to ride'])).toBe(false)
    // Naming a dead man, or where he died, doesn't bring him back.
    expect(changedBy(dead, ['Mara visits the weir where Ash died'])).toBe(false)
    // The secret and the belief go; the sling, the key and the door take their places.
    expect(keeps(['Mara tells Tobin the truth about the ledger', 'Mara learns the truth about Tobin'])).toEqual(['Ash is dead', 'Mara', 'Mara', 'The door'])
  })
})

describe('the contract', () => {
  const mara = person('Mara')
  const tobin = person('Tobin')
  const must = [
    line('condition', 'Mara: left arm in a sling (since Ch 2, Sc 4)', [mara.id]),
    line('holding', 'Mara is holding: the survey case (since Ch 3, Sc 1)', [mara.id]),
    line('dead', 'Ash is dead: drowned at the weir (since Ch 1, Sc 2)', ['ash']),
    line('gap', 'Kept from Tobin: the letter is forged (Mara knows it). Tobin must not learn, guess or think it here unless the scene card says so', [tobin.id]),
    line('elapsed', 'Time: 2 days since the scene before (Day 4, morning); this scene is Day 6'),
    line('wearing', 'Mara is wearing: grey cloak on', [mara.id]),
    line('thing', 'The door: barred from inside'),
    line('slip', 'Slipped in Ch 2, Sc 3 and put right, so don’t repeat it: Mara’s eyes are blue.')
  ]

  it('carrying on with no stage for the end of the scene so far: nothing at the start (review, 2026-10-16)', () => {
    const fact: FactState = { factId: 'f', fact: 'The letter is forged', knownBy: [mara.id, tobin.id], at: 3 }
    const o = from({ asks: 'stretch', must, people: [mara, tobin], facts: [fact], direction: 'Mara and Tobin argue about the forged letter' })
    expect(sceneContract(o)!.items.some((i) => i.part === 'start')).toBe(true)
    const c = sceneContract({ ...o, noStart: true })!
    expect(c.items.filter((i) => i.part === 'start')).toEqual([])
    // What must happen and what must not change stay, and the codes start at C1.
    expect(c.items[0]).toMatchObject({ code: 'C1', part: 'change', text: 'Mara and Tobin argue about the forged letter' })
    expect(c.items.some((i) => i.part === 'keep' && /Ash is dead/.test(i.text))).toBe(true)
  })

  it('the start and what must not change come from what must stay true, word for word; codes run in order', () => {
    const c = sceneContract(from({ must, people: [mara, tobin], card: { beats: ['Mara reaches the gate'], outcome: '' } }))!
    expect(c.asks).toBe('scene')
    const by = (part: string): string[] => c.items.filter((i) => i.part === part).map((i) => i.text)
    expect(by('start')).toEqual([
      'Time: 2 days since the scene before (Day 4, morning); this scene is Day 6',
      'Mara is holding: the survey case (since Ch 3, Sc 1)'
    ])
    expect(by('change')).toEqual(['Mara reaches the gate'])
    expect(by('keep')).toEqual([
      'Ash is dead: drowned at the weir (since Ch 1, Sc 2)',
      'Kept from Tobin: the letter is forged (Mara knows it). Tobin must not learn, guess or think it here unless the scene card says so',
      'Mara: left arm in a sling (since Ch 2, Sc 4)',
      'The door: barred from inside'
    ])
    expect(c.items.map((i) => i.code)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'])
    // Plain clothes and slips put right aren't in it (what must stay true still says them).
    expect(c.items.some((i) => /grey cloak|Slipped/.test(i.text))).toBe(false)
    // Each with the check a broken one belongs to, and who it is about.
    expect(c.items.find((i) => i.text.startsWith('Time'))!.check).toBe('timeline')
    expect(c.items.find((i) => i.text.startsWith('Kept from'))).toMatchObject({ check: 'knowledge', entryIds: [tobin.id] })
    expect(c.items.find((i) => i.text.startsWith('Mara: left arm'))!.check).toBe('facts')
    expect(c.items.find((i) => i.text.startsWith('The door'))!.check).toBe('continuity')
  })

  it('a secret the card plans telling isn’t kept from anyone', () => {
    const c = sceneContract(from({ must, people: [mara, tobin], card: { beats: ['Mara tells Tobin the letter is forged'], outcome: '' } }))!
    expect(c.items.some((i) => i.text.startsWith('Kept from Tobin'))).toBe(false)
    expect(c.items.filter((i) => i.part === 'change').map((i) => i.text)).toEqual(['Mara tells Tobin the letter is forged'])
    // Only the secret's own words count, not who knows it or the rule after it.
    const shown = sceneContract(from({ must, people: [mara, tobin], card: { beats: ['The letter turns out to be forged'], outcome: '' } }))!
    expect(shown.items.some((i) => i.text.startsWith('Kept from Tobin'))).toBe(false)
    const other = sceneContract(from({ must, people: [mara, tobin], card: { beats: ['Tobin must learn to guess the tide'], outcome: '' } }))!
    expect(other.items.some((i) => i.text.startsWith('Kept from Tobin'))).toBe(true)
  })

  it('a handful at most in each list', () => {
    const many = Array.from({ length: 9 }, (_, i) => line('condition', `Person ${i}: a cut on the hand`))
    const where = Array.from({ length: 9 }, (_, i) => line('where', `Where Person ${i} is: the yard`))
    const c = sceneContract(from({ must: [...many, ...where] }))!
    expect(c.items.filter((i) => i.part === 'keep')).toHaveLength(CONTRACT_MOST.keep)
    expect(c.items.filter((i) => i.part === 'start')).toHaveLength(CONTRACT_MOST.start)
  })

  it('who knows what the scene is about, when everyone here knows it, is true at the start', () => {
    const facts: FactState[] = [
      { factId: 'f1', fact: 'The bridge at Amber Gate washed away.', knownBy: [mara.id, tobin.id], at: 5, since: { [mara.id]: { at: 5, where: 'The Mill, Ch 2, Sc 1', sceneId: 's21' } } },
      // Not what the scene is about.
      { factId: 'f2', fact: 'The miller owes money in town.', knownBy: [mara.id, tobin.id], at: 4 },
      // Known by only one of them: a secret, which is what must not change (from what must stay true).
      { factId: 'f3', fact: 'The bridge toll was stolen.', knownBy: [mara.id], at: 6 },
      // Read by the memory alone: who doesn't know it isn't known.
      { factId: 'f4', fact: 'The bridge keeper fled.', knownBy: [mara.id, tobin.id], at: 7, backed: false }
    ] as FactState[]
    const c = sceneContract(from({ people: [mara, tobin], facts, card: { beats: ['They find the bridge at Amber Gate gone'], outcome: '' } }))!
    const start = c.items.filter((i) => i.part === 'start')
    expect(start.map((i) => i.text)).toEqual(['Mara and Tobin know: The bridge at Amber Gate washed away (since Ch 2, Sc 1)'])
    expect(start[0]).toMatchObject({ check: 'knowledge', entryIds: [mara.id, tobin.id] })
  })

  it('says nothing when there is nothing to keep to or bring about', () => {
    expect(sceneContract(from())).toBeNull()
    expect(sceneContract(from({ asks: 'continue', must: [line('wearing', 'Mara is wearing: grey cloak on')] }))).toBeNull()
  })
})

describe('how it is told', () => {
  const c = {
    asks: 'scene' as const,
    items: [
      { code: 'C1', part: 'start' as const, text: 'Mara is holding: the survey case', check: 'continuity' as const, entryIds: [] },
      { code: 'C2', part: 'change' as const, text: 'Mara reaches the gate', check: 'facts' as const, entryIds: [] },
      { code: 'C3', part: 'change' as const, text: 'Tobin tells her the truth', check: 'facts' as const, entryIds: [] },
      { code: 'C4', part: 'keep' as const, text: 'Ash is dead', check: 'facts' as const, entryIds: [] }
    ]
  }

  it('to the writer: the lead, then each list under its heading; short without the lead', () => {
    expect(contractText(c)).toBe(
      [
        CONTRACT_LEAD,
        'Must be true at the start:\n- Mara is holding: the survey case',
        'Must change by the end of the scene:\n1. Mara reaches the gate\n2. Tobin tells her the truth',
        'Must not change:\n- Ash is dead'
      ].join('\n')
    )
    expect(contractText(c, { short: true }).startsWith('Must be true at the start:')).toBe(true)
  })

  it('to a check: every item with its id, no lead', () => {
    const text = contractText(c, { codes: true })
    expect(text).toContain('- [C2] Mara reaches the gate')
    expect(text).toContain('- [C4] Ash is dead')
    expect(text).not.toContain(CONTRACT_LEAD)
  })

  it('names what must change by what the draft is asked to write', () => {
    expect(partTitle('change', 'scene')).toBe('Must change by the end of the scene')
    expect(partTitle('change', 'beat')).toBe('Must change by the end of this beat')
    expect(partTitle('change', 'stretch')).toBe('Must happen in what you write now')
    expect(partTitle('change', 'continue')).toBe('Must happen next')
    expect(partTitle('start', 'stretch')).toBe('Must be true where you carry on from')
  })

  it('what must stay true leaves out the start and what must not change, word for word', () => {
    expect([...contractSays(c)]).toEqual(['Mara is holding: the survey case', 'Ash is dead'])
    expect(contractSays(null).size).toBe(0)
  })
})

describe('words that say what happens', () => {
  it('a fact is said when two of its words, or a third of them, are there', () => {
    expect(saysFact('Mara tells Tobin the letter is forged', 'the letter is forged')).toBe(true)
    expect(saysFact('Mara reaches the gate', 'the letter is forged')).toBe(false)
  })
  it('an item is mostly in the words when three in five of its words are', () => {
    expect(mostlyIn('Tobin hides the letter in his coat', 'At last Tobin hid the letter inside his coat.')).toBe(true)
    expect(mostlyIn('Tobin hides the letter in his coat', 'Tobin looked at the river.')).toBe(false)
  })
})

// ---------- In the writer's briefing ----------

const stageNow = (): SceneState => ({
  time: 'late evening',
  weather: '',
  light: '',
  characters: [
    { where: 'the mill loft, by the hatch', wearing: '', posture: '', holding: 'the survey case', condition: 'left arm in a sling', mood: '', lastAction: '', name: 'Wren' }
  ],
  said: {
    'wren|where': { quote: 'up in the loft by the hatch', sceneId: 'here' },
    'wren|holding': { quote: 'the case under her good arm', sceneId: 'sc-3-2' },
    'wren|condition': { quote: 'her arm in its sling', sceneId: 'sc-2-4' }
  }
})

function briefingInput(over: Partial<ContextInput> = {}): ContextInput {
  const wren = person('Wren', { description: '', notes: '', parentId: null, hardRule: false, origin: 'adam', fieldOrigins: {}, happened: [], changed: [] } as Partial<EntryState>)
  const osric = person('Osric Hale', { description: '', notes: '', parentId: null, hardRule: false, origin: 'adam', fieldOrigins: {}, happened: [], changed: [] } as Partial<EntryState>)
  const ash = person('Ash', {
    description: '',
    notes: '',
    parentId: null,
    hardRule: false,
    origin: 'adam',
    fieldOrigins: {},
    changed: [],
    happened: [{ note: 'drowned at the weir', changeId: 'd', where: 'The Mill, Ch 1, Sc 2', at: 3 }]
  } as Partial<EntryState>)
  return {
    style: { ...defaultStyleGuide(), pov: 'Close third person', tense: 'Past tense', spelling: 'UK' },
    scene: { title: 'The hatch', card: { ...emptySceneCard(), povId: wren.id, presentIds: [wren.id, osric.id], beats: ['Osric climbs up to the loft', 'Wren shows him the case Ash left'] } },
    memory: {
      storyId: 'mill',
      sceneId: 'here',
      knows: '',
      previous: { sceneId: 'sc-3-2', title: 'Before', text: 'The sleet came on.', storyId: 'mill', storyTitle: 'The Mill', otherStory: null },
      entries: [wren, osric, ash],
      firstHere: [],
      elsewhere: [],
      relationships: [],
      facts: [],
      threads: [],
      storySoFar: { scenes: [], chapters: [], stories: [], series: [], leadsInto: null },
      bringAbout: []
    },
    pins: [],
    blockModes: {},
    world: { themes: '', tone: '' },
    series: null,
    story: { title: 'The Mill', premise: '', themes: '', tone: '' },
    options: { direction: '', targetWords: 800, creativity: 'balanced' },
    contextLength: 64_000,
    continuity: stageNow(),
    continuityAtSoFar: false,
    stageWhere: { 'sc-3-2': 'The Mill, Ch 3, Sc 2', 'sc-2-4': 'The Mill, Ch 2, Sc 4' },
    ...over
  }
}

describe('in the writer’s briefing', () => {
  it('off (no contract asked for): no block, and what must stay true is as it always was', () => {
    const p = prepareContext(briefingInput())
    expect(p.blocks.some((b) => b.id === CONTRACT_BLOCK.id)).toBe(false)
    expect(p.contract).toBeUndefined()
  })

  it('a short late block right above what must stay true, which leaves out what the contract says', () => {
    // A slip put right in an earlier scene: what must stay true says it; the contract doesn't.
    const withSlip = (inp: ContextInput): ContextInput => ({
      ...inp,
      slips: [{ text: 'Wren’s eyes are grey.', where: 'The Mill, Ch 1, Sc 1', entryIds: [inp.memory.entries[0].id], kind: 'fact', back: 2 }]
    })
    const off = assembleContext(withSlip(briefingInput()), countRaw)
    const on = assembleContext(withSlip(briefingInput({ contract: { asks: 'scene' } })), countRaw)
    const ids = on.blocks.filter((b) => !b.dropped).map((b) => b.id)
    expect(ids.slice(-2)).toEqual([CONTRACT_BLOCK.id, MUST_BLOCK])
    expect(SEND_ORDER.indexOf(CONTRACT_BLOCK.id)).toBe(SEND_ORDER.indexOf(MUST_BLOCK) - 1)
    expect(SEND_ORDER.indexOf(CONTRACT_BLOCK.id)).toBeGreaterThan(SEND_ORDER.indexOf('scene-card'))
    const block = on.blocks.find((b) => b.id === CONTRACT_BLOCK.id)!
    expect(block.title).toBe('This scene’s contract')
    expect(block.priority).toBe(MUST_PRIORITY)
    expect(block.text).toContain(CONTRACT_LEAD)
    expect(block.text).toContain('Must change by the end of the scene:\n1. Osric climbs up to the loft\n2. Wren shows him the case Ash left')
    expect(block.text).toContain('- Ash is dead: drowned at the weir (since Ch 1, Sc 2)')
    expect(block.text).toContain('- Wren: left arm in a sling (since Ch 2, Sc 4)')
    // What must stay true said those lines before; now the contract does, and they aren't said twice.
    const mustOff = off.blocks.find((b) => b.id === MUST_BLOCK)!.text
    const mustOn = on.blocks.find((b) => b.id === MUST_BLOCK)?.text ?? ''
    expect(mustOn).toContain('Wren’s eyes are grey.')
    expect(mustOff).toContain('Ash is dead')
    expect(mustOn).not.toContain('Ash is dead')
    expect(mustOn).not.toContain('left arm in a sling')
    const user = on.messages[1].content
    expect(user.indexOf('## This scene’s contract')).toBeGreaterThan(user.indexOf('## Scene card'))
    // Everything in it, nothing left over: with nothing else to keep to, what must stay true goes.
    const all = prepareContext(briefingInput({ contract: { asks: 'scene' } }))
    expect(all.blocks.some((b) => b.id === MUST_BLOCK)).toBe(false)
  })

  it('every block sent before the scene card reads the same with a contract or without (the cache)', () => {
    const off = assembleContext(briefingInput(), countRaw)
    const on = assembleContext(briefingInput({ contract: { asks: 'scene' } }), countRaw)
    const before = SEND_ORDER.slice(0, SEND_ORDER.indexOf('scene-card'))
    const text = (id: string, p: typeof on): string => p.blocks.find((b) => b.id === id)?.text ?? ''
    for (const id of before) expect(text(id, on), id).toBe(text(id, off))
  })

  it('the plan’s words for what must change come first, the card’s beats the plan doesn’t say after; a beat’s own takes the card’s place', () => {
    const planned = prepareContext(briefingInput({ contract: { asks: 'scene', planned: ['Osric sees the case is empty'] } }))
    expect(planned.contract!.items.filter((i) => i.part === 'change').map((i) => i.text)).toEqual([
      'Osric sees the case is empty',
      'Osric climbs up to the loft',
      'Wren shows him the case Ash left'
    ])
    const beat = prepareContext(briefingInput({ contract: { asks: 'beat', focus: 'Wren shows him the case' } }))
    expect(beat.blocks.find((b) => b.id === CONTRACT_BLOCK.id)!.text).toContain('Must change by the end of this beat:\n1. This beat, as given last of all, below.')
    // The check still reads the beat itself.
    expect(contractText(beat.contract!, { codes: true })).toContain('Wren shows him the case')
  })

  it('is never left out, even for a model with very little room', () => {
    const small = assembleContext(briefingInput({ contract: { asks: 'scene' }, contextLength: 4_096 }), countRaw)
    const block = small.blocks.find((b) => b.id === CONTRACT_BLOCK.id)!
    expect(block.dropped).toBe(false)
  })
})
