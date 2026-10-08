// The writer lab's winners as the app's defaults (0.6.35; the lab ran them as switches, 2026-10-08): the writer at
// temperature 1.0; Continue plays out what is under way and asks for 180 to 280 words; a door locked with someone
// outside said in one line; the prompt bugs the lab's reviews found (stale placing and looks, the plan's holding
// changes, people and places off the scene, "not known by" the person a fact is about); no stock phrase named in the
// writer prompt, the ones that get through said afresh after writing; a second opinion on each slip before repair.
// Invented scenes and lines only (the inn of writerWorld.ts, the mill house); no model.
import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import type { EntryState, ID } from '@shared/types'
import type { EditInput } from '@shared/contracts/edits'
import type { CharacterState, SceneState, StageItem } from '@shared/continuity'
import { CREATIVITY_PRESETS, defaultStyleGuide, emptySceneCard, writerTemperature } from '@shared/defaults'
import { editBriefing, replyRoom, type EditWorld } from '../../src/main/edits/briefing'
import { CARRY_ON_LAST, CONTINUE_WORDS, finalAsk, systemPrompt, type PromptOptions } from '../../src/main/edits/prompts'
import { buildBlocks, MENTIONED_TITLE } from '../../src/main/ai/context'
import { RECALL_ENTRIES } from '../../src/main/retrieval/briefing'
import { instructionsText } from '../../src/main/ai/prompts'
import { clearStalePlacing, freshLooks, linkedPlaces, OFFSTAGE_LEAD, offScene, pastProfile, pastTimes, staleLookPieces } from '../../src/main/ai/briefingFixes'
import { fastDoors, keyHolder, lockLines, withLockLines } from '../../src/main/ai/lockRule'
import { stageInScene } from '../../src/main/ai/mustStay'
import { checkPlan, newWordsOf, type CheckWith } from '../../src/main/plan/plan'
import { codexLines } from '../../src/main/repair/prompts'
import type { SceneCheckContext } from '../../src/main/checks/context'
import { groundedSlips, quotedIn, rejectedNotes, secondOpinion, SECOND_MARKER, secondRequest, withdrawnFinding } from '../../src/main/repair/second'
import { readRewrites, SLOP_EXTRA, SLOP_MARKER, SLOP_PHRASES, SLOP_WHY, sampleLinesOf, slopIn, slopMessages, slopSpans } from '../../src/main/repair/slop'
import { STOCK_TICS } from '../../src/main/ai/repetition'
import { checkNewWords, noteStage, resetRepairsForTests } from '../../src/main/repair'
import { REPAIR_MARKER } from '../../src/main/repair/prompts'
import type { Claim } from '../../src/main/repair/claims'
import type { MemoryModel } from '../../src/main/keeper/model'
import * as repo from '../../src/main/db/repo'
import * as gens from '../../src/main/db/generations'
import { memoryWorld } from './helpers'
import { addBelowStep, entry } from './writerWorld'

afterEach(() => resetRepairsForTests())

const who = (name: string, o: Partial<CharacterState> = {}): CharacterState => ({ name, where: '', posture: '', holding: '', condition: '', mood: '', lastAction: '', clothes: [], ...o })

// ---------- Temperature ----------

describe('the writer writes Balanced at 1.0', () => {
  it('drafts and Continue at 1.0 for Balanced (the default); the other presets and the edit tools as they were', () => {
    expect(writerTemperature('balanced')).toBe(1)
    expect(writerTemperature(undefined)).toBe(1)
    expect(writerTemperature('steady')).toBe(CREATIVITY_PRESETS.steady.temperature)
    expect(writerTemperature('adventurous')).toBe(CREATIVITY_PRESETS.adventurous.temperature)
    expect(CREATIVITY_PRESETS.balanced.temperature).toBe(0.85)
    const continued = editBriefing(millInput(), millWorld(null))
    const rewrite = editBriefing(millInput({ tool: 'rewrite', selection: 'Nell set the bar across the door.', direction: 'plainer' }), millWorld(null))
    expect(continued.ok && continued.temperature).toBe(1)
    expect(rewrite.ok && rewrite.temperature).toBe(0.85)
  })
})

// ---------- Continue ----------

