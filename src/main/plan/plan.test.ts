// Plan before writing (step 4): the planner's reply read, checked against the stage as far as it still holds here
// (positions in the stage's own words, guesses left out, changes that are already so or start from what isn't so left
// out, nothing from the dead), never an event the card doesn't call for or a secret let out, what it asks for found in
// the codex by its name, the plan written as the writer's own notes, taken only when there is room, and no plan at all
// when the call fails, is stopped or takes too long. The model is a stand-in; invented test text only.
import { describe, expect, it } from 'vitest'
import type { ContextBlock, EntryKind, EntryState } from '@shared/types'
import type { SceneState } from '@shared/continuity'
import { defaultStyleGuide, emptySceneCard } from '@shared/defaults'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import * as gens from '../db/generations'
import type { MemoryModel } from '../keeper/model'
import { refusalsOf } from '../keeper/refusals'
import type { Secret } from '../ai/mustStay'
import { assembleContext, EARLIER_BLOCK, finishContext, prepareContext, type ContextInput } from '../ai/context'
import { countRaw } from '../ai/tokens'
import { CONTRACT_BLOCK } from '../ai/contract'
import {
  BEATS_CHECK_LABEL,
  changeLine,
  checkPlan,
  contradicts,
  fieldOf,
  KEEP_PLAN_PROMPTS,
  latestSaysOtherwise,
  LOOKUP_RULE,
  keepsRoom,
  makePlan,
  PLAN_GO,
  PLAN_HEAD,
  PLAN_MARKER,
  PLAN_MOST,
  planForContinue,
  planMaterial,
  planMessages,
  planSystem,
  planText,
  readPlan,
  saysIn,
  type CheckWith,
  type PlanMaterial,
  type RawPlan,
  type ScenePlan
} from './plan'
import type { CanHappen } from './preconditions'

