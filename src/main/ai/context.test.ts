import { describe, expect, it, vi } from 'vitest'
import type { BlockMode, Change, EntryKind, EntryState, Pin, StyleGuide } from '@shared/types'
import { AUTO_LENGTH, cardLength, defaultStyleGuide, emptySceneCard } from '@shared/defaults'
import type { SceneMemory, StorySoFar } from '../memory/types'
import {
  assembleContext,
  autoCeiling,
  blockAsSent,
  buildBlocks,
  cachedCounter,
  computeBudget,
  DEFAULT_CONTEXT_LENGTH,
  effectivePins,
  finishContext,
  formatProfile,
  formsOf,
  lengthTooLong,
  maxTargetWords,
  mentions,
  parentChain,
  prepareContext,
  REPLY_LIMIT_CAP,
  replyTokenLimit,
  replyTokens,
  THINKING_ROOM,
  sceneTail,
  selectEntries,
  sentEntryIds,
  sentEntryVersions,
  storySoFarText,
  timeSincePrevious,
  deadBy,
  type ContextInput,
  type PreparedContext,
  STAND_LEAD_SO_FAR,
  MUST_BLOCK,
  DETAILS_LABEL,
  FACTS_LABEL
} from './context'
import { finalInstruction, lengthLine, trimPassage } from './prompts'
import { countRaw } from './tokens'

// ---------- Fixtures ----------

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

const style = (s: Partial<StyleGuide> = {}): StyleGuide => ({
  ...defaultStyleGuide(),
  pov: 'Close third person',
  tense: 'Past tense',
  spelling: 'UK',
  ...s
})

const noStory = (): StorySoFar => ({ scenes: [], chapters: [], stories: [], series: [], leadsInto: null })

/** A previous scene in this scene's own story. */
const inBook2 = { storyId: 'book-2', storyTitle: 'Book 2', otherStory: null }

function memoryOf(entries: EntryState[], over: Partial<SceneMemory> = {}): SceneMemory {
  return {
    storyId: 'book-2',
    sceneId: 'scene-9',
    knows: 'This story knows what happened in: Book 1.',
    previous: { sceneId: 'scene-8', title: 'The docks', text: 'She left the docks at dusk.', ...inBook2 },
    entries,
    firstHere: [],
    elsewhere: [],
    relationships: [],
    facts: [],
    threads: [],
    storySoFar: noStory(),
    bringAbout: [],
    ...over
  }
}

function world() {
  const mara = entry('character', 'Mara Venn', {
    aliases: ['the Heir'],
    summary: 'A disgraced heir turned smuggler.',
    description: 'Lost her left hand in the siege.',
    notes: 'PRIVATE: maybe kill her off in book 4',
    fields: {
      pronouns: 'she/her',
      speech: 'Short, dry sentences.',
      sampleLines: '"Don\'t."\n"I\'ve had worse."',
      origin: 'Born in the Narrows.'
    }
  })
  const tobin = entry('character', 'Tobin', {
    summary: 'A ferryman who owes Mara.',
    fields: { speech: 'Rambling, warm.', traits: 'Loyal to a fault.' }
  })
  const duke = entry('character', 'The Duke', { summary: 'Rules Varn.' })
  const varn = entry('place', 'Varn', { summary: 'The river capital.' })
  const lowtown = entry('place', 'Lowtown', { summary: 'The docks district.', parentId: varn.id })
  const eel = entry('place', 'The Gilded Eel', {
    summary: 'A smoky tavern.',
    parentId: lowtown.id,
    fields: { atmosphere: 'Smoke and wet wool.', history: 'Built on a wreck.' }
  })
  const binding = entry('lore', 'The Binding', {
    summary: 'Oaths bind magically.',
    hardRule: true,
    fields: { rules: 'A broken oath burns the breaker.' }
  })
  const ferry = entry('place', "Tobin's Ferry", { summary: 'A flat-bottomed ferry.', description: 'Moored below the Narrows.' })
  const softLore = entry('lore', 'River songs', { summary: 'Songs of the river folk.' })
  return {
    mara,
    tobin,
    duke,
    varn,
    lowtown,
    eel,
    binding,
    ferry,
    softLore,
    all: [mara, tobin, duke, varn, lowtown, eel, binding, ferry, softLore]
  }
}

function input(over: Partial<ContextInput> = {}, memory: Partial<SceneMemory> = {}): ContextInput {
  const w = world()
  return {
    style: style({ samplePassage: 'The river kept its own counsel.', avoidPhrases: ['suddenly'] }),
    scene: {
      title: 'The knock',
      card: {
        ...emptySceneCard(),
        povId: w.mara.id,
        presentIds: [w.mara.id, w.tobin.id],
        locationId: w.eel.id,
        when: 'Day 12, dusk',
        beats: ['Mara arrives at the tavern', "Tobin offers passage on Tobin's Ferry"],
        goal: 'Get passage out of Varn',
        conflict: 'Tobin wants a favour first',
        outcome: 'She agrees, then someone knocks',
        mood: 'Tense',
        targetWords: 1200,
        notes: 'Keep the hand subtle.'
      }
    },
    memory: memoryOf(w.all, memory),
    pins: [],
    blockModes: {},
    world: { themes: 'Debt and loyalty', tone: 'Grim but warm' },
    series: null,
    story: { title: 'Book 2', premise: 'A smuggler must cross the river.', themes: '', tone: '' },
    options: { direction: 'Make it tense, end on the knock at the door', targetWords: 1200, creativity: 'balanced' },
    contextLength: 32000,
    ...over
  }
}

const named = (inp: ContextInput, name: string): EntryState => {
  const e = [...inp.memory.entries, ...inp.memory.elsewhere.map((x) => x.entry)].find((x) => x.name === name)
  if (!e) throw new Error(`No ${name}`)
  return e
}
const pin = (entryId: string, scope: Pin['scope'], action: Pin['action'] = 'pin'): Pin => ({
  id: `p-${entryId}-${scope}`,
  scope,
  scopeId: scope === 'world' ? null : 'x',
  entryId,
  action
})
const words = (n: number, word = 'word'): string => Array.from({ length: n }, () => word).join(' ')
const blockOf = (inp: ContextInput, id: string) => buildBlocks(inp).find((b) => b.id === id)

/** The same scene with no one tied to the people present who isn't there, so it has no block 11. */
function withoutTies(inp: ContextInput): ContextInput {
  const here = new Set([inp.scene.card.povId, ...inp.scene.card.presentIds])
  const people = new Set(inp.memory.entries.filter((e) => e.kind === 'character').map((e) => e.id))
  inp.memory.relationships = inp.memory.relationships.filter(
    (r) => !((here.has(r.aId) && people.has(r.bId) && !here.has(r.bId)) || (here.has(r.bId) && people.has(r.aId) && !here.has(r.aId)))
  )
  return inp
}

/**
 * A scene with every kind of block: a long sample passage and previous scene (so both have short
 * forms), a group, a plot thread, relationships and knowledge, story so far, a pin and themes.
 */
function richInput(over: Partial<ContextInput> = {}): ContextInput {
  const inp = input({ style: style({ samplePassage: words(300, 'river.'), avoidPhrases: ['suddenly'] }) })
  const mara = named(inp, 'Mara Venn')
  const tobin = named(inp, 'Tobin')
  const guild = entry('group', 'The Tide Guild', { summary: "A smugglers' guild.", description: 'Runs the night boats.' })
  const crown = entry('thread', 'The stolen crown', { summary: 'Who took the crown?', description: 'Stolen in Book 1.' })
  const ana = entry('character', 'Ana Venn', { summary: "Mara's sister." })
  const m = inp.memory
  m.entries.push(guild, crown, ana)
  m.previous = {
    sceneId: 'scene-8',
    title: 'The docks',
    text: Array.from({ length: 12 }, (_, i) => `P${i} ${words(99)}.`).join('\n\n'),
    ...inBook2
  }
  m.relationships = [
    {
      aId: mara.id,
      bId: tobin.id,
      type: 'now enemies',
      aFeels: 'Contempt, but she needs his boat',
      bFeels: 'Guilt',
      where: 'Book 2, Ch 1, Sc 2'
    },
    { aId: mara.id, bId: guild.id, type: 'member (lieutenant)', aFeels: '', bFeels: '', where: '' },
    { aId: mara.id, bId: ana.id, type: 'sister', aFeels: 'Fierce love', bFeels: 'Worry', where: '' }
  ]
  m.facts = [
    { factId: 'f1', fact: 'Mara is the heir', knownBy: [mara.id] },
    { factId: 'f2', fact: 'The ferry leaks', knownBy: [mara.id, tobin.id] }
  ]
  m.threads = [{ entryId: crown.id, status: 'open', setUp: 'Book 1, Ch 2, Sc 1', paidOff: '' }]
  m.storySoFar = {
    scenes: Array.from({ length: 7 }, (_, i) => ({
      sceneId: `s${i + 1}`,
      chapterId: i < 4 ? 'c1' : 'c2',
      label: `Ch ${i < 4 ? 1 : 2}, Sc ${i < 4 ? i + 1 : i - 3}`,
      text: `Scene summary ${i + 1}.`
    })),
    chapters: [{ chapterId: 'c1', label: 'Ch 1', text: 'Chapter one summary.' }],
    stories: [{ storyId: 'book-1', title: 'Book 1', meanwhile: false, cut: false, text: 'Book one summary.' }],
    series: [{ seriesId: 'sr', name: 'The River Books', storyIds: ['book-1'], text: 'Series roll-up.' }],
    leadsInto: null
  }
  inp.scene.card.paysOffIds = [crown.id]
  inp.pins = [pin(named(inp, 'River songs').id, 'story')]
  inp.series = { name: 'The River Books', themes: 'What we owe', tone: 'Wry' }
  return { ...inp, ...over }
}

// ---------- Budget ----------

describe('budget', () => {
  it('is the context length minus the reply room and a 10% margin', () => {
    const b = computeBudget(32000, 1000)
    expect(b.reserved).toBe(Math.ceil(1000 * 1.35 * 1.4))
    expect(b.available).toBe(32000 - b.reserved - 3200)
  })

  it('uses 16,000 when the context length is unknown', () => {
    expect(computeBudget(null, 1000).contextLength).toBe(DEFAULT_CONTEXT_LENGTH)
    expect(computeBudget(0, 1000).contextLength).toBe(DEFAULT_CONTEXT_LENGTH)
  })

  it('with Auto, keeps room for the longest scene Auto allows plus 40%', () => {
    expect(replyTokens(null)).toBe(Math.ceil(AUTO_LENGTH.max * 1.35 * 1.4))
    expect(computeBudget(32000, null).reserved).toBe(replyTokens(AUTO_LENGTH.max))
  })
})

describe('Auto length', () => {
  it("reads the scene card's length: a word count Adam set, else Auto", () => {
    expect(cardLength(emptySceneCard())).toBeNull()
    // Cards from before Auto: the old default is Auto, any other length was Adam's.
    expect(cardLength({ targetWords: 1500 })).toBeNull()
    expect(cardLength({ targetWords: 2500 })).toBe(2500)
    expect(cardLength({ targetWords: 1500, lengthSet: true })).toBe(1500)
    expect(cardLength({ targetWords: 2500, lengthSet: false })).toBeNull()
    expect(cardLength({ targetWords: 0, lengthSet: true })).toBeNull()
    expect(cardLength(null)).toBeNull()
  })

  it("lowers Auto's ceiling for a model with a small reply limit, never under Auto's least", () => {
    expect(autoCeiling(null)).toBe(AUTO_LENGTH.max)
    expect(autoCeiling(100_000)).toBe(AUTO_LENGTH.max)
    expect(autoCeiling(4096)).toBe(3000)
    expect(autoCeiling(500)).toBe(AUTO_LENGTH.min)
  })

  it('asks the model to choose the length the scene needs, within the range', () => {
    expect(lengthLine({ targetWords: 1200 })).toBe('- Aim for about 1,200 words.')
    expect(lengthLine({ targetWords: null })).toBe(
      "- Make the scene as long as it needs to be, between 800 and 4,000 words: play out every beat in full, and don't pad it."
    )
    expect(lengthLine({ targetWords: null, autoMax: 2300 })).toContain('between 800 and 2,300 words')
    const final = finalInstruction({ targetWords: null, style: defaultStyleGuide(), hasBeats: true, hasPrevious: false, hasDirection: false })
    expect(final).toContain('as long as it needs to be')
    expect(final).not.toContain('Aim for about')
  })

  it("says so on the scene card and in the closing instruction, and keeps the model's reply limit in mind", () => {
    const auto = assembleContext(input({ options: { direction: '', targetWords: null, creativity: 'balanced' } }), countRaw)
    const user = auto.messages[1].content
    expect(user).toContain('Length: as long as the scene needs')
    expect(user).not.toContain('Length: about')
    expect(user).toContain('between 800 and 4,000 words')
    expect(auto.budget.reserved).toBe(replyTokens(AUTO_LENGTH.max))
    const small = assembleContext(input({ maxOutput: 4096, options: { direction: '', targetWords: null, creativity: 'balanced' } }), countRaw)
    expect(small.messages[1].content).toContain('between 800 and 3,000 words')
    expect(small.budget.reserved).toBe(replyTokens(3000))
    // A set length is unchanged.
    const set = assembleContext(input(), countRaw)
    expect(set.messages[1].content).toContain('Length: about 1,200 words')
    expect(set.messages[1].content).toContain('- Aim for about 1,200 words.')
  })
})

