// An invented scene for the writer-round tests (Adam, 2026-10-08): a survey clerk and a drover at an inn on a coast
// road, a dead master, a ferryman met days before, a long story so far, and Add below steps one after another. Nobody's
// real story: every word here is made up for the tests.

import type { EntryKind, EntryState, FactState } from '@shared/types'
import { defaultStyleGuide, emptySceneCard } from '@shared/defaults'
import type { SceneState } from '@shared/continuity'
import type { ContextInput } from '../../src/main/ai/context'
import type { StorySoFar } from '../../src/main/memory/types'
import type { RecallInput } from '../../src/main/retrieval/types'

let seq = 0
export const entry = (kind: EntryKind, name: string, extra: Partial<EntryState> = {}): EntryState => ({
  id: `w${++seq}`,
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

const SENTENCES = [
  'The road ran along the cliff with the sea working at the rocks below.',
  'They stopped at a farm for water and the farmer would not take a coin for it.',
  'A carter passed them going south with a load of slate and no word for anyone.',
  'By noon the cloud had come down off the fell and the drizzle had set in.',
  'Wren checked the strap of the case every mile, as if it might have gone.',
  'Ash talked about cattle prices and the fair at Carrow and the price of hay.'
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

export interface WriterWorld {
  wren: EntryState
  ash: EntryState
  edric: EntryState
  oskar: EntryState
  inn: EntryState
  ferry: EntryState
  survey: EntryState
  compass: EntryState
  all: EntryState[]
}

export function writerWorld(): WriterWorld {
  const wren = entry('character', 'Wren Hollis', {
    summary: 'A surveyor’s clerk carrying her dead master’s survey.',
    fields: {
      pronouns: 'she/her',
      marks: 'a burn on her left arm, wrapped in linen',
      speech: 'Few words, exact.',
      // One line is narration, not speech: it never goes in as a sample line.
      sampleLines: '‘Bearings first. Then talk.’\nShe looked at the map for a long time.\n“I’ll lay it before the Assize.”'
    }
  })
  const ash = entry('character', 'Ash Penrose', {
    summary: 'A drover walking the coast road with her.',
    fields: { pronouns: 'he/him', speech: 'Easy, slow.', sampleLines: '‘That’s the way of it.’' },
    happened: [{ note: 'walked the coast road with Wren as far as the inn', where: 'Fell Road, Ch 3, Sc 1', changeId: 'c-ash', at: 7 }]
  })
  const edric = entry('character', 'Edric Rone', {
    summary: 'Wren’s master, a surveyor.',
    happened: [{ note: 'died this afternoon in his chair in the survey room', where: 'Fell Road, Ch 1, Sc 1', changeId: 'c-edric', at: 1 }]
  })
  const oskar = entry('character', 'Oskar Venn', {
    summary: 'The ferryman at the Linn.',
    happened: [{ note: 'ferried Wren and Ash across the Linn for double fare', where: 'Fell Road, Ch 2, Sc 1', changeId: 'c-oskar', at: 4 }]
  })
  const inn = entry('place', 'The Coast Road Inn', { summary: 'A drovers’ inn above the sea.' })
  const ferry = entry('place', 'The Linn ferry', { summary: 'A punt on a cable across the river.' })
  const survey = entry('item', 'The survey case', { summary: 'Edric’s survey of the fell, in a leather case.' })
  const compass = entry('item', 'The brass compass', {
    summary: 'Wren’s grandmother’s compass.',
    happened: [{ note: 'given by Wren to Pell at the ferry', where: 'Fell Road, Ch 2, Sc 1', changeId: 'c-compass', at: 4 }]
  })
  return { wren, ash, edric, oskar, inn, ferry, survey, compass, all: [wren, ash, edric, oskar, inn, ferry, survey, compass] }
}

/** A long story so far: two chapters before this one, the scenes' cards saying when, where and who. */
export function storySoFar(w: WriterWorld, big = false): StorySoFar {
  const scenes: StorySoFar['scenes'] = []
  const last = big ? 7 : 3
  for (let c = 1; c <= last; c++) {
    for (let k = 1; k <= 5; k++) {
      if (c === last && k > 3) break
      scenes.push({
        sceneId: `s${c}-${k}`,
        chapterId: `c${c}`,
        label: `Fell Road, Ch ${c}, Sc ${k}`,
        text: prose(big ? 220 : 70),
        when: `Day ${c * 5 + k}, ${k % 2 ? 'dusk' : 'morning'}`,
        whereId: c === 2 && k === 1 ? w.ferry.id : w.inn.id,
        whoIds: c === 2 && k === 1 ? [w.wren.id, w.ash.id, w.oskar.id] : [w.wren.id, w.ash.id]
      })
    }
  }
  return {
    scenes,
    chapters: [
      ...Array.from({ length: last - 1 }, (_, i) => ({ chapterId: `c${i + 1}`, label: `Fell Road, Ch ${i + 1}`, text: prose(big ? 200 : 80) }))
    ],
    stories: [],
    series: [],
    leadsInto: null
  }
}

const blank = { where: '', posture: '', holding: '', condition: '', mood: '', lastAction: '' }

/** Where things stand at the end of the scene so far: Oskar and a hat from days before, Edric "burning in his chair". */
export function stage(w: WriterWorld): SceneState {
  return {
    time: 'night',
    weather: 'rain',
    light: 'firelight',
    things: [
      { name: 'the survey case', state: 'on the windowsill' },
      { name: 'the door', state: 'barred from inside' }
    ],
    characters: [
      {
        ...blank,
        name: w.wren.name,
        where: 'on the settle by the fire',
        holding: 'nothing',
        condition: 'wet through',
        clothes: [
          { name: 'hat', state: 'on, pulled down' },
          { name: 'boots', state: 'off, on the hearth' }
        ]
      },
      { ...blank, name: w.ash.name, where: 'gone out to the stable' },
      { ...blank, name: w.oskar.name, where: 'in the punt out in the middle of the flood' },
      { ...blank, name: w.edric.name, where: 'in his chair in the burning survey room', condition: 'dead, burning', lastAction: 'burning in his chair' }
    ],
    said: {
      'wren hollis|where': { quote: 'sat on the settle', sceneId: 'here' },
      'wren hollis|clothes:hat': { quote: 'pulled her hat down', sceneId: 's1-3' },
      'wren hollis|clothes:boots': { quote: 'set her boots on the hearth', sceneId: 'here' },
      'ash penrose|where': { quote: 'went out to see to the horses', sceneId: 'here' },
      'oskar venn|where': { quote: 'took the punt back out', sceneId: 's2-1' },
      'edric rone|where': { quote: 'in his chair', sceneId: 's1-1' },
      '|thing:survey case': { quote: 'set the case on the sill', sceneId: 'here' },
      '|thing:door': { quote: 'dropped the bar', sceneId: 'here' }
    }
  }
}

/** Who knows what: a fact twice, a plan of Wren's own, a plan long past, a plan that happened, and real secrets. */
export function facts(w: WriterWorld): FactState[] {
  return [
    { factId: 'f1', fact: 'The survey is Edric’s work and must be laid before the Assize rises', knownBy: [w.wren.id], at: 2 },
    { factId: 'f2', fact: 'The survey is Edric’s work and must be laid before the Assize rises.', knownBy: [w.wren.id], at: 6 },
    { factId: 'f3', fact: 'Wren will go up to the abbey in the morning', knownBy: [w.ash.id], at: 3 },
    { factId: 'f4', fact: 'Gale will ask again in the morning about buying the papers', knownBy: [w.wren.id], at: 2 },
    { factId: 'f5', fact: 'Wren will give Pell the brass compass at the ferry', knownBy: [w.wren.id], at: 3 },
    { factId: 'f6', fact: 'A man in grey has been asking at every inn for the survey', knownBy: [w.wren.id], at: 9 },
    { factId: 'f7', fact: 'The Warden offered gold for the Carrow papers', knownBy: [w.wren.id], at: 8 }
  ]
}

/** The words of the scene so far at each Add below step, longer each time. */
export const SO_FAR = [
  'Wren and Ash stopped for the night at the inn on the coast road, where it dropped to the sea. Wren set the survey case on the sill and dropped the bar on the door. The rain went on over the roof. Ash went out to see to the horses.',
  'Wren and Ash stopped for the night at the inn on the coast road, where it dropped to the sea. Wren set the survey case on the sill and dropped the bar on the door. The rain went on over the roof. Ash went out to see to the horses. She sat on the settle, set her boots on the hearth and thought of Oskar Venn and of Edric Rone. The rain went on over the roof, and neither of them said a word when he came back. He said, That’s the way of it.'
]

/** One Add below step of the scene at the inn: step 0, then step 1 (more on the page, another direction, a new fact). */
export function addBelowStep(step: 0 | 1, big = false): ContextInput {
  next = 0
  seq = 0
  const w = writerWorld()
  const known = facts(w)
  // After step 0 the memory keeper learned something new.
  if (step === 1) known.push({ factId: 'f8', fact: 'Ash has a cousin at Carrow', knownBy: [w.ash.id, w.wren.id], at: 12 })
  const recall: RecallInput = {
    sticky: step === 0 ? [w.ferry.id, w.compass.id] : [w.compass.id, w.ferry.id],
    found: step === 0 ? [w.oskar.id] : [],
    passages: [],
    said: []
  }
  return {
    style: { ...defaultStyleGuide(), pov: 'Close third person', tense: 'Past tense', spelling: 'UK', samplePassage: prose(120) },
    scene: {
      title: 'The inn on the coast road',
      card: {
        ...emptySceneCard(),
        povId: w.wren.id,
        presentIds: [w.wren.id, w.ash.id],
        locationId: w.inn.id,
        when: 'Day 23, night, rain',
        beats: ['Wren and Ash stop for the night at an inn on the coast road', 'They talk about what comes next']
      }
    },
    memory: {
      storyId: 'fell-road',
      sceneId: 'here',
      knows: '',
      previous: { sceneId: 's3-3', title: 'The coast road', text: prose(500), storyId: 'fell-road', storyTitle: 'Fell Road', when: 'Day 23, dusk', otherStory: null },
      entries: w.all,
      firstHere: [],
      elsewhere: [],
      relationships: [{ aId: w.wren.id, bId: w.ash.id, type: 'travelling companions', aFeels: '', bFeels: '', where: '' }],
      facts: known,
      threads: [],
      storySoFar: storySoFar(w, big),
      bringAbout: []
    },
    pins: [],
    blockModes: {},
    world: { themes: 'Debt and duty', tone: 'Quiet, wet, close' },
    series: null,
    story: { title: 'Fell Road', premise: 'A clerk carries a dead man’s survey to the Assize.', themes: '', tone: '' },
    options: {
      direction: step === 0 ? 'Wren wonders which way the coast road runs' : 'Ash comes back in from the stable',
      targetWords: 350,
      creativity: 'balanced',
      addBelow: true
    },
    contextLength: 64_000,
    continuity: stage(w),
    continuityAtSoFar: true,
    stageWhere: { here: 'Fell Road, Ch 3, Sc 4', 's1-3': 'Fell Road, Ch 1, Sc 3', 's2-1': 'Fell Road, Ch 2, Sc 1', 's1-1': 'Fell Road, Ch 1, Sc 1' },
    recall,
    soFar: SO_FAR[step]
  }
}
