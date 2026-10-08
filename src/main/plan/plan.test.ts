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
import type { MemoryModel } from '../keeper/model'
import type { Secret } from '../ai/mustStay'
import { assembleContext, prepareContext, type ContextInput } from '../ai/context'
import { countRaw } from '../ai/tokens'
import {
  checkPlan,
  contradicts,
  fieldOf,
  KEEP_PLAN_PROMPTS,
  keepsRoom,
  makePlan,
  PLAN_GO,
  PLAN_HEAD,
  PLAN_MARKER,
  PLAN_MOST,
  planMaterial,
  planMessages,
  planText,
  readPlan,
  type CheckWith,
  type PlanMaterial,
  type RawPlan
} from './plan'

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
    expect(r).toEqual({
      relies: [{ who: 'Wren', what: 'wearing', value: 'linen shirt' }],
      changes: [{ who: 'Wren', what: '', from: '', to: '', how: 'She stands.' }],
      needs: ['The weir', 'The tithe ledger']
    })
    expect(readPlan('{}')).toEqual({ relies: [], changes: [], needs: [] })
    expect(readPlan('The scene should be tense.')).toBeNull()
    expect(readPlan('[1, 2]')).toBeNull()
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
    expect(p.changes).toEqual(['Wren walks back towards the mill.', 'Wren sits on a sack.'])
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
      'Wren pulls her boots on and laces them.',
      'Wren picks up the survey case.',
      "Wren lays a hand on Osric's arm."
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
    expect(none.changes).toEqual(['Wren dresses.'])
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
    expect(p.changes).toEqual(['Wren gets up and goes to the hatch.', 'Osric Hale: where now the loft'])
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
    expect(checkPlan(raw({ changes }), world()).changes).toEqual(['Osric climbs the ladder to the loft.', 'They argue about the failing weir.'])
    // For one beat: only what that beat calls for.
    const beat = checkPlan(raw({ changes }), world({ calls: 'Beat 1 of 2: Osric climbs up to the loft' }))
    expect(beat.changes).toEqual(['Osric climbs the ladder to the loft.'])
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
      `${PLAN_HEAD}\nWhat the scene rests on, as things stand:\n- Wren: left arm in a sling\nWhat happens on the page, in order:\n1. Wren gets up.\n2. Someone knocks.\n${PLAN_GO.start}`
    )
    expect(planText({ keep: [], changes: ['Wren gets up.'] }, true).endsWith(PLAN_GO.here)).toBe(true)
    expect(planText({ keep: [], changes: [] }, false)).toBe('')
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

const materialOf = (input: ContextInput, focus = ''): PlanMaterial =>
  planMaterial(input, assembleContext(input, countRaw), prepareContext(input, { speakerTags: true }), focus)