describe('replyTokenLimit', () => {
  it('gives the reply headroom beyond the reply room when the model has space', () => {
    // 1,500 words: 2,835 tokens of reply room.
    const { limit, fallback } = replyTokenLimit({ contextLength: 128000, reserved: 2835, used: 4000 })
    expect(fallback).toBe(2835)
    // At least THINKING_ROOM beyond the reply room, for models that think first.
    expect(limit).toBe(2835 + THINKING_ROOM)
    expect(replyTokenLimit({ contextLength: 128000, reserved: 6000, used: 4000 }).limit).toBe(12000)
  })

  it('stops at the cap unless the reply room plus thinking room is bigger', () => {
    expect(replyTokenLimit({ contextLength: 200000, reserved: 9450, used: 3000 }).limit).toBe(REPLY_LIMIT_CAP)
    expect(replyTokenLimit({ contextLength: 200000, reserved: 14000, used: 3000 }).limit).toBe(18000)
  })

  it('never goes past what the context window has left after the briefing', () => {
    // 3,000-token model, 756 kept for the reply, 1,500 used: 3000 - 1500 - 150 = 1,350 left.
    expect(replyTokenLimit({ contextLength: 3000, reserved: 756, used: 1500 })).toEqual({ limit: 1350, fallback: 756 })
    // A briefing that is already over budget keeps the plain reply room.
    expect(replyTokenLimit({ contextLength: 3000, reserved: 756, used: 2900 })).toEqual({ limit: 756, fallback: 756 })
  })

  it('leaves the reply its room beside the thinking when the model is asked to think more', () => {
    const budget = { contextLength: 128000, reserved: 2835, used: 4000 }
    expect(replyTokenLimit(budget, null, 'high').limit).toBe(14175)
    expect(replyTokenLimit(budget, null, 'medium').limit).toBe(2835 + THINKING_ROOM)
    expect(replyTokenLimit(budget, null, 'off').limit).toBe(2835 + THINKING_ROOM)
    expect(replyTokenLimit(budget, null, 'auto').limit).toBe(2835 + THINKING_ROOM)
    // Still never past the model's own output limit or what the window has left.
    expect(replyTokenLimit({ contextLength: 200000, reserved: 2835, used: 3000 }, 4096, 'high').limit).toBe(4096)
    expect(replyTokenLimit({ contextLength: 3000, reserved: 756, used: 1500 }, null, 'high').limit).toBe(1350)
  })

  it("respects the model's own output limit when the provider gives one", () => {
    expect(replyTokenLimit({ contextLength: 200000, reserved: 2835, used: 3000 }, 4096)).toEqual({ limit: 4096, fallback: 2835 })
    expect(replyTokenLimit({ contextLength: 200000, reserved: 5670, used: 3000 }, 4096)).toEqual({ limit: 4096, fallback: 4096 })
  })
})

describe('maxTargetWords', () => {
  it("says how many words fit in what's left of the window after the briefing", () => {
    // 8192 - 639 - 410 = 7143 tokens left, at 1.35 tokens a word plus 40%: about 3,700 words.
    expect(maxTargetWords({ contextLength: 8192, used: 639 })).toBe(3700)
    expect(maxTargetWords({ contextLength: 8192, used: 8000 })).toBe(0)
  })

  it('flags a length that cannot fit next to the briefing, and nothing else', () => {
    // 6,000 words on an 8K model: 11,340 tokens for the reply.
    expect(lengthTooLong({ contextLength: 8192, used: 1149, reserved: replyTokens(6000) })).toEqual({ maxWords: 3500 })
    expect(lengthTooLong({ contextLength: 8192, used: 1149, reserved: replyTokens(3000) })).toBeNull()
    expect(lengthTooLong({ contextLength: 200000, used: 4000, reserved: replyTokens(12000) })).toBeNull()
  })
})

// ---------- Selection ----------

