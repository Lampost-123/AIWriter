// The continuity brief before each scene (long story memory fix 14; trimmed 2026-10-20), the planner's side: how much
// the plan's call may read, the record it reads fitted to that room (the earlier chapters in short, the scene before and
// the scene so far word for word, everyone and everything here with their last few changes, who knows what among them, the
// calendar, the slips, the rule findings, the first few passages found, the contract), the request in an order a
// provider's cache can keep, the brief read and checked (a scene it was never given or looked up left out, each list
// capped, kept to its size), the call that writes it with the plan (no new call), and the world's parts it reads. The
// model is a stand-in; invented test text only.
import { describe, expect, it } from 'vitest'
import type { EntryKind, EntryState, FactState, Pin } from '@shared/types'
import type { SceneState } from '@shared/continuity'
import { defaultStyleGuide, emptySceneCard } from '@shared/defaults'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import * as gens from '../db/generations'
import { openRuleFindings } from '../db/checks'
import type { MemoryModel } from '../keeper/model'
import { estimateTokens } from '../keeper/text'
import { assembleContext, prepareContext, sceneKnowers, selectEntries, toldStage, type ContextInput } from '../ai/context'
import { openThreadsMost } from '../ai/openThreads'
import { memoryScale } from '../ai/memoryRoom'
import { countRaw } from '../ai/tokens'
import { BRIEF_BLOCK, briefText } from '../ai/brief'
import { contractText } from '../ai/contract'
import { buildCalendar } from '../memory/calendar'
import {
  BRIEF_MOST,
  BRIEF_REPLY_SHARE,
  CHAPTERS_TITLE,
  KNOWS_MOST,
  PASSAGES_MOST,
  PREVIOUS_TITLE,
  RECORD_MOST,
  SO_FAR_TITLE,
  briefFrees,
  briefMaterial,
  briefRoom,
  BRIEF_RULE,
  checkBrief,
  fitParts,
  partText,
  placesCited,
  planThreads,
  readBrief,
  type BriefMaterial
} from './brief'
import { keepsRoom, LOOKUP_RULE, makePlan, planMessages, planSystem, readPlan, type PlanMaterial } from './plan'