const millPerson = (id: string, name: string): EntryState => ({
  ...entry('character', name),
  id,
  fields: { pronouns: id === 'nell' ? 'she/her' : 'he/him' },
  updatedAt: `2026-01-02T00:00:00.000Z-${id}`
})
const millWorld = (stand: SceneState | null): EditWorld => ({
  style: defaultStyleGuide(),
  scene: { title: 'The mill house', card: { ...emptySceneCard(), povId: 'nell', presentIds: ['tam'], beats: ['Tam fetches the cart', 'They talk about the flood'] } },
  entries: [millPerson('nell', 'Nell Garrow'), millPerson('tam', 'Tam Rudd')],
  contextLength: 32000,
  stand
})
const BEFORE = 'Tam went out to fetch the cart round.\n\nNell turned the key in the mill door and put it in her apron pocket.'
function millInput(o: Partial<EditInput> = {}): EditInput {
  return { taskId: 't1', sceneId: 's1', tool: 'continue', selection: '', before: BEFORE, after: '', continueAs: 'paragraph', ...o }
}
const continueBriefing = (stand: SceneState | null = null, o: Partial<EditInput> = {}) => {
  const b = editBriefing(millInput(o), millWorld(stand))
  if (!b.ok) throw new Error(b.problem)
  return b
}
const o: PromptOptions = { direction: '', continueAs: 'paragraph', hasAfter: false, lineBreaks: false }

describe('Continue with no direction plays out what is under way first', () => {
  it('the task plays the last paragraphs out before the next beat, and brings nothing new in', () => {
    const sys = systemPrompt('continue', defaultStyleGuide(), o)
    expect(sys).toContain(
      "Whatever is under way in the last paragraphs plays out first, at the scene's own pace; only once it has, move towards the card's next beat. Bring in no new arrivals, news or turns of your own, and don't wrap the scene up."
    )
    expect(sys).not.toContain('Invent no new events')
  })

  it('its ask ends on the last paragraph, after the speaker tags too; inline as well', () => {
    expect(finalAsk('continue', o).split('\n')).toEqual(['Write the next paragraph or two of the scene, about 180 to 280 words. Reply with only the new words.', CARRY_ON_LAST])
    expect(finalAsk('continue', { ...o, speakerTags: true }).split('\n').pop()).toBe(CARRY_ON_LAST)
    expect(finalAsk('continue', { ...o, continueAs: 'inline' }).split('\n').pop()).toBe(CARRY_ON_LAST)
    expect(continueBriefing().messages.at(-1)!.content.trim().split('\n').pop()).toBe(CARRY_ON_LAST)
  })

  it('with the author\'s "what happens next": that, and it is last', () => {
    const d = { ...o, direction: 'Tam brings the cart round.' }
    expect(systemPrompt('continue', defaultStyleGuide(), d)).toContain('The author says what happens next (at the end of the briefing): write that, and nothing beyond it. Invent no new events beyond that')
    expect(finalAsk('continue', d)).not.toContain(CARRY_ON_LAST)
    expect(finalAsk('continue', d).split('\n').pop()).toBe('Tam brings the cart round.')
  })

  it('the other tools are untouched', () => {
    const r = { ...o, direction: 'plainer' }
    expect(finalAsk('rewrite', r)).toBe('Rewrite the selected words as the author asked (“plainer”). Reply with only the new words that take the place of the selected ones.')
    expect(systemPrompt('rewrite', defaultStyleGuide(), r)).not.toContain('Whatever is under way')
  })
})

describe('Continue asks for 180 to 280 words', () => {
  it('in its task and its ask, with room for the top of it', () => {
    expect(CONTINUE_WORDS).toEqual({ min: 180, max: 280 })
    expect(systemPrompt('continue', defaultStyleGuide(), o)).toContain('about 180 to 280 words, a paragraph or two')
    expect(finalAsk('continue', { ...o, continueAs: 'inline' })).toContain('Carry on from exactly where the text stops, for about 180 to 280 words.')
    expect(replyRoom('continue', 0)).toBe(Math.ceil(280 * 1.35 * 2))
    expect(continueBriefing().reply).toBeGreaterThanOrEqual(756)
  })
})

// ---------- A door locked with someone outside ----------

const NELL = who('Nell Garrow', { where: 'in the mill kitchen, by the stove', holding: 'nothing' })
const TAM_OUT = who('Tam Rudd', { where: 'out in the yard, gone out through the mill door', lastAction: 'went out to fetch the cart round' })
const LOCKED: StageItem[] = [
  { name: 'the mill door', state: 'shut and locked from inside, key taken out' },
  { name: 'the key', state: "in Nell's apron pocket" },
  { name: 'the lamp', state: 'on the table' }
]
const millStage = (things: StageItem[], characters: CharacterState[]): SceneState => ({ time: '', weather: 'sleet', light: '', things, characters })
const LINE = 'Tam Rudd is outside; the mill door is locked from inside and Nell Garrow has the key. If Tam comes back in, by any door, someone unlocks it on the page first.'

