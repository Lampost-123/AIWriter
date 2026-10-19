import { describe, expect, it } from 'vitest'
import type { EntryState, StyleGuide } from '@shared/types'
import { defaultStyleGuide, emptySceneCard } from '@shared/defaults'
import { SOUND_BLOCK } from '@shared/ownSample'
import type { SceneMemory } from '../memory/types'
import type { OwnSample } from '../style/ownWords'
import { buildBlocks, prepareContext, VOICES_BLOCK, type ContextInput } from './context'
import { instructionsText, ownSampleText, soundLikeText } from './prompts'

// Invented text only.
const style = (s: Partial<StyleGuide> = {}): StyleGuide => ({ ...defaultStyleGuide(), pov: 'Close third person', tense: 'Past tense', ...s })

const long = (seed: string, n: number): string =>
  Array.from({ length: Math.ceil(n / 10) }, (_, i) => `The ${seed} gull number ${i} sat on the post and watched the tide.`).join(' ')

const SAMPLE: OwnSample = {
  passages: [
    { sceneId: 's2', where: 'Ch 2, Sc 1', text: `${long('grey', 150)}\n\n"Get the lamp, girl," Bryn said.`, words: 156, dialogue: true, narration: true },
    { sceneId: 's1', where: 'Ch 1, Sc 3', text: long('white', 120), words: 120, dialogue: false, narration: true }
  ],
  words: 276
}

let seq = 0
const person = (name: string, fields: Record<string, string> = {}): EntryState => ({
  id: `p${++seq}`,
  kind: 'character',
  name,
  aliases: [],
  summary: '',
  description: '',
  tags: [],
  notes: '',
  fields,
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
  changed: []
})

function input(over: Partial<ContextInput> = {}, people: EntryState[] = []): ContextInput {
  const memory: SceneMemory = {
    storyId: 'book-1',
    sceneId: 'scene-3',
    knows: '',
    previous: null,
    entries: people,
    firstHere: [],
    elsewhere: [],
    relationships: [],
    facts: [],
    threads: [],
    storySoFar: { scenes: [], chapters: [], stories: [], series: [], leadsInto: null },
    bringAbout: []
  }
  return {
    style: style(),
    scene: { title: 'The bell', card: { ...emptySceneCard(), povId: people[0]?.id ?? null, presentIds: people.map((p) => p.id), beats: ['The bell rings'] } },
    memory,
    pins: [],
    blockModes: {},
    world: { themes: '', tone: '' },
    series: null,
    story: { title: 'Book 1', premise: '', themes: '', tone: '' },
    options: { targetWords: 1500, creativity: 'balanced', direction: '' },
    contextLength: 64_000,
    ...over
  }
}

describe('Adam’s own writing as the sample passage', () => {
  it('each stretch in its own quotes, nearest first; the short form keeps the first, trimmed', () => {
    const text = ownSampleText(SAMPLE)
    expect(text.split('\n')[0]).toBe('Sample passage')
    expect(text).toContain("These passages are the author's own writing, from the story so far.")
    expect(text.indexOf('grey gull')).toBeLessThan(text.indexOf('white gull'))
    expect(text.match(/"""/g)).toHaveLength(4)
    const short = ownSampleText(SAMPLE, true)
    expect(short).toContain("This passage is the author's own writing")
    expect(short).not.toContain('white gull')
    expect(short.length).toBeLessThan(text.length)
  })

  it('takes the place of the style guide’s sample passage in block 1; without it, block 1 is as before', () => {
    const guide = style({ samplePassage: 'The kettle sang. Nobody moved to lift it.' })
    const own = instructionsText(guide, { ownSample: SAMPLE })
    expect(own).toContain('grey gull')
    expect(own).not.toContain('The kettle sang.')
    expect(instructionsText(guide, { ownSample: null })).toContain('This passage is by the author.')
    expect(instructionsText(guide)).toBe(instructionsText(guide, { ownSample: { passages: [], words: 0 } }))
  })

  it('in the briefing: block 1 says how much is his and from where, and some of it again comes last', () => {
    const blocks = prepareContext(input({ ownSample: SAMPLE })).blocks
    const first = blocks.find((b) => b.id === 'instructions')!
    expect(first.ownWriting).toMatchObject({ words: 276, from: ['Ch 2, Sc 1', 'Ch 1, Sc 3'] })
    expect(first.ownWriting!.short!.from).toEqual(['Ch 2, Sc 1'])
    const last = blocks.at(-1)!
    expect(last).toMatchObject({ id: SOUND_BLOCK.id, title: 'Sound like this', priority: 2 })
    expect(last.text).toBe(soundLikeText({ text: last.text.split('"""\n')[1].replace(/\n"""$/, '') }))
    // The stretch with dialogue and narration, about 120 words.
    expect(last.text).toContain('grey gull')
    expect(last.ownWriting!.words).toBeLessThanOrEqual(121)
    // Without his own writing: neither.
    const plain = prepareContext(input()).blocks
    expect(plain.some((b) => b.id === SOUND_BLOCK.id)).toBe(false)
    expect(plain.find((b) => b.id === 'instructions')!.ownWriting).toBeUndefined()
  })
})

describe('How they sound: one compact line each from their lines so far', () => {
  it('under the profiles’ lines, for those in the scene only', () => {
    const bryn = person('Bryn', { speech: 'Gruff.' })
    const wren = person('Wren')
    const away = person('Ash')
    const marks = {
      [bryn.id]: { text: 'short sentences (about 4 words); calls people "girl"; often says "aye"', own: true, lines: 12 },
      [wren.id]: { text: 'asks a lot of questions', own: false, lines: 5 },
      [away.id]: { text: 'talks at length', own: true, lines: 9 }
    }
    const block = buildBlocks(input({ voiceMarks: marks }, [bryn, wren])).find((b) => b.id === VOICES_BLOCK.id)!
    expect(block.text).toBe(
      [
        'Keep each voice distinct in every line they speak:',
        '- Bryn: Gruff.',
        "How their lines so far read (the author's own lines where there are enough):",
        '- Bryn: short sentences (about 4 words); calls people "girl"; often says "aye".',
        '- Wren: asks a lot of questions.'
      ].join('\n')
    )
  })

  it('sent when only the lines say how someone talks, and not at all when nothing does', () => {
    const bryn = person('Bryn')
    const only = buildBlocks(input({ voiceMarks: { [bryn.id]: { text: 'never uses contractions ("do not", "cannot")', own: true, lines: 6 } } }, [bryn]))
    expect(only.find((b) => b.id === VOICES_BLOCK.id)!.text).toBe(
      "Keep each voice distinct in every line they speak. How their lines so far read (the author's own lines where there are enough):\n- Bryn: never uses contractions (\"do not\", \"cannot\")."
    )
    expect(buildBlocks(input({}, [person('Ash')])).some((b) => b.id === VOICES_BLOCK.id)).toBe(false)
  })
})