let seq = 0
const entry = (kind: EntryKind, name: string, extra: Partial<EntryState> = {}): EntryState => ({
  id: `q${++seq}`,
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

// ---------- How much it may read ----------

describe('how much the plan may read for the brief', () => {
  it('the record: half of what it reads, less the plan and its reply, at most RECORD_MOST however much it reads; none when there is no room', () => {
    expect(briefRoom({ contextLength: 16_000, base: 3_000, reply: 2_200 })).toBe(2_800)
    expect(briefRoom({ contextLength: 24_000, base: 3_000, reply: 3_500 })).toBe(5_500)
    // DeepSeek Flash reads 1,000,000 tokens: the record is still RECORD_MOST (2026-10-20: no whole book beside it).
    expect(briefRoom({ contextLength: 64_000, base: 3_000, reply: 3_500 })).toBe(RECORD_MOST)
    expect(briefRoom({ contextLength: 1_000_000, base: 5_000, reply: 3_500 })).toBe(RECORD_MOST)
    expect(RECORD_MOST).toBeLessThanOrEqual(12_000)
    expect(briefRoom({ contextLength: 8_000, base: 3_800, reply: 2_200 })).toBe(0)
  })
})

describe('how long the brief may be', () => {
  it('about as long as what the parts going short beside it free: those sent in full, less their short forms', () => {
    const draft = (id: string, full: number, short: number | null) => ({
      id,
      text: 'x'.repeat(full * 3.5),
      short: short == null ? null : 'x'.repeat(short * 3.5)
    })
    const sent = (id: string, extra = {}) => ({
      id,
      priority: 8,
      title: id,
      text: '',
      tokens: 1,
      entryIds: [],
      dropped: false,
      short: false,
      ...extra
    })
    const blocks = [draft('story-so-far', 2_000, 1_200), draft('recalled', 900, 400), draft('knowledge', 300, 100), draft('pov', 800, 300)]
    // 800 + 500, and who knows what's 200 apart (it goes short only when the brief says who knows what); the point of view
    // never goes short for a brief.
    const all = ['story-so-far', 'recalled', 'knowledge', 'pov'].map((id) => sent(id))
    expect(briefFrees({ blocks: all }, blocks)).toEqual({ always: 1_300, knows: 200 })
    // Already short (for room, or Adam's choice), or left out: nothing to free.
    expect(
      briefFrees({ blocks: [sent('story-so-far', { short: true }), sent('recalled', { dropped: true }), sent('knowledge')] }, blocks)
    ).toEqual({ always: 0, knows: 200 })
    expect(briefFrees({ blocks: [sent('story-so-far')] }, [draft('story-so-far', 2_000, null)])).toEqual({ always: 0, knows: 0 })
    expect(briefFrees({ blocks: [sent('story-so-far')] }, undefined)).toEqual({ always: 0, knows: 0 })
  })

  it('nothing from a part Adam wants in full, nor from the story so far of a story with earlier books (fix 14’s review)', () => {
    const draft = (id: string, full: number, short: number) => ({ id, text: 'x'.repeat(full * 3.5), short: 'x'.repeat(short * 3.5) })
    const sent = (id: string, extra = {}) => ({
      id,
      priority: 8,
      title: id,
      text: '',
      tokens: 1,
      entryIds: [],
      dropped: false,
      short: false,
      ...extra
    })
    const blocks = [draft('story-so-far', 2_000, 1_200), draft('recalled', 900, 400)]
    expect(briefFrees({ blocks: [sent('story-so-far', { mode: 'full' }), sent('recalled')] }, blocks)).toEqual({ always: 500, knows: 0 })
    expect(briefFrees({ blocks: [sent('story-so-far'), sent('recalled')] }, blocks, { earlierBooks: true })).toEqual({
      always: 500,
      knows: 0
    })
  })

  it('a brief with nothing on who knows what is held to what goes short without it', () => {
    const lines = (n: number) => Array.from({ length: n }, (_, i) => `Fact ${i + 1}: ${'word '.repeat(30)}`)
    const without = checkBrief({ keep: lines(12) }, { material: '', tokens: 1_000, tokensNoKnows: 300 }).brief!
    expect(estimateTokens(without.parts.keep!.join('\n'))).toBeLessThanOrEqual(360)
    const withKnows = checkBrief(
      { keep: lines(12), knows: ['Osric doesn’t know.'] },
      { material: '', tokens: 1_000, tokensNoKnows: 300 }
    ).brief!
    expect(withKnows.parts.keep!.length).toBeGreaterThan(without.parts.keep!.length)
  })
})

describe('fitting the record to the room', () => {
  const part = (title: string, n: number, share: number, rank?: number) => ({
    title,
    items: Array.from({ length: n }, (_, i) => `- ${title} line ${i + 1} ${'x'.repeat(60)}`),
    share,
    ...(rank != null ? { rank } : {})
  })

  it('each part first to its share, whole lines from the first; what is left by rank; empty parts left out', () => {
    const all = fitParts([part('A', 3, 0.5), part('B', 3, 0.5), part('Empty', 0, 0.1)], 100_000)
    expect(all.map((p) => p.title)).toEqual(['A', 'B'])
    expect(all[0].body.split('\n')).toHaveLength(3)
    // Little room: B (ranked first) gets what A's share leaves.
    const some = fitParts([part('A', 20, 0.1, 1), part('B', 20, 0.1, 0)], 300)
    const lines = (t: string) => some.find((p) => p.title === t)?.body.split('\n').length ?? 0
    expect(lines('B')).toBeGreaterThan(lines('A'))
    expect(estimateTokens(some.map((p) => `## ${p.title}\n${p.body}`).join('\n'))).toBeLessThanOrEqual(300)
    expect(fitParts([part('A', 3, 1)], 0)).toEqual([])
  })
})

// ---------- What it reads ----------

const STAND: SceneState = {
  time: 'late evening',
  weather: '',
  light: '',
  characters: [
    {
      where: 'the mill loft',
      wearing: '',
      posture: '',
      holding: 'the survey case',
      condition: 'left arm in a sling',
      mood: '',
      lastAction: '',
      name: 'Wren'
    }
  ]
}

function world() {
  const wren = entry('character', 'Wren', {
    summary: 'A miller’s daughter.',
    happened: [{ note: 'Broke her left arm at the weir', changeId: 'c1', where: 'The Mill, Ch 1, Sc 2', at: 2 }]
  })
  const osric = entry('character', 'Osric Hale', { summary: 'The reeve.' })
  const loft = entry('place', 'The mill loft', { summary: 'Flour sacks and a hatch.' })
  const bell = entry('thread', 'The drowned bell', { fields: { promise: 'Who rang the drowned bell?' } })
  const ledger = entry('item', 'The tithe ledger', { summary: 'Kept by the reeve.' })
  return { wren, osric, loft, bell, ledger }
}

function input(over: Partial<ContextInput> = {}): ContextInput {
  const w = world()
  const facts: FactState[] = [
    {
      factId: 'f1',
      fact: 'The flour tax was forged.',
      knownBy: [w.wren.id],
      at: 4,
      since: { [w.wren.id]: { at: 4, where: 'The Mill, Ch 1, Sc 3', how: 'saw' } }
    },
    // About Osric: never "not known by Osric".
    {
      factId: 'f2',
      fact: 'Osric Hale took the bribe.',
      knownBy: [w.wren.id],
      at: 5,
      since: { [w.wren.id]: { at: 5, where: 'The Mill, Ch 2, Sc 1', how: 'told', from: w.osric.id } }
    }
  ]
  const cal = buildCalendar([
    { id: 'start', story: 's', when: 'Day 1, morning' },
    { id: 'previous', story: 's', when: 'Day 20, dusk' },
    { id: 'here', story: 's', when: 'Day 22, evening' }
  ])
  return {
    style: { ...defaultStyleGuide(), pov: 'Close third person', tense: 'Past tense', spelling: 'UK' },
    scene: {
      title: 'The hatch',
      card: {
        ...emptySceneCard(),
        povId: w.wren.id,
        presentIds: [w.wren.id, w.osric.id],
        locationId: w.loft.id,
        setsUpIds: [w.bell.id],
        beats: ['Osric climbs up with the tithe ledger']
      }
    },
    memory: {
      storyId: 'mill',
      sceneId: 'here',
      knows: '',
      previous: {
        sceneId: 'sc-2-4',
        title: 'Before',
        text: 'The sleet came on.',
        storyId: 'mill',
        storyTitle: 'The Mill',
        when: 'Day 20, dusk',
        label: 'The Mill, Ch 2, Sc 4',
        otherStory: null
      },
      entries: [w.wren, w.osric, w.loft, w.bell, w.ledger],
      firstHere: [],
      elsewhere: [],
      relationships: [],
      facts,
      beliefs: [
        {
          factId: 'b1',
          fact: 'The abbot is in Varn.',
          believedBy: [w.osric.id],
          since: { [w.osric.id]: { at: 3, where: 'The Mill, Ch 1, Sc 4', how: 'told' } },
          at: 3
        }
      ],
      threads: [{ entryId: w.bell.id, status: 'open', setUp: '', paidOff: '' }],
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
    continuity: STAND,
    calendar: {
      here: cal.dates.get('here')!,
      previous: cal.dates.get('previous')!,
      landmarks: [{ name: 'the weir breaking', date: cal.dates.get('start')! }],
      ages: []
    },
    slips: [{ text: 'Wren used her left hand to climb.', where: 'The Mill, Ch 2, Sc 2', entryIds: [w.wren.id], kind: 'fact', back: 2 }],
    recall: {
      sticky: [],
      found: [],
      said: [],
      passages: [
        { where: 'The Mill, Ch 1, Sc 2', text: 'The weir gave way under her.', kind: 'scene', order: 2 },
        { where: 'The Mill, Ch 1, Sc 4', text: 'Osric counted the sacks twice.', kind: 'scene', order: 4 }
      ]
    },
    ...over
  }
}

const sources = (over: Partial<Parameters<typeof briefMaterial>[2]> = {}) => ({
  findings: [],
  room: 20_000,
  tokens: 1_000,
  ...over
})

/** The story so far in short: Ch 1 summed up, Ch 2 not yet (its scene's gist), as memory/scene.ts storySoFar gives them. */
const STORY_SO_FAR: ContextInput['memory']['storySoFar'] = {
  scenes: [
    { sceneId: 'sc-1-2', chapterId: 'c1', label: 'The Mill, Ch 1, Sc 2', text: 'The weir broke under Wren.' },
    { sceneId: 'sc-2-1', chapterId: 'c2', label: 'The Mill, Ch 2, Sc 1', text: 'Osric took the bribe at the tithe barn. Wren saw it from the loft.' }
  ],
  chapters: [{ chapterId: 'c1', label: 'The Mill, Ch 1', text: 'By the end, Wren has broken her left arm at the weir (scene 2) and the mill stands idle.' }],
  stories: [],
  series: [],
  leadsInto: null
}

describe('what the plan reads for the brief', () => {
  it('the chapters in short, the scene before, everyone and everything here, who knows what, the calendar, the slips and the findings', () => {
    const inp = input()
    const [wren] = inp.memory.entries
    const m = briefMaterial(
      {
        ...inp,
        memory: {
          ...inp.memory,
          storySoFar: STORY_SO_FAR,
          facts: [
            ...inp.memory.facts,
            {
              factId: 'f3',
              fact: 'The sluice key is under the third sack.',
              knownBy: [wren.id],
              at: 6,
              since: { [wren.id]: { at: 6, where: 'The Mill, Ch 2, Sc 3', how: 'saw' } }
            }
          ]
        }
      },
      {},
      sources({ findings: ['Ash died in Ch 1, Sc 2, but speaks here.'] })
    )
    const text = (title: string): string => m.record.find((p) => p.title.startsWith(title))?.body ?? ''
    // Each earlier chapter in short, citing its scenes as the rest of the record does; one not summed up yet, its scenes.
    const chapters = text(CHAPTERS_TITLE)
    expect(chapters).toContain('### Ch 1\nBy the end, Wren has broken her left arm at the weir (Ch 1, Sc 2) and the mill stands idle.')
    expect(chapters).toContain('### Ch 2 (no summary of the chapter yet: its scenes)\n- Ch 2, Sc 1: Osric took the bribe at the tithe barn.')
    expect(chapters).toContain('look up any you need (read_passage)')
    expect(chapters.indexOf('### Ch 1')).toBeLessThan(chapters.indexOf('### Ch 2'))
    // The scene before, word for word, with where it is.
    expect(m.record.map((p) => p.title)).toContain(`${PREVIOUS_TITLE} (Ch 2, Sc 4: Before)`)
    expect(text(PREVIOUS_TITLE)).toBe('"""\nThe sleet came on.\n"""')
    // Everyone and everything here, each with its most recent changes; the place, the card's thread and the item the beats
    // name too.
    const all = text('Everyone and everything')
    expect(all).toContain('### Wren (character)')
    expect(all).toContain('Broke her left arm at the weir (The Mill, Ch 1, Sc 2)')
    expect(all).toContain('### Osric Hale (character)')
    expect(all).toContain('### The mill loft (place)')
    expect(all).toContain('### The drowned bell (thread)')
    expect(all).toContain('### The tithe ledger (item)')
    // Who knows what: only what someone here doesn't know, with since when and how, the newest first; never what everyone
    // here knows (Osric knows he took the bribe), which is a look-up away; and false beliefs.
    const knows = text('Who knows what')
    expect(knows).toContain('- The flour tax was forged: known by Wren (since Ch 1, Sc 3; saw it); not known by Osric Hale')
    expect(knows).toContain('- The sluice key is under the third sack: known by Wren (since Ch 2, Sc 3; saw it); not known by Osric Hale')
    expect(knows).not.toContain('took the bribe')
    expect(knows).toContain('- Wrongly believed by Osric Hale (since Ch 1, Sc 4; was told): The abbot is in Varn (it isn')
    expect(knows.indexOf('sluice key')).toBeLessThan(knows.indexOf('flour tax'))
    expect(knows).toContain('(Not listed: 1 more fact known here, by everyone here or older: who_knows has them.)')
    // The calendar: this scene, the scene before, and how long since each day worth counting from.
    const cal = text('The story calendar')
    expect(cal).toContain('- This scene: Day 22')
    expect(cal).toContain('- 2 days after the scene before (Day 20')
    expect(cal).toContain('- 3 weeks since the weir breaking (Day 1')
    expect(text('Slips put right')).toBe('- In Ch 2, Sc 2: Wren used her left hand to climb.')
    expect(text('Still open in this scene')).toBe('- Ash died in Ch 1, Sc 2, but speaks here.')
    // The whole book so far is never read (2026-10-20).
    expect(m.record.some((p) => /book so far|How each chapter so far ended/.test(p.title))).toBe(false)
    // The passages found change from step to step: they go after the words before.
    expect(m.late[0].title).toBe('Earlier passages found by searching the story (best first)')
    expect(m.late[0].body).toContain('### Ch 1, Sc 2\nThe weir gave way under her.')
    expect(m.words).toBe(750)
    expect(m.tokens).toBe(1_000)
    // The chapters "Already happened" tells scene by scene aren't told again in short.
    const covered = briefMaterial({ ...inp, memory: { ...inp.memory, storySoFar: STORY_SO_FAR } }, {}, sources({ covered: ['Ch 2'] }))
    expect(covered.record.find((p) => p.title === CHAPTERS_TITLE)!.body).not.toContain('### Ch 2')
  })

  it('the scene so far word for word, sent last; a long scene from where its last stretch starts, the start a look-up away', () => {
    const long = Array.from({ length: 80 }, (_, i) => `Paragraph ${i + 1}. ${'The flour drifted down from the loft. '.repeat(8)}`).join('\n\n')
    const inp = input({ soFar: 'Wren set the ledger on the sill.' })
    const m = briefMaterial({ ...inp, memory: { ...inp.memory, previous: { ...inp.memory.previous!, text: long } } }, {}, sources())
    expect(m.late[0]).toMatchObject({ title: SO_FAR_TITLE, body: '"""\nWren set the ledger on the sill.\n"""', scene: { of: 'soFar', words: 7 } })
    const previous = m.record.find((p) => p.title.startsWith(PREVIOUS_TITLE))!
    expect(previous.steady).toBe(true)
    expect(previous.body).toContain('Paragraph 80.')
    expect(previous.body).not.toContain('Paragraph 1.')
    expect(previous.body.startsWith('(Its earlier part is left out here: look it up if you need it.)')).toBe(true)
    // The record kept in the world has a note in place of a scene's own words.
    expect(partText(previous, false)).toMatch(/^## The scene before, word for word \(Ch 2, Sc 4: Before\)\n\(\d,\d{3} words, read word for word\. Not kept here/)
    expect(partText(previous)).toContain('Paragraph 80.')
  })

  it('fits the room, what matters most first, and the scene’s contract is never cut', () => {
    const inp = input({ contract: { asks: 'scene' } })
    const prepared = prepareContext(inp)
    // Room for the contract and a little more: who knows what has it first.
    const contract = estimateTokens(`## This scene’s contract\n${contractText(prepared.contract!)}`)
    const tiny = briefMaterial(inp, prepared, sources({ room: contract + 90 }))
    expect(tiny.record[0].title).toBe('Who knows what, among everyone here')
    expect(tiny.record.some((p) => p.title.startsWith('Everyone and everything'))).toBe(false)
    expect(tiny.late.map((p) => p.title)).toEqual(['This scene’s contract'])
    const none = briefMaterial(inp, prepared, sources({ room: 0 }))
    expect(none.record).toEqual([])
    expect(none.late.map((p) => p.title)).toEqual(['This scene’s contract'])
    expect(none.late[0].body).toContain('Must change by the end of the scene:\n1. Osric climbs up with the tithe ledger')
  })

  it('a long story’s record stays within RECORD_MOST: the newest chapters, the last changes, the newest facts, the first passages', () => {
    const base = input()
    const [wren, osric, ...rest] = base.memory.entries
    const long = (e: EntryState, n: number): EntryState => ({
      ...e,
      happened: Array.from({ length: n }, (_, i) => ({ note: `${e.name} change ${i + 1}`, changeId: `${e.id}-${i}`, where: 'The Mill, Ch 1, Sc 1', at: i }))
    })
    const facts: FactState[] = Array.from({ length: 40 }, (_, i) => ({
      factId: `lf${i}`,
      fact: `Secret number ${i + 1} about the mill`,
      knownBy: [wren.id],
      at: 10 + i,
      since: { [wren.id]: { at: 10 + i, where: 'The Mill, Ch 3, Sc 1', how: 'saw' } }
    }))
    const words = (n: number, w: string) => Array.from({ length: n / 10 }, () => `${w} walked the long road to the mill at dusk.`).join(' ')
    const inp: ContextInput = {
      ...base,
      soFar: words(5_000, 'Wren'),
      recall: {
        ...base.recall!,
        passages: Array.from({ length: 12 }, (_, i) => ({ where: `The Mill, Ch 1, Sc ${i + 1}`, text: `Passage ${i + 1}.`, kind: 'scene' as const, order: i }))
      },
      memory: {
        ...base.memory,
        entries: [long(wren, 300), long(osric, 300), ...rest],
        facts,
        previous: { ...base.memory.previous!, text: words(6_000, 'Osric') },
        storySoFar: {
          ...STORY_SO_FAR,
          scenes: [],
          chapters: Array.from({ length: 60 }, (_, i) => ({
            chapterId: `c${i + 1}`,
            label: `The Mill, Ch ${i + 1}`,
            text: `By the end of chapter ${i + 1}, ${'the mill wheel turned and the river ran high. '.repeat(25)}`
          }))
        }
      }
    }
    const m = briefMaterial(inp, {}, sources({ room: RECORD_MOST }))
    const sent = [...m.record, ...m.late].map((p) => partText(p)).join('\n\n')
    expect(estimateTokens(sent)).toBeLessThanOrEqual(RECORD_MOST)
    const part = (title: string) => [...m.record, ...m.late].find((p) => p.title.startsWith(title))?.body ?? ''
    // The newest chapters, in reading order; the oldest left out, and said so.
    const chapters = part(CHAPTERS_TITLE)
    expect(chapters).toContain('### Ch 60')
    expect(chapters).not.toContain('### Ch 1\n')
    expect(chapters).toMatch(/\(\d+ earlier chapters left out here for room: what_happened tells their scenes\.\)/)
    // The scene so far whatever else gives way, from where its last stretch starts.
    expect(part(SO_FAR_TITLE)).toContain('Wren walked the long road')
    // Each person's last few changes, the rest a look-up away.
    expect(part('Everyone and everything')).toContain('Wren change 300')
    expect(part('Everyone and everything')).not.toContain('Wren change 290')
    // At most KNOWS_MOST.facts facts, the newest first.
    const knows = part('Who knows what')
    expect(knows.split('\n').filter((l) => l.startsWith('- Secret')).length).toBeLessThanOrEqual(KNOWS_MOST.facts)
    expect(knows).toContain('Secret number 40 about the mill')
    expect(knows).not.toContain('Secret number 1 about')
    // At most PASSAGES_MOST passages.
    expect(part('Earlier passages').match(/^### /gm)?.length ?? 0).toBeLessThanOrEqual(PASSAGES_MOST)
  })
})

// ---------- The request ----------

const PLAIN: PlanMaterial = {
  ask: 'Write the scene now.',
  card: 'Scene: The hatch\nPoint of view: Wren\nBeats, in order:\n1. Osric climbs up',
  must: '- Wren: left arm in a sling (since Ch 1, Sc 2)',
  reach: 'here',
  stand: '',
  standTitle: 'Where things stand',
  standNote: '',
  before: { title: 'The end of the previous scene', text: 'The sleet came on.' },
  inBriefing: [],
  others: ['The weir (place)'],
  people: ['Wren', 'Osric Hale'],
  secrets: [],
  calls: 'Scene: The hatch\nBeats, in order:\n1. Osric climbs up'
}

const MATERIAL: BriefMaterial = {
  record: [
    { title: CHAPTERS_TITLE, body: '### Ch 1\nBy the end, the weir has broken (Ch 1, Sc 2).', steady: true },
    {
      title: `${PREVIOUS_TITLE} (Ch 1, Sc 2: The weir)`,
      body: '"""\nThe weir gave way, and Wren held the silver key.\n"""',
      steady: true,
      scene: { of: 'previous', words: 9 }
    },
    { title: 'Who knows what, among everyone here', body: '- The flour tax was forged: known by Wren (since Ch 1, Sc 3; saw it)' }
  ],
  late: [{ title: 'Earlier passages found by searching the story (best first)', body: '### Ch 1, Sc 4\nOsric counted the sacks twice.' }],
  words: 750,
  tokens: 1_000
}

describe('the plan’s request with a brief', () => {
  it('the instructions ask for the brief after the plan’s own, and its lists in the reply; without one, as they always were', () => {
    const plain = planSystem()
    const asked = planSystem(false, true)
    expect(asked).toContain(BRIEF_RULE)
    // Never the clothes or the bed an earlier scene ended with, unless where things stand still says so (2026-10-16).
    expect(BRIEF_RULE).toContain('never what people wore, where they were or how they lay as an earlier scene ended unless where things stand says it still holds here')
    // ...but what the story set someone to wear from now on does (memory review, 2026-10-20: the green jumper).
    expect(BRIEF_RULE).toContain('what someone usually wears now, as what must stay true says, always holds')
    expect(asked).toContain('"needs": [""], "brief": {"matters": [""], "keep": [""], "knows": [""], "promises": [""], "time": [""]}}')
    expect(asked.replace(`\n${BRIEF_RULE}`, '').replace(/, "brief": \{[^}]*\}/, '')).toBe(plain)
    expect(planSystem(false, false)).toBe(plain)
    // With a contract too.
    expect(planSystem(true, true)).toContain('"must": [""], "brief": {')
    expect(planMessages(PLAIN)[0].content).toBe(plain)
    // The same whatever the brief's length (said at the end of the request), so what comes after it stays in the cache.
    expect(planMessages({ ...PLAIN, brief: MATERIAL })[0].content).toBe(asked)
    expect(planMessages({ ...PLAIN, brief: { ...MATERIAL, words: 1_450 } })[0].content).toBe(asked)
    // Told plainly that it has earlier scenes only in short, and can look their words up (2026-10-20).
    expect(planSystem(false, true, true)).toContain(LOOKUP_RULE)
    expect(LOOKUP_RULE).toContain('to read what an earlier scene said, word for word, use read_passage')
  })

  it('the record first, its steadiest parts leading; the plan’s own parts; the passages after the words before; what is being written last', () => {
    const [, user] = planMessages({ ...PLAIN, brief: MATERIAL })
    const at = (s: string) => user.content.indexOf(s)
    expect(at(`## ${CHAPTERS_TITLE}`)).toBe(0)
    expect(at('## The scene before, word for word')).toBeLessThan(at('## Who knows what'))
    expect(at('## Who knows what')).toBeLessThan(at('## The scene card'))
    expect(at('## The scene card')).toBeLessThan(at('## Earlier passages found'))
    expect(at('## Earlier passages found')).toBeLessThan(at('## What is being written'))
    expect(
      user.content.trimEnd().endsWith('Plan the scene and write its continuity brief (at most about 750 words) now, as one JSON object.')
    ).toBe(true)
    // The end of the previous scene isn't said again: the record has the scene before word for word.
    expect(user.content).not.toContain('## The end of the previous scene')
    expect(planMessages(PLAIN)[1].content).toContain('## The end of the previous scene')
    expect(planMessages({ ...PLAIN, brief: { ...MATERIAL, record: MATERIAL.record.slice(2) } })[1].content).toContain('## The end of the previous scene')
    // A model that caches only where asked keeps the steady parts: the chapters in short and the scene before.
    expect(user.content.slice(0, user.cacheUpTo).endsWith('The weir gave way, and Wren held the silver key.\n"""')).toBe(true)
    expect(user.content.slice(0, user.cacheUpTo)).not.toContain('Who knows what')
    // The record kept in the world: the scene's own words as a note.
    const kept = planMessages({ ...PLAIN, brief: MATERIAL }, false)[1]
    expect(kept.content).not.toContain('silver key')
    expect(kept.content).toContain('(9 words, read word for word. Not kept here, to save space: they are the scene’s own words.)')
    expect(kept.content).toContain('By the end, the weir has broken')
    expect(kept.cacheUpTo).toBeUndefined()
    // Nothing steady, nothing to keep.
    expect(planMessages({ ...PLAIN, brief: { ...MATERIAL, record: MATERIAL.record.slice(2) } })[1].cacheUpTo).toBeUndefined()
    // Without a brief, the request is as it always was.
    expect(planMessages(PLAIN)[1].content).not.toContain('continuity brief')
    expect(planMessages(PLAIN)[1].cacheUpTo).toBeUndefined()
  })
})

// ---------- The brief, read and checked ----------

describe('reading and checking the brief', () => {
  it('reads each list (strings, or objects with a text), leaving bullets off; none when it says nothing', () => {
    expect(readBrief({ matters: [' - The case matters. ', { text: 'The key too.' }, 3, ''], keep: 'One fact.', time: [] })).toEqual({
      matters: ['The case matters.', 'The key too.'],
      keep: ['One fact.']
    })
    expect(readBrief({})).toBeNull()
    expect(readBrief('a brief')).toBeNull()
    expect(readBrief(null)).toBeNull()
    expect(readPlan('{"relies": [], "changes": [], "needs": [], "brief": {"keep": ["Wren’s arm is broken."]}}')!.brief).toEqual({
      keep: ['Wren’s arm is broken.']
    })
    expect(readPlan('{"relies": [], "changes": [], "needs": []}')!.brief).toBeUndefined()
  })

  it('knows a chapter or scene cited however it is worded', () => {
    expect(placesCited('Set in Ch 2, Sc 3; changed in chapter 4, scene 1; see Ch 5 and Book 1, Ch. 6, Sc. 2; Sc 4 alone.')).toEqual([
      'Ch 2, Sc 3',
      'Ch 4, Sc 1',
      'Ch 5',
      'Ch 6, Sc 2'
    ])
  })

  it('leaves out a line citing a scene the planner wasn’t given, says each line once, caps each list and keeps to its size', () => {
    const material = 'since Ch 1, Sc 3 ... ### Ch 2, Sc 1 ...'
    const { brief, dropped } = checkBrief(
      {
        matters: ['The case.', 'the case.'],
        keep: [
          'Wren saw the forgery (since Ch 1, Sc 3).',
          'Mara lost her ring in Ch 9, Sc 9.',
          'Osric was bribed in Ch 2.',
          'Chapter 2, Scene 1 set it.'
        ]
      },
      { material, tokens: 1_000 }
    )
    expect(brief!.parts).toEqual({
      matters: ['The case.'],
      keep: ['Wren saw the forgery (since Ch 1, Sc 3).', 'Osric was bribed in Ch 2.', 'Chapter 2, Scene 1 set it.']
    })
    expect(dropped).toBe(1)
    const many = checkBrief({ keep: Array.from({ length: 20 }, (_, i) => `Fact ${i + 1}.`) }, { material: '', tokens: 1_000 }).brief!
    expect(many.parts.keep).toHaveLength(BRIEF_MOST.keep)
    // Too long: the least important lists lose their last lines first, what must not be contradicted last.
    const long = (n: number, w: string) => Array.from({ length: n }, (_, i) => `${w} ${i + 1}: ${'word '.repeat(40)}`)
    const fitted = checkBrief(
      { keep: long(6, 'Keep'), promises: long(6, 'Promise'), time: long(6, 'Time') },
      { material: '', tokens: 400 }
    ).brief!
    expect(estimateTokens(Object.values(fitted.parts).flat().join('\n'))).toBeLessThanOrEqual(480)
    expect(fitted.parts.keep!.length).toBeGreaterThan(fitted.parts.promises?.length ?? 0)
    expect(fitted.parts.keep!.length).toBe(6)
    // Nothing left: no brief.
    expect(checkBrief({ keep: ['In Ch 7, Sc 1 it changed.'] }, { material: '', tokens: 1_000 }).brief).toBeNull()
    expect(checkBrief({ keep: ['One fact.'] }, { material: '', tokens: 1_000 }).brief).toEqual({ parts: { keep: ['One fact.'] } })
  })

  it('a chapter told only in short counts as given, and its scenes the summary cites (2026-10-20)', () => {
    const inp = input()
    const m = briefMaterial({ ...inp, memory: { ...inp.memory, storySoFar: STORY_SO_FAR } }, {}, sources())
    const material = m.record.map((p) => partText(p)).join('\n\n')
    const { brief } = checkBrief(
      { keep: ['The weir broke in Ch 1.', 'Wren’s arm broke at the weir (Ch 1, Sc 2).', 'The bribe was in Ch 2, Sc 1.', 'Mara drowned in Ch 1, Sc 5.'] },
      { material, tokens: 1_000 }
    )
    expect(brief!.parts.keep).toEqual(['The weir broke in Ch 1.', 'Wren’s arm broke at the weir (Ch 1, Sc 2).', 'The bribe was in Ch 2, Sc 1.'])
  })
})

// ---------- The call ----------

const model: MemoryModel = {
  target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'test' },
  choice: { providerId: 'p1', modelId: 'fake/memory', label: 'fake', contextLength: 1_000_000, promptPrice: null, completionPrice: null },
  thinking: 'off'
}

/** A stand-in model that answers every request with `reply`, keeping what it was asked. */
function answering(reply: string): typeof fetch & { asked: { user: string; maxTokens: number }[] } {
  const asked: { user: string; maxTokens: number }[] = []
  const f = (async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { max_tokens: number; messages: { content: unknown }[] }
    const user = body.messages[1].content
    asked.push({ user: typeof user === 'string' ? user : JSON.stringify(user), maxTokens: body.max_tokens })
    const chunk = { choices: [{ index: 0, delta: { content: reply }, finish_reason: 'stop' }] }
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  }) as typeof fetch & { asked: { user: string; maxTokens: number }[] }
  f.asked = asked
  return f
}

function plan(reply: string, material: PlanMaterial) {
  const db = memoryWorld()
  const sceneId = repo.getOutline(db, repo.listStories(db)[0].id).scenes[0].id
  const f = answering(reply)
  const done = makePlan({
    db,
    model,
    sceneId,
    material,
    check: { stand: STAND, entries: [], inBriefing: new Set(), hidden: new Set() },
    carryingOn: false,
    closed: () => false,
    fetchImpl: f,
    retryDelays: []
  })
  return { db, f, done }
}

describe('the plan writes the brief in its own call', () => {
  const reply = JSON.stringify({
    // A fact found only in the record read for the brief is no fact the plan rests on: a scene before may say what no longer
    // holds.
    relies: [{ who: 'Wren', what: 'fact', value: 'Wren held the silver key' }],
    changes: [{ who: 'Osric Hale', what: 'where', from: 'below', to: 'the loft', how: 'Osric climbs up.' }],
    needs: [],
    brief: {
      matters: ['Osric comes up to the loft.'],
      keep: ['Wren’s left arm is in a sling (since Ch 1, Sc 2).', 'Mara lost her ring in Ch 9, Sc 9.'],
      knows: ['Osric doesn’t know the flour tax was forged.']
    }
  })

  it('one call, with room for the brief; the record keeps the scene’s words as a note; the brief checked; the plan checked as before', async () => {
    const { db, f, done } = plan(reply, { ...PLAIN, brief: MATERIAL })
    const made = await done
    expect(f.asked).toHaveLength(1)
    expect(f.asked[0].user).toContain('Wren held the silver key')
    expect(made!.text).toContain('1. Osric Hale, where: below → the loft. Osric climbs up.')
    expect(made!.text).not.toContain('silver key')
    expect(made!.brief).toEqual({
      parts: {
        matters: ['Osric comes up to the loft.'],
        keep: ['Wren’s left arm is in a sling (since Ch 1, Sc 2).'],
        knows: ['Osric doesn’t know the flour tax was forged.']
      }
    })
    const row = db.prepare("SELECT messages_json AS m, blocks_json AS b, budget_json AS u FROM generations WHERE job = 'memory'").get() as {
      m: string
      b: string
      u: string
    }
    expect(row.m).not.toContain('silver key')
    expect(row.m).toContain('read word for word. Not kept here')
    expect(JSON.parse(row.b)[0].title).toBe('Planning the scene and writing its continuity brief')
    // Its size is counted as it was sent, the scene's words included.
    expect(JSON.parse(row.u).used).toBe(
      estimateTokens(
        planMessages({ ...PLAIN, brief: MATERIAL })
          .map((x) => x.content)
          .join('\n')
      )
    )
  })

  it('a reply with only a brief is still a plan; without a brief asked for, a brief in the reply is never used', async () => {
    const only = '{"relies": [], "changes": [], "needs": [], "brief": {"keep": ["Wren’s left arm is in a sling (since Ch 1, Sc 2)."]}}'
    expect((await plan(only, { ...PLAIN, brief: { ...MATERIAL, record: MATERIAL.record.slice(2) } }).done)!.brief).toEqual({
      parts: { keep: ['Wren’s left arm is in a sling (since Ch 1, Sc 2).'] }
    })
    expect(await plan(only, PLAIN).done).toBeNull()
    const asked = plan(reply, PLAIN)
    expect((await asked.done)!.brief).toBeUndefined()
    // The reply's room grows by the brief's (its tokens and a little more) only when a brief is asked for.
    const briefed = plan(reply, { ...PLAIN, brief: MATERIAL })
    await briefed.done
    expect(briefed.f.asked[0].maxTokens - asked.f.asked[0].maxTokens).toBe(Math.ceil(MATERIAL.tokens * BRIEF_REPLY_SHARE))
  })

  it('takes the room of the parts it says what matters of, and only that', () => {
    const block = (id: string, tokens: number, extra = {}) => ({
      id,
      priority: 3,
      title: id,
      text: id,
      tokens,
      entryIds: [],
      dropped: false,
      ...extra
    })
    const budget = (used: number) => ({ contextLength: 64_000, reserved: 2_000, available: 50_000, used })
    const before = { blocks: [block('story-so-far', 3_000), block('recalled', 1_500), block('pov', 800)], budget: budget(6_000) }
    const brief = block(BRIEF_BLOCK.id, 900)
    const after = (pov: number) => ({
      blocks: [
        block('story-so-far', 1_800, { shortFor: 'brief' }),
        block('recalled', 700, { shortFor: 'brief' }),
        block('pov', pov),
        brief
      ],
      budget: budget(5_000)
    })
    expect(keepsRoom(before, after(800))).toBe(true)
    expect(keepsRoom(before, after(600))).toBe(false)
    // Short for the brief only beside it.
    expect(keepsRoom(before, { ...after(800), blocks: after(800).blocks.filter((b) => b.id !== BRIEF_BLOCK.id) })).toBe(false)
  })
})

// ---------- The world's parts ----------

describe('what the world gives the brief', () => {
  it('the rule checks’ findings still open in the scene, oldest first; none of the AI’s, nor one settled', () => {
    const db = memoryWorld()
    const story = repo.listStories(db)[0]
    const sceneId = repo.getOutline(db, story.id).scenes[0].id
    const add = (id: string, status: string, by: string, message: string, at: string) =>
      db
        .prepare(
          `INSERT INTO issues (id, scene_id, story_id, kind, severity, status, quote, message, payload_json, created_at, updated_at) VALUES (?, ?, ?, 'fact', 'error', ?, '', ?, ?, ?, ?)`
        )
        .run(id, sceneId, story.id, status, message, JSON.stringify({ by }), at, at)
    add('i2', 'open', 'rule', 'Ash died in Ch 1, Sc 2, but speaks here.', '2026-10-16T02:00:00Z')
    add('i1', 'open', 'rule', 'The brass compass was destroyed in Ch 3, Sc 2, but Tobin holds it here.', '2026-10-16T01:00:00Z')
    add('i3', 'ignored', 'rule', 'Ignored.', '2026-10-16T03:00:00Z')
    add('i4', 'open', 'check', 'The AI’s own.', '2026-10-16T04:00:00Z')
    expect(openRuleFindings(db, sceneId)).toEqual([
      'The brass compass was destroyed in Ch 3, Sc 2, but Tobin holds it here.',
      'Ash died in Ch 1, Sc 2, but speaks here.'
    ])
    expect(openRuleFindings(db, 'nowhere')).toEqual([])
  })

  it('the last brief written for a scene, from its newest draft that sent one (for the Context tab)', () => {
    const db = memoryWorld()
    const sceneId = repo.getOutline(db, repo.listStories(db)[0].id).scenes[0].id
    const draft = (id: string, at: string, blocks: object[]) =>
      gens.insertGeneration(db, {
        id,
        sceneId,
        job: 'draft',
        providerId: 'p',
        providerName: 'Fake',
        modelId: 'fake/writer',
        params: { temperature: 1, top_p: 1, max_tokens: 100 } as never,
        direction: '',
        blocks: blocks as never,
        messages: [],
        budget: { contextLength: 32_000, reserved: 1_000, available: 20_000, used: 100 },
        entries: [],
        createdAt: at
      })
    const brief = (text: string, dropped = false) => ({
      id: BRIEF_BLOCK.id,
      priority: 2,
      title: 'Continuity brief',
      text,
      tokens: 10,
      entryIds: [],
      dropped
    })
    expect(gens.lastSentBlock(db, sceneId, BRIEF_BLOCK.id)).toBeNull()
    draft('g1', '2026-10-16T01:00:00Z', [brief(briefText({ parts: { keep: ['Older.'] } }))])
    draft('g2', '2026-10-16T02:00:00Z', [brief(briefText({ parts: { keep: ['Newer.'] } }))])
    draft('g3', '2026-10-16T03:00:00Z', [brief('left out', true)])
    draft('g4', '2026-10-16T04:00:00Z', [
      { id: 'pov', priority: 4, title: 'pov', text: 'no brief', tokens: 1, entryIds: [], dropped: false }
    ])
    expect(gens.lastSentBlock(db, sceneId, BRIEF_BLOCK.id)).toContain('- Newer.')
  })
})

describe('in the writer’s briefing, end to end', () => {
  it('the planner’s record for a draft makes the writer’s brief, and the briefing with it keeps its room', () => {
    const inp = input()
    const before = assembleContext(inp, countRaw)
    const after = assembleContext({ ...inp, brief: { parts: { keep: ['Wren’s left arm is in a sling (since Ch 1, Sc 2).'] } } }, countRaw)
    expect(after.blocks.find((b) => b.id === BRIEF_BLOCK.id)?.dropped).toBe(false)
    expect(keepsRoom(before, after)).toBe(true)
  })
})

// ---------- Fix 14's review ----------

const hide = (entryId: string): Pin => ({ id: `hide-${entryId}`, scope: 'scene', scopeId: 'here', entryId, action: 'hide' })
const recordText = (m: BriefMaterial): string => m.record.map((p) => `## ${p.title}\n${p.body}`).join('\n\n')
const blank = { wearing: '', posture: '', holding: '', condition: '', mood: '', lastAction: '' }

describe('what Adam kept out of the scene stays out of the brief (fix 14’s review)', () => {
  function withHidden(pins: boolean) {
    const base = input()
    const [wren] = base.memory.entries
    const ash = entry('character', 'Ash', {
      summary: 'A smuggler.',
      happened: [{ note: 'Swore to bring the barge back', changeId: 'a1', where: 'The Mill, Ch 1, Sc 1', at: 1 }]
    })
    const mara = entry('character', 'Mara', { summary: 'The miller.' })
    const inp: ContextInput = {
      ...base,
      memory: {
        ...base.memory,
        entries: [...base.memory.entries, ash, mara],
        facts: [
          ...base.memory.facts,
          {
            factId: 'f3',
            fact: 'Ash hid the key in the sluice.',
            knownBy: [wren.id],
            at: 6,
            since: { [wren.id]: { at: 6, where: 'The Mill, Ch 2, Sc 2', how: 'saw' } }
          }
        ]
      },
      // On the stage from the scene before, and named in the scene so far.
      continuity: { ...STAND, characters: [...STAND.characters, { ...blank, name: 'Ash', where: 'the loft stairs' }] },
      continuityAtSoFar: true,
      soFar: 'Mara came up the ladder with flour on her sleeves, and Ash followed her.',
      slips: [
        ...(base.slips ?? []),
        { text: 'Ash’s scar was on the wrong cheek.', where: 'The Mill, Ch 2, Sc 3', entryIds: [ash.id], kind: 'fact', back: 1 }
      ],
      pins: pins ? [hide(ash.id), hide(mara.id)] : []
    }
    return { inp, ash, mara }
  }

  it('someone kept out is never an entry, a knower, a slip or a line of the record, though on the stage or in the scene so far', () => {
    const open = withHidden(false)
    const all = recordText(briefMaterial(open.inp, {}, sources()))
    expect(all).toContain('### Ash (character)')
    expect(all).toContain('### Mara (character)')
    expect(all).toContain('Ash’s scar')
    const { inp, ash, mara } = withHidden(true)
    const m = briefMaterial(inp, {}, sources())
    const text = recordText(m)
    expect(text).not.toContain('### Ash')
    expect(text).not.toContain('### Mara')
    expect(text).not.toContain('Ash’s scar')
    expect(text).not.toContain('Ash hid the key')
    // The planner is told their names, so its brief leaves them out too.
    expect(text).toContain('## Left out by the author\nNever name these in the brief: Ash; Mara.')
    expect(m.hidden).toEqual(['Ash', 'Mara'])
    // Who is in the scene, for who knows what (the writer's too): never them.
    const knowers = sceneKnowers(inp, selectEntries(inp), toldStage(inp)).map((e) => e.id)
    expect(knowers).not.toContain(ash.id)
    expect(knowers).not.toContain(mara.id)
    expect(sceneKnowers(open.inp, selectEntries(open.inp), toldStage(open.inp)).map((e) => e.id)).toEqual(
      expect.arrayContaining([open.ash.id, open.mara.id])
    )
    // On the stage as the scene before ended, and nowhere else: in the scene, unless kept out.
    const onStage: ContextInput = { ...inp, soFar: '' }
    const unpinned: ContextInput = { ...onStage, pins: [] }
    expect(sceneKnowers(unpinned, selectEntries(unpinned), inp.continuity!).map((e) => e.id)).toContain(ash.id)
    expect(sceneKnowers(onStage, selectEntries(onStage), inp.continuity!).map((e) => e.id)).not.toContain(ash.id)
  })

  it('a plot thread kept out is never among the planner’s threads, and a brief line naming anything kept out is left out', () => {
    const base = input()
    const threads = Array.from({ length: 10 }, (_, i) => entry('thread', `Thread ${i + 1}`, { fields: { promise: `Promise ${i + 1}` } }))
    const bell = threads[0]
    const inp: ContextInput = {
      ...base,
      memory: {
        ...base.memory,
        entries: [...base.memory.entries, ...threads],
        threads: threads.map((t) => ({ entryId: t.id, status: 'open', setUp: '', paidOff: '' }))
      },
      pins: [hide(bell.id)]
    }
    const listed = planThreads(inp, 1_000_000)
    expect(listed).not.toContain('Thread 1 —')
    expect(listed).toContain('Thread 2')
    // Nor in the writer's list of the open threads.
    const writer = assembleContext(inp, countRaw).blocks.find((b) => b.id === 'open-threads')!.text
    expect(writer).not.toContain('Thread 1 —')
    expect(assembleContext({ ...inp, pins: [] }, countRaw).blocks.find((b) => b.id === 'open-threads')!.text).toContain('Thread 1 —')
    // As many as the memory model has room for: 6 on the 16,000-token guess.
    const few = planThreads({ ...inp, pins: [] }, 16_000)
    expect(few.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(openThreadsMost(memoryScale(16_000)))
    const { brief, dropped } = checkBrief(
      { keep: ['Ash hid the key.', 'Wren’s left arm is in a sling.'], promises: ['Thread 1 is due now.'] },
      { material: '', tokens: 1_000, hidden: ['Ash', 'Thread 1'] }
    )
    expect(brief!.parts).toEqual({ keep: ['Wren’s left arm is in a sling.'] })
    expect(dropped).toBe(2)
  })
})

describe('what a scene’s plans send (2026-10-20)', () => {
  it('a retry counted: the record with the brief’s call (again when it is retried), never with a later beat, and small whatever the story', async () => {
    // A long story: sixty chapters in short, long scenes before and so far; the record is fitted to RECORD_MOST.
    const base = input()
    const words = (n: number) => Array.from({ length: n / 10 }, () => 'Wren walked the long road to the mill at dusk.').join(' ')
    const inp: ContextInput = {
      ...base,
      soFar: words(5_000),
      memory: {
        ...base.memory,
        previous: { ...base.memory.previous!, text: words(6_000) },
        storySoFar: {
          ...STORY_SO_FAR,
          chapters: Array.from({ length: 60 }, (_, i) => ({ chapterId: `c${i}`, label: `The Mill, Ch ${i + 1}`, text: 'The river ran high. '.repeat(60) }))
        }
      }
    }
    const material: PlanMaterial = { ...PLAIN, brief: briefMaterial(inp, {}, sources({ room: briefRoom({ contextLength: 1_000_000, base: 3_000, reply: 3_000 }) })) }
    const db = memoryWorld()
    const sceneId = repo.getOutline(db, repo.listStories(db)[0].id).scenes[0].id
    const sent: number[] = []
    let calls = 0
    const reply = JSON.stringify({
      relies: [],
      changes: [{ who: 'Osric Hale', what: 'where', to: 'the loft', how: 'Osric climbs up.' }],
      needs: [],
      brief: { keep: ['Wren’s arm is in a sling (since Ch 1, Sc 2).'] }
    })
    const flaky = (async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { messages: { content: unknown }[] }
      sent.push(
        estimateTokens(body.messages.map((x) => (typeof x.content === 'string' ? x.content : JSON.stringify(x.content))).join('\n'))
      )
      // The first try fails on the provider's side and is tried again, the whole prompt sent again.
      if (++calls === 1) return new Response('{"error":{"message":"overloaded"}}', { status: 503 })
      const chunk = { choices: [{ index: 0, delta: { content: reply }, finish_reason: 'stop' }] }
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
    }) as typeof fetch
    const run = (m: PlanMaterial) =>
      makePlan({
        db,
        model,
        sceneId,
        material: m,
        check: { stand: STAND, entries: [], inBriefing: new Set(), hidden: new Set() },
        carryingOn: false,
        closed: () => false,
        fetchImpl: flaky,
        retryDelays: [0]
      })
    // Beat 1 writes the brief (tried twice); beats 2 and 3 reuse it (plan/index.ts), their plans as they always were.
    expect((await run(material))?.brief).toBeTruthy()
    await run(PLAIN)
    await run(PLAIN)
    expect(sent).toHaveLength(4)
    expect(sent[1]).toBe(sent[0])
    expect(sent[2]).toBeLessThan(2_000)
    // The brief's call reads the record and the plan's own parts: never more than RECORD_MOST beside them, however long the
    // story (the live run's plans read about 85,000 tokens with the book). The scene's plans, a retry included, cost under
    // a cent at DeepSeek's price for what isn't cached ($0.28 a million tokens).
    expect(sent[0]).toBeLessThanOrEqual(RECORD_MOST + 3_000)
    const total = sent.reduce((n, x) => n + x, 0)
    expect((total * 0.28) / 1_000_000).toBeLessThan(0.01)
  })
})

describe('an entry with a very long history (fix 14’s review)', () => {
  it('gives its most recent changes, the rest a look-up away, rather than leaving “everyone and everything” empty', () => {
    const base = input()
    const [wren, ...rest] = base.memory.entries
    const long: EntryState = {
      ...wren,
      happened: Array.from({ length: 600 }, (_, i) => ({
        note: `Change number ${i + 1} in a very long life at the mill`,
        changeId: `h${i}`,
        where: 'The Mill, Ch 1, Sc 1',
        at: i
      }))
    }
    const inp: ContextInput = { ...base, memory: { ...base.memory, entries: [long, ...rest] } }
    const m = briefMaterial(inp, {}, sources({ room: 3_000 }))
    const people = m.record.find((p) => p.title.startsWith('Everyone and everything'))!
    expect(people.body).toContain('### Wren (character)')
    expect(people.body).toContain('Change number 600 in a very long life')
    // Its last few changes (2026-10-20: the rest a look-up away).
    expect(people.body).toContain('Change number 595 in a very long life')
    expect(people.body).not.toContain('Change number 594 in a very long life')
    expect(people.body).toContain('(594 earlier changes left out here: get_entry has them.)')
  })
})