describe('a door locked with someone outside, said in one line', () => {
  it('one line, with who has the key', () => {
    const s = millStage(LOCKED, [NELL, TAM_OUT])
    expect(fastDoors(s)).toEqual([{ name: 'the mill door', how: ['locked'] }])
    expect(keyHolder(s)).toBe('Nell Garrow')
    expect(lockLines(s)).toEqual([LINE])
  })

  it('unlocked, only shut, open or locked from outside: no line', () => {
    const door = (state: string) => millStage([{ name: 'the mill door', state }, LOCKED[1]], [NELL, TAM_OUT])
    for (const s of ['shut, unlocked again', 'shut', 'no longer locked; standing open', 'locked from the outside']) expect(lockLines(door(s))).toEqual([])
  })

  it('back in, or never out: no line', () => {
    expect(lockLines(millStage(LOCKED, [NELL, who('Tam Rudd', { where: 'back in the kitchen, by the stove' })]))).toEqual([])
    expect(lockLines(millStage(LOCKED, [NELL, who('Tam Rudd', { where: 'came back in from the yard; at the table' })]))).toEqual([])
    expect(lockLines(millStage(LOCKED, [NELL, who('Tam Rudd', { where: 'at the table, across from Nell' })]))).toEqual([])
    expect(lockLines(millStage(LOCKED, [NELL, who('Old Wenna', { where: 'gone out of the kitchen' })]))).toEqual([])
    // A place in the room wins over a going out in what they last did.
    expect(lockLines(millStage(LOCKED, [NELL, who('Tam Rudd', { where: 'by the fire, boots steaming', lastAction: 'went out across the yard for logs' })]))).toEqual([])
    expect(lockLines(millStage(LOCKED, [NELL, who('Tam Rudd', { where: 'gone out of the kitchen', lastAction: 'came back in with the logs' })]))).toEqual([])
  })

  it('out by the words of the place and of what they last did (round G: "across the yard to the stall")', () => {
    const line = 'Tam Rudd is outside; the mill door is locked from inside and Nell Garrow has the key. If Tam comes back in, by any door, someone unlocks it on the page first.'
    for (const where of ['gone out of the back kitchen, across the yard to the stall', 'out of the mill and off up the lane', 'in the stall with the grey mare', 'at the byre, forking hay'])
      expect(lockLines(millStage(LOCKED, [NELL, who('Tam Rudd', { where, lastAction: '' })])), where).toEqual([line])
    // No place that says out, but what he last did does.
    expect(lockLines(millStage(LOCKED, [NELL, who('Tam Rudd', { where: 'gone out of the back kitchen', lastAction: 'went out across the yard' })]))).toEqual([line])
    expect(lockLines(millStage(LOCKED, [NELL, who('Tam Rudd', { where: '', lastAction: 'crossed the yard to the cart' })]))).toEqual([line])
    // Neither says out: no line.
    expect(lockLines(millStage(LOCKED, [NELL, who('Tam Rudd', { where: 'gone out of the back kitchen', lastAction: 'shut the dresser drawer' })]))).toEqual([])
  })

  it('two doors: the one their place names; none named, every door held shut', () => {
    const things: StageItem[] = [
      { name: 'the front door', state: 'shut and barred from inside' },
      { name: 'the back door', state: 'locked from inside' },
      { name: 'the key', state: "in Nell's pocket" }
    ]
    expect(lockLines(millStage(things, [NELL, who('Tam Rudd', { where: 'in the yard, gone out through the back door' })]))).toEqual([
      'Tam Rudd is outside; the back door is locked from inside and Nell Garrow has the key. If Tam comes back in, by any door, someone unlocks it on the page first.'
    ])
    expect(lockLines(millStage(things, [NELL, who('Tam Rudd', { where: 'out in the sleet' })]))).toEqual([
      'Tam Rudd is outside; the front door and the back door are barred and locked from inside and Nell Garrow has the key. If Tam comes back in, by any door, someone unbars and unlocks them on the page first.'
    ])
  })

  it('a key in the lock has no holder; the one with the key gets no line; only the people asked for', () => {
    expect(lockLines(millStage([LOCKED[0], { name: 'the key', state: 'in the lock, turned' }], [NELL, TAM_OUT]))).toEqual([
      'Tam Rudd is outside; the mill door is locked from inside. If Tam comes back in, by any door, someone unlocks it on the page first.'
    ])
    expect(lockLines(millStage([LOCKED[0]], [NELL, { ...TAM_OUT, holding: 'the mill key' }]))).toEqual([])
    expect(lockLines(millStage(LOCKED, [NELL, TAM_OUT]), ['Nell Garrow'])).toEqual([])
    expect(withLockLines('text', null)).toBe('text')
  })

  it("in Continue's stage, after the things here; nothing locked, the request as before", () => {
    const stand = continueBriefing(millStage(LOCKED, [NELL, TAM_OUT])).blocks.find((x) => x.id === 'stand')!.text
    expect(stand).toContain(`- the lamp: on the table\n${LINE}`)
    const open = continueBriefing(millStage([{ name: 'the mill door', state: 'shut' }], [NELL, TAM_OUT]))
    expect(open.messages.map((m) => m.content).join('\n')).not.toContain('comes back in')
    // The carry-on line is still last.
    expect(continueBriefing(millStage(LOCKED, [NELL, TAM_OUT])).messages.at(-1)!.content.trim().split('\n').pop()).toBe(CARRY_ON_LAST)
  })

  it("in Add below's where things stand (block 3b), and gone once he is back", () => {
    const blank = { where: '', posture: '', holding: '', condition: '', mood: '', lastAction: '', clothes: [] }
    const inp = { ...addBelowStep(0), options: { direction: 'Tobin knocks to be let back in', targetWords: null, creativity: 'balanced' as const, addBelow: true } }
    inp.continuity = {
      time: '',
      weather: '',
      light: '',
      things: [
        { name: 'the cellar door', state: 'shut and bolted from inside' },
        { name: 'the tavern door', state: 'shut' }
      ],
      characters: [
        { ...blank, name: 'Mara Venn', where: 'in the back room of the Gilded Eel' },
        { ...blank, name: 'Tobin', where: 'out in the alley, gone out through the cellar door' }
      ]
    }
    const line = 'Tobin is outside; the cellar door is bolted from inside. If Tobin comes back in, by any door, someone unbolts it on the page first.'
    expect(buildBlocks(inp).find((b) => b.id === 'continuity')!.text.endsWith(line)).toBe(true)
    inp.continuity.characters[1] = { ...blank, name: 'Tobin', where: 'back in the back room, by the fire' }
    expect(buildBlocks(inp).find((b) => b.id === 'continuity')!.text).not.toContain('comes back in')
  })
})