let seq = 0
const entry = (kind: EntryKind, name: string, extra: Partial<EntryState> = {}): EntryState => ({
  id: `p${++seq}`,
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
const STAND: SceneState = {
  time: 'dusk',
  weather: '',
  light: '',
  characters: [
    { ...blank, name: 'Wren', where: 'the mill loft', wearing: 'linen shirt, boots off by the hatch', posture: 'sitting on a sack', condition: 'left arm in a sling' },
    { ...blank, name: 'Osric Hale', where: 'the foot of the stairs' }
  ]
}

const CARD = 'Scene: The hatch\nPoint of view: Wren\nAlso in the scene: Osric Hale\nBeats, in order:\n1. Osric climbs up to the loft\n2. They argue about the weir'
const MATERIAL = `## The scene card\n${CARD}\nThe weir is failing and the abbot knows it.\n\n## Must stay true\n- Wren: a burn scar on her right hand`
const SECRET: Secret = { fact: 'The flour tax was forged', knownBy: ['Wren'], keptFrom: ['Osric Hale'] }

type World = CheckWith & { weir: EntryState; ledger: EntryState; abbot: EntryState; wren: EntryState; mara: EntryState }
function world(over: Partial<CheckWith> = {}): World {
  const wren = entry('character', 'Wren')
  const weir = entry('place', 'The weir', { aliases: ['the old weir'] })
  const ledger = entry('item', 'The tithe ledger')
  const hidden = entry('item', 'The black ledger')
  const abbot = entry('character', 'Abbot Fen', { happened: [{ note: 'Died of the fever', where: 'The Mill, Ch 2, Sc 1', changeId: 'd' }] })
  const mill = entry('place', 'The mill')
  const mara = entry('character', 'Mara')
  return {
    stand: STAND,
    reach: 'here',
    material: MATERIAL,
    card: CARD,
    calls: CARD,
    people: ['Wren', 'Osric Hale'],
    secrets: [SECRET],
    entries: [wren, weir, ledger, hidden, abbot, mill, mara],
    inBriefing: new Set([wren.id, mill.id]),
    hidden: new Set([hidden.id]),
    weir,
    ledger,
    abbot,
    wren,
    mara,
    ...over
  }
}

const raw = (over: Partial<RawPlan>): RawPlan => ({ relies: [], changes: [], needs: [], ...over })

describe('reading the plan', () => {
  it('reads the JSON wherever it sits in the reply; anything missing is empty', () => {
    const r = readPlan(
      'Here is the plan:\n{"relies": [{"who": "Wren", "what": "wearing", "value": " linen  shirt "}], "changes": [{"who": "Wren", "how": "She stands."}, "junk"], "needs": ["The weir", {"name": "The tithe ledger"}, 4]}\nDone.'
    )
    const shape = { wants: '', against: '', turn: '', beats: [], whoWhere: [], mustStay: [], closing: '' }
    expect(r).toEqual({
      relies: [{ who: 'Wren', what: 'wearing', value: 'linen shirt' }],
      changes: [{ who: 'Wren', what: '', from: '', to: '', how: 'She stands.' }],
      needs: ['The weir', 'The tithe ledger'],
      must: [],
      ...shape
    })
    expect(readPlan('{}')).toEqual({ relies: [], changes: [], needs: [], must: [], ...shape })
    expect(readPlan('The scene should be tense.')).toBeNull()
    expect(readPlan('[1, 2]')).toBeNull()
  })

  it('reads the scene’s shape: the point, the beats, who is where, what must stay true and the closing image', () => {
    const r = readPlan(
      JSON.stringify({
        wants: ' Wren wants  the ledger ',
        against: 'Osric guards it',
        turn: 'He gives it up',
        beats: ['1. Osric climbs up', { text: 'They argue' }, 7],
        who_where: ['Wren: in the loft', { who: 'Osric Hale', where: 'at the hatch' }],
        must_stay: ['Osric does not know of the forgery'],
        closing_image: 'The ladder, empty.'
      })
    )!
    expect(r).toMatchObject({
      wants: 'Wren wants the ledger',
      against: 'Osric guards it',
      turn: 'He gives it up',
      beats: ['1. Osric climbs up', 'They argue'],
      whoWhere: ['Wren: in the loft', 'Osric Hale: at the hatch'],
      mustStay: ['Osric does not know of the forgery'],
      closing: 'The ladder, empty.'
    })
    expect(fieldOf('knowledge')).toBe('knows')
    expect(fieldOf('learns')).toBe('knows')
  })

  it("knows the stage's fields by other words, and anything else is a fact", () => {
    expect(fieldOf('position')).toBe('posture')
    expect(fieldOf('Clothing')).toBe('wearing')
    expect(fieldOf('location')).toBe('where')
    expect(fieldOf('injury')).toBe('condition')
    expect(fieldOf('time')).toBe('time')
    expect(fieldOf('fact')).toBeNull()
    expect(fieldOf('')).toBeNull()
  })

  it('tells when two descriptions disagree about something both name', () => {
    expect(contradicts('boots on', 'linen shirt, boots off by the hatch')).toBe(true)
    expect(contradicts('the shutters open', 'the shutters closed and barred')).toBe(true)
    expect(contradicts('standing by the hatch', 'sitting on a sack')).toBe(true)
    // Different words that agree, or say nothing against it.
    expect(contradicts('cloak on, boots off', 'boots off, cloak on')).toBe(false)
    expect(contradicts('boots off', 'linen shirt, boots off by the hatch')).toBe(false)
    expect(contradicts('a grey cloak', 'linen shirt, boots off by the hatch')).toBe(false)
    expect(contradicts('in the loft', 'the mill loft')).toBe(false)
  })
})

describe('checking the plan against the stage', () => {
  it("carrying on inside a scene: positions in the stage's own words, guesses left out, facts it was given kept", () => {
    const p = checkPlan(
      raw({
        relies: [
          { who: 'Wren', what: 'wearing', value: 'a red coat' },
          { who: 'Wren', what: 'position', value: 'sitting on a sack' },
          { who: 'Wren', what: 'holding', value: 'a silver knife' },
          // The stage has her condition: its words win.
          { who: 'Wren', what: 'condition', value: 'a burn scar on her right hand' },
          // Not on the stage, but in what the planner was given.
          { who: 'Osric Hale', what: 'holding', value: 'the abbey keys' },
          { who: '', what: 'time', value: 'midnight' },
          { who: '', what: 'fact', value: 'The weir is failing' },
          { who: '', what: 'fact', value: 'The abbot is secretly alive' },
          { who: 'Osric', what: 'where', value: 'at the foot of the stairs' }
        ]
      }),
      world({ material: `${MATERIAL}\nOsric Hale carries the abbey keys.` })
    )
    expect(p.keep).toEqual([
      // Read from a state kept before step 2b, in one line: the pieces, each as it reads.
      'Wren is wearing: linen shirt; boots off by the hatch',
      'How Wren is placed: sitting on a sack',
      'Wren: left arm in a sling',
      'Osric Hale is holding: the abbey keys',
      'Time: dusk',
      'The weir is failing',
      'Where Osric Hale is: the foot of the stairs'
    ])
    // Put right: what she wears, her condition, the time and where Osric is; left out: the knife and the abbot alive.
    expect(p.checked).toEqual({ corrected: 4, dropped: 2 })
  })

  it("a new scene the same day: only injuries, clothes and what people hold come from the scene before; the card's where and when stand", () => {
    const card = `${CARD}\nWhen: Day 3, midnight\nWhere: the market square`
    const p = checkPlan(
      raw({
        relies: [
          { who: 'Wren', what: 'wearing', value: 'a red coat' },
          { who: 'Wren', what: 'where', value: 'the mill loft' },
          { who: 'Wren', what: 'where', value: 'the market square' },
          { who: '', what: 'time', value: 'Day 3, midnight' },
          { who: '', what: 'time', value: 'dusk' }
        ],
        changes: [
          // She is in the market now (the card says so): moving from the loft is no "already so", and going to the
          // loft is a move like any other.
          { who: 'Wren', what: 'where', from: 'the market square', to: 'the mill loft', how: 'Wren walks back towards the mill.' },
          { who: 'Wren', what: 'position', from: 'standing', to: 'sitting on a sack', how: 'Wren sits on a sack.' }
        ]
      }),
      world({ reach: 'start', card, calls: card })
    )
    expect(p.keep).toEqual([
      'Wren is wearing: linen shirt; boots off by the hatch',
      'Where Wren is: the market square',
      'Time: Day 3, midnight'
    ])
    // Each change whole in itself (2026-10-19): who, what, from and to, and how it happens.
    expect(p.changes).toEqual([
      'Wren, where: the market square → the mill loft. Wren walks back towards the mill.',
      'Wren, position: standing → sitting on a sack. Wren sits on a sack.'
    ])
    expect(p.checked).toEqual({ corrected: 1, dropped: 2 })
  })

  it("piece by piece: each piece and each thing in the place in the stage's own words, and a change that starts wrong left out", () => {
    // Step 2b (Adam, 2026-10-07): a door barred and then opened from outside with nothing keeping track of it, and a case
    // put on a windowsill back in someone's hand.
    const stand: SceneState = {
      time: '',
      weather: '',
      light: '',
      things: [
        { name: 'the door', state: 'shut and barred from inside' },
        { name: 'the survey case', state: 'on the windowsill' }
      ],
      characters: [
        {
          name: 'Wren',
          where: 'the inn parlour',
          posture: 'sitting on the settle',
          touching: '',
          sees: '',
          holding: 'nothing',
          condition: '',
          mood: '',
          lastAction: '',
          clothes: [
            { name: 'grey coat', state: 'on, buttoned' },
            { name: 'boots', state: 'off, by the hearth' }
          ]
        }
      ]
    }
    const p = checkPlan(
      raw({
        relies: [
          // The piece it names, in the stage's words.
          { who: 'Wren', what: 'wearing', value: 'her boots on' },
          // A thing in the place, in the stage's words; one the stage doesn't have and nothing gave it: left out.
          { who: '', what: 'thing', value: 'the door: open' },
          { who: '', what: 'object', value: 'the lamp: lit' }
        ],
        changes: [
          // Moves that need no asking: dressing, picking things up, a hand on an arm.
          { who: 'Wren', what: 'wearing', from: 'boots off', to: 'boots on, laced', how: 'Wren pulls her boots on and laces them.' },
          { who: 'Wren', what: 'thing', from: 'the survey case: on the windowsill', to: 'gone', how: 'Wren picks up the survey case.' },
          { who: 'Wren', what: 'touching', from: '', to: "a hand on Osric's arm", how: "Wren lays a hand on Osric's arm." },
          // Already so: her coat is on.
          { who: 'Wren', what: 'wearing', from: '', to: 'grey coat', how: 'Wren puts on her grey coat.' },
          // Starts from a door that isn't open.
          { who: 'Wren', what: 'thing', from: 'the door: open', to: 'the door: shut', how: 'Wren shuts the door.' },
          // Seeing someone can be what happens: only when the card calls for it.
          { who: 'Wren', what: 'sees', from: '', to: 'sees a stranger at the window', how: 'Wren sees a stranger at the window.' }
        ]
      }),
      world({ stand })
    )
    expect(p.keep).toEqual(['Wren: boots off, by the hearth', 'The door: shut and barred from inside'])
    expect(p.changes).toEqual([
      'Wren, wearing: boots off → boots on, laced. Wren pulls her boots on and laces them.',
      'Wren, the survey case: on the windowsill → gone. Wren picks up the survey case.',
      "Wren, touching: now a hand on Osric's arm. Wren lays a hand on Osric's arm."
    ])
    expect(p.checked).toEqual({ corrected: 2, dropped: 4 })
    expect(fieldOf('touching')).toBe('touching')
    expect(fieldOf('sees')).toBe('sees')
    expect(fieldOf('thing')).toBe('thing')
    expect(contradicts('the door: barred', 'the door: open')).toBe(true)
    expect(contradicts('the lamp lit', 'the lamp out')).toBe(true)
  })

  it('a later day, or a gap not known: only injuries; another story: none of the stage', () => {
    const relies = [
      { who: 'Wren', what: 'wearing', value: 'a red coat' },
      { who: 'Wren', what: 'condition', value: 'bruised' }
    ]
    const later = checkPlan(raw({ relies }), world({ reach: 'later' }))
    expect(later.keep).toEqual(['Wren: left arm in a sling'])
    const none = checkPlan(raw({ relies, changes: [{ who: 'Wren', what: 'wearing', from: '', to: 'linen shirt, boots off by the hatch', how: 'Wren dresses.' }] }), world({ reach: 'none' }))
    expect(none.keep).toEqual([])
    // Nothing on the stage holds here, so dressing as she was is no "already so".
    expect(none.changes).toEqual(['Wren, wearing: now linen shirt, boots off by the hatch. Wren dresses.'])
  })

  it("leaves out a change that is already so, starts from what the stage says isn't so, or is the dead's", () => {
    const p = checkPlan(
      raw({
        changes: [
          { who: 'Wren', what: 'wearing', from: 'boots on', to: 'boots off', how: 'Wren pulls off her boots.' },
          { who: 'Wren', what: 'position', from: 'sitting on a sack', to: 'sitting on a sack', how: 'Wren sits down.' },
          { who: 'Abbot Fen', what: 'where', from: '', to: 'the loft', how: 'The abbot climbs into the loft.' },
          { who: 'Wren', what: 'position', from: 'sitting on a sack', to: 'standing at the hatch', how: 'Wren gets up and goes to the hatch.' },
          { who: 'Osric Hale', what: 'where', from: '', to: 'the loft', how: '' },
          { who: 'Osric Hale', what: 'where', from: '', to: 'the loft', how: '' }
        ]
      }),
      world()
    )
    expect(p.changes).toEqual(['Wren, position: sitting on a sack → standing at the hatch. Wren gets up and goes to the hatch.', 'Osric Hale, where: now the loft.'])
    expect(p.checked.dropped).toBe(3)
  })

  it('has no event happen that the scene card (or the beat) does not call for; moving and dressing need no asking', () => {
    const changes = [
      { who: 'Osric Hale', what: 'where', from: 'the foot of the stairs', to: 'the loft', how: 'Osric climbs the ladder to the loft.' },
      { who: '', what: 'fact', from: '', to: '', how: 'They argue about the failing weir.' },
      { who: '', what: 'fact', from: '', to: '', how: 'A stranger bursts in with a crossbow.' },
      { who: 'Wren', what: 'condition', from: '', to: 'a broken wrist', how: 'Wren breaks her wrist on the hatch.' },
      // Someone not on the card turning up is an event too.
      { who: 'Mara', what: 'where', from: '', to: 'the loft', how: 'Mara climbs into the loft.' }
    ]
    expect(checkPlan(raw({ changes }), world()).changes).toEqual([
      'Osric Hale, where: the foot of the stairs → the loft. Osric climbs the ladder to the loft.',
      'They argue about the failing weir.'
    ])
    // For one beat: only what that beat calls for.
    const beat = checkPlan(raw({ changes }), world({ calls: 'Beat 1 of 2: Osric climbs up to the loft' }))
    expect(beat.changes).toEqual(['Osric Hale, where: the foot of the stairs → the loft. Osric climbs the ladder to the loft.'])
  })

  it('never lets out what is kept from someone in the scene, unless the scene card says so', () => {
    const tells = { who: 'Wren', what: 'fact', from: '', to: '', how: 'Wren tells Osric the flour tax was forged.' }
    const p = checkPlan(raw({ changes: [tells], relies: [{ who: '', what: 'fact', value: 'The flour tax was forged' }] }), world({ material: `${MATERIAL}\nKept from Osric Hale: The flour tax was forged.`, calls: `${CARD}\nThe flour tax comes up.` }))
    expect(p.changes).toEqual([])
    expect(p.keep).toEqual([])
    const card = `${CARD}\n3. Wren confesses that the flour tax was forged`
    expect(checkPlan(raw({ changes: [tells] }), world({ card, calls: card })).changes).toEqual(['Wren tells Osric the flour tax was forged.'])
  })

  it('finds what it asks for by its name or other name exactly, never what the briefing has or Adam kept out, and only a few', () => {
    const w = world()
    const p = checkPlan(raw({ needs: ['the old weir', 'The mill', 'The black ledger', 'the tithe ledger (an item)', 'Nobody', 'the mill where Mara hid'] }), w)
    expect(p.needs).toEqual([w.weir.id, w.ledger.id])
    expect(checkPlan(raw({ needs: ['Weir'] }), w).needs).toEqual([w.weir.id])
    const many = Array.from({ length: 8 }, (_, i) => entry('place', `Room ${i}`))
    const q = checkPlan(raw({ needs: many.map((e) => e.name) }), world({ entries: many }))
    expect(q.needs).toHaveLength(PLAN_MOST.needs)
  })

  it("is written as the writer's own notes, leading into the prose; nothing when it says nothing", () => {
    const text = planText({ keep: ['Wren: left arm in a sling'], changes: ['Wren gets up.', 'Someone knocks.'] }, false)
    expect(text).toBe(
      `${PLAN_HEAD}\nWhat the scene rests on, as things stand:\n- Wren: left arm in a sling\nWhat changes on the page, in order:\n1. Wren gets up.\n2. Someone knocks.\n${PLAN_GO.start}`
    )
    expect(planText({ keep: [], changes: ['Wren gets up.'] }, true).endsWith(PLAN_GO.here)).toBe(true)
    expect(planText({ keep: [], changes: [] }, false)).toBe('')
  })

  it('the whole shape: the point, who is where, the beats, what changes, what must stay true and the closing image', () => {
    const p = {
      point: { wants: 'to keep the ledger from Osric', against: 'Osric has the key', turn: 'she gives it up to save the mill' },
      whoWhere: ['Wren: in the loft', 'Osric Hale: at the hatch'],
      keep: ['Wren: left arm in a sling'],
      beats: ['Osric climbs up', 'They argue about the weir', 'Wren hands him the ledger'],
      changes: ['Wren hands Osric the ledger.'],
      mustStay: ['Osric does not know the flour tax was forged'],
      closing: 'The ladder, empty'
    }
    expect(planText(p, false, { pov: 'Wren' })).toBe(
      [
        PLAN_HEAD,
        'The point: Wren wants: to keep the ledger from Osric. Against it: Osric has the key. How it turns: she gives it up to save the mill.',
        'Who is where: Wren: in the loft; Osric Hale: at the hatch.',
        'What the scene rests on, as things stand:\n- Wren: left arm in a sling',
        'The beats, in order:\n1. Osric climbs up\n2. They argue about the weir\n3. Wren hands him the ledger',
        'What changes on the page, in order:\n1. Wren hands Osric the ledger.',
        'What must stay true:\n- Osric does not know the flour tax was forged',
        'It ends on: The ladder, empty.',
        PLAN_GO.start
      ].join('\n')
    )
    // Beat by beat: the scene's plan, saying which beat is now; the closing image only with the last beat.
    const two = planText(p, true, { beat: { index: 2, of: 3 } })
    expect(two).toContain('The beats, in order (I write only beat 2 of 3 now, and stop at its end):\n1. Osric climbs up\n2. They argue about the weir (now)')
    expect(two).toContain('What changes on the page, in order, over the whole scene:')
    expect(two).not.toContain('It ends on')
    expect(planText(p, true, { beat: { index: 3, of: 3 } })).toContain('It ends on: The ladder, empty.')
    // The planner's own sentence for what someone wants is never said twice.
    expect(planText({ ...p, point: { wants: 'Wren wants Osric gone', against: '', turn: '' } }, false, { pov: 'Wren' })).toContain(
      'The point: Wren wants Osric gone.\n'
    )
  })

  it('never plans again a beat already on the page', () => {
    const p = checkPlan(raw({ beats: ['Osric climbs up the ladder to the loft', 'They argue about the failing weir'] }), {
      ...world(),
      done: ['Beat 1: Osric climbs up to the loft']
    })
    expect(p.beats).toEqual(['They argue about the failing weir'])
  })

  it('where the stage says nothing, takes what people wear and hold from the story index, else from what it was given (2026-10-19)', () => {
    // A new scene with nothing known of where things stand: before, every starting fact not on the card was dropped.
    const known = { wren: { wearing: ['oilskin coat'], holding: ['the survey case'] } }
    const w = world({ stand: null, reach: 'none', known, material: `${MATERIAL}\n\n## Looked up\nOsric Hale: carrying a lantern (since Ch 1, Sc 2)` })
    const p = checkPlan(
      raw({
        relies: [
          { who: 'Wren', what: 'wearing', value: 'oilskin coat' },
          { who: 'Wren', what: 'holding', value: 'a silver knife' },
          { who: 'Osric Hale', what: 'holding', value: 'a lantern' },
          { who: 'Osric Hale', what: 'where', value: 'the foot of the stairs' }
        ]
      }),
      w
    )
    // The index's own words for Wren, what was looked up for Osric; where people were, never without the card.
    expect(p.keep).toEqual(['Wren is wearing: oilskin coat', 'Wren is holding: the survey case', 'Osric Hale is holding: a lantern'])
    expect(p.checked).toEqual({ corrected: 1, dropped: 1 })
  })

  it('keeps the shape only where it is safe: no stranger, no secret, who is where for those here, what must stay true as given', () => {
    const p = checkPlan(
      raw({
        wants: 'Wren wants Osric gone before dawn',
        against: 'Osric means to search the loft',
        turn: 'Wren tells Osric the flour tax was forged',
        beats: ['Osric climbs up to the loft', 'A stranger bursts in with a crossbow', 'Mara arrives at the hatch', 'They argue about the weir'],
        whoWhere: ['Wren: in the loft', 'Mara: at the door', 'Abbot Fen: by the wheel', 'nobody here'],
        mustStay: ['Wren has a burn scar on her right hand', 'Osric owns the mill'],
        closing: 'Osric alone at the foot of the stairs'
      }),
      world()
    )
    expect(p.point).toEqual({ wants: 'Wren wants Osric gone before dawn', against: 'Osric means to search the loft', turn: '' })
    expect(p.beats).toEqual(['Osric climbs up to the loft', 'They argue about the weir'])
    expect(p.whoWhere).toEqual(['Wren: in the loft'])
    expect(p.mustStay).toEqual(['Wren has a burn scar on her right hand'])
    expect(p.closing).toBe('Osric alone at the foot of the stairs')
    expect(p.checked.dropped).toBe(7)
  })
})

describe('what the plan rests on, and what changes, said whole (stand-in test, 2026-10-19)', () => {
  // A stand-in test found the boots on the hearth, the coat on its peg and Ash out at the stable dropped: only words the
  // planner read word for word in the last few hundred words of the scene were taken.
  const soFar = [
    'Wren came in out of the rain and lit the lamp. She pulled her boots off and set them by the hearth. She hung her coat on its peg by the door.',
    'Ash went out to the stable to see to the horses.',
    // Hundreds of words later, the scene's latest word on the lamp.
    Array.from({ length: 60 }, () => 'The rain kept on at the shutters.').join(' '),
    'She blew the lamp out and sat in the dark.'
  ].join('\n\n')
  const previous = 'They rode hard for the ford. The bridge at Carrow was down, the river over its stones.'
  const stand: SceneState = { time: '', weather: '', light: '', characters: [{ ...blank, name: 'Wren', where: 'the inn parlour' }] }
  const relies = [
    // Set up earlier in the scene so far, in other words.
    { who: 'Wren', what: 'thing', value: 'her boots on the hearth' },
    { who: '', what: 'thing', value: 'her coat on its peg' },
    { who: 'Ash', what: 'where', value: 'out at the stable' },
    // The end of the previous scene.
    { who: '', what: 'fact', value: 'the bridge at Carrow is down' },
    // What was looked up in this plan's own call.
    { who: 'Osric Hale', what: 'holding', value: 'a lantern' },
    // Never: invented, a secret kept from someone here, or what the scene's latest words say otherwise of.
    { who: 'Wren', what: 'holding', value: 'a silver knife' },
    { who: '', what: 'fact', value: 'The flour tax was forged' },
    { who: '', what: 'thing', value: 'the lamp: lit' }
  ]
  const w = (over: Partial<CheckWith> = {}): CheckWith =>
    world({
      stand,
      soFar,
      previous,
      material: `${MATERIAL}\nThe flour tax was forged.\n\n## Looked up\nOsric Hale: carrying a lantern (since Ch 1, Sc 2)`,
      ...over
    })

  it('takes a fact the scene so far, the previous scene’s end, the story index or a look-up backs, in other words too', () => {
    const p = checkPlan(raw({ relies }), w())
    expect(p.keep).toEqual([
      'Her boots on the hearth',
      'Her coat on its peg',
      'Where Ash is: out at the stable',
      'the bridge at Carrow is down',
      'Osric Hale is holding: a lantern'
    ])
    expect(p.checked.dropped).toBe(3)
    // Without the scene so far and the scene before, only what the planner read in so many words.
    expect(checkPlan(raw({ relies }), w({ soFar: undefined, previous: undefined })).keep).toEqual(['Osric Hale is holding: a lantern'])
  })

  it('backs a value in other words only with every word that matters, never words saying otherwise', () => {
    expect(saysIn('boots off, by the hearth', 'Wren', 'She set her boots by the hearth to dry.')).toBe(true)
    expect(saysIn('boots off, by the hearth', 'Wren', 'She pulled her boots on by the hearth.')).toBe(false)
    expect(saysIn('the door barred', '', 'The door stood shut.')).toBe(false)
    expect(saysIn('out at the stable', 'Ash', 'Ash went out to the stable.')).toBe(true)
    // One word that matters, and nothing to say whose: not enough.
    expect(saysIn('out at the stable', 'Ash', 'The stable roof leaked.')).toBe(false)
    expect(latestSaysOtherwise('the lamp lit', 'Wren lit the lamp. Later she blew the lamp out.')).toBe(true)
    expect(latestSaysOtherwise('the lamp lit', 'The lamp was out. Wren lit the lamp again.')).toBe(false)
    // "On the hearth" says where, not how: no clash with boots taken off.
    expect(contradicts('her boots on the hearth', 'She pulled her boots off')).toBe(false)
    expect(contradicts('her boots on', 'She pulled her boots off')).toBe(true)
  })

  it('a change line says who, what, from and to, with how it happens when that adds something', () => {
    expect(changeLine({ who: 'Wren', what: 'holding', from: 'the key', to: 'nothing', how: 'She sets it down on the table.' })).toBe(
      'Wren, holding: the key → nothing. She sets it down on the table.'
    )
    expect(changeLine({ who: 'Osric Hale', what: 'knows', from: '', to: 'the tax was forged', how: 'Wren tells him.' })).toBe(
      'Osric Hale learns: the tax was forged. Wren tells him.'
    )
    expect(changeLine({ who: '', what: 'thing', from: 'the door: unbarred', to: 'the door: barred from inside', how: 'Wren bars the door.' })).toBe(
      'The door: unbarred → barred from inside. Wren bars the door.'
    )
    // How it happens says nothing more: left out.
    expect(changeLine({ who: 'Ash', what: 'where', from: 'the kitchen', to: 'the yard', how: 'the kitchen to the yard' })).toBe('Ash, where: the kitchen → the yard.')
    // Only how: whose it is, before it.
    expect(changeLine({ who: 'Wren', what: 'mood', from: '', to: '', how: 'She softens.' })).toBe('Wren: She softens.')
  })
})

describe('the plan as Continue gets it (stand-in test, 2026-10-19)', () => {
  const p = {
    point: { wants: 'to keep the ledger', against: '', turn: '' },
    beats: ['Osric climbs up', 'They argue about the weir', 'Wren hands him the ledger'],
    mustStay: ['Osric does not know the tax was forged'],
    closing: 'The ladder, empty'
  }

  it('the beats on the page marked done, the next marked, the rest as they come', () => {
    const t = planForContinue(p, 'Wren', { done: 1 })
    expect(t).toContain(
      'The beats, in order:\n1. Osric climbs up (done: on the page already)\n2. They argue about the weir (next: write this now)\n3. Wren hands him the ledger\n'
    )
    expect(t).not.toContain('the plan is complete')
    expect(planForContinue(p, 'Wren')).toContain('1. Osric climbs up (next: write this now)')
  })

  it('every beat on the page: the plan is complete, carry on towards the card’s outcome and the closing image', () => {
    const t = planForContinue(p, 'Wren', { done: 3, outcome: 'Osric leaves with the ledger.' })
    expect(t).toContain('3. Wren hands him the ledger (done: on the page already)')
    expect(t).toContain(
      "Every beat of the plan is on the page: the plan is complete. Add no new beats of your own: carry on towards the scene card's outcome (Osric leaves with the ledger) and the image it ends on (The ladder, empty)."
    )
    expect(t).not.toContain('(next: write this now)')
  })
})

describe('room for the plan', () => {
  const block = (id: string, tokens: number, dropped = false): ContextBlock => ({ id, priority: 3, title: id, text: id, tokens, entryIds: [], dropped })
  const budget = (used: number, available = 1000, reserved = 500) => ({ contextLength: 4000, reserved, available, used })
  const before = { blocks: [block('previous-scene', 300), block('continuity', 100), block('ties', 50, true)], budget: budget(600) }

  it('is taken only when nothing the briefing had room for is lost', () => {
    expect(keepsRoom(before, { blocks: [...before.blocks, block('plan', 80)], budget: budget(680) })).toBe(true)
    // A part shortened, or left out, for it: no plan.
    expect(keepsRoom(before, { blocks: [block('previous-scene', 120), block('continuity', 100), block('ties', 50, true), block('plan', 80)], budget: budget(500) })).toBe(false)
    expect(keepsRoom(before, { blocks: [block('previous-scene', 300), block('continuity', 100, true), block('ties', 50, true), block('plan', 80)], budget: budget(580) })).toBe(false)
    // Less room for the reply (Auto's ceiling came down), or over the budget where it wasn't: no plan.
    expect(keepsRoom(before, { blocks: before.blocks, budget: budget(680, 1000, 400) })).toBe(false)
    expect(keepsRoom(before, { blocks: before.blocks, budget: budget(1100) })).toBe(false)
  })

  it('may take the room the scenes before word for word had, which go only in room to spare (2026-10-15)', () => {
    const spare = { ...before, blocks: [...before.blocks, block(EARLIER_BLOCK.id, 400)] }
    const shorter = [...before.blocks, block(EARLIER_BLOCK.id, 300), block('plan', 80)]
    expect(keepsRoom(spare, { blocks: shorter, budget: budget(880) })).toBe(true)
    const gone = [...before.blocks, block(EARLIER_BLOCK.id, 400, true), block('plan', 80)]
    expect(keepsRoom(spare, { blocks: gone, budget: budget(680) })).toBe(true)
  })

  it('what was left in this place is the plan’s to read again: shorter or gone with it is no loss (place memory)', () => {
    const left = { ...before, blocks: [...before.blocks, block('left-here', 40)] }
    expect(keepsRoom(left, { blocks: [...before.blocks, block('plan', 80)], budget: budget(640) })).toBe(true)
    expect(keepsRoom(left, { blocks: [...before.blocks, block('left-here', 20), block('plan', 80)], budget: budget(660) })).toBe(true)
  })
})

// ---------- What the planner reads ----------

function draftInput(over: Partial<ContextInput> = {}): ContextInput {
  const wren = entry('character', 'Wren', { summary: 'A miller’s daughter.' })
  const osric = entry('character', 'Osric Hale', { aliases: ['the reeve'] })
  const weir = entry('place', 'The weir')
  return {
    style: { ...defaultStyleGuide(), pov: 'Close third person', tense: 'Past tense', spelling: 'UK' },
    scene: { title: 'The hatch', card: { ...emptySceneCard(), povId: wren.id, presentIds: [wren.id, osric.id], beats: ['Osric climbs up'], when: 'Day 3, midnight' } },
    memory: {
      storyId: 'mill',
      sceneId: 'here',
      knows: '',
      previous: { sceneId: 'before', title: 'Before', text: 'The sleet came on, and the wheel stopped.', storyId: 'mill', storyTitle: 'The Mill', when: 'Day 3, dusk', otherStory: null },
      entries: [wren, osric, weir],
      firstHere: [],
      elsewhere: [],
      relationships: [],
      facts: [{ factId: 'f', fact: 'The flour tax was forged.', knownBy: [wren.id] }],
      threads: [],
      storySoFar: { scenes: [], chapters: [], stories: [], series: [], leadsInto: null },
      bringAbout: []
    },
    pins: [],
    blockModes: {},
    world: { themes: '', tone: '' },
    series: null,
    story: { title: 'The Mill', premise: '', themes: '', tone: '' },
    options: { direction: 'Keep it quiet.', targetWords: 800, creativity: 'balanced' },
    contextLength: 64_000,
    continuity: STAND,
    ...over
  }
}

const materialOf = (input: ContextInput, o: Parameters<typeof planMaterial>[3] = {}): PlanMaterial =>
  planMaterial(input, assembleContext(input, countRaw), prepareContext(input, { speakerTags: true }), o)

/** What the planner reads carrying on from the scene so far (Add below): the briefing with it, as a draft has it. */
function carryingOn(input: ContextInput): PlanMaterial {
  const p = prepareContext(input, { speakerTags: true, extraBlocks: [{ id: 'scene-so-far', title: 'The scene so far', text: input.soFar ?? '' }] })
  return planMaterial(input, finishContext(p, p.texts.map(countRaw)), p)
}

describe('what the planner reads', () => {
  it('the scene card, what must stay true, where things stand as it holds here, the words before and the codex', () => {
    const input = draftInput()
    const m = materialOf(input)
    expect(m.card).toContain('Beats, in order:\n1. Osric climbs up')
    expect(m.must).toContain('Wren: left arm in a sling')
    expect(m.reach).toBe('start')
    expect(m.standTitle).toBe('Where things stand as the previous scene ended')
    // Later the same day (Adam, 2026-10-16): injuries and what is still on, not where people were or how placed, nor the
    // boots taken off.
    expect(m.stand).toContain('- Wren: condition: left arm in a sling')
    expect(m.stand).toContain('linen shirt')
    expect(m.stand).not.toContain('the mill loft')
    expect(m.stand).not.toContain('sitting on a sack')
    expect(m.stand).not.toContain('boots off')
    expect(m.before).toEqual({ title: 'The end of the previous scene', text: 'The sleet came on, and the wheel stopped.' })
    // What is being written, in a line: not the writer's closing instruction, nor the reading-aloud tags.
    expect(m.ask).toBe('A whole scene, about 800 words.')
    expect(m.inBriefing).toEqual(['Wren (character): A miller’s daughter.', 'Osric Hale (character)'])
    expect(m.others).toEqual(['The weir (place)'])
    expect(m.people).toEqual(['Wren', 'Osric Hale'])
    expect(m.pov).toBe('Wren')
    expect(m.secrets).toEqual([{ fact: 'The flour tax was forged', knownBy: ['Wren'], keptFrom: ['Osric Hale'] }])
    expect(m.calls).toBe(m.card)
    const [system, user] = planMessages(m)
    expect(system.content.startsWith(PLAN_MARKER)).toBe(true)
    expect(system.content).toContain('Add no events of your own.')
    expect(system.content).toContain('- wants, against, turn:')
    expect(system.content).toContain('"closing_image": ""')
    expect(system.content).not.toContain('look it up with the tools')
    // Told it is how the scene before ended, and what of it may have changed.
    expect(user.content).toContain('## Where things stand as the previous scene ended\nThis was as the scene before ended, earlier the same day.')
    expect(user.content).toContain('## Also in the world (not in the briefing)\nThe weir (place)')
    expect(user.content).toContain('## What is being written\nA whole scene, about 800 words.')
    expect(user.content.trimEnd().endsWith('Plan the scene now, as one JSON object.')).toBe(true)
    // Adam's direction for a whole scene is on the card, once.
    expect(user.content.split('Keep it quiet.')).toHaveLength(2)
  })

  it('reads the open plot threads as the writer gets them, and plans no payoff the card does not ask for (2026-10-08)', () => {
    const input = draftInput()
    const bell = entry('thread', 'The drowned bell', { fields: { promise: 'Who rang the drowned bell?', clues: 'a coin on the bell' } })
    input.memory.entries.push(bell)
    input.memory.threads = [{ entryId: bell.id, status: 'open', setUp: 'The Mill, Ch 1, Sc 1', paidOff: '' }]
    const m = materialOf(input)
    expect(m.threads).toContain('- The drowned bell — Who rang the drowned bell? — last clue: a coin on the bell')
    const [system, user] = planMessages(m)
    expect(system.content).toContain('Open plot threads stay open: plan no payoff for one unless the scene card or the author')
    expect(user.content).toContain("## Open plot threads\nPlot threads still open in the story. Keep these alive.")
    // None open: no part for them.
    expect(planMessages(materialOf(draftInput()))[1].content).not.toContain('## Open plot threads')
  })

  it('after a gap not known it says only injuries surely carry on; from another story it gives none of it', () => {
    const gap = draftInput()
    gap.scene.card.when = 'Three weeks later'
    expect(planMessages(materialOf(gap))[1].content).toContain('Only injuries surely carry on')
    const other = draftInput()
    other.memory.previous = { ...other.memory.previous!, otherStory: { ended: true, timeGap: '200 years' } }
    const m = materialOf(other)
    expect(m.stand).toBe('')
    expect(planMessages(m)[1].content).not.toContain('## Where things stand')
  })

  it('gets the story index’s core: what has already happened, everyone here as things stand, and its threads with none of the writer’s', () => {
    const core = {
      storyId: 'mill',
      asItBegins: true,
      people: ['Wren: at the mill (since Ch 1, Sc 1)', 'Wren: wearing oilskin coat (since Ch 1, Sc 2)'],
      known: {},
      recent: ['Ch 1, Sc 1: The wheel stops in the sleet.', 'Ch 1, Sc 2: Osric counts the sacks.'],
      threads: ['The forged tax (open since Ch 1, Sc 1)'],
      left: ['Left here before: the ledger under the loose floorboard (since Ch 1, Sc 1)'],
      present: []
    }
    const m = materialOf(draftInput(), { core })
    const user = planMessages(m)[1].content
    expect(user).toContain(
      '## Already happened (a line a scene; never plan any of it again)\n- Ch 1, Sc 1: The wheel stops in the sleet.\n- Ch 1, Sc 2: Osric counts the sacks.'
    )
    expect(user).toContain('## Everyone in the scene, as things stand (from the story so far)\n- Wren: at the mill (since Ch 1, Sc 1)')
    expect(user).toContain('## Open plot threads\n- The forged tax (open since Ch 1, Sc 1)')
    // Place memory (2026-10-19): what was left in this place on an earlier visit.
    expect(user).toContain(
      '## Left in this place on an earlier visit (from the story so far)\n- Left here before: the ledger under the loose floorboard (since Ch 1, Sc 1)'
    )
  })

  it('sends what stays the same through a scene first, and what is being written (the direction, said once) last (for the cache)', () => {
    const input = draftInput()
    input.options = { ...input.options, addBelow: true, direction: 'Osric asks about the tax.' }
    input.soFar = 'Wren heard the ladder creak.'
    const m = carryingOn(input)
    expect(m.card).not.toContain("The author's direction")
    expect(m.ask).toBe(
      'The next stretch of the scene, carrying straight on from the end of the scene so far, at most about 800 words. Plan only this stretch: what the author directs:\nOsric asks about the tax.'
    )
    expect(m.calls).toBe(`${m.card}\n\nThe author's direction for this stretch:\nOsric asks about the tax.`)
    const user = planMessages(m)[1].content
    const heads = user.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.replace(/^## /, ''))
    expect(heads).toEqual(['The scene card', 'Must stay true', 'In the briefing', 'Also in the world (not in the briefing)', m.standTitle, m.before!.title, 'What is being written'])
    expect(user.split('Osric asks about the tax.')).toHaveLength(2)
    expect(user.trimEnd().endsWith(`${m.ask}\n\nPlan the scene now, as one JSON object.`)).toBe(true)
  })

  it('carrying on with no direction: the next beat not on the page, and the beats on the page as done', () => {
    const input = draftInput()
    input.scene.card.beats = ['Osric climbs up the ladder to the loft', 'They argue about the weir']
    input.options = { ...input.options, addBelow: true, direction: '' }
    input.soFar = 'Osric climbed up the ladder to the loft, slowly.'
    const m = carryingOn(input)
    expect(m.ask).toContain('Plan only this stretch: the next beat on the scene card, beat 2 of 2:\nThey argue about the weir')
    expect(m.done).toEqual(['Beat 1: Osric climbs up the ladder to the loft'])
    expect(planMessages(m)[1].content).toContain('## Already on the page in this scene (done: never plan it again)\n- Beat 1: Osric climbs up the ladder to the loft')
  })

  it('Beat by beat: the whole scene, one plan beat for each on the card; no "must" for a beat’s own contract', () => {
    const input = draftInput({ contract: { asks: 'beat', focus: 'Osric climbs up' } })
    const m = materialOf(input, { beats: true })
    expect(m.ask).toBe('The whole scene, written one beat at a time, about 800 words a beat. Give "beats" one line for each beat on the scene card not yet on the page, in the same order (1 in all).')
    expect(m.contract).toBeUndefined()
  })

  it('may look things up first: the instructions say so, and the last line asks for the look-ups or the plan', () => {
    const m = { ...materialOf(draftInput()), lookups: true }
    const [system, user] = planMessages(m)
    expect(system.content).toContain('look it up with the tools. Ask for everything you need at once: you get one round of look-ups.')
    expect(user.content.trimEnd().endsWith('Look up anything else the scene needs, all at once; or plan the scene now, as one JSON object.')).toBe(true)
    expect(planSystem(false, false, true).replace(`\n${LOOKUP_RULE}`, '')).toBe(planSystem())
  })

  it('told when the story means strong content, as every memory job is', () => {
    const m = { ...materialOf(draftInput()), contentNote: 'About this story: it is fiction for adult readers.' }
    expect(planMessages(m)[0].content.endsWith('\n\nAbout this story: it is fiction for adult readers.')).toBe(true)
  })
})

// ---------- The call ----------

const model: MemoryModel = {
  target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'test' },
  choice: { providerId: 'p1', modelId: 'fake/memory', label: 'fake', contextLength: 32000, promptPrice: null, completionPrice: null },
  thinking: 'off'
}

/** A stand-in model that answers every request with `reply`. */
function answering(reply: string): typeof fetch & { asked: { model: string; system: string }[] } {
  const asked: { model: string; system: string }[] = []
  const f = (async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { model: string; messages: { content: string }[] }
    asked.push({ model: body.model, system: body.messages[0].content })
    const chunk = { choices: [{ index: 0, delta: { content: reply }, finish_reason: 'stop' }] }
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  }) as typeof fetch & { asked: { model: string; system: string }[] }
  f.asked = asked
  return f
}

/** A stand-in model that never answers until it is stopped. */
const silent = (async (_input: unknown, init?: RequestInit) =>
  new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })))
  })) as typeof fetch