describe('selection', () => {
  const why = (inp: ContextInput) => Object.fromEntries(prepareContext(inp).entries.map((e) => [e.name, e.why]))

  it('says why each entry is in the briefing, in plain words', () => {
    const inp = input()
    inp.scene.card.notes = 'Keep the hand subtle. The Duke is watching.'
    expect(why(inp)).toEqual({
      'Mara Venn': 'On the scene card',
      Tobin: 'On the scene card',
      'The Gilded Eel': 'Where the scene happens',
      Lowtown: "Around the scene's location",
      Varn: "Around the scene's location",
      'The Binding': 'A world rule',
      "Tobin's Ferry": 'Named in the beats',
      'The Duke': 'Named in the scene notes'
    })
    const viaDirection = input({ options: { direction: 'Have her think of the duke.', targetWords: 1000, creativity: 'balanced' } })
    expect(why(viaDirection)['The Duke']).toBe('Named in your direction')
    // Named in the rest of the card, or at the end of the previous scene: the writer gets their details too.
    const viaGoal = input()
    viaGoal.scene.card.goal = 'Get past the Duke unseen.'
    expect(why(viaGoal)['The Duke']).toBe('Named on the scene card')
    const viaPrevious = input()
    viaPrevious.memory.previous = { ...viaPrevious.memory.previous!, text: 'She left the docks at dusk. The Duke watched her go.' }
    expect(why(viaPrevious)['The Duke']).toBe('Named at the end of the previous scene')
    // Each entry is listed with the block it is in.
    const entries = prepareContext(inp).entries
    expect(entries.find((e) => e.name === 'Mara Venn')).toMatchObject({
      blockId: 'pov',
      kind: 'character',
      hidden: false,
      pinned: null,
      label: null
    })
    expect(entries.find((e) => e.name === 'Varn')!.blockId).toBe('setting')
  })

  it('counts only entries that exist at this scene', () => {
    const inp = input()
    const later = entry('lore', 'The Salt Law', { summary: 'Found in Book 3.', hardRule: true })
    const kell = entry('character', 'Kell', { summary: 'A drifter.' })
    inp.memory.elsewhere = [
      { entry: later, label: 'not in the story yet at this point' },
      { entry: kell, label: "from Kell's Road, not in this story so far" }
    ]
    inp.scene.card.beats.push('Kell watches from the door')
    const sel = selectEntries(inp)
    expect(sel.chosen.has(later.id)).toBe(false)
    expect(sel.chosen.has(kell.id)).toBe(false)
    expect(
      buildBlocks(inp)
        .map((b) => b.text)
        .join('\n')
    ).not.toContain('Salt Law')
  })

  it('sends an entry that does not exist here when it is on the card or pinned, with its label', () => {
    const inp = input()
    const kell = entry('character', 'Kell', { summary: 'A drifter.', fields: { speech: 'Clipped.' } })
    const salt = entry('lore', 'The Salt Law', { summary: 'No salt on the river.' })
    inp.memory.elsewhere = [
      { entry: kell, label: "from Kell's Road, not in this story so far" },
      { entry: salt, label: 'not in the story yet at this point' }
    ]
    inp.scene.card.presentIds.push(kell.id)
    inp.pins = [pin(salt.id, 'scene')]
    const blocks = buildBlocks(inp)
    const card = blocks.find((b) => b.id === 'scene-card')!.text
    expect(card).toContain("Also in the scene: Tobin, Kell (from Kell's Road, not in this story so far)")
    expect(blocks.find((b) => b.id === 'present')!.text).toContain("### Kell (from Kell's Road, not in this story so far)")
    const also = blocks.find((b) => b.id === 'mentioned')!
    expect(also.title).toBe('Also relevant')
    expect(also.text).toContain('### The Salt Law (lore; not in the story yet at this point)')
    const entries = prepareContext(inp).entries
    expect(entries.find((e) => e.entryId === kell.id)).toMatchObject({
      why: 'On the scene card',
      label: "from Kell's Road, not in this story so far",
      blockId: 'present'
    })
    expect(entries.find((e) => e.entryId === salt.id)).toMatchObject({
      why: 'Pinned for this scene',
      pinned: 'scene',
      blockId: 'mentioned'
    })
  })

  it('marks an entry that first appears in this scene', () => {
    const inp = input()
    const tobin = named(inp, 'Tobin')
    inp.memory.firstHere = [tobin.id]
    const blocks = buildBlocks(inp)
    expect(blocks.find((b) => b.id === 'scene-card')!.text).toContain('Also in the scene: Tobin (first appears in this scene)')
    expect(blocks.find((b) => b.id === 'present')!.text).toContain('### Tobin (first appears in this scene)')
    expect(prepareContext(inp).entries.find((e) => e.entryId === tobin.id)!.label).toBe('first appears in this scene')
  })

  it('leaves out what Adam kept out, and lists it so he can bring it back; the closest pin wins', () => {
    const inp = input()
    const tobin = named(inp, 'Tobin')
    const binding = named(inp, 'The Binding')
    const duke = named(inp, 'The Duke')
    inp.pins = [
      pin(tobin.id, 'world'),
      pin(tobin.id, 'scene', 'hide'),
      pin(binding.id, 'story', 'hide'),
      pin(duke.id, 'world', 'hide'),
      pin(duke.id, 'scene')
    ]
    expect(effectivePins(inp.pins).get(tobin.id)!.action).toBe('hide')
    const blocks = buildBlocks(inp)
    expect(blocks.find((b) => b.id === 'present')).toBeUndefined()
    expect(blocks.find((b) => b.id === 'world-rules')).toBeUndefined()
    // The card is Adam's: it still names who is there.
    expect(blocks.find((b) => b.id === 'scene-card')!.text).toContain('Also in the scene: Tobin')
    expect(blocks.flatMap((b) => b.entryIds)).not.toContain(tobin.id)
    const entries = prepareContext(inp).entries
    expect(entries.filter((e) => e.hidden).map((e) => [e.name, e.why, e.blockId])).toEqual([
      ['Tobin', 'Kept out of this scene', null],
      ['The Binding', 'Kept out of this story', null]
    ])
    expect(entries.find((e) => e.entryId === duke.id)).toMatchObject({
      why: 'Pinned for this scene',
      pinned: 'scene',
      hidden: false,
      blockId: 'mentioned'
    })
  })

  it("brings in pins for the scene, the story and every scene, and notes a pin on an entry that's there anyway", () => {
    const inp = input()
    const songs = named(inp, 'River songs')
    const duke = named(inp, 'The Duke')
    const mara = named(inp, 'Mara Venn')
    inp.pins = [pin(songs.id, 'story'), pin(duke.id, 'world'), pin(mara.id, 'scene')]
    const entries = prepareContext(inp).entries
    expect(entries.find((e) => e.entryId === songs.id)).toMatchObject({
      why: 'Pinned for this story',
      pinned: 'story',
      blockId: 'mentioned'
    })
    expect(entries.find((e) => e.entryId === duke.id)).toMatchObject({ why: 'Pinned for every scene', pinned: 'world' })
    expect(entries.find((e) => e.entryId === mara.id)).toMatchObject({ why: 'On the scene card', pinned: 'scene', blockId: 'pov' })
    const also = blockOf(inp, 'mentioned')!
    expect(also.text).toContain('### River songs (lore)')
    expect(also.text).toContain('### The Duke (character)')
  })

  it('finds the groups the people present belong to, as one-liners in the setting', () => {
    const inp = richInput()
    const setting = blockOf(inp, 'setting')!
    expect(setting.text).toContain(
      "Groups the people here belong to:\n- The Tide Guild: A smugglers' guild. (Mara Venn: member (lieutenant))"
    )
    expect(setting.text).not.toContain('Runs the night boats')
    expect(prepareContext(inp).entries.find((e) => e.name === 'The Tide Guild')).toMatchObject({
      why: 'A group someone here belongs to',
      blockId: 'setting'
    })

    // With no location, the groups still come, under their own title.
    inp.scene.card.locationId = null
    const groups = blockOf(inp, 'setting')!
    expect(groups.title).toBe('Groups')
    expect(groups.text).toContain('The Tide Guild')
  })

  it('takes the plot threads on the card that are still open here', () => {
    const inp = richInput()
    const crown = named(inp, 'The stolen crown')
    const old = entry('thread', 'The lost map', { summary: 'Where is the map?' })
    const fresh = entry('thread', 'The new debt', { summary: 'What does Mara owe?' })
    inp.memory.entries.push(old, fresh)
    inp.memory.threads.push({ entryId: old.id, status: 'resolved', setUp: 'Book 1, Ch 1, Sc 1', paidOff: 'Book 1, Ch 9, Sc 2' })
    inp.scene.card.paysOffIds = [crown.id, old.id]
    inp.scene.card.setsUpIds = [fresh.id]
    const threads = blockOf(inp, 'threads')!
    expect(threads.title).toBe('Plot threads in this scene')
    expect(threads.entryIds).toEqual([fresh.id, crown.id])
    expect(threads.text).toContain('### The new debt (this scene sets it up)')
    expect(threads.text).toContain('### The stolen crown (this scene pays it off)')
    expect(threads.text).toContain('Set up in Book 1, Ch 2, Sc 1.')
    expect(threads.text).not.toContain('The lost map')
    expect(threads.short).toBe(
      '- The new debt (this scene sets it up): What does Mara owe?\n- The stolen crown (this scene pays it off): Who took the crown?'
    )
    // The card still lists them all.
    const card = blockOf(inp, 'scene-card')!.text
    expect(card).toContain('Sets up: The new debt')
    expect(card).toContain('Pays off: The stolen crown, The lost map')
  })

  it('finds mentions by whole name or alias, ignoring case, in beats, notes and direction', () => {
    expect(mentions('he spoke to the duke at dawn', 'The Duke')).toBe(true)
    expect(mentions('the Dukes of old', 'The Duke')).toBe(false)
    expect(mentions('Tobin’s boat', 'Tobin')).toBe(true)
    expect(mentions('Tobinson', 'Tobin')).toBe(false)
    expect(mentions('the  heir', 'the Heir')).toBe(true)
    expect(mentions('a b c', 'a')).toBe(false)
    expect(mentions('cost x2', 'x2)')).toBe(false)
    expect(mentions('cost (x2)', 'x2)')).toBe(true)
    // A single capitalised name must appear capitalised, so ordinary words don't count.
    expect(mentions('Tobin says he will take her word', 'Will')).toBe(false)
    expect(mentions('She wore a red cloak', 'Red')).toBe(false)
    expect(mentions('Will finds the horse', 'Will')).toBe(true)
    expect(mentions('because of the Tide Laws', 'The Tide Laws')).toBe(true)

    const inp = input({ options: { direction: 'Have her think of   the duke.', targetWords: 1000, creativity: 'balanced' } })
    const duke = named(inp, 'The Duke')
    const mentioned = blockOf(inp, 'mentioned')!
    expect(mentioned.entryIds).toContain(duke.id)
    expect(mentioned.title).toBe('Also mentioned')
    expect(mentioned.text).toContain('### The Duke (character)\nIn short: Rules Varn.')
  })

  it('does not repeat an entry that is already in an earlier block', () => {
    const inp = richInput()
    inp.scene.card.beats.push('Mara thinks of Lowtown, the Tide Guild and the Binding')
    const ids = buildBlocks(inp)
      .filter((b) => b.id !== 'relationships')
      .flatMap((b) => b.entryIds)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('skips characters on the card that have been deleted', () => {
    const inp = input()
    inp.scene.card.presentIds = ['gone', ...inp.scene.card.presentIds]
    inp.scene.card.povId = 'also-gone'
    const blocks = buildBlocks(inp)
    expect(blocks.find((b) => b.id === 'pov')).toBeUndefined()
    expect(blocks.find((b) => b.id === 'present')!.entryIds).toHaveLength(2)
  })
})

// ---------- Blocks, full and short ----------

describe('blocks', () => {
  it('builds the blocks with their fixed priorities, in the order they are sent: the same-every-time ones first', () => {
    expect(buildBlocks(richInput()).map((b) => [b.id, b.priority])).toEqual([
      ['instructions', 1],
      ['world-rules', 7],
      ['themes', 10],
      ['setting', 7],
      ['pov', 4],
      ['present', 5],
      ['relationships', 6],
      ['ties', 11],
      ['mentioned', 9],
      ['threads', 7],
      ['story-so-far', 8],
      ['previous-scene', 3],
      ['scene-card', 2],
      ['must-stay-true', 11]
    ])
  })

  it('records which entries each block includes', () => {
    const inp = input()
    const id = (n: string): string => named(inp, n).id
    const blocks = buildBlocks(inp)
    const get = (b: string) => blocks.find((x) => x.id === b)!
    expect(get('pov').entryIds).toEqual([id('Mara Venn')])
    expect(get('present').entryIds).toEqual([id('Tobin')])
    expect(get('setting').entryIds).toEqual([id('The Gilded Eel'), id('Lowtown'), id('Varn')])
    expect(get('world-rules').entryIds).toEqual([id('The Binding')])
    expect(get('mentioned').entryIds).toEqual([id("Tobin's Ferry")])
    expect(get('instructions').entryIds).toEqual([])
  })

  it('leaves out blocks with nothing in them', () => {
    const inp = input({
      world: { themes: '', tone: '' },
      story: { title: 'Book 1', premise: '', themes: '', tone: '' },
      scene: { title: '', card: emptySceneCard() },
      options: { direction: '', targetWords: 1500, creativity: 'balanced' }
    })
    inp.memory = memoryOf([], { previous: null })
    expect(buildBlocks(inp).map((b) => b.id)).toEqual(['instructions', 'scene-card'])
  })

  it('block 1: the style guide, sample passage and phrases to avoid; short: the sample passage trimmed', () => {
    const block = blockOf(input(), 'instructions')!
    expect(block.text).toContain('Point of view: Close third person')
    expect(block.text).toContain('Tense: Past tense')
    expect(block.text).toContain('UK English')
    expect(block.text).toContain('The river kept its own counsel.')
    expect(block.text).toContain('- suddenly')
    expect(block.text).toContain('Write like a person, not like an AI')
    // A short sample passage has nothing to trim: the short form only leaves out the list of AI phrases.
    expect(block.short).toContain('The river kept its own counsel.')
    expect(block.short).toContain('Write like a person, not like an AI')
    expect(block.short).not.toContain('Never use stock phrases like these')

    const sample = Array.from({ length: 40 }, (_, i) => `Sentence ${i} runs on a little.`).join(' ')
    const long = blockOf(input({ style: style({ samplePassage: sample, avoidPhrases: ['suddenly'] }) }), 'instructions')!
    expect(long.text).toContain('Sentence 39 runs on a little.')
    expect(long.short).toContain('Sentence 0 runs on a little.')
    expect(long.short).not.toContain('Sentence 39')
    expect(long.short).toContain('- suddenly')
    expect(long.short!.length).toBeLessThan(long.text.length)
  })

  it('trims a passage at a sentence end near the length asked for', () => {
    expect(trimPassage('One two. Three four.', 10)).toBe('One two. Three four.')
    const text = Array.from({ length: 30 }, (_, i) => `S${i} a b c.`).join(' ')
    const short = trimPassage(text, 22)
    expect(short).toBe('S0 a b c. S1 a b c. S2 a b c. S3 a b c. S4 a b c.')
    expect(trimPassage(words(50), 10)).toBe(`${words(10)}…`)
  })

  it('block 2: the whole scene card and the direction, with no short form', () => {
    const block = blockOf(input(), 'scene-card')!
    for (const s of [
      'Scene: The knock',
      'When: Day 12, dusk',
      'Point of view: Mara Venn',
      'Also in the scene: Tobin',
      'Where: The Gilded Eel',
      '1. Mara arrives at the tavern',
      "2. Tobin offers passage on Tobin's Ferry",
      'Goal: Get passage out of Varn',
      'Conflict: Tobin wants a favour first',
      'Outcome: She agrees, then someone knocks',
      'Mood: Tense',
      'Length: about 1,200 words',
      'Keep the hand subtle.',
      'Make it tense, end on the knock at the door'
    ]) {
      expect(block.text).toContain(s)
    }
    expect(block.short).toBeNull()
    expect(block.text).not.toContain('bring about')
  })

  it('block 2 on a redraft: what this scene should bring about, as aims rather than facts', () => {
    const inp = input()
    const mara = named(inp, 'Mara Venn')
    const tobin = named(inp, 'Tobin')
    const base = {
      anchor: 'scene',
      storyId: 'book-2',
      sceneId: 'scene-9',
      position: 0,
      origin: 'text',
      runId: null,
      createdAt: '',
      updatedAt: ''
    } as const
    const changes: Change[] = [
      { ...base, id: 'c1', entryId: mara.id, kind: 'update', payload: { note: 'Loses her temper with Tobin' } },
      {
        ...base,
        id: 'c2',
        entryId: mara.id,
        kind: 'relationship',
        payload: { otherId: tobin.id, type: 'enemies', feels: 'Betrayed', otherFeels: '' }
      },
      { ...base, id: 'c3', entryId: tobin.id, kind: 'knowledge', payload: { factId: 'f1', fact: 'Mara is the heir' } }
    ]
    inp.memory.bringAbout = changes
    const text = blockOf(inp, 'scene-card')!.text
    expect(text).toContain(
      'What this scene should bring about (aims for this draft, not facts yet):\n- Mara Venn: Loses her temper with Tobin\n- Mara Venn and Tobin: enemies. Mara Venn feels: Betrayed.\n- Tobin learns: Mara is the heir'
    )
    const preview = assembleContext(inp, countRaw)
    expect(preview.messages[1].content).toContain('Make the scene bring about what the scene card says it should.')
    // Changes pinned to this scene are never sent as facts.
    expect(preview.messages[1].content).not.toContain('What has happened so far')
    // A fresh take doesn't build on the earlier draft: only Adam's own note for the scene is an aim.
    inp.memory.bringAbout = [...changes, { ...base, id: 'c4', origin: 'adam', entryId: tobin.id, kind: 'update', payload: { note: 'Leaves the ferry' } }]
    inp.options = { ...inp.options, fresh: true }
    const fresh = blockOf(inp, 'scene-card')!.text
    expect(fresh).toContain('What this scene should bring about (aims for this draft, not facts yet):\n- Tobin: Leaves the ferry')
    expect(fresh).not.toContain('Loses her temper')
  })

  it('block 3: the end of the previous scene on the line; short: the last 200 words', () => {
    const inp = richInput()
    const block = blockOf(inp, 'previous-scene')!
    const count = (t: string): number => t.split(/\s+/).length
    expect(count(block.text)).toBe(600)
    expect(count(block.short!)).toBe(200)
    expect(block.short!.startsWith('P10 ')).toBe(true)
    // None at the start of the line.
    inp.memory.previous = null
    expect(blockOf(inp, 'previous-scene')).toBeUndefined()
    expect(assembleContext(inp, countRaw).messages[1].content).not.toContain('Continue seamlessly')
  })

  it('block 3 from another story (this story’s first scene): how that story ended, with the time gap, never "continue seamlessly"', () => {
    const inp = input()
    inp.memory.previous = {
      sceneId: 'b1-last',
      title: 'The fire',
      text: 'The mill burned all night.',
      storyId: 'book-1',
      storyTitle: 'Book 1',
      otherStory: { ended: true, timeGap: '200 years' }
    }
    const block = blockOf(inp, 'previous-scene')!
    expect(block.title).toBe('How Book 1 ended')
    expect(block.text).toBe(
      'This is how Book 1 ended. This story comes after it. Time since then: 200 years.\n\nThe mill burned all night.'
    )
    const user = assembleContext(inp, countRaw).messages[1].content
    expect(user).toContain('## How Book 1 ended\n\n')
    expect(user).not.toContain('Continue seamlessly')
    expect(user).toContain(
      "- The previous scene is how Book 1 ended, not part of this story. Don't continue it seamlessly or recap it: open this story in its own right. Time since then: 200 years."
    )

    // A side story starting partway through Book 1, with no time gap.
    inp.memory.previous = { ...inp.memory.previous, otherStory: { ended: false, timeGap: '' } }
    expect(blockOf(inp, 'previous-scene')).toMatchObject({
      title: 'Where Book 1 had got to',
      text: 'This is where Book 1 had got to when this story starts.\n\nThe mill burned all night.'
    })
    expect(assembleContext(inp, countRaw).messages[1].content).toContain(
      "- The previous scene is where Book 1 had got to, not part of this story. Don't continue it seamlessly or recap it: open this story in its own right.\n"
    )
  })

  it('block 4: the point-of-view character as of this scene; short: without backstory', () => {
    const inp = richInput()
    const mara = named(inp, 'Mara Venn')
    mara.happened = Array.from({ length: 7 }, (_, i) => ({
      note: `Change ${i + 1}`,
      where: `Book 2, Ch 1, Sc ${i + 1}`,
      changeId: `c${i}`
    }))
    const pov = blockOf(inp, 'pov')!
    expect(pov.title).toBe('Point-of-view character: Mara Venn')
    expect(pov.text).toContain('Also called: the Heir')
    expect(pov.text).toContain('In short: A disgraced heir turned smuggler.')
    expect(pov.text).toContain('Lost her left hand in the siege.')
    expect(pov.text).toContain(`${FACTS_LABEL}\n- Pronouns: she/her`)
    expect(pov.text).toContain('Backstory\n- Origin: Born in the Narrows.')
    expect(pov.text).toContain('Voice\n- How they speak: Short, dry sentences.')
    expect(pov.text).toContain('- Sample lines of dialogue:\n    "Don\'t."\n    "I\'ve had worse."')
    expect(pov.text).toContain('What has happened so far:\n- Change 1 (Book 2, Ch 1, Sc 1)')
    expect(pov.text).toContain('What Mara Venn knows:\n- Mara is the heir.\n- The ferry leaks.')
    // Her ties to people not in the scene are block 11's, and the groups she belongs to block 7's.
    expect(pov.text).not.toContain('Ana Venn')
    // Tobin is in the scene, so their relationship is in block 6 instead.
    expect(pov.text).not.toContain('now enemies')

    expect(pov.short).toContain('Voice\n- How they speak: Short, dry sentences.')
    expect(pov.short).toContain('What Mara Venn knows:')
    expect(pov.short).not.toContain('Born in the Narrows')
    expect(pov.short).not.toContain('Ties to people')
    expect(pov.short).not.toContain('Change 2 (')
    expect(pov.short).toContain('Change 3 (')
    expect(pov.short).toContain('Change 7 (')
    const all = buildBlocks(inp)
      .map((b) => b.text + (b.short ?? ''))
      .join('\n')
    expect(all).not.toContain('PRIVATE')
  })

  it('block 4: a point-of-view character with nothing filled in yet is still there', () => {
    const inp = input()
    const kell = entry('character', 'Kell')
    inp.memory.entries.push(kell)
    inp.memory.firstHere = [kell.id]
    inp.scene.card.povId = kell.id
    expect(blockOf(inp, 'pov')).toMatchObject({
      title: 'Point-of-view character: Kell (first appears in this scene)',
      text: 'Kell.',
      short: null
    })
    expect(prepareContext(inp).entries.find((e) => e.entryId === kell.id)!.blockId).toBe('pov')
  })

  it('block 5: the others present as of this scene; short: summary plus voice', () => {
    const inp = input()
    named(inp, 'Tobin').happened = [{ note: 'Sold his second boat', where: 'Book 2, Ch 1, Sc 1', changeId: 'c1' }]
    const present = blockOf(inp, 'present')!
    expect(present.title).toBe('Also in the scene')
    expect(present.text).toContain('### Tobin\nIn short: A ferryman who owes Mara.')
    expect(present.text).toContain('Personality\n- Core traits: Loyal to a fault.')
    expect(present.text).toContain('What has happened so far:\n- Sold his second boat (Book 2, Ch 1, Sc 1)')
    expect(present.short).toBe('### Tobin\nIn short: A ferryman who owes Mara.\n\nVoice\n- How they speak: Rambling, warm.')
  })

  it('block 6: relationships and who knows what among those present, with no short form', () => {
    const inp = richInput()
    const block = blockOf(inp, 'relationships')!
    expect(block.title).toBe('Relationships and who knows what')
    expect(block.text).toBe(
      "- Mara Venn and Tobin: now enemies. Mara Venn feels: Contempt, but she needs his boat. Tobin feels: Guilt.\n\nFacts some of them know and others don't:\n- Tobin does not know: Mara is the heir. (Mara Venn knows it.)"
    )
    expect(block.short).toBeNull()
    expect(block.entryIds).toEqual([named(inp, 'Mara Venn').id, named(inp, 'Tobin').id])

    // Alone, there is nobody to compare with.
    inp.scene.card.presentIds = [named(inp, 'Mara Venn').id]
    expect(blockOf(inp, 'relationships')).toBeUndefined()
  })

  it('block 7: the setting with the places around it; short: one line each', () => {
    const inp = input()
    named(inp, 'The Gilded Eel').happened = [{ note: 'The back room burned', where: 'Book 2, Ch 1, Sc 4', changeId: 'c9' }]
    const setting = blockOf(inp, 'setting')!
    expect(setting.title).toBe('Setting')
    expect(setting.text).toContain('### Where: The Gilded Eel')
    expect(setting.text).toContain('Smoke and wet wool.')
    expect(setting.text).toContain('Built on a wreck.')
    expect(setting.text).toContain('What has happened so far:\n- The back room burned (Book 2, Ch 1, Sc 4)')
    expect(setting.text).toContain('It lies within:\n- Lowtown: The docks district.\n- Varn: The river capital.')
    expect(setting.short).toBe(
      '### Where: The Gilded Eel\nIn short: A smoky tavern.\n\nIt lies within:\n- Lowtown: The docks district.\n- Varn: The river capital.'
    )

    const a = entry('place', 'A', { parentId: 'b' })
    const b = entry('place', 'B', { id: 'b', parentId: a.id })
    const byId = new Map([a, b].map((e) => [e.id, e]))
    expect(parentChain(a, byId).map((e) => e.name)).toEqual(['B'])
  })

  it('block 3b: where things stand as the previous scene ended; short: only the characters on the card', () => {
    const blank = { where: '', wearing: '', posture: '', holding: '', condition: '', mood: '', lastAction: '' }
    const inp = input()
    // The same day as the scene before, so what Mara wears and holds is in what must stay true too.
    inp.memory.previous = { ...inp.memory.previous!, when: 'Day 12, noon' }
    inp.continuity = {
      time: 'dusk',
      weather: 'rain',
      light: '',
      characters: [
        { ...blank, name: 'Mara Venn', where: 'the tavern door', wearing: 'a soaked grey cloak', holding: 'a lamp' },
        { ...blank, name: 'The Duke', where: 'his tower', mood: 'suspicious' }
      ]
    }
    const block = blockOf(inp, 'continuity')!
    expect(block.title).toBe('Where things stand as the previous scene ended')
    expect(block.text).toContain('Time: dusk. Weather: rain')
    expect(block.text).toContain('- Mara Venn: where: the tavern door; wearing: a soaked grey cloak; holding: a lamp')
    expect(block.text).toContain('- The Duke: where: his tower; mood: suspicious')
    expect(block.short).toContain('- Mara Venn: ')
    expect(block.short).not.toContain('The Duke')
    // Sent last but for what must stay true, right above the closing instruction, after the scene card and any block a
    // part adds.
    const ids = prepareContext(inp, { extraBlocks: [{ id: 'scene-so-far', title: 'The scene so far', text: 'Words.' }] }).blocks.map((b) => b.id)
    expect(ids.slice(-2)).toEqual(['continuity', 'must-stay-true'])
    expect(ids.indexOf('scene-card')).toBeLessThan(ids.indexOf('scene-so-far'))
    expect(ids.indexOf('previous-scene')).toBeLessThan(ids.indexOf('scene-card'))
    // A new scene isn't told to keep to it in the closing instruction (time may have passed): only the lead says so.
    expect(prepareContext(inp).finals.withPrevious).not.toContain('Keep to where things stand')
    // Nothing known: no block.
    expect(blockOf(input(), 'continuity')).toBeUndefined()
  })

  it('block 3b at the end of the scene so far: its own title and lead, and the closing instruction keeps to it', () => {
    const blank = { where: '', wearing: '', posture: '', holding: '', condition: '', mood: '', lastAction: '' }
    const inp = input()
    inp.continuity = {
      time: '',
      weather: '',
      light: '',
      characters: [{ ...blank, name: 'Mara Venn', wearing: 'white shirt unbuttoned, boots off (by the door)', posture: 'sitting on the bed' }]
    }
    inp.continuityAtSoFar = true
    const block = blockOf(inp, 'continuity')!
    expect(block.title).toBe('Where things stand at the end of the scene so far')
    expect(block.text.startsWith(STAND_LEAD_SO_FAR)).toBe(true)
    expect(block.text).toContain('wearing: white shirt unbuttoned, boots off (by the door); position: sitting on the bed')
    expect(prepareContext(inp).finals.withPrevious).toContain('Keep to where things stand at the end of the scene so far')
  })

  it('Add below: carries on from the scene so far rather than starting the scene, or the previous scene', () => {
    const inp = input({ options: { direction: '', targetWords: null, creativity: 'balanced', addBelow: true } })
    const final = prepareContext(inp).finals.withPrevious
    expect(final.startsWith('Carry the scene on now, from the end of the scene so far.')).toBe(true)
    expect(final).toContain("don't repeat, recap or rewrite any of it, and don't start the scene again")
    expect(final).toContain("beats the scene so far hasn't reached yet")
    expect(final).toContain('Write as much as the rest of the scene needs')
    expect(final).not.toContain('Continue seamlessly from where the previous scene ends')
    expect(final).not.toContain('Write the scene now')
    // Without Add below, the usual closing.
    expect(prepareContext(input()).finals.withPrevious.startsWith('Write the scene now.')).toBe(true)
  })

  it('block 7: places around the location only as far as they exist here', () => {
    const inp = input()
    const varn = named(inp, 'Varn')
    inp.memory.entries = inp.memory.entries.filter((e) => e.id !== varn.id)
    inp.memory.elsewhere = [{ entry: varn, label: 'not in the story yet at this point' }]
    const setting = blockOf(inp, 'setting')!
    expect(setting.text).toContain('Lowtown')
    expect(setting.text).not.toContain('Varn')
  })

  it("block 7: the world's hard rules, always; short: one line each", () => {
    const inp = input({
      scene: { title: '', card: { ...emptySceneCard() } },
      options: { direction: '', targetWords: 800, creativity: 'steady' }
    })
    const blocks = buildBlocks(inp)
    expect(blocks.find((b) => b.id === 'setting')).toBeUndefined()
    const rules = blocks.find((b) => b.id === 'world-rules')!
    expect(rules.title).toBe('World rules (never break these)')
    expect(rules.text).toContain('### World rule: The Binding')
    expect(rules.text).toContain('A broken oath burns the breaker.')
    expect(rules.short).toBe('- The Binding: Oaths bind magically.')
    expect(blocks.map((b) => b.text).join('\n')).not.toContain('River songs')
  })

  it('block 8: every earlier scene, earlier stories; short: earlier chapters; then fewer scenes and series roll-ups', () => {
    const inp = richInput()
    const block = blockOf(inp, 'story-so-far')!
    expect(block.title).toBe('The story so far')
    const recent =
      '### Most recently\nCh 1, Sc 3: Scene summary 3.\n\nCh 1, Sc 4: Scene summary 4.\n\nCh 2, Sc 1: Scene summary 5.\n\nCh 2, Sc 2: Scene summary 6.\n\nCh 2, Sc 3: Scene summary 7.'
    // In full, every earlier scene of this story by its own summary (a chapter's summary loses detail).
    expect(block.text).toBe(
      [
        '### Book 1\nBook one summary.',
        '### Earlier in Book 2\nCh 1, Sc 1: Scene summary 1.\n\nCh 1, Sc 2: Scene summary 2.',
        recent
      ].join('\n\n')
    )
    // Short: earlier chapters by their summaries, the last 5 scenes in detail.
    expect(block.short).toBe(['### Book 1\nBook one summary.', '### Earlier in Book 2\nCh 1: Chapter one summary.', recent].join('\n\n'))
    // Smaller: the series roll-up, chapter summaries, the last 2 scenes; the chapter this scene is in
    // has no summary yet, so its earlier scene is told by its own summary rather than skipped.
    expect(block.smaller[0]).toBe(
      [
        '### The River Books\nSeries roll-up.',
        '### Earlier in Book 2\nCh 1: Chapter one summary.\n\nCh 2, Sc 1: Scene summary 5.',
        '### Most recently\nCh 2, Sc 2: Scene summary 6.\n\nCh 2, Sc 3: Scene summary 7.'
      ].join('\n\n')
    )
    // Smaller still, for small models: only the most recent parts, saying so.
    expect(block.smaller.slice(1)).toEqual([
      'Only the most recent part of the story so far is given here, to save space.\n\n### Most recently\nCh 2, Sc 2: Scene summary 6.\n\nCh 2, Sc 3: Scene summary 7.',
      'Only the most recent part of the story so far is given here, to save space.\n\n### Most recently\nCh 2, Sc 3: Scene summary 7.'
    ])
  })

  it('block 8: no earlier scene of this story is skipped, even in a long chapter with no summary yet', () => {
    // Ch 1 is finished and summarised; Ch 2 (no summary yet) has 8 scenes before this one; Ch 3's summary isn't written yet.
    const scenes = [
      ...Array.from({ length: 2 }, (_, i) => ({ sceneId: `a${i}`, chapterId: 'c1', label: `Ch 1, Sc ${i + 1}`, text: `One ${i + 1}.` })),
      ...Array.from({ length: 8 }, (_, i) => ({ sceneId: `b${i}`, chapterId: 'c2', label: `Ch 2, Sc ${i + 1}`, text: `Two ${i + 1}.` }))
    ]
    const s: StorySoFar = {
      scenes,
      chapters: [{ chapterId: 'c1', label: 'Ch 1', text: 'Chapter one.' }],
      stories: [],
      series: [],
      leadsInto: null
    }
    // In full, the finished chapter's scenes too, each by its own summary.
    expect(storySoFarText(s, 'Book 2', 0)).toContain('### Earlier in Book 2\nCh 1, Sc 1: One 1.\n\nCh 1, Sc 2: One 2.\n\nCh 2, Sc 1: Two 1.')
    expect(storySoFarText(s, 'Book 2', 1)).toBe(
      [
        '### Earlier in Book 2\nCh 1: Chapter one.\n\nCh 2, Sc 1: Two 1.\n\nCh 2, Sc 2: Two 2.\n\nCh 2, Sc 3: Two 3.',
        '### Most recently\nCh 2, Sc 4: Two 4.\n\nCh 2, Sc 5: Two 5.\n\nCh 2, Sc 6: Two 6.\n\nCh 2, Sc 7: Two 7.\n\nCh 2, Sc 8: Two 8.'
      ].join('\n\n')
    )
    // A finished chapter whose summary isn't written yet is told by its scenes, in their place.
    const pending: StorySoFar = {
      ...s,
      scenes: [
        { sceneId: 'a0', chapterId: 'c1', label: 'Ch 1, Sc 1', text: 'One 1.' },
        { sceneId: 'b0', chapterId: 'c2', label: 'Ch 2, Sc 1', text: 'Two 1.' },
        { sceneId: 'b1', chapterId: 'c2', label: 'Ch 2, Sc 2', text: 'Two 2.' },
        ...Array.from({ length: 5 }, (_, i) => ({ sceneId: `c${i}`, chapterId: 'c3', label: `Ch 3, Sc ${i + 1}`, text: `Three ${i + 1}.` }))
      ],
      chapters: [{ chapterId: 'c1', label: 'Ch 1', text: 'Chapter one.' }]
    }
    expect(storySoFarText(pending, 'Book 2', 1)).toContain(
      '### Earlier in Book 2\nCh 1: Chapter one.\n\nCh 2, Sc 1: Two 1.\n\nCh 2, Sc 2: Two 2.'
    )
    expect(storySoFarText(pending, 'Book 2', 2)).toContain(
      'Ch 2, Sc 2: Two 2.\n\nCh 3, Sc 1: Three 1.\n\nCh 3, Sc 2: Three 2.\n\nCh 3, Sc 3: Three 3.\n\n### Most recently\nCh 3, Sc 4: Three 4.'
    )
  })

  it('block 8: smaller forms keep the most recent parts; the "Leads into" target goes last of all', () => {
    const s: StorySoFar = {
      scenes: Array.from({ length: 3 }, (_, i) => ({
        sceneId: `s${i}`,
        chapterId: 'c9',
        label: `Ch 9, Sc ${i + 1}`,
        text: `Scene ${i + 1}.`
      })),
      chapters: Array.from({ length: 8 }, (_, i) => ({ chapterId: `c${i + 1}`, label: `Ch ${i + 1}`, text: `Chapter ${i + 1}.` })),
      stories: [{ storyId: 'b1', title: 'Book 1', meanwhile: false, cut: false, text: 'Book one.' }],
      series: [],
      leadsInto: { storyId: 'b2', title: 'Book 2', text: 'Mara is twenty.' }
    }
    const at = (level: number): string => storySoFarText(s, 'The Prequel', level)
    expect(at(3)).toBe(
      [
        'Only the most recent part of the story so far is given here, to save space.',
        '### Earlier in The Prequel\nCh 6: Chapter 6.\n\nCh 7: Chapter 7.\n\nCh 8: Chapter 8.\n\nCh 9, Sc 1: Scene 1.',
        '### Most recently\nCh 9, Sc 2: Scene 2.\n\nCh 9, Sc 3: Scene 3.',
        '### Leads into Book 2\nThis story leads into Book 2. Below is how Book 2 begins: a target to steer towards over the story, not events to mention or bring about in this scene.\nMara is twenty.'
      ].join('\n\n')
    )
    expect(at(2)).toContain('### Book 1\nBook one.')
    expect(at(4)).not.toContain('Leads into')
    expect(at(4)).toContain('### Most recently\nCh 9, Sc 2: Scene 2.\n\nCh 9, Sc 3: Scene 3.')
    expect(at(5)).toBe(
      'Only the most recent part of the story so far is given here, to save space.\n\n### Most recently\nCh 9, Sc 3: Scene 3.'
    )
    // At a story's first scene, the most recent part is the end of the story before it.
    const first: StorySoFar = { ...s, scenes: [], chapters: [], leadsInto: null }
    expect(storySoFarText(first, 'Book 2', 5)).toBe('### Book 1\nBook one.')
  })

  it('block 8: side stories under "Meanwhile", a story cut short, and the "Leads into" target', () => {
    const s: StorySoFar = {
      scenes: [{ sceneId: 's1', chapterId: 'c1', label: 'Ch 1, Sc 1', text: 'Young Mara steals a boat.' }],
      chapters: [],
      stories: [
        { storyId: 'b1', title: 'Book 1', meanwhile: false, cut: true, text: 'Book one up to chapter five.' },
        { storyId: 'k', title: "Kell's Road", meanwhile: true, cut: false, text: 'Kell walks south.' }
      ],
      series: [],
      leadsInto: { storyId: 'b1', title: 'Book 1', text: 'Mara is twenty and owns nothing.' }
    }
    const text = storySoFarText(s, 'Mara’s Youth', false)
    expect(text).toContain('### Book 1, up to where this story starts\nBook one up to chapter five.')
    expect(text).toContain("### Meanwhile: Kell's Road\nKell walks south.")
    expect(text).toContain('### Most recently\nCh 1, Sc 1: Young Mara steals a boat.')
    expect(
      text.endsWith(
        '### Leads into Book 1\nThis story leads into Book 1. Below is how Book 1 begins: a target to steer towards over the story, not events to mention or bring about in this scene.\nMara is twenty and owns nothing.'
      )
    ).toBe(true)
    // A chapter whose every summarised scene is shown isn't told twice.
    expect(storySoFarText({ ...s, chapters: [{ chapterId: 'c1', label: 'Ch 1', text: 'Chapter one.' }] }, 'X', false)).not.toContain(
      'Chapter one.'
    )
    expect(storySoFarText({ scenes: [], chapters: [], stories: [], series: [], leadsInto: null }, 'X', false)).toBe('')
  })

  it('block 9: other entries named or pinned; short: one line each', () => {
    const tide = entry('lore', 'The Tide Laws', {
      summary: 'Boats and bells.',
      fields: { category: 'Law', rules: 'No boats after the night bell without a token.', limits: 'A token costs two silver.' }
    })
    const market = entry('place', 'The Fish Market', { fields: { atmosphere: 'Gulls, brine and shouting.' } })
    const will = entry('character', 'Will', {
      summary: 'A stable boy.',
      fields: { build: 'Wiry', hair: 'Red', traits: 'Nosy', origin: 'Born in a barn.' }
    })
    const inp = input()
    inp.memory.entries.push(tide, market, will)
    inp.scene.card.beats = ['Tobin can’t take her because of the Tide Laws', 'They pass the Fish Market', 'Will brings the horses']
    const block = blockOf(inp, 'mentioned')!
    expect(block.text).toContain(
      '### The Tide Laws (lore)\nIn short: Boats and bells.\n\n- Category: Law\n- How it works: No boats after the night bell without a token.\n- Limits and costs: A token costs two silver.'
    )
    expect(block.text).toContain('### The Fish Market (place)\n\n- Atmosphere: Gulls, brine and shouting.')
    expect(block.text).toContain('### Will (character)\nIn short: A stable boy.')
    expect(block.text).toContain(`${DETAILS_LABEL}\n- Build: Wiry\n- Hair: Red`)
    expect(block.text).not.toContain('Nosy')
    expect(block.text).not.toContain('Born in a barn')
    expect(block.short).toBe('- The Tide Laws (lore): Boats and bells.\n- The Fish Market (place)\n- Will (character): A stable boy.')
  })

  it('block 9: a plot thread named in the beats that is already paid off says so', () => {
    const inp = input()
    const map = entry('thread', 'The lost map', { summary: 'Where is the map?' })
    const debt = entry('thread', 'The debt', { summary: 'What does Mara owe?' })
    inp.memory.entries.push(map, debt)
    inp.memory.threads = [
      { entryId: map.id, status: 'resolved', setUp: 'Book 1, Ch 1, Sc 1', paidOff: 'Book 1, Ch 9, Sc 2' },
      { entryId: debt.id, status: 'open', setUp: 'Book 1, Ch 2, Sc 1', paidOff: '' }
    ]
    inp.scene.card.beats = ['Mara remembers the lost map', 'She thinks of the debt']
    const block = blockOf(inp, 'mentioned')!
    expect(block.text).toContain('### The lost map (plot thread; already paid off in Book 1, Ch 9, Sc 2)')
    expect(block.text).toContain('### The debt (plot thread)\n')
    expect(block.short).toContain('- The lost map (plot thread; already paid off in Book 1, Ch 9, Sc 2): Where is the map?')
  })

  it('block 10: themes and tone of the story, series and world; short: one line', () => {
    const inp = richInput()
    inp.story.tone = 'Bleak. Then hopeful.'
    const block = blockOf(inp, 'themes')!
    expect(block.text).toBe(
      'Story premise: A smuggler must cross the river.\nStory tone: Bleak. Then hopeful.\nSeries themes: What we owe\nSeries tone: Wry\nWorld themes: Debt and loyalty\nWorld tone: Grim but warm'
    )
    expect(block.short).toBe('Themes: What we owe. Tone: Bleak.')
  })
})

// ---------- Fitting the briefing to the model ----------

/**
 * Counts for a prepared briefing, in the order of `prepared.texts`: every full form `full`, every
 * short form `short`, every smaller form `smaller` (by default the same as the short form, so it
 * saves nothing), the closing instructions 0.
 */
function counts(
  prepared: PreparedContext,
  full: (id: string) => number,
  short: (id: string) => number = () => 100,
  smaller: (id: string, level: number) => number = (id) => short(id)
): number[] {
  const out = prepared.blocks.flatMap((b) =>
    formsOf(b).map((_, level) => (level === 0 ? full(b.id) : level === 1 ? short(b.id) : smaller(b.id, level)))
  )
  expect(out.length).toBe(prepared.texts.length - 2)
  return [...out, 0, 0]
}

/** The briefing without what must stay true (its own tests are in mustStay.test.ts), so the numbers here stay simple. */
function withoutMust(p: PreparedContext): PreparedContext {
  const blocks = p.blocks.filter((b) => b.id !== MUST_BLOCK)
  return { ...p, blocks, texts: [...blocks.flatMap((b) => formsOf(b).map((t) => blockAsSent(b, t))), p.finals.withPrevious, p.finals.withoutPrevious] }
}

/** A context length that leaves exactly `available` tokens for the briefing. */
function lengthFor(available: number, targetWords: number | null): number {
  let length = Math.floor((available + replyTokens(targetWords)) / 0.9) - 5
  while (computeBudget(length, targetWords).available < available) length++
  expect(computeBudget(length, targetWords).available).toBe(available)
  return length
}

describe('fitting the briefing to the model', () => {
  const fit = (prepared: PreparedContext, available: number, c: number[], modes: Record<string, BlockMode> = {}) =>
    finishContext({ ...prepared, modes, contextLength: lengthFor(available, prepared.targetWords) }, c)
  const ids = (p: ReturnType<typeof fit>, test: (b: (typeof p.blocks)[number]) => boolean | undefined) =>
    p.blocks.filter(test).map((b) => b.id)

  // 12 blocks of 1,100 tokens each (1,000 plus the 10% allowance), short forms of 110; 10 have a short form.
  // Block 11 (ties to people not in the scene) and what must stay true are left out here, so the numbers stay simple;
  // see their own tests.
  const prepared = withoutMust(prepareContext(withoutTies(richInput())))
  const c = counts(prepared, () => 1000)
  const total = 12 * 1100 + 8

  it('every block of the rich scene has a short form except the scene card and relationships', () => {
    expect(prepared.blocks.filter((b) => b.short == null).map((b) => b.id)).toEqual(['relationships', 'scene-card'])
  })

  it('sends everything in full when it fits', () => {
    const p = fit(prepared, total, c)
    expect(ids(p, (b) => b.dropped || b.short)).toEqual([])
    expect(p.budget.used).toBe(total)
    expect(p.blocks.every((b) => b.mode === 'auto')).toBe(true)
    expect(p.blocks.find((b) => b.id === 'pov')).toMatchObject({ hasShort: true, short: false, tokens: 1100 })
    expect(p.blocks.find((b) => b.id === 'relationships')).toMatchObject({ hasShort: false, short: false })
  })

  it('says where the part a redraft sends again unchanged ends: right before the entries named in the card or direction', () => {
    for (const p of [fit(prepared, total, c), fit(prepared, total - 5 * 990, c)]) {
      const user = p.messages[1]
      const mentioned = p.blocks.find((b) => b.id === 'mentioned')!
      expect(mentioned.dropped).toBe(false)
      expect(user.cacheUpTo).toBeGreaterThan(0)
      expect(user.content.slice(user.cacheUpTo! + 2).startsWith(blockAsSent(mentioned))).toBe(true)
      expect(user.content.slice(0, user.cacheUpTo)).toContain('## World rules (never break these)')
      expect(p.messages[0].cacheUpTo).toBeUndefined()
    }
  })

  it('switches blocks to their short form from the bottom up before dropping anything', () => {
    const p = fit(prepared, total - 3 * 990, c)
    expect(ids(p, (b) => b.short)).toEqual(['themes', 'mentioned', 'story-so-far'])
    expect(ids(p, (b) => b.dropped)).toEqual([])
    expect(p.blocks.find((b) => b.id === 'themes')).toMatchObject({
      tokens: 110,
      text: prepared.blocks.find((b) => b.id === 'themes')!.short
    })

    // Within priority 7, the plot threads go short first and the hard rules last.
    const q = fit(prepared, total - 5 * 990, c)
    expect(ids(q, (b) => b.short)).toEqual(['themes', 'setting', 'mentioned', 'threads', 'story-so-far'])
    expect(q.messages[1].content).toContain('## World rules (never break these)\n\n### World rule: The Binding')
  })

  it('shortens block 1 only once blocks 3 to 10 are all short', () => {
    const p = fit(prepared, total - 9 * 990, c)
    expect(ids(p, (b) => b.short)).not.toContain('instructions')
    expect(ids(p, (b) => b.short)).toHaveLength(9)
    const q = fit(prepared, total - 10 * 990, c)
    expect(ids(q, (b) => b.short)).toContain('instructions')
    expect(q.messages[0].content).toBe(prepared.blocks[0].short)
    expect(ids(q, (b) => b.dropped)).toEqual([])
  })

  it('drops whole blocks from priority 10 upward only when everything is short, never 1 or 2', () => {
    // All short: 10 x 110 + the scene card and relationships in full.
    const allShort = 10 * 110 + 2 * 1100 + 8
    const p = fit(prepared, allShort - 300, c)
    expect(ids(p, (b) => b.dropped)).toEqual(['themes', 'mentioned', 'story-so-far'])
    expect(ids(p, (b) => !b.dropped && !b.short)).toEqual(['relationships', 'scene-card'])
    expect(p.budget.used).toBeLessThanOrEqual(p.budget.available)
    // Dropped blocks stay in the record but aren't sent.
    expect(p.blocks).toHaveLength(12)
    expect(p.messages[1].content).not.toContain('## Themes and tone')
    expect(p.messages[1].content).toContain('## Also in the scene')

    // Far too small: everything droppable goes, blocks 1 and 2 stay.
    const tiny = fit(prepared, 500, c)
    expect(ids(tiny, (b) => !b.dropped)).toEqual(['instructions', 'scene-card'])
    expect(tiny.messages[1].content).not.toContain('Continue seamlessly')
  })

  it('puts back smaller blocks once a big one has gone, then gives back full forms that fit, most important first', () => {
    // Short forms the same size as full ones; relationships (no short form) is huge.
    const big = counts(
      prepared,
      (id) => (id === 'relationships' ? 5000 : 100),
      () => 100
    )
    const p = fit(prepared, 1500, big)
    expect(ids(p, (b) => b.dropped)).toEqual(['relationships'])
    expect(ids(p, (b) => b.short)).toEqual([])

    // Room to re-expand one block after everything is short: the most important one gets it.
    const q = fit(prepared, 10 * 110 + 2 * 1100 + 8 + 990, c)
    expect(ids(q, (b) => !b.short && b.hasShort)).toEqual(['instructions'])
    const r = fit(prepared, 10 * 110 + 2 * 1100 + 8 + 2 * 990, c)
    expect(ids(r, (b) => !b.short && b.hasShort)).toEqual(['instructions', 'previous-scene'])
  })

  it("follows Adam's choice: 'full' is never shortened, 'short' is always short", () => {
    // Point of view short by choice saves one block's worth; then 9 and 8 go short, skipping 10.
    const p = fit(prepared, total - 3 * 990, c, { themes: 'full', pov: 'short' })
    expect(ids(p, (b) => b.short)).toEqual(['pov', 'mentioned', 'story-so-far'])
    expect(p.blocks.find((b) => b.id === 'themes')).toMatchObject({ mode: 'full', short: false, dropped: false })
    expect(p.blocks.find((b) => b.id === 'pov')).toMatchObject({ mode: 'short', short: true })

    // 'short' even when there is plenty of room.
    const roomy = fit(prepared, 100_000, c, { pov: 'short', 'scene-card': 'short' })
    expect(ids(roomy, (b) => b.short)).toEqual(['pov'])
    expect(roomy.blocks.find((b) => b.id === 'scene-card')!.mode).toBe('short')
  })

  it('drops a block Adam wants in full only as a last resort', () => {
    const allShortButThemes = 9 * 110 + 3 * 1100 + 8
    const p = fit(prepared, allShortButThemes - 1000, c, { themes: 'full' })
    expect(p.blocks.find((b) => b.id === 'themes')).toMatchObject({ dropped: false, short: false })
    expect(ids(p, (b) => b.dropped)).toContain('relationships')
    const tiny = fit(prepared, 500, c, { themes: 'full' })
    expect(tiny.blocks.find((b) => b.id === 'themes')!.dropped).toBe(true)
  })

  it('lists only the entries that were actually sent', () => {
    const tiny = fit(prepared, 500, c)
    expect(sentEntryIds(tiny.blocks)).toEqual([])
    const all = fit(prepared, total, c)
    const inp = richInput()
    expect(sentEntryIds(all.blocks).length).toBe(prepared.entries.filter((e) => !e.hidden).length)
    expect(sentEntryVersions(inp.memory, tiny.blocks).size).toBe(0)
  })

  it('a small-context model and a large-context model both get a sensible briefing for the same scene', () => {
    // Ordinary prose: a 300-word sample passage and a 720-word previous scene.
    const sample = Array.from({ length: 25 }, () => 'Mara did not hurry, and the river did not wait for her either.').join(' ')
    const scene = (contextLength: number): ContextInput => {
      const inp = richInput({ contextLength, options: { direction: 'End on the knock.', targetWords: 400, creativity: 'balanced' } })
      inp.style = style({ samplePassage: sample, avoidPhrases: ['suddenly'] })
      // A full profile, as Adam would fill it in.
      Object.assign(named(inp, 'Mara Venn').fields, {
        age: '31',
        role: 'protagonist',
        build: 'Wiry, all tendon',
        hair: 'Black, cropped with a knife',
        marks: 'The stump of her left wrist, kept wrapped',
        traits: 'Proud, quick, slow to trust',
        fears: 'Owing anyone anything',
        desires: 'To buy back her name',
        pastEvents: 'The siege of Varn, the fall of her house, two years rowing contraband for the Tide Guild.',
        secrets: 'She signed the order that opened the river gate.',
        arcStart: 'Alone and certain she needs no one.',
        arcEnd: 'Trusting Tobin with the truth.',
        wants: 'Passage out of Varn',
        motivation: 'The Duke has learnt who she is.'
      })
      inp.memory.previous = {
        ...inBook2,
        sceneId: 'scene-8',
        title: 'The docks',
        text: Array.from(
          { length: 12 },
          (_, i) =>
            `Paragraph ${i}. ${Array.from({ length: 5 }, () => 'The rain came off the river in sheets and Mara kept walking.').join(' ')}`
        ).join('\n\n')
      }
      return inp
    }
    // The rules against AI phrasing take about 150 tokens of block 1's short form.
    const small = assembleContext(scene(3200), countRaw)
    const sent = (id: string) => small.blocks.find((b) => b.id === id)!
    expect(small.budget.used).toBeLessThanOrEqual(small.budget.available)
    expect(sent('instructions')).toMatchObject({ dropped: false, short: true })
    expect(sent('scene-card').dropped).toBe(false)
    expect(sent('pov')).toMatchObject({ dropped: false, short: true })
    expect(sent('story-so-far')).toMatchObject({ dropped: false, short: true })
    expect(sent('previous-scene')).toMatchObject({ dropped: false, short: true })
    const user = small.messages[1].content
    expect(user).toContain('### Most recently\nCh 2, Sc 2: Scene summary 6.\n\nCh 2, Sc 3: Scene summary 7.')
    expect(user).toContain('## Point-of-view character: Mara Venn')
    expect(user).toContain('Voice\n- How they speak: Short, dry sentences.')
    expect(user).not.toContain('Born in the Narrows')
    expect(user).toContain('Write the scene now.')

    const large = assembleContext(scene(128_000), countRaw)
    expect(large.blocks.filter((b) => b.dropped || b.short)).toEqual([])
    expect(large.blocks).toHaveLength(14)
    expect(large.messages[1].content).toContain('## Ties to people not in this scene')
    expect(large.messages[0].content).toContain(sample)
    expect(large.messages[1].content).toContain('Born in the Narrows')
    expect(large.messages[1].content).toContain('Ch 1, Sc 3: Scene summary 3.')
  })

  it('uses the smaller forms of the point of view and the story so far, from the bottom up, before dropping anything', () => {
    // Full forms 1,000, short forms 100, then 50 and 20 (all plus the 10% allowance: 1,100, 110, 55, 22).
    const c = counts(
      prepared,
      () => 1000,
      () => 100,
      (_, level) => (level === 2 ? 50 : 20)
    )
    expect(prepared.blocks.filter((b) => b.smaller.length).map((b) => [b.id, b.smaller.length])).toEqual([
      ['pov', 1],
      ['story-so-far', 3]
    ])
    const form = (id: string, level: number): string => formsOf(prepared.blocks.find((b) => b.id === id)!)[level]
    const allShort = 10 * 110 + 2 * 1100 + 8
    // Room for everything short, less 50: the story so far goes smaller first (it is lower down).
    const p = fit(prepared, allShort - 50, c)
    expect(ids(p, (b) => b.dropped)).toEqual([])
    expect(p.blocks.find((b) => b.id === 'story-so-far')).toMatchObject({ text: form('story-so-far', 2), short: true, tokens: 55 })
    expect(p.blocks.find((b) => b.id === 'pov')!.text).toBe(form('pov', 1))
    expect(p.budget.used).toBeLessThanOrEqual(p.budget.available)
    // Less room still: a step at a time, both go smaller, and still nothing is dropped.
    const q = fit(prepared, allShort - 140, c)
    expect(ids(q, (b) => b.dropped)).toEqual([])
    expect(q.blocks.find((b) => b.id === 'story-so-far')).toMatchObject({ text: form('story-so-far', 3), tokens: 22 })
    expect(q.blocks.find((b) => b.id === 'pov')).toMatchObject({ text: form('pov', 2), tokens: 55 })
    // Only when the smallest forms aren't enough are blocks dropped, from the bottom up.
    expect(ids(fit(prepared, allShort - 200, c), (b) => b.dropped)).toEqual(['themes'])
    // Plenty of room: every block gets its full form back.
    expect(ids(fit(prepared, total, c), (b) => b.short || b.dropped)).toEqual([])
    // 'short' is the short form when there is room, and 'full' is never made smaller.
    const r = fit(prepared, 100_000, c, { pov: 'short' })
    expect(r.blocks.find((b) => b.id === 'pov')!.text).toBe(form('pov', 1))
    const s = fit(prepared, allShort - 140, c, { 'story-so-far': 'full' })
    expect(s.blocks.find((b) => b.id === 'story-so-far')).toMatchObject({ short: false, dropped: false })
  })
})

// ---------- Realistic numbers: small and large models, the same scene ----------

describe('a small-context model and a large-context model both get a sensible briefing for the same scene', () => {
  // Plain stand-in prose (nobody's story), so token counts are those of real English.
  const SENTENCES = [
    'The rain came off the river in grey sheets, and the lamps along the quay burned low and yellow.',
    'She kept her wrapped wrist inside her coat and walked as if she had somewhere better to be.',
    'Somewhere behind her a bell rang twice, then stopped, as though whoever pulled the rope had thought better of it.',
    'He was waiting under the awning of the chandler, his hat pulled down and his hands busy with a length of tarred rope.',
    '"You are late," he said, without looking up, and she let the silence answer for her.',
    'The smell of wet wool and lamp oil hung over everything, and under it the old green stink of the river.',
    'She counted the boats tied along the wall, the way she always did, and found one more than there should have been.',
    'It was not the kind of thing anyone else would notice, which was exactly why it worried her.'
  ]
  let next = 0
  const prose = (n: number): string => {
    const out: string[] = []
    for (let w = 0; w < n; ) {
      const s = SENTENCES[next++ % SENTENCES.length]
      out.push(s)
      w += s.split(' ').length
    }
    return out.join(' ')
  }
  const paragraphs = (n: number, per: number): string => Array.from({ length: Math.ceil(n / per) }, () => prose(per)).join('\n\n')

  /** A character filled in on every field, as the character builder would leave them. */
  const filled = (name: string): EntryState =>
    entry('character', name, {
      aliases: ['the Heir'],
      summary: prose(20),
      description: prose(150),
      fields: {
        ...Object.fromEntries(
          ['traits', 'values', 'flaws', 'fears', 'desires', 'habits', 'triggers', 'wants', 'needs', 'arcStart', 'arcEnd', 'motivation'].map(
            (k) => [k, prose(25)]
          )
        ),
        ...Object.fromEntries(['build', 'face', 'hair', 'eyes', 'skin', 'clothing', 'movement'].map((k) => [k, 'Narrow and watchful'])),
        pronouns: 'she/her',
        age: '31',
        role: 'protagonist',
        marks: 'The stump of her left wrist, kept wrapped',
        origin: prose(60),
        pastEvents: prose(90),
        secrets: prose(40),
        speech: 'Short, dry sentences. Never raises her voice.',
        tics: prose(15),
        neverSays: prose(15),
        sampleLines: Array.from({ length: 5 }, () => `"${prose(12)}"`).join('\n')
      },
      happened: Array.from({ length: 14 }, (_, i) => ({ note: prose(18), where: `Book 2, Ch ${i + 1}, Sc 2`, changeId: `h${i}` }))
    })

  /**
   * Book 3, Ch 12, Sc 5: two earlier books (and a series roll-up), 11 finished chapters with 200-word
   * summaries, four earlier scenes in this chapter, a 2,600-word previous scene, a 350-word sample
   * passage, three full profiles, a location inside two places, two hard rules, a plot thread and a pin.
   */
  function bookThree(contextLength: number, targetWords: number | null, card: 'full' | 'typical' = 'full'): ContextInput {
    next = 0
    const mara = filled('Mara Venn')
    const tobin = filled('Tobin')
    const duke = filled('The Duke')
    const varn = entry('place', 'Varn', {
      summary: prose(15),
      description: prose(120),
      fields: { atmosphere: prose(30), history: prose(80) }
    })
    const lowtown = entry('place', 'Lowtown', { summary: prose(15), parentId: varn.id, description: prose(80) })
    const eel = entry('place', 'The Gilded Eel', {
      summary: prose(15),
      parentId: lowtown.id,
      description: prose(100),
      fields: { atmosphere: prose(30), senses: prose(40), people: prose(25), history: prose(60) }
    })
    const guild = entry('group', 'The Tide Guild', { summary: prose(15), description: prose(100) })
    const binding = entry('lore', 'The Binding', {
      summary: prose(15),
      hardRule: true,
      description: prose(60),
      fields: { rules: prose(60) }
    })
    const salt = entry('lore', 'The Salt Law', { summary: prose(15), hardRule: true, description: prose(40) })
    const crown = entry('thread', 'The stolen crown', {
      summary: prose(15),
      description: prose(60),
      fields: { promise: prose(25), clues: prose(40) }
    })
    const songs = entry('lore', 'River songs', { summary: prose(15), description: prose(80) })
    const sceneSummaries = [
      ...Array.from({ length: 3 }, (_, i) => ({ sceneId: `s11-${i}`, chapterId: 'c11', label: `Ch 11, Sc ${i + 1}`, text: prose(180) })),
      ...Array.from({ length: 4 }, (_, i) => ({ sceneId: `s12-${i}`, chapterId: 'c12', label: `Ch 12, Sc ${i + 1}`, text: prose(180) }))
    ]
    const typical = card === 'typical'
    return {
      style: style({
        proseStyle: prose(60),
        notes: prose(50),
        contentLimits: prose(20),
        samplePassage: paragraphs(350, 90),
        avoidPhrases: ['suddenly', 'a testament to', 'tapestry', 'delve', 'shiver down her spine', 'orbs', 'smirked', 'in that moment']
      }),
      scene: {
        title: 'The knock',
        card: {
          ...emptySceneCard(),
          povId: mara.id,
          presentIds: [mara.id, tobin.id],
          locationId: eel.id,
          when: 'Day 12, dusk',
          beats: typical
            ? Array.from({ length: 5 }, () => prose(14))
            : [...Array.from({ length: 6 }, () => prose(25)), 'She thinks of The Duke'],
          goal: prose(typical ? 15 : 25),
          conflict: prose(typical ? 15 : 25),
          outcome: prose(typical ? 15 : 25),
          mood: 'Tense, close, wet',
          targetWords: targetWords ?? 1500,
          notes: typical ? '' : prose(60),
          paysOffIds: [crown.id]
        }
      },
      memory: memoryOf([mara, tobin, duke, varn, lowtown, eel, guild, binding, salt, crown, songs], {
        knows: 'This story knows what happened in: Book 1; Book 2.',
        previous: { sceneId: 'p', title: 'The docks', text: paragraphs(2600, 110), ...inBook2 },
        relationships: [
          { aId: mara.id, bId: tobin.id, type: 'old friends, now uneasy', aFeels: prose(15), bFeels: prose(15), where: '' },
          { aId: mara.id, bId: guild.id, type: 'lieutenant', aFeels: '', bFeels: '', where: '' },
          { aId: mara.id, bId: duke.id, type: 'sworn enemies', aFeels: prose(12), bFeels: prose(12), where: '' }
        ],
        facts: Array.from({ length: 8 }, (_, i) => ({
          factId: `f${i}`,
          fact: prose(15),
          knownBy: i % 2 ? [mara.id] : [mara.id, tobin.id]
        })),
        threads: [{ entryId: crown.id, status: 'open', setUp: 'Book 1, Ch 2, Sc 1', paidOff: '' }],
        storySoFar: {
          scenes: sceneSummaries,
          chapters: Array.from({ length: 11 }, (_, i) => ({ chapterId: `c${i + 1}`, label: `Ch ${i + 1}`, text: prose(200) })),
          stories: [
            { storyId: 'b1', title: 'Book 1', meanwhile: false, cut: false, text: prose(250) },
            { storyId: 'b2', title: 'Book 2', meanwhile: false, cut: false, text: prose(250) }
          ],
          series: [{ seriesId: 'sr', name: 'The River Books', storyIds: ['b1', 'b2'], text: prose(200) }],
          leadsInto: null
        }
      }),
      pins: [pin(songs.id, 'story')],
      blockModes: {},
      world: { themes: prose(30), tone: prose(20) },
      series: { name: 'The River Books', themes: prose(30), tone: prose(20) },
      story: { title: 'Book 3', premise: prose(50), themes: prose(25), tone: prose(15) },
      options: { direction: typical ? '' : prose(20), targetWords, creativity: 'balanced' },
      contextLength
    }
  }

  const briefing = (contextLength: number, targetWords: number | null, card: 'full' | 'typical' = 'full') => {
    const p = assembleContext(bookThree(contextLength, targetWords, card), countRaw)
    const block = (id: string) => p.blocks.find((b) => b.id === id)!
    const sent = (id: string): boolean => !!p.blocks.find((b) => b.id === id && !b.dropped)
    return { p, block, sent, user: p.messages[1].content }
  }

  /** What every briefing must hold, whatever the model. */
  function sensible(b: ReturnType<typeof briefing>): void {
    expect(b.p.budget.used).toBeLessThanOrEqual(b.p.budget.available)
    // Every part is listed, sent or not, so the Context tab and "What the AI saw" show what was left out.
    expect(b.p.blocks).toHaveLength(14)
    for (const id of ['instructions', 'scene-card', 'pov', 'previous-scene']) expect(b.sent(id), id).toBe(true)
    expect(b.p.messages[0].content).toContain('Style guide\n- Point of view: Close third person')
    expect(b.p.messages[0].content).toContain('Sample passage')
    expect(b.p.messages[0].content).toContain('- suddenly')
    expect(b.user).toContain('Beats, in order:\n1. ')
    // A point-of-view character the model can write: who she is, how she speaks, what she knows.
    expect(b.user).toContain('## Point-of-view character: Mara Venn\n\nAlso called: the Heir\nIn short: ')
    expect(b.user).toContain('- Pronouns: she/her')
    expect(b.user).toContain('- How they speak: Short, dry sentences. Never raises her voice.')
    expect(b.user).toMatch(/- Sample lines of dialogue:\n {4}"/)
    expect(b.user).toContain('What Mara Venn knows:\n- ')
    expect(b.user).toContain('## End of the previous scene\n\n')
    expect(b.user.trimEnd().endsWith('- Never contradict the facts given above.')).toBe(true)
    // Nothing is cut off mid-sentence: every part starts and ends on whole sentences.
    for (const x of b.p.blocks.filter((x) => !x.dropped)) expect(x.text, x.id).not.toContain('…')
    expect(b.block('previous-scene').text).toMatch(/^["A-Z]/)
  }

  it('a 4,000-token model writing 600 words: instructions, scene card, the end of the previous scene and the core of the point of view', () => {
    const b = briefing(4096, 600, 'typical')
    sensible(b)
    expect(b.block('instructions').short).toBe(true)
    expect(b.block('previous-scene').short).toBe(true)
    // The least of the profile: no backstory, no long description, two sample lines.
    expect(b.block('pov').text).not.toContain('Backstory')
    expect(b.block('pov').text.match(/^ {4}"/gm)).toHaveLength(2)
    expect(b.block('pov').text).toContain('- Current motivation: ')
    expect(b.block('pov').text).toContain('- Distinguishing marks: The stump of her left wrist, kept wrapped')
  })

  it('an 8,000-token model writing 1,500 words: also the people present, the world rules and the most recent story so far', () => {
    const b = briefing(8192, 1500)
    sensible(b)
    for (const id of ['present', 'relationships', 'world-rules', 'setting', 'threads', 'story-so-far']) expect(b.sent(id), id).toBe(true)
    expect(b.block('story-so-far').short).toBe(true)
    expect(b.block('story-so-far').text).toContain('Only the most recent part of the story so far is given here, to save space.')
    // The last two scenes before this one, by their summaries.
    expect(b.block('story-so-far').text).toMatch(/### Most recently\nCh 12, Sc 3: .+\n\nCh 12, Sc 4: /)
    expect(b.block('pov').text).not.toContain('Backstory')
    // Tobin, in short: who he is and how he speaks.
    expect(b.user).toContain('## Also in the scene\n\n### Tobin\nIn short: ')
    expect(b.user).toContain('The Binding: ')
  })

  it('a 16,000-token model: the point of view in full, the story so far by chapters', () => {
    const b = briefing(16_000, 1500)
    sensible(b)
    expect(b.p.blocks.filter((x) => x.dropped)).toEqual([])
    expect(b.block('pov')).toMatchObject({ short: false })
    expect(b.block('pov').text).toContain('Backstory\n- Origin: ')
    const sofar = b.block('story-so-far').text
    expect(sofar).toContain('### The River Books\n')
    expect(sofar).toContain('Ch 11: ')
    // The chapter this scene is in has no summary yet: its earlier scenes are told one by one.
    expect(sofar).toContain('Ch 12, Sc 1: ')
  })

  it('32,000 and 128,000-token models: everything in full', () => {
    for (const length of [32_768, 128_000]) {
      const b = briefing(length, 1500)
      sensible(b)
      expect(b.p.blocks.filter((x) => x.dropped || x.short)).toEqual([])
      expect(b.user).toContain('### Book 1\n')
      expect(b.user).toContain('### Book 2\n')
      expect(b.user).toContain('Ch 1: ')
      expect(b.user).toContain('Ch 11, Sc 3: ')
      expect(b.user).toContain('## Also relevant')
      expect(b.user).toContain('## Themes and tone')
    }
  })

  it('late in a long series, when the point of view knows 150 things, a small model still gets her and who knows what', () => {
    const inp = bookThree(8192, 1500)
    const mara = named(inp, 'Mara Venn')
    const tobin = named(inp, 'Tobin')
    inp.memory.facts = Array.from({ length: 150 }, (_, i) => ({
      factId: `k${i}`,
      fact: i === 3 ? 'Tobin owes the Tide Guild forty crowns.' : `${prose(14)} (${i})`,
      knownBy: i % 5 ? [mara.id] : [mara.id, tobin.id]
    }))
    const p = assembleContext(inp, countRaw)
    const block = (id: string) => p.blocks.find((b) => b.id === id)!
    expect(p.budget.used).toBeLessThanOrEqual(p.budget.available)
    for (const id of ['pov', 'relationships', 'story-so-far', 'previous-scene']) expect(block(id).dropped, id).toBe(false)
    const pov = block('pov').text
    // The fact about someone in the scene is kept, with the latest ones, and the rest are counted.
    expect(pov).toContain('- Tobin owes the Tide Guild forty crowns.')
    expect(pov).toContain('(149)')
    expect(pov).toMatch(/\(And 14\d more, left out here to save space\.\)/)
    expect(pov).toContain('- How they speak: Short, dry sentences.')
    const rel = block('relationships')
    expect(rel.short).toBe(true)
    expect(rel.text).toContain('- Mara Venn and Tobin: old friends, now uneasy.')
    expect(rel.text).toContain("Facts some of them know and others don't:\n- Tobin does not know: ")
    expect(rel.text).toMatch(/\(And 11\d more, left out here to save space\.\)/)
    // A large model gets them all.
    const big = assembleContext({ ...inp, contextLength: 200_000 }, countRaw)
    expect(big.blocks.filter((b) => b.short || b.dropped)).toEqual([])
    expect(big.messages[1].content).not.toContain('left out here to save space')
    expect(big.blocks.find((b) => b.id === 'relationships')!.text.match(/^- Tobin does not know: /gm)).toHaveLength(120)
    // What must stay true repeats only the latest few, right above the closing instruction.
    expect(big.blocks.find((b) => b.id === MUST_BLOCK)!.text.match(/^- Kept from Tobin: /gm)).toHaveLength(3)
  })

  it("Auto on a big model: room for Auto's longest scene, and the briefing in full", () => {
    const b = briefing(128000, null)
    sensible(b)
    expect(b.p.budget.reserved).toBe(replyTokens(AUTO_LENGTH.max))
    expect(b.user).toContain('between 800 and 4,000 words')
    expect(lengthTooLong(b.p.budget)).toBeNull()
  })

  it("Auto on a model too small for Auto's longest scene: the ceiling comes down to what fits, instead of a refusal", () => {
    const b = briefing(6000, null)
    const ceiling = Number(/between 800 and ([\d,]+) words/.exec(b.user)![1].replace(',', ''))
    expect(ceiling).toBeLessThan(AUTO_LENGTH.max)
    expect(ceiling).toBeGreaterThanOrEqual(AUTO_LENGTH.min)
    expect(b.p.budget.reserved).toBe(replyTokens(ceiling))
    expect(lengthTooLong(b.p.budget)).toBeNull()
    for (const id of ['instructions', 'scene-card']) expect(b.sent(id), id).toBe(true)
  })

  it("Auto on a model too small even for Auto's shortest scene: refused with a length that fits", () => {
    const b = briefing(2600, null)
    expect(b.p.budget.reserved).toBe(replyTokens(AUTO_LENGTH.min))
    expect(lengthTooLong(b.p.budget)!.maxWords).toBeLessThan(AUTO_LENGTH.min)
  })

  it('a model too small for the length asked: only the instructions and the scene card, and the draft is refused with a length that fits', () => {
    const b = briefing(4096, 1500)
    expect(b.p.blocks.filter((x) => !x.dropped).map((x) => x.id)).toEqual(['instructions', 'scene-card'])
    expect(lengthTooLong(b.p.budget)).toEqual({ maxWords: expect.any(Number) })
    expect(lengthTooLong(b.p.budget)!.maxWords).toBeGreaterThanOrEqual(500)
  })
})

// ---------- The previous scene's ending ----------

describe('sceneTail', () => {
  it('returns short scenes whole', () => {
    expect(sceneTail('  A short scene.  ')).toBe('A short scene.')
  })

  it('cuts long scenes at a paragraph start, between 400 and 800 words, near 600', () => {
    const paras = Array.from({ length: 20 }, (_, i) => `P${i} ${words(99)}.`)
    const text = paras.join('\n\n')
    const tail = sceneTail(text)
    const n = tail.split(/\s+/).length
    expect(n).toBeGreaterThanOrEqual(400)
    expect(n).toBeLessThanOrEqual(800)
    expect(n).toBe(600)
    expect(tail.startsWith('P14 ')).toBe(true)
  })

  it('falls back to a sentence start when paragraphs are too long', () => {
    const sentences = Array.from({ length: 120 }, (_, i) => `S${i} ${words(9)}.`)
    const tail = sceneTail(sentences.join(' '))
    expect(tail).toMatch(/^S\d+ /)
    const n = tail.split(/\s+/).length
    expect(n).toBeGreaterThanOrEqual(400)
    expect(n).toBeLessThanOrEqual(800)
  })

  it('cuts mid-text with an ellipsis when there is no boundary at all', () => {
    const tail = sceneTail(words(2000))
    expect(tail.startsWith('…')).toBe(true)
    expect(tail.split(/\s+/).length).toBe(600)
  })
})

// ---------- Messages ----------

describe('assembleContext', () => {
  it('sends block 1 as the system message and the rest in order under headings', () => {
    const preview = assembleContext(richInput(), countRaw)
    expect(preview.messages).toHaveLength(2)
    expect(preview.messages[0]).toEqual({ role: 'system', content: preview.blocks[0].text })
    const user = preview.messages[1].content
    const order = [
      '## World rules (never break these)',
      '## Themes and tone',
      '## Setting',
      '## Point-of-view character: Mara Venn',
      '## Also in the scene',
      '## Relationships and who knows what',
      '## Also relevant',
      '## Plot threads in this scene',
      '## The story so far',
      '## End of the previous scene',
      '## Scene card',
      'Write the scene now.'
    ]
    let at = -1
    for (const h of order) {
      const i = user.indexOf(h)
      expect(i, h).toBeGreaterThan(at)
      at = i
    }
    expect(user).toContain('Hit every beat on the scene card, in order.')
    expect(user).toContain('Aim for about 1,200 words.')
    expect(user).toContain('Keep to close third person, past tense and UK spelling.')
    expect(user).toContain('Continue seamlessly from where the previous scene ends')
    expect(user).toContain("Follow the author's direction for this draft.")
    expect(user).toContain('Never contradict the facts given above.')
  })

  it('returns the "knows what happened in" sentence and every entry with why, for the Context tab', () => {
    const preview = assembleContext(richInput(), countRaw)
    expect(preview.knows).toBe('This story knows what happened in: Book 1.')
    expect(preview.entries!.map((e) => [e.name, e.blockId])).toEqual([
      ['Mara Venn', 'pov'],
      ['Tobin', 'present'],
      ['The Binding', 'world-rules'],
      ['The Gilded Eel', 'setting'],
      ['Lowtown', 'setting'],
      ['Varn', 'setting'],
      ['The Tide Guild', 'setting'],
      ['The stolen crown', 'threads'],
      ["Tobin's Ferry", 'mentioned'],
      ['River songs', 'mentioned'],
      ['Ana Venn', 'ties']
    ])
  })

  it('keeps the system message identical between scenes, so providers can cache it', () => {
    const a = assembleContext(input(), countRaw)
    const b = assembleContext(
      input(
        { options: { direction: '', targetWords: 900, creativity: 'steady' } },
        { previous: { sceneId: 'x', title: '', text: 'Something else entirely.', ...inBook2 } }
      ),
      countRaw
    )
    expect(a.messages[0].content).toBe(b.messages[0].content)
  })

  it('keeps the briefing the same up to the scene card when only the direction changes', () => {
    const a = assembleContext(input(), countRaw).messages[1].content
    const b = assembleContext(input({ options: { direction: 'Slower, more rain.', targetWords: 1200, creativity: 'balanced' } }), countRaw)
      .messages[1].content
    const head = (t: string): string => t.slice(0, t.indexOf('## Scene card'))
    expect(head(a).length).toBeGreaterThan(200)
    expect(head(a)).toBe(head(b))
    expect(a).not.toBe(b)
  })

  it('counts tokens with a 10% allowance and adds up what is sent', () => {
    const preview = assembleContext(input(), countRaw)
    for (const b of preview.blocks) expect(b.tokens).toBeGreaterThan(0)
    const sum = preview.blocks.reduce((s, b) => s + b.tokens, 0)
    expect(preview.budget.used).toBeGreaterThan(sum)
    expect(preview.budget.used).toBeLessThan(sum + 200)
    expect(preview.blocks.every((b) => !b.dropped)).toBe(true)
  })

  it('formats a profile with its heading by default', () => {
    const w = world()
    expect(formatProfile(w.tobin).startsWith('### Tobin\nIn short: A ferryman who owes Mara.')).toBe(true)
  })
})

describe('cachedCounter', () => {
  it('counts each text once, and only the new ones on the next call', async () => {
    const count = vi.fn(async (texts: string[]) => texts.map((t) => t.length))
    const cached = cachedCounter(count, 3)
    expect(await cached(['aa', 'bbb', '', 'aa'])).toEqual([2, 3, 0, 2])
    expect(count).toHaveBeenCalledWith(['aa', 'bbb'])
    expect(await cached(['bbb', 'cccc'])).toEqual([3, 4])
    expect(count).toHaveBeenLastCalledWith(['cccc'])
    // Keeps only the most recently used.
    await cached(['d'])
    count.mockClear()
    await cached(['aa'])
    expect(count).toHaveBeenCalledWith(['aa'])
  })
})

// ---------- The writer instructions ----------

describe('the writer instructions', () => {
  const system = (over: Partial<StyleGuide> = {}): string =>
    assembleContext(input({ style: style({ samplePassage: 'Mara did not hurry.', ...over }) }), countRaw).messages[0].content
  const user = (card: Partial<ContextInput['scene']['card']>, direction = ''): string =>
    assembleContext(
      input({
        scene: { title: 'The knock', card: { ...emptySceneCard(), ...card } },
        options: { direction, targetWords: 1000, creativity: 'balanced' }
      }),
      countRaw
    ).messages[1].content

  it('follows the point of view the style guide sets', () => {
    expect(system()).toContain('In a close third-person, first-person or second-person point of view')
    expect(system({ pov: 'Omniscient, roving between the crew' })).toContain('Keep to the omniscient point of view the style guide sets')
    expect(system({ pov: 'Omniscient' })).not.toContain("other people's thoughts show only through")
  })

  it("asks for the sample passage's voice without forbidding its names", () => {
    const text = system()
    expect(text).toContain("don't copy its sentences or replay its events")
    expect(text).not.toMatch(/reuse its events, names/)
  })

  it('asks for plain text, with asterisks only for italics', () => {
    expect(system()).toContain('wrap them in single *asterisks*')
  })

  it('says aims and targets are where the story is heading, not what has happened', () => {
    expect(system()).toContain('is where the story is heading, not something that has already happened')
  })

  it('aims the scene at whatever the card holds', () => {
    expect(user({ beats: ['She arrives'] })).toContain('Hit every beat on the scene card, in order.')
    expect(user({ goal: 'Escape', outcome: 'She is caught' })).toContain('from its goal to its outcome')
    expect(user({ goal: 'Escape' })).toContain("Build the scene around the scene card's goal.")
    expect(user({ outcome: 'She is caught' })).toContain("arrives at the scene card's outcome")
    expect(user({ notes: 'A quiet scene by the fire.' })).toContain("Write the scene the author's notes on the scene card describe.")
    const empty = user({})
    expect(empty).toContain('The scene card gives no plan beyond its title')
    expect(empty).not.toContain('from its goal to its outcome')
    const directed = user({}, 'Make it tense')
    expect(directed).not.toContain('no plan beyond its title')
    expect(directed).toContain("Follow the author's direction for this draft.")
  })
})

// ---------- Block 11: ties to people not in this scene (milestone 5) ----------

describe('ties to people not in this scene', () => {
  it('lists, for each character present, who they are tied to that is not there, with where it stands', () => {
    const inp = richInput()
    const ties = blockOf(inp, 'ties')!
    expect(ties.priority).toBe(11)
    expect(ties.title).toBe('Ties to people not in this scene')
    expect(ties.text).toBe("### Mara Venn\n- Ana Venn: Mara's sister. Sister. Mara Venn feels: Fierce love. Ana Venn feels: Worry.")
    // Short: names and relationship only. Groups belong to block 7, and Tobin is in the scene (block 6).
    expect(ties.short).toBe('Mara Venn: Ana Venn (sister)')
    expect(ties.text).not.toContain('Tide Guild')
    expect(ties.text).not.toContain('Tobin')
    expect(ties.entryIds).toEqual([named(inp, 'Ana Venn').id])
  })

  it('tells what has happened between them, newest first: events naming both, and changes that name the other', () => {
    const inp = richInput()
    const mara = named(inp, 'Mara Venn')
    const ana = named(inp, 'Ana Venn')
    const flood = entry('event', 'The flood', { summary: 'The river took the lower town.', fields: { when: 'Year 3' } })
    inp.memory.entries.push(flood)
    inp.memory.relationships.find((r) => r.bId === ana.id)!.at = 2
    inp.memory.relationships.push(
      { aId: mara.id, bId: flood.id, type: 'involved in', aFeels: '', bFeels: '', where: 'Book 1, Ch 1, Sc 1', at: 1 },
      { aId: ana.id, bId: flood.id, type: 'involved in', aFeels: '', bFeels: '', where: 'Book 1, Ch 1, Sc 1', at: 1 }
    )
    mara.happened = [
      { note: 'Pulled Ana out of the water', where: 'Book 1, Ch 1, Sc 2', changeId: 'h1', at: 2 },
      { note: 'Lost her left hand in the siege', where: 'Book 1, Ch 4, Sc 1', changeId: 'h2', at: 5 }
    ]
    ana.happened = [{ note: 'Stopped writing to Mara.', where: 'Book 1, Ch 9, Sc 1', changeId: 'h3', at: 9 }]
    expect(blockOf(inp, 'ties')!.text).toContain(
      [
        '  Between them, newest first:',
        '  - Ana Venn: Stopped writing to Mara (Book 1, Ch 9, Sc 1).',
        '  - Mara Venn: Pulled Ana out of the water (Book 1, Ch 1, Sc 2).',
        '  - The flood (Year 3): The river took the lower town.'
      ].join('\n')
    )
    expect(blockOf(inp, 'ties')!.text).not.toContain('left hand')
  })

  it('puts the closest and most recent ties first, and the smallest form keeps only the closest few', () => {
    const inp = richInput()
    const mara = named(inp, 'Mara Venn')
    const others = ['Bram', 'Cato', 'Dell', 'Esk', 'Finn'].map((n) => entry('character', n))
    inp.memory.entries.push(...others)
    others.forEach((o, i) =>
      inp.memory.relationships.push({ aId: mara.id, bId: o.id, type: 'friend', aFeels: '', bFeels: '', where: '', at: 10 + i })
    )
    // Bram is the oldest of these ties but shares the most with her.
    mara.happened = [1, 2, 3].map((n) => ({ note: `Sailed with Bram, trip ${n}`, where: '', changeId: `t${n}`, at: n }))
    const ties = blockOf(inp, 'ties')!
    expect(ties.short).toBe(
      'Mara Venn: Bram (friend); Finn (friend); Esk (friend); Dell (friend); Cato (friend); Ana Venn (sister)'
    )
    expect(ties.smaller).toEqual(['Mara Venn: Bram (friend); Finn (friend); Esk (friend)'])
  })

  it('leaves out people Adam kept out, and people who do not exist here yet', () => {
    const inp = richInput()
    inp.pins.push(pin(named(inp, 'Ana Venn').id, 'scene', 'hide'))
    expect(blockOf(inp, 'ties')).toBeUndefined()
    const later = richInput()
    const ana = named(later, 'Ana Venn')
    later.memory.entries = later.memory.entries.filter((e) => e.id !== ana.id)
    later.memory.elsewhere.push({ entry: ana, label: 'not in the story yet at this point' })
    expect(blockOf(later, 'ties')).toBeUndefined()
  })

  it('goes short first, and is left out before any block is made smaller than its short form', () => {
    const prepared = withoutMust(prepareContext(richInput()))
    const fit = (available: number, c: number[]) =>
      finishContext({ ...prepared, contextLength: lengthFor(available, prepared.targetWords) }, c)
    const total = 13 * 1100 + 8
    expect(
      fit(total - 990, counts(prepared, () => 1000))
        .blocks.filter((b) => b.short)
        .map((b) => b.id)
    ).toEqual(['ties'])
    // Everything short is 11 x 110 plus the scene card and relationships in full; 100 less than that (more than the
    // story so far's own extra step, chapters and the last few scenes, can save).
    const small = counts(
      prepared,
      () => 1000,
      () => 100,
      (_, level) => (level === 2 ? 50 : 20)
    )
    const short = (id: string): string | null => prepared.blocks.find((b) => b.id === id)!.short
    const p = fit(11 * 110 + 2 * 1100 + 8 - 100, small)
    expect(p.blocks.filter((b) => b.dropped).map((b) => b.id)).toEqual(['ties'])
    expect(p.blocks.find((b) => b.id === 'story-so-far')!.text).toBe(short('story-so-far'))
    expect(p.blocks.find((b) => b.id === 'pov')!.text).toBe(short('pov'))
  })
})

describe('the time since the previous scene', () => {
  const at = (now: string, then: string | undefined, otherStory = false) =>
    timeSincePrevious({
      scene: { title: '', card: { ...emptySceneCard(), when: now } },
      memory: { previous: { sceneId: 'p', title: '', text: 'x', storyId: 's', storyTitle: '', when: then, otherStory: otherStory ? { ended: true, timeGap: '' } : null } } as never
    })
  it('says how long after the previous scene this one is, from both cards', () => {
    expect(at('Day 8, noon', 'Day 5, dusk')).toBe(
      "The previous scene was Day 5, dusk. 3 days later. Make the time that has passed fit (travel, sleep, healing), and don't say more or less of it has gone by."
    )
    expect(at('Day 10, dawn', 'Day 9, night')).toContain('The next day.')
    expect(at('Day 13, dusk', 'Day 13, afternoon')).toContain('The same day.')
    expect(at('Spring, the year after', 'Winter')).toBe(
      "The previous scene was Winter. Make the time that has passed fit (travel, sleep, healing), and don't say more or less of it has gone by."
    )
    expect(at('Day 8', '')).toBe('')
    expect(at('Day 8', 'Day 5', true)).toBe('')
  })
})

describe('who is dead by this point', () => {
  const who = (notes: string[]) =>
    deadBy([{ kind: 'character', name: 'Anselm', happened: notes.map((note, i) => ({ note, where: '', changeId: String(i) })) }])
  it('from a note that says they died, the latest', () => {
    expect(who(['lied to Captain Sallow', 'presumed dead in the Archive fire'])).toEqual([{ name: 'Anselm', note: 'presumed dead in the Archive fire' }])
    expect(who(['died in the fire'])).toHaveLength(1)
    expect(who(['killed by the watch at dawn'])).toHaveLength(1)
    expect(who(['was found drowned in the harbour'])).toHaveLength(1)
  })
  it('not from someone else’s death, news of one, or a death undone', () => {
    expect(who(['killed the guard at the gate'])).toEqual([])
    expect(who(['learned that Maud was dead'])).toEqual([])
    expect(who(['watched her father die'])).toEqual([])
    expect(who(['presumed dead in the fire', 'survived the fire after all'])).toEqual([])
    // Someone else's death in a note of hers (a live run counted these as her own).
    expect(who(['admitted Anselm died in the fire because of her'])).toEqual([])
    expect(who(['burned the Archive, and Anselm died in it'])).toEqual([])
    expect(who(['revealed her family drowned the old coast'])).toEqual([])
  })
  it('a death later in a note of what they did', () => {
    expect(who(['fled across the causeway and was taken by the tide'])).toEqual([])
    expect(who(['fought the watch and was killed by Sallow'])).toHaveLength(1)
  })
})