// ---------- The prompt bugs the lab's reviews found ----------

describe('how someone is placed, after they move', () => {
  const SO_FAR = 'Tam sat on the bench by the stove with his cap on his knee. Later he got up and went out to the woodshed for logs.'
  const said = {
    'tam reed|where': { quote: 'went out to the woodshed for logs', sceneId: 'here' },
    'tam reed|posture': { quote: 'Tam sat on the bench by the stove', sceneId: 'here' },
    'tam reed|sees': { quote: 'looked across at Nell', sceneId: 'prev' }
  }
  const tam = who('Tam Reed', { where: 'gone out to the woodshed', posture: 'sitting on the bench by the stove', sees: 'looking at Nell', holding: 'his cap' })

  it('clears posture said before the move and sees from an older scene; keeps what he holds', () => {
    const out = clearStalePlacing(tam, said, 'here', SO_FAR)
    expect(out).toMatchObject({ posture: '', sees: '', holding: 'his cap', where: 'gone out to the woodshed' })
  })

  it('keeps a posture said after the move, and everything when where is from an older scene or its words are not found', () => {
    expect(clearStalePlacing(tam, { ...said, 'tam reed|posture': { quote: 'went out to the woodshed for logs', sceneId: 'here' } }, 'here', SO_FAR).posture).toBe('sitting on the bench by the stove')
    expect(clearStalePlacing(tam, { ...said, 'tam reed|where': { quote: 'rode in at dusk', sceneId: 'prev' } }, 'here', SO_FAR)).toEqual(tam)
    expect(clearStalePlacing(tam, { ...said, 'tam reed|where': { quote: 'words not in the scene', sceneId: 'here' } }, 'here', SO_FAR)).toEqual(tam)
  })

  it('reaches the stage as told: a riding posture from the scene before is gone indoors', () => {
    const stand: SceneState = {
      time: '',
      weather: '',
      light: '',
      things: [],
      characters: [who('Tam Reed', { where: 'in the kitchen by the stove', posture: 'riding, hands in his armpits' })],
      said: { 'tam reed|where': { quote: 'came into the kitchen', sceneId: 'here' }, 'tam reed|posture': { quote: 'rode with his hands in his armpits', sceneId: 'prev' } }
    }
    const scope = { sceneId: 'here', timeCarries: true, onCard: [{ name: 'Tam Reed', aliases: [] }], cast: [{ name: 'Tam Reed', aliases: [] }], words: 'Tam came into the kitchen, shaking the rain off.', previousSceneId: 'prev' }
    expect(stageInScene(stand, scope)!.characters[0].posture).toBe('')
  })
})