function call(
  fetchImpl: typeof fetch,
  over: { signal?: AbortSignal; limitMs?: number; db?: ReturnType<typeof memoryWorld>; preconditions?: (p: ScenePlan) => CanHappen } = {}
) {
  const db = over.db ?? memoryWorld()
  const sceneId = repo.getOutline(db, repo.listStories(db)[0].id).scenes[0].id
  const material: PlanMaterial = {
    ask: 'Write the scene now.',
    card: CARD,
    must: '- Wren: a burn scar on her right hand',
    reach: 'here',
    stand: '',
    standTitle: 'Where things stand',
    standNote: '',
    before: null,
    inBriefing: [],
    others: ['The weir (place)'],
    people: ['Wren', 'Osric Hale'],
    secrets: [],
    calls: CARD
  }
  const w = world()
  return {
    db,
    sceneId,
    done: makePlan({
      db,
      model,
      sceneId,
      material,
      check: { stand: w.stand, entries: w.entries, inBriefing: w.inBriefing, hidden: w.hidden },
      carryingOn: false,
      closed: () => false,
      fetchImpl,
      retryDelays: [],
      limitMs: over.limitMs,
      signal: over.signal,
      ...(over.preconditions ? { preconditions: over.preconditions } : {})
    }),
    w
  }
}

