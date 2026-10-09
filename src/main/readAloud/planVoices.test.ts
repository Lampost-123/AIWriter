// Every character's own voice in a plan: voices cast as they speak, and the lines a character owns that are
// not said aloud (thoughts, messages, letters) read in their voice.
import { describe, expect, it } from 'vitest'
import { autoCaster } from './autocast'
import { castOf, everyone } from './cast'
import { planClips, voicedRanges, type PlanInput, type PlanSettings } from './plan'
import { studioClip, type StudioVoice } from './studio'
import type { ParagraphMarks } from './types'

const settings: PlanSettings = {
  engine: 'breeze',
  narratorVoice: 'narrator',
  narratorDescription: '',
  dialogueVoice: '',
  style: '',
  castVoices: true,
  steadyNarrator: false,
  sounds: false,
  // Every word is read here, the tags too (speechTags.test.ts tests skipping them).
  skipSpeechTags: false
}

const voices: StudioVoice[] = [
  { id: 'f1', gender: 'female', age: '18-25', pitch: 'mid' },
  { id: 'm1', gender: 'male', age: '66-75', pitch: 'low' },
  { id: 'm2', gender: 'male', age: '26-35', pitch: 'mid' }
]
const all = castOf([
  { id: 'mara', name: 'Mara', aliases: [], about: 'A young woman.', voice: { design: '', voice: 'clip:library/f9.wav' } },
  { id: 'tom', name: 'Tomas', aliases: [], about: 'An old man.' }
])
const cast = everyone(all)

const plan = (p: { text: string; italics?: [number, number][] }, marks: ParagraphMarks = {}, more: Partial<PlanInput> = {}) =>
  planClips({
    paragraphs: [{ pid: 'p1', ...p }],
    settings,
    cast,
    lexicon: [],
    marks: new Map([['p1', marks]]),
    ...more
  }).clips.map((c) => ({ who: c.who, input: c.clip.input, voice: c.clip.voice, delivery: c.clip.delivery, mood: c.clip.mood, how: c.how }))