describe('usual looks that no longer hold', () => {
  const nell = (): EntryState =>
    entry('character', 'Nell Darrow', {
      fields: { clothing: 'blue coat with horn buttons; scarf over her hair; sling on her right arm', movement: 'walks with her clogs clattering', pastEvents: 'swore this day before the reeve', speech: 'says tomorrow a lot' },
      changed: ['clothing'],
      changedWhere: { clothing: 'Mill Lane, Ch 2, Sc 1' },
      happened: [
        { note: 'put her arm in a sling', where: 'Mill Lane, Ch 2, Sc 1', changeId: 'a' },
        { note: 'sling off; the arm mended', where: 'Mill Lane, Ch 3, Sc 2', changeId: 'b' }
      ]
    })
  const stage = who('Nell Darrow', { clothes: [{ name: 'clogs', state: 'off, by the door' }, { name: 'blue coat', state: 'on' }] })

  it('a piece gone since it was set, one the stage has off; "gone from grey to yellow" is no removal', () => {
    expect(staleLookPieces('blue coat with horn buttons; scarf over her hair; sling on her right arm', stage, nell().happened, 'Mill Lane, Ch 2, Sc 1')).toEqual(['sling on her right arm'])
    expect(staleLookPieces('walks with her clogs clattering', stage, [], undefined)).toEqual(['walks with her clogs clattering'])
    expect(staleLookPieces('a bandage round his head', null, [{ note: 'the cut under the bandage gone from grey to yellow', where: 'x', changeId: 'c' }])).toEqual([])
  })

  it('leaves out the stale piece and the stale way of moving; the entry as kept is unchanged', () => {
    const e = nell()
    const out = freshLooks(e, stage)
    expect(out.fields.clothing).toBe('blue coat with horn buttons; scarf over her hair')
    expect(out.fields.movement).toBe('')
    expect(e.fields.clothing).toContain('sling')
    expect(freshLooks(e, null).fields.movement).toBe('walks with her clogs clattering')
  })

  it('makes relative times past in profile lines, never the voice', () => {
    expect(pastTimes('swore this day before the reeve; leaves tomorrow; said so today')).toBe('swore that day before the reeve; leaves the next day; said so that day')
    expect(pastProfile(nell()).fields).toMatchObject({ pastEvents: 'swore that day before the reeve', speech: 'says tomorrow a lot' })
  })

  it("the writer's briefing shows her looks put right: no boots squelching while they dry on the hearth", () => {
    const inp = addBelowStep(0)
    const wren = inp.memory.entries.find((e) => e.name === 'Wren Hollis')!
    wren.fields = { ...wren.fields, movement: 'walks with her boots squelching' }
    expect(buildBlocks(inp).find((b) => b.id === 'pov')!.text).not.toContain('boots squelching')
  })
})

describe("the plan's notes keep a holding change that tells no secret", () => {
  const nell = entry('character', 'Nell')
  const tam = entry('character', 'Tam Reed')
  const w: CheckWith = {
    stand: { time: '', weather: '', light: '', things: [], characters: [who('Nell', { where: 'at the door', holding: 'the tithe ledger, under her arm' })] },
    reach: 'here',
    material: 'Nell holds the tithe ledger.',
    card: 'Scene: The mill\nPoint of view: Nell\nAlso in the scene: Tam Reed',
    calls: 'Tam goes out. Nell locks the door and puts the key in her pocket.',
    people: ['Nell', 'Tam Reed'],
    secrets: [{ fact: 'The reeve does not know what is in the tithe ledger', knownBy: ['Nell'], keptFrom: ['Tam Reed'] }],
    entries: [nell, tam],
    inBriefing: new Set(),
    hidden: new Set()
  }
  const change = { who: 'Nell', what: 'holding', from: 'the tithe ledger, under her arm', to: 'the tithe ledger, under her arm; the key in her pocket', how: 'She puts the key in her pocket.' }

  it('the key into her pocket is kept; telling the secret outright is still dropped', () => {
    expect(checkPlan({ relies: [], changes: [change], needs: [] }, w).changes).toEqual(['She puts the key in her pocket.'])
    expect(checkPlan({ relies: [], changes: [{ ...change, how: 'She tells Tam what is in the tithe ledger.' }], needs: [] }, w).changes).toEqual([])
    expect(newWordsOf('the tithe ledger; the key in her pocket', 'the tithe ledger')).toBe('key in her pocket')
  })
})