describe('making the plan', () => {
  it('asks the memory model once, keeps the call in a memory record, and gives back the checked plan', async () => {
    const reply = JSON.stringify({
      relies: [{ who: 'Wren', what: 'wearing', value: 'a red coat' }],
      changes: [{ who: 'Wren', what: 'position', from: 'sitting on a sack', to: 'standing', how: 'Wren stands to meet him.' }],
      needs: ['The weir']
    })
    const f = answering(reply)
    const { db, sceneId, done, w } = call(f)
    const plan = await done
    expect(f.asked).toHaveLength(1)
    expect(f.asked[0].system.startsWith(PLAN_MARKER)).toBe(true)
    expect(plan).toMatchObject({
      needs: [w.weir.id],
      text: `${PLAN_HEAD}\nWhat the scene rests on, as things stand:\n- Wren is wearing: linen shirt; boots off by the hatch\nWhat changes on the page, in order:\n1. Wren, position: sitting on a sack → standing. Wren stands to meet him.\n${PLAN_GO.start}`,
      must: [],
      checked: { corrected: 1, dropped: 0 }
    })
    expect(plan).not.toHaveProperty('lookedUp')
    expect(db.prepare('SELECT job, scene_id, status FROM generations').all()).toEqual([{ job: 'memory', scene_id: sceneId, status: 'complete' }])
  })

  it('checks each beat can happen: what must come first goes after its beat in the notes, and what can’t is kept on the record for Adam', async () => {
    const reply = JSON.stringify({ beats: ['Osric climbs up to the loft', 'Wren reads the letter to Osric'], relies: [], changes: [], needs: [] })
    let seen: string[] = []
    const { db, done } = call(answering(reply), {
      preconditions: (p) => {
        seen = p.beats
        return {
          notes: [{ beat: 1, note: 'First Wren must fetch the letter from the loft, where it was left under the loose board (Ch 1, Sc 1).' }],
          flags: ['Beat 1 (“Osric climbs up to the loft”) has Ash there, but Ash isn’t in this scene.']
        }
      }
    })
    const plan = await done
    expect(seen).toEqual(['Osric climbs up to the loft', 'Wren reads the letter to Osric'])
    expect(plan?.text).toContain(
      '1. Osric climbs up to the loft\n2. Wren reads the letter to Osric. First Wren must fetch the letter from the loft, where it was left under the loose board (Ch 1, Sc 1).'
    )
    expect(plan?.plan?.first).toEqual([{ beat: 1, note: expect.stringMatching(/^First Wren must fetch/) }])
    expect(plan?.flags).toEqual(['Beat 1 (“Osric climbs up to the loft”) has Ash there, but Ash isn’t in this scene.'])
    const id = (db.prepare('SELECT id FROM generations').get() as { id: string }).id
    const step = gens.getGeneration(db, id).params.steps?.find((s) => s.label === BEATS_CHECK_LABEL)
    expect(step?.result).toBe(
      'Added to the writer’s plan:\n- Beat 2 (“Wren reads the letter to Osric”): First Wren must fetch the letter from the loft, where it was left under the loose board (Ch 1, Sc 1).\n\nFor you to look at (the plan was left as it is):\n- Beat 1 (“Osric climbs up to the loft”) has Ash there, but Ash isn’t in this scene.'
    )
    // A check that finds nothing changes nothing, and one that fails leaves the plan as it was.
    const quiet = await call(answering(reply), { preconditions: () => ({ notes: [], flags: [] }) }).done
    expect(quiet?.text).toContain('1. Osric climbs up to the loft\n2. Wren reads the letter to Osric\n')
    expect(quiet).not.toHaveProperty('flags')
    const broken = await call(answering(reply), {
      preconditions: () => {
        throw new Error('index gone')
      }
    }).done
    expect(broken?.text).toBe(quiet?.text)
  })

  it(`only a scene's newest ${KEEP_PLAN_PROMPTS} planning calls keep their whole prompt`, async () => {
    const db = memoryWorld()
    const f = answering('{"relies": [], "changes": [{"who": "Wren", "what": "where", "to": "the hatch", "how": "Wren goes to the hatch."}], "needs": []}')
    for (let i = 0; i < KEEP_PLAN_PROMPTS + 2; i++) await call(f, { db }).done
    const kept = db.prepare("SELECT count(*) AS n FROM generations WHERE job = 'memory' AND messages_json <> '[]'").get() as { n: number }
    expect(kept.n).toBe(KEEP_PLAN_PROMPTS)
  })

  it('no plan when the reply is no use, the call fails, takes too long or is stopped', async () => {
    expect(await call(answering('The scene should be tense.')).done).toBeNull()
    expect(await call(answering('{"relies": [], "changes": [], "needs": []}')).done).toBeNull()
    const failing = (async () => new Response(JSON.stringify({ error: { message: 'No endpoints found' } }), { status: 404 })) as typeof fetch
    expect(await call(failing).done).toBeNull()
    // Too long: stopped at the limit, and the draft goes on without it.
    const started = Date.now()
    const late = call(silent, { limitMs: 80 })
    expect(await late.done).toBeNull()
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(late.db.prepare('SELECT status FROM generations').get()).toEqual({ status: 'stopped' })
    // Adam stopped the draft before it began.
    const stop = new AbortController()
    const stopped = call(silent, { signal: stop.signal, limitMs: 60_000 })
    setTimeout(() => stop.abort(), 20)
    expect(await stopped.done).toBeNull()
    const already = new AbortController()
    already.abort()
    const f = answering('{}')
    expect(await call(f, { signal: already.signal }).done).toBeNull()
    expect(f.asked).toHaveLength(0)
  })

  it('may look things up first, one round answered here, then plans in the same exchange; what it looked up reaches the writer', async () => {
    const asked: { tools: string[]; toolChoice: unknown; messages: { role: string; content: string }[] }[] = []
    const reply = JSON.stringify({
      wants: 'Wren wants Osric gone',
      beats: ['Osric climbs up to the loft'],
      relies: [{ who: 'Wren', what: 'fact', value: 'Osric counted the sacks twice' }]
    })
    const sse = (delta: Record<string, unknown>, finish: string): Response =>
      new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`, {
        headers: { 'Content-Type': 'text/event-stream' }
      })
    const f = (async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        tools?: { function: { name: string } }[]
        tool_choice?: unknown
        messages: { role: string; content: string }[]
      }
      asked.push({ tools: (body.tools ?? []).map((t) => t.function.name), toolChoice: body.tool_choice ?? null, messages: body.messages })
      if (asked.length === 1) {
        const call = { index: 0, id: 'c1', type: 'function', function: { name: 'find_in_story', arguments: '{"query": "the sacks"}' } }
        return sse({ tool_calls: [call] }, 'tool_calls')
      }
      return sse({ content: reply }, 'stop')
    }) as typeof fetch
    const db = memoryWorld()
    const sceneId = repo.getOutline(db, repo.listStories(db)[0].id).scenes[0].id
    const w = world()
    const plan = await makePlan({
      db,
      model,
      sceneId,
      material: {
        ask: 'A whole scene, about 600 words.',
        card: CARD,
        must: '',
        reach: 'here',
        stand: '',
        standTitle: 'Where things stand',
        standNote: '',
        before: null,
        inBriefing: [],
        others: [],
        people: ['Wren', 'Osric Hale'],
        secrets: [],
        calls: CARD
      },
      check: { stand: w.stand, entries: w.entries, inBriefing: w.inBriefing, hidden: w.hidden },
      carryingOn: false,
      lookups: {
        db,
        sceneId,
        storyId: 'story',
        asItBegins: true,
        entries: w.entries,
        people: ['Wren', 'Osric Hale'],
        hidden: new Set(),
        find: async () => [{ where: 'Ch 1, Sc 4', text: 'Osric counted the sacks twice, and said nothing of the tax.' }]
      },
      closed: () => false,
      fetchImpl: f,
      retryDelays: []
    })
    // Two requests: the first offered the look-ups, the second (with their answers) asked for the plan with the tools
    // still listed and none to be called (tool_choice 'none'), so it starts as the first did (the cache, 2026-10-19).
    expect(asked).toHaveLength(2)
    expect(asked[0].tools).toContain('find_in_story')
    expect(asked[0].messages[0].content).toContain('you get one round of look-ups')
    expect(asked[1].tools).toEqual(asked[0].tools)
    expect(asked[1].toolChoice).toBe('none')
    expect(asked[1].messages.find((m) => m.role === 'tool')?.content).toBe('### Ch 1, Sc 4\nOsric counted the sacks twice, and said nothing of the tax.')
    expect(asked[1].messages[asked[1].messages.length - 1].content).toBe('Now plan the scene, as one JSON object. Reply with only the JSON object.')
    // The fact it relied on is in what it looked up, so it is kept; the passage goes to the writer beside the plan.
    expect(plan?.text).toContain('- Wren: Osric counted the sacks twice')
    expect(plan?.text).toContain('The beats, in order:\n1. Osric climbs up to the loft')
    expect(plan?.lookedUp).toContain('### Ch 1, Sc 4\nOsric counted the sacks twice, and said nothing of the tax.')
    // One record, with each request and what was looked up, for "What the AI saw".
    const rec = gens.listGenerations(db, sceneId)
    expect(rec).toHaveLength(0)
    const row = db.prepare("SELECT job, params_json FROM generations WHERE job = 'memory'").get() as { job: string; params_json: string }
    const params = JSON.parse(row.params_json) as { steps: { tool: string }[]; requests: unknown[] }
    expect(params.steps.map((s) => s.tool)).toEqual(['find_in_story'])
    expect(params.requests).toHaveLength(2)
  })

  it('no plan when the memory model turns the scene down, and the top bar is told the draft went without one', async () => {
    const { db, sceneId, done } = call(answering("I'm sorry, but I can't help with this request. It involves explicit sexual content."))
    expect(await done).toBeNull()
    // The call's record keeps the reply as it came; no plan is made of it.
    expect(db.prepare('SELECT job FROM generations').get()).toEqual({ job: 'memory' })
    expect(refusalsOf(db)).toMatchObject([{ task: 'plan', model: 'memory', sceneId }])
  })
})

// ---------- The scene's contract (long story memory fix 13) ----------

describe('what must change, for the scene’s contract (fix 13)', () => {
  it('is asked for only when the draft has a contract; otherwise the planner’s instructions are as they always were', () => {
    expect(planSystem()).not.toContain('"must"')
    expect(planSystem(true)).toContain('- must: what must be different by the end of what is being written')
    expect(planSystem(true)).toContain('"needs": [""], "must": [""]}')
    expect(planSystem(true).replace(/\n- must: [^\n]*/, '').replace(', "must": [""]', '')).toBe(planSystem())
    const plain = materialOf(draftInput())
    expect(plain.contract).toBeUndefined()
    expect(planMessages(plain)[0].content).toBe(planSystem())
    const asked = materialOf(draftInput({ contract: { asks: 'scene' } }))
    expect(asked.contract).toBe(true)
    expect(planMessages(asked)[0].content).toBe(planSystem(true))
  })

  it('is read from the reply, and kept only when the card, the beat or the direction calls for it, never a secret let out', () => {
    expect(readPlan('{"must": ["Osric reaches the loft", {"text": "They argue about the weir"}, 3, ""]}')!.must).toEqual([
      'Osric reaches the loft',
      'They argue about the weir'
    ])
    const must = [
      'Osric reaches the loft',
      'Osric and Wren argue about the failing weir',
      'A stranger bursts in with a crossbow',
      'Wren tells Osric the flour tax was forged',
      'Osric reaches the loft'
    ]
    const p = checkPlan(raw({ must }), world())
    expect(p.must).toEqual(['Osric reaches the loft', 'Osric and Wren argue about the failing weir'])
    expect(p.checked.dropped).toBe(2)
    // At most a handful.
    const many = Array.from({ length: 9 }, (_, i) => `They argue about the weir, round ${i + 1}`)
    expect(checkPlan(raw({ must: many }), world()).must).toHaveLength(PLAN_MOST.must)
  })

  it('the planner is told what the contract keeps to, which what must stay true no longer says', () => {
    const input = draftInput({ contract: { asks: 'scene' } })
    const m = materialOf(input)
    // The injury went into the contract's list of what must not change: the planner still reads it.
    expect(assembleContext(input, countRaw).blocks.find((b) => b.id === CONTRACT_BLOCK.id)!.text).toContain('Wren: left arm in a sling')
    expect(m.must).toContain('Wren: left arm in a sling')
  })

  it('may change the contract’s block: what it says must change takes the place of the card’s words', () => {
    const block = (id: string, tokens: number): ContextBlock => ({ id, priority: 2, title: id, text: id, tokens, entryIds: [], dropped: false })
    const budget = { contextLength: 4000, reserved: 500, available: 1000, used: 600 }
    const before = { blocks: [block('continuity', 100), block(CONTRACT_BLOCK.id, 120)], budget }
    expect(keepsRoom(before, { blocks: [block('continuity', 100), block(CONTRACT_BLOCK.id, 90), block('plan', 80)], budget: { ...budget, used: 650 } })).toBe(true)
  })

  it('a plan that says only what must change is still a plan, with a contract; without one it says nothing', async () => {
    const reply = '{"relies": [], "changes": [], "needs": [], "must": ["Osric reaches the loft"]}'
    const db = memoryWorld()
    const sceneId = repo.getOutline(db, repo.listStories(db)[0].id).scenes[0].id
    const w = world()
    const material: PlanMaterial = {
      ask: 'Write the scene now.',
      card: CARD,
      must: '',
      reach: 'here',
      stand: '',
      standTitle: 'Where things stand',
      standNote: '',
      before: null,
      inBriefing: [],
      others: [],
      people: ['Wren', 'Osric Hale'],
      secrets: [],
      calls: CARD
    }
    const make = (contract: boolean) =>
      makePlan({
        db,
        model,
        sceneId,
        material: { ...material, ...(contract ? { contract: true } : {}) },
        check: { stand: w.stand, entries: w.entries, inBriefing: w.inBriefing, hidden: w.hidden },
        carryingOn: false,
        closed: () => false,
        fetchImpl: answering(reply),
        retryDelays: []
      })
    expect(await make(true)).toMatchObject({ needs: [], text: '', must: ['Osric reaches the loft'], checked: { corrected: 0, dropped: 0 } })
    expect(await make(false)).toBeNull()
  })
})