describe('a speaker with no voice of their own', () => {
  it('reads the line in a studio voice cast for them, not the narrator’s; the narration stays the narrator’s', () => {
    const text = '“Not tonight,” Tomas said.'
    expect(plan({ text })[0]).toMatchObject({ who: 'Tomas', voice: 'narrator' })
    const got = plan({ text }, {}, { autocast: autoCaster({ voices, narrator: 'narrator', cast: all }) })
    expect(got[0]).toMatchObject({ who: 'Tomas', voice: studioClip('m1') })
    expect(got[1]).toMatchObject({ who: 'Narrator', voice: 'narrator' })
  })

  it('casts someone the marks name who isn’t in the cast, the same voice every line', () => {
    const autocast = autoCaster({ voices, narrator: 'narrator', cast: all })
    const marks = { speakers: { papers: 'the guard', now: 'the guard' } }
    const got = plan({ text: '“Papers.” “Now.”' }, marks, { autocast })
    expect(got[0]?.voice).toMatch(/^clip:library\//)
    expect(got[1]?.voice).toBe(got[0]?.voice)
    // "The old woman" is cast by the words of her label.
    expect(plan({ text: '“Hush.”' }, { speakers: { hush: 'the old woman' } }, { autocast })[0]?.voice).toBe(studioClip('f1'))
    expect(got[0]?.who).toBe('The guard')
  })

  it('keeps a character’s own voice, and reads them as now when cast voices are off', () => {
    const autocast = autoCaster({ voices, narrator: 'narrator', cast: all })
    expect(plan({ text: '“Go,” Mara said.' }, {}, { autocast })[0]?.voice).toBe('clip:library/f9.wav')
    expect(plan({ text: '“Go,” Tomas said.' }, {}, { autocast, settings: { ...settings, castVoices: false } })[0]?.voice).toBe('narrator')
  })
})

describe('a thought, a message or a letter a character owns', () => {
  it('reads only the thought in italics in their voice, soft and from their whisper; the tag stays the narrator’s', () => {
    const text = 'Not again, Tomas thought.'
    const marks: ParagraphMarks = {
      kinds: { '~not again tomas thought': 'thought' },
      voiced: { '~not again tomas thought': 'Tomas' },
      delivery: { '~not again tomas thought': { tone: 'weary', feeling: 'sad', intensity: 2 } }
    }
    const autocast = autoCaster({ voices, narrator: 'narrator', cast: all })
    const got = plan({ text, italics: [[0, 10]] }, marks, { autocast })
    expect(got[0]).toMatchObject({ who: 'Tomas', input: 'Not again,', voice: studioClip('m1'), mood: 'whisper', how: 'thought · weary' })
    expect(got[0]?.delivery).toContain('soft and inward, a private thought')
    expect(got[1]).toMatchObject({ who: 'Narrator', input: 'Tomas thought.', voice: 'narrator' })
  })

  it('reads a text message plainly in its writer’s voice, the "Name:" before it by the narrator', () => {
    const text = 'Mara: running late, save me a seat'
    const marks: ParagraphMarks = {
      kinds: { '~mara running late save me a seat': 'text_message' },
      voiced: { '~mara running late save me a seat': 'Mara' },
      delivery: { '~mara running late save me a seat': { tone: 'hurried, apologetic', feeling: 'anxious', intensity: 2 } }
    }
    const got = plan({ text }, marks)
    expect(got.map((c) => [c.who, c.input, c.voice])).toEqual([
      ['Narrator', 'Mara:', 'narrator'],
      ['Mara', 'running late, save me a seat', 'clip:library/f9.wav']
    ])
    // Plain: no note, no acted feeling.
    expect(got[1]).toMatchObject({ delivery: '', how: 'message' })
    expect(got[1]?.mood).toBeUndefined()
  })

  it('reads a message of several sentences in italics as one plain line, with no emphasis; the tag beside a thought has no note', () => {
    const text = 'Forgot to say. You did well today.'
    const marks: ParagraphMarks = {
      kinds: { '~forgot to say': 'text_message', '~you did well today': 'text_message' },
      voiced: { '~forgot to say': 'Tomas', '~you did well today': 'Tomas' },
      delivery: { '~forgot to say': { tone: 'offhand' }, '~you did well today': { tone: 'kind' } }
    }
    const got = plan({ text, italics: [[0, text.length]] }, marks)
    expect(got).toEqual([expect.objectContaining({ who: 'Tomas', input: 'Forgot to say. You did well today.', delivery: '' })])
    const thought: ParagraphMarks = {
      kinds: { '~not again she thought': 'thought' },
      voiced: { '~not again she thought': 'Tomas' },
      delivery: { '~not again she thought': { tone: 'sinking dread' } }
    }
    const tag = plan({ text: 'Not again, she thought.', italics: [[0, 10]] }, thought)[1]
    expect(tag).toMatchObject({ who: 'Narrator', input: 'she thought.', delivery: '' })
  })

  it('reads a letter in its writer’s voice with its note, unacted; a sign stays the narrator’s', () => {
    const text = 'I miss the river. “KEEP OUT,” the sign read.'
    const marks: ParagraphMarks = {
      kinds: { '~i miss the river': 'letter', 'keep out': 'sign' },
      voiced: { '~i miss the river': 'Mara' },
      speakers: { 'keep out': 'narrator' },
      delivery: { '~i miss the river': { tone: 'wistful', feeling: 'longing', intensity: 2 }, 'keep out': {} }
    }
    const got = plan({ text }, marks)
    expect(got[0]).toMatchObject({ who: 'Mara', input: 'I miss the river.', voice: 'clip:library/f9.wav', delivery: 'wistful', how: 'letter · wistful' })
    expect(got[0]?.mood).toBeUndefined()
    expect(got.slice(1).every((c) => c.voice === 'narrator')).toBe(true)
  })

  it('acts a spoken line from the director’s feeling when it is clear, not when it is only a hint', () => {
    const marks = (intensity: 1 | 2 | 3): ParagraphMarks => ({ speakers: { go: 'Mara' }, delivery: { go: { tone: 'quietly', feeling: 'angry', intensity } } })
    expect(plan({ text: '“Go.”' }, marks(3))[0]?.mood).toBe('angry')
    expect(plan({ text: '“Go.”' }, marks(1))[0]?.mood).toBeUndefined()
  })

  it('finds the stretch a sentence’s owner reads: its italics, else after a "Name:", else all of it', () => {
    const voiced = (text: string, italics?: [number, number][]) =>
      voicedRanges({ pid: 'p', text, ...(italics ? { italics } : {}) }, { voiced: Object.fromEntries([[`~${text.toLowerCase().replace(/[^a-z]+/g, ' ').trim()}`, 'Mara']]) }).map((r) => text.slice(r.at, r.end))
    expect(voiced('Not again, she thought.', [[0, 11]])).toEqual(['Not again,'])
    expect(voiced('Mara: on my way')).toEqual(['on my way'])
    expect(voiced('I miss you.')).toEqual(['I miss you.'])
  })
})

describe('with "Read thoughts, messages and letters in the character’s voice" off', () => {
  it('reads them by the narrator, as before; the characters’ spoken lines keep their voices', () => {
    const text = 'Not again, Tomas thought. “Go,” Mara said.'
    const marks: ParagraphMarks = {
      kinds: { '~not again tomas thought': 'thought', go: 'speech' },
      voiced: { '~not again tomas thought': 'Tomas' },
      speakers: { go: 'Mara' }
    }
    const got = plan({ text, italics: [[0, 10]] }, marks, { settings: { ...settings, voicedLines: false } })
    expect(got[0]).toMatchObject({ who: 'Narrator', input: 'Not again, Tomas thought.', voice: 'narrator' })
    expect(got[1]).toMatchObject({ who: 'Mara', voice: 'clip:library/f9.wav' })
  })
})