describe('people and places off the scene', () => {
  it('a person not named gets a line, a place not linked is left out, an item stays', () => {
    const [a, b, ferry, yard, key] = [entry('character', 'Oskar'), entry('character', 'Agate'), entry('place', 'The ferry'), entry('place', 'The yard'), entry('item', 'The key')]
    const out = offScene([a, b, ferry, yard, key], { named: (e) => e === b, linked: new Set([yard.id]) })
    expect(out).toEqual({ full: [b, yard, key], offstage: [a], dropped: [ferry] })
  })

  it('linked places: the place, those it lies within, those within it', () => {
    const coast = entry('place', 'The coast')
    const inn = entry('place', 'The inn', { parentId: coast.id })
    const parlour = entry('place', 'The parlour', { parentId: inn.id })
    const far = entry('place', 'The far town')
    expect([...linkedPlaces(inn.id, [coast, inn, parlour, far])].sort()).toEqual([coast.id, inn.id, parlour.id].sort())
  })

  it('in the briefing: Oskar one line, the ferry gone, the compass kept, and the prompt smaller', () => {
    const texts = buildBlocks(addBelowStep(0))
      .filter((b) => b.title === MENTIONED_TITLE || b.title === RECALL_ENTRIES.title)
      .map((b) => b.text)
      .join('\n\n')
    expect(texts).not.toContain('### Oskar Venn')
    expect(texts).toContain(OFFSTAGE_LEAD)
    expect(texts).toMatch(/^- Oskar Venn/m)
    expect(texts).not.toContain('The Linn ferry')
    expect(texts).toContain('The brass compass')
  })
})

describe('"not known by" never the person the fact is about', () => {
  it('the check after new words leaves Ash out of a fact about Ash', () => {
    const inp = addBelowStep(0)
    const ash = inp.memory.entries.find((e) => e.name === 'Ash Penrose')!
    const wren = inp.memory.entries.find((e) => e.name === 'Wren Hollis')!
    const ctx = {
      memory: { ...inp.memory, facts: [{ factId: 'k1', fact: 'Ash will be at the Crown in the morning', knownBy: [wren.id], at: 3 }] },
      entries: [
        { code: 'E1', entry: wren, why: 'point of view', label: null },
        { code: 'E2', entry: ash, why: 'present', label: null }
      ],
      earlier: []
    } as unknown as SceneCheckContext
    expect(codexLines(ctx, 'Ash said nothing.').sections.find((s) => s.id === 'knowledge')!.text).not.toContain('Not known by')
  })
})

// ---------- Stock phrases ----------

describe('no stock phrase named in the writer prompt', () => {
  it('the craft rule says what to do, the AI-phrase rules name none', () => {
    const text = instructionsText(defaultStyleGuide())
    expect(text).toContain('show feeling through what someone does or says')
    expect(text).not.toContain("a breath someone didn't know they were holding")
    expect(text).not.toContain('Never use stock phrases like these')
    // Adam's own words to avoid stay.
    expect(instructionsText({ ...defaultStyleGuide(), avoidPhrases: ['suddenly'] })).toContain('Words and phrases to avoid\nNever use any of these:\n- suddenly')
  })

  it('Add below and Continue list no phrases used already', () => {
    const add = buildBlocks(addBelowStep(1)).map((b) => b.text).join('\n')
    expect(add).not.toContain('This scene has used these already')
    expect(continueBriefing(null, { before: 'The rain went on. The rain went on. For a long moment she waited.' }).messages.at(-1)!.content).not.toContain('used these already')
  })
})