describe('what the planner reads', () => {
  it('the scene card, what must stay true, where things stand as it holds here, the words before and the codex', () => {
    const input = draftInput()
    const m = materialOf(input)
    expect(m.card).toContain('Beats, in order:\n1. Osric climbs up')
    expect(m.must).toContain('Wren: left arm in a sling')
    expect(m.reach).toBe('start')
    expect(m.standTitle).toBe('Where things stand as the previous scene ended')
    expect(m.stand).toContain('- Wren: where: the mill loft')
    expect(m.before).toEqual({ title: 'The end of the previous scene', text: 'The sleet came on, and the wheel stopped.' })
    expect(m.ask.startsWith('Write the scene now.')).toBe(true)
    // Not the reading-aloud tags: the planner writes none of the prose.
    expect(m.ask).not.toContain('curly braces')
    expect(m.inBriefing).toEqual(['Wren (character): A miller’s daughter.', 'Osric Hale (character)'])
    expect(m.others).toEqual(['The weir (place)'])
    expect(m.people).toEqual(['Wren', 'Osric Hale'])
    expect(m.secrets).toEqual([{ fact: 'The flour tax was forged', knownBy: ['Wren'], keptFrom: ['Osric Hale'] }])
    expect(m.calls).toBe(m.card)
    const [system, user] = planMessages(m)
    expect(system.content.startsWith(PLAN_MARKER)).toBe(true)
    expect(system.content).toContain('Add no events of your own.')
    expect(system.content).not.toContain('a secret told')
    // Told it is how the scene before ended, and what of it may have changed.
    expect(user.content).toContain('## Where things stand as the previous scene ended\nThis was as the scene before ended, earlier the same day.')
    expect(user.content).toContain('## Also in the world (not in the briefing)\nThe weir (place)')
    expect(user.content.trimEnd().endsWith('Plan the scene now, as one JSON object.')).toBe(true)
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

  it('sends the card, what must stay true and the codex first, and what the writer is asked and the direction last (for the cache)', () => {
    const input = draftInput()
    input.options = { ...input.options, addBelow: true, direction: 'Osric asks about the tax.' }
    const m = materialOf(input)
    expect(m.card).not.toContain("The author's direction")
    expect(m.direction).toBe("The author's direction for this stretch:\nOsric asks about the tax.")
    expect(m.calls).toBe(`${m.card}\n\n${m.direction}`)
    const user = planMessages(m)[1].content
    const heads = user.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.replace(/^## /, ''))
    expect(heads).toEqual(['The scene card', 'Must stay true', 'In the briefing', 'Also in the world (not in the briefing)', m.standTitle, m.before!.title, 'What the writer is asked'])
    expect(user.trimEnd().endsWith(`${m.ask.trim()}\n\n${m.direction}\n\nPlan the scene now, as one JSON object.`)).toBe(true)
  })

  it('only the order changes: the same parts, each word for word, as when what the writer is asked came first', () => {
    const input = draftInput()
    input.options = { ...input.options, addBelow: true, direction: 'Osric asks about the tax.' }
    const m = materialOf(input)
    const parts = planMessages(m)[1].content.split('\n\n## ')
    // The order before: the ask, the card with the direction, must stay true, the stage, the words before, the codex.
    const part = (title: string, body: string): string => `## ${title}\n${body.trim()}`
    const before = [
      part('What the writer is asked', m.ask),
      part('The scene card', `${m.card}\n\n${m.direction}`),
      part('Must stay true', m.must),
      part(m.standTitle, [m.standNote, m.stand].filter(Boolean).join('\n')),
      part(m.before!.title, `"""\n${m.before!.text}\n"""`),
      part('In the briefing', m.inBriefing.map((l) => `- ${l}`).join('\n')),
      part('Also in the world (not in the briefing)', m.others.join('; ')),
      'Plan the scene now, as one JSON object.'
    ].join('\n\n')
    const sorted = (s: string): string => s.split('\n').sort().join('\n')
    expect(sorted(planMessages(m)[1].content)).toBe(sorted(before))
    expect(parts).toHaveLength(7)
    // With no scene card, the direction stands as the card, as before.
    const bare = planMessages({ ...m, card: '' })[1].content
    expect(bare).toContain(`## The scene card\n${m.direction}`)
    expect(bare.match(/The author's direction/g)).toHaveLength(1)
  })

  it('for one beat: plans only that beat, which is what its events must answer to', () => {
    const m = materialOf(draftInput(), 'Beat 1 of 1: Osric climbs up')
    expect(m.calls).toBe('Beat 1 of 1: Osric climbs up\nKeep it quiet.')
    const user = planMessages(m)[1].content
    expect(user).toContain('## Plan only this beat\nBeat 1 of 1: Osric climbs up\nThe beats after it are written later: plan nothing from them.')
    expect(user.trimEnd().endsWith('Plan the beat now, as one JSON object.')).toBe(true)
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

function call(fetchImpl: typeof fetch, over: { signal?: AbortSignal; limitMs?: number; db?: ReturnType<typeof memoryWorld> } = {}) {
  const db = over.db ?? memoryWorld()
  const sceneId = repo.getOutline(db, repo.listStories(db)[0].id).scenes[0].id
  const material: PlanMaterial = {
    ask: 'Write the scene now.',
    card: CARD,
    direction: '',
    focus: '',
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
      signal: over.signal
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
    expect(plan).toEqual({
      needs: [w.weir.id],
      text: `${PLAN_HEAD}\nWhat the scene rests on, as things stand:\n- Wren is wearing: linen shirt; boots off by the hatch\nWhat happens on the page, in order:\n1. Wren stands to meet him.\n${PLAN_GO.start}`,
      checked: { corrected: 1, dropped: 0 }
    })
    expect(db.prepare('SELECT job, scene_id, status FROM generations').all()).toEqual([{ job: 'memory', scene_id: sceneId, status: 'complete' }])
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
})