describe('stock phrases found after writing, one instruction per kind', () => {
  it('the writer round’s stock tics first, then the extras; each in a family', () => {
    expect(SLOP_PHRASES).toHaveLength(STOCK_TICS.length + SLOP_EXTRA.length)
    expect(slopSpans('For a long moment, the silence stretched between them.').map((s) => s.was)).toEqual(['For a long moment', 'the silence stretched between them'])
    const text = 'For a long moment she waited. A wave of relief washed over her. And that was enough.'
    expect(slopSpans(text, [], true).map((s) => s.family)).toEqual(['filler', 'body', 'closer'])
  })

  it('copied sample lines too, only in the AI words, and the rewrites read back', () => {
    const samples = sampleLinesOf('- Sample lines of dialogue:\n    That is the long and short of it.\n    No.\n')
    expect(samples).toEqual(['That is the long and short of it.'])
    const text = 'The rain went on against the glass. ‘That is the long and short of it,’ Tam said, unhurried.'
    expect(slopSpans(text, samples).map((s) => s.was)).toEqual(['The rain went on against the glass', 'That is the long and short of it', 'unhurried'])
    const spans = slopIn({ paragraphs: [{ text: `Adam wrote this. ${text}`, from: 17, to: 17 + text.length }, { text, from: 0, to: text.length, edited: true }] }, samples)
    expect(spans.every((s) => s.para === 0 && s.start >= 17)).toBe(true)
    expect(readRewrites('{"rewrites": [{"id": "s1", "with": "Rain ticked at the glass"}]}').get('S1')).toBe('Rain ticked at the glass')
  })

  it('the request groups them by kind, each under its own instruction', () => {
    const text = 'For a long moment she waited. A wave of relief washed over her. And that was enough.'
    const msgs = slopMessages(slopIn({ paragraphs: [{ text, from: 0, to: text.length }] }, []))
    expect(msgs[0].content.startsWith(SLOP_MARKER)).toBe(true)
    expect(msgs[1].content.match(/^## /gm)).toHaveLength(3)
    expect(msgs[1].content).toMatch(/## A stock body reaction[^\n]*\nS2: phrase "wave of relief washed over/)
  })
})

// ---------- A second opinion ----------

const claim = (over: Partial<Claim>): Claim => ({ quote: '', who: '', about: 'where', line: 'W1', verdict: 'slip', bothTrue: 'no', between: 'nothing', why: '', fix: null, question: '', ...over })

describe('a second opinion on each slip', () => {
  const material = '## Where things stand\n- [W1] Nell · where: at the door · words: "stood at the door"\n- [W2] the jug · thing in the place: on the hearth · no words kept\n### E1 Nell (character)'
  const newWords = 'Nell crossed to the stove and lifted the jug from the table.'

  it('a note the model takes back in its last clause', () => {
    expect(withdrawnFinding('The jug was on the hearth. But she could have moved it, so it is not a contradiction.')).toBe(true)
    expect(withdrawnFinding('No contradiction in the time, but the jug is on the hearth.')).toBe(false)
    expect(withdrawnFinding('The jug is on the hearth, not the table.')).toBe(false)
    expect(quotedIn(newWords, 'lifted the jug … from the table')).toBe(true)
    expect(quotedIn(newWords, 'poured the milk')).toBe(false)
  })

  it('with no call: drops a slip on a line not given, a quote not in the words, one taken back', () => {
    const good = claim({ quote: 'lifted the jug from the table', line: 'W2', why: 'The jug was on the hearth.' })
    const fits = claim({ verdict: 'fits', line: 'W9' })
    const { kept, dropped } = groundedSlips(
      [good, fits, claim({ quote: 'lifted the jug', line: 'K7' }), claim({ quote: 'poured the milk', line: 'W2' }), claim({ quote: 'crossed to the stove', line: 'W1', why: 'She was at the door. She could have walked over, so this is fine.' })],
      { newWords, lines: new Set(['W1', 'W2', 'E1']) }
    )
    expect(kept).toEqual([good, fits])
    expect(dropped.map((d) => d.why)).toEqual(['no-line', 'no-quote', 'withdrawn'])
  })

  it('reason first, then real; no "could have happened off the page" for clothes or position', () => {
    const r = secondRequest([claim({ quote: 'lifted the jug from the table', line: 'W2', why: 'The jug was on the hearth.' })], { material, leadIn: '', newWords })
    expect(r.messages[0].content.startsWith(SECOND_MARKER)).toBe(true)
    expect(r.messages[0].content).toContain('reason first')
    expect(r.messages[1].content).toContain('1. Quote: "lifted the jug from the table" · Line: [W2] the jug · thing in the place: on the hearth')
    expect(r.messages[0].content).toContain('never reject a note about those because the change could have happened off the page')
    expect(r.messages[0].content).not.toContain('could have happened off the page as time passed or people moved')
    expect(r.messages[0].content).not.toContain('scene contract')
  })

  it('reads the notes ruled not real; drops nothing for a reply it cannot read; no call with nothing left', async () => {
    expect([...rejectedNotes('{"verdicts": [{"n": 1, "reason": "x", "real": true}, {"n": 2, "reason": "y", "real": false}]}')!]).toEqual([1])
    expect(rejectedNotes('no idea')).toBeNull()
    const out = await secondOpinion({ db: null as never, model: null as never, closed: () => false }, 'here', [claim({ quote: 'poured the milk', line: 'W2' })], { newWords, leadIn: '', material, lines: new Set(['W2']) })
    expect(out).toMatchObject({ kept: [], dropped: [{ why: 'no-quote' }] })
  })
})

// ---------- Both, in check and repair ----------

const model: MemoryModel = {
  target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'test' },
  choice: { providerId: 'p1', modelId: 'fake/writer', label: 'fake', contextLength: 32000, promptPrice: null, completionPrice: null }
}
const ADAMS = 'Mara pushed her hood back and lay down on the bench. Tobin left for the docks.'
const AI = 'Mara kept her hood low and watched the fire. For a long moment she said nothing.\n\nTobin was waiting by the door, as he had promised.'
const STAGE: SceneState = {
  time: '',
  weather: '',
  light: '',
  characters: [
    { name: 'Mara', where: 'the inn', wearing: 'hood back', posture: 'lying on the bench', holding: '', condition: '', mood: '', lastAction: '' },
    { name: 'Tobin', where: 'gone to the docks', wearing: '', posture: '', holding: '', condition: '', mood: '', lastAction: '' }
  ],
  said: { 'mara|wearing': { quote: 'pushed her hood back', sceneId: 's' }, 'tobin|where': { quote: 'Tobin left for the docks', sceneId: 's' } }
}
const SLIPS = {
  claims: [
    { quote: 'Mara kept her hood low', who: 'Mara', about: 'wearing', line: 'W2', verdict: 'slip', bothTrue: 'no', between: 'nothing', why: 'Mara pushed her hood back earlier.', fix: { replace: 'kept her hood low', with: 'kept her hood down' } },
    { quote: 'Tobin was waiting by the door', who: 'Tobin', about: 'where', line: 'W4', verdict: 'slip', why: 'Tobin left for the docks.', question: 'Tobin left for the docks. Should he come back first?' }
  ]
}

/** The stand-in memory model, answering each kind of call by its marker, and keeping what it was asked. */
function byMarker(replies: Record<string, unknown>): typeof fetch & { asked: string[] } {
  const asked: string[] = []
  const f = (async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { messages: { content: string }[] }
    const system = body.messages[0].content
    const marker = Object.keys(replies).find((m) => system.startsWith(m)) ?? ''
    asked.push(marker)
    const chunk = { choices: [{ index: 0, delta: { content: JSON.stringify(replies[marker] ?? {}) }, finish_reason: 'stop' }] }
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  }) as typeof fetch & { asked: string[] }
  f.asked = asked
  return f
}

function repairWorld(): { db: Database.Database; sceneId: ID; recordId: ID } {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const sceneId = repo.getOutline(db, story.id).scenes[0].id
  repo.createEntry(db, 'character', { name: 'Mara' })
  repo.createEntry(db, 'character', { name: 'Tobin' })
  const text = `${ADAMS}\n\n${AI}`
  repo.saveSceneText(db, sceneId, { type: 'doc', content: text.split('\n\n').map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) }, text)
  const recordId = 'draft-1'
  gens.insertGeneration(db, {
    id: recordId,
    sceneId,
    job: 'draft',
    providerId: 'p1',
    providerName: 'Fake',
    modelId: 'fake/writer',
    params: { temperature: 1, top_p: 1, max_tokens: 1000 },
    direction: '',
    blocks: [],
    messages: [],
    budget: { contextLength: 0, reserved: 0, available: 0, used: 0 },
    entries: [],
    createdAt: '2026-10-07T09:00:00.000Z'
  })
  gens.finishGeneration(db, recordId, { status: 'complete', error: null, response: AI, promptTokens: 1, completionTokens: 1, cost: null, finishedAt: '2026-10-07T09:00:01.000Z' })
  noteStage(recordId, sceneId, STAGE)
  return { db, sceneId, recordId }
}
const landed = (sceneId: ID, recordId: ID) => ({ sceneId, recordId, paragraphs: AI.split('\n\n').map((text) => ({ text, from: 0, to: text.length })), leadIn: ADAMS })
const opts = (db: Database.Database, fetchImpl: typeof fetch, prefs = {}) => ({ db, model, prefs: prefs as never, closed: () => false, fetchImpl, retryDelays: [0] })

describe('check and repair: the second opinion, then the stock phrases', () => {
  it('a slip ruled not real is neither mended nor asked; a stock phrase comes back as one more fix, in amber', async () => {
    const { db, sceneId, recordId } = repairWorld()
    const fetchImpl = byMarker({
      [REPAIR_MARKER]: SLIPS,
      [SECOND_MARKER]: { verdicts: [{ n: 1, reason: 'Her hood is back (W2); "kept her hood low" cannot be.', real: true }, { n: 2, reason: 'W4 is not given.', real: false }] },
      [SLOP_MARKER]: { rewrites: [{ id: 'S1', with: 'She turned the cup in her hands' }] }
    })
    const out = await checkNewWords(opts(db, fetchImpl), landed(sceneId, recordId))
    expect(fetchImpl.asked).toEqual([REPAIR_MARKER, SECOND_MARKER, SLOP_MARKER])
    // Tobin's slip is gone: no question about it.
    expect(out.questions).toBe(0)
    expect(out.fixes.map((f) => [f.was, f.now])).toEqual([
      ['kept her hood low', 'kept her hood down'],
      ['For a long moment she said nothing', 'She turned the cup in her hands']
    ])
    expect(out.fixes[1].why).toBe(SLOP_WHY)
  })

  it('no stock-phrase call when Adam turns "Steer clear of common AI phrases" off', async () => {
    const { db, sceneId, recordId } = repairWorld()
    const fetchImpl = byMarker({ [REPAIR_MARKER]: { claims: [] }, [SLOP_MARKER]: { rewrites: [{ id: 'S1', with: 'x' }] } })
    const out = await checkNewWords(opts(db, fetchImpl, { avoidAiPhrases: false }), landed(sceneId, recordId))
    expect(fetchImpl.asked).toEqual([REPAIR_MARKER])
    expect(out.fixes).toEqual([])
  })
})
