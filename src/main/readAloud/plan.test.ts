import { describe, expect, it } from 'vitest'
import { castOf, everyone } from './cast'
import { planClips, type PlanInput, type PlanSettings } from './plan'
import { lexiconOf } from './say'
import type { ParagraphMarks } from './types'

const settings: PlanSettings = {
  engine: 'breeze',
  narratorVoice: 'narrator',
  narratorDescription: '',
  dialogueVoice: '',
  style: '',
  castVoices: true,
  steadyNarrator: false,
  sounds: true
}

const cast = everyone(
  castOf([
    { id: 'mara', name: 'Mara Quill', aliases: [], about: '', voice: { design: 'A low, dry woman’s voice.', voice: '' } },
    { id: 'tom', name: 'Tomas', aliases: [], about: '', voice: { design: '', voice: 'clip:tomas.wav' } },
    { id: 'ann', name: 'Ann', aliases: [], about: '' }
  ])
)

const plan = (text: string, more: Partial<PlanInput> = {}) =>
  planClips({ paragraphs: [{ pid: 'p1', text }], settings, cast, lexicon: [], marks: new Map(), ...more })

const said = (text: string, more: Partial<PlanInput> = {}) =>
  plan(text, more).clips.map((c) => ({ who: c.who, how: c.how, input: c.clip.input, voice: c.clip.voice, design: c.clip.voiceDesign }))

describe('who reads each clip, in which voice', () => {
  it('reads narration in the narrator’s voice and a line in its speaker’s own', () => {
    expect(said('Mara looked up. “Get out,” she snapped.')).toEqual([
      { who: 'Narrator', how: '', input: 'Mara looked up.', voice: 'narrator', design: '' },
      { who: 'Mara Quill', how: 'sharp and irritated', input: 'Get out,', voice: 'narrator', design: 'A low, dry woman’s voice.' },
      { who: 'Narrator', how: '', input: 'she snapped.', voice: 'narrator', design: '' }
    ])
    expect(said('“Not tonight,” said Tomas.')[0]).toMatchObject({ who: 'Tomas', voice: 'clip:tomas.wav', design: '' })
  })

  it('reads a character with no voice of their own, or every character when cast voices are off, in the dialogue voice', () => {
    const s = { ...settings, dialogueVoice: 'warm' }
    expect(said('“Hello,” said Ann.', { settings: s })[0]).toMatchObject({ who: 'Ann', voice: 'warm' })
    expect(said('“Hello,” said Tomas.', { settings: { ...s, castVoices: false } })[0]).toMatchObject({ who: 'Tomas', voice: 'warm' })
    // With no dialogue voice, the narrator reads every line.
    expect(said('“Hello,” said Tomas.', { settings: { ...settings, castVoices: false } })[0]).toMatchObject({ voice: 'narrator' })
  })

  it('keeps the narrator’s standing note off the characters’ lines', () => {
    const clips = plan('He waited. “Now,” said Ann.', { settings: { ...settings, style: 'Warm and wry.' } }).clips
    expect(clips[0].clip.instruct).toBe('Warm and wry.')
    expect(clips[1].clip.instruct).toBe('')
  })
})

describe('how each clip is said', () => {
  it('puts clear emphasis on the words in italics', () => {
    const text = 'She had never been so sure.'
    const at = text.indexOf('never')
    const [clip] = plan(text, { paragraphs: [{ pid: 'p1', text, italics: [[at, at + 5]] }] }).clips
    expect(clip.clip.delivery).toBe("Put clear emphasis on 'never'.")
    expect(clip.clip.input).toBe('She had never been so sure.')
  })

  it('says names as "Say it as" has them, on the voice only', () => {
    const [clip] = plan('Siobhan waited.', { lexicon: lexiconOf([{ name: 'Siobhan', say: 'shiv-AWN' }]) }).clips
    expect(clip.clip.input).toBe('shiv-AWN waited.')
    expect(clip.to).toBe('Siobhan waited.'.length)
  })

  it('follows the AI’s marks over the rules: the speaker and the tone', () => {
    const marks = new Map<string, ParagraphMarks>([
      ['p1', { speakers: { 'who goes there': 'Tomas' }, delivery: { 'who goes there': { tone: 'wary', pace: 'slow' } } }]
    ])
    const [clip] = plan('“Who goes there?”', { marks }).clips
    expect(clip).toMatchObject({ who: 'Tomas', how: 'wary, slowly' })
    expect(clip.clip).toMatchObject({ voice: 'clip:tomas.wav', delivery: 'wary', pace: 'slow' })
  })

  it('reads a quote the AI marked as nobody’s words (a sign) in the narrator’s voice', () => {
    const marks = new Map<string, ParagraphMarks>([['p1', { speakers: { 'no entry': 'narrator' } }]])
    expect(plan('The sign said “No entry.”', { marks }).clips.map((c) => c.who)).toEqual(['Narrator', 'Narrator'])
  })

  it('keeps a steady narrator plain: no standing note, and a marked mood held gently', () => {
    const steady = { ...settings, steadyNarrator: true, style: 'Warm and wry.' }
    const plain = plan('The door opened.', { settings: steady }).clips[0].clip
    expect(plain).toMatchObject({ instruct: '', delivery: '', gentle: false })
    const marks = new Map<string, ParagraphMarks>([['p1', { delivery: { '~the door opened': { tone: 'hushed' } } }]])
    expect(plan('The door opened.', { settings: steady, marks }).clips[0].clip).toMatchObject({
      instruct: '',
      delivery: 'hushed',
      gentle: true
    })
  })

  it('never slows the narrator, keeping the feeling; a character’s line keeps its pace', () => {
    const marks = new Map<string, ParagraphMarks>([
      [
        'p1',
        {
          delivery: {
            '~the stairs went on': { tone: 'hushed, unhurried, dread building', pace: 'slow' },
            'wait': { tone: 'wary', pace: 'slow' }
          }
        }
      ]
    ])
    const [narration, line] = plan('The stairs went on. “Wait,” said Tomas.', { marks }).clips
    expect(narration).toMatchObject({ how: 'hushed, dread building' })
    expect(narration.clip).toMatchObject({ delivery: 'hushed, dread building', pace: '' })
    expect(line.clip).toMatchObject({ delivery: 'wary', pace: 'slow' })
    // A quickening is kept, and a note that was only about slowing leaves the narration plain.
    const quick = new Map<string, ParagraphMarks>([['p1', { delivery: { '~the stairs went on': { tone: 'urgent', pace: 'fast' } } }]])
    expect(plan('The stairs went on.', { marks: quick }).clips[0].clip).toMatchObject({ delivery: 'urgent', pace: 'fast' })
    const slowOnly = new Map<string, ParagraphMarks>([['p1', { delivery: { '~the stairs went on': { tone: 'slowly, measured', pace: 'slow' } } }]])
    expect(plan('The stairs went on.', { marks: slowOnly }).clips[0].clip).toMatchObject({ delivery: '', pace: '' })
  })

  it('performs a written sound only when Perform written sounds is on', () => {
    const text = 'She sighs. Then she goes.'
    const at = text.indexOf('sighs')
    const paragraphs = [{ pid: 'p1', text, italics: [[at, at + 5]] as [number, number][] }]
    expect(plan(text, { paragraphs }).clips[0].clip.input).toBe('She (sigh). Then she goes.')
    expect(plan(text, { paragraphs, settings: { ...settings, sounds: false } }).clips[0].clip.input).toBe(text)
    expect(plan('“Haha! Fine.”').clips[0].clip.input).toBe('(laugh) Fine.')
  })
})

describe('the plan as a whole', () => {
  it('gives the same clip the same key, and a different voice a different one', () => {
    const a = plan('“Hello,” said Tomas.').clips[0]
    expect(plan('“Hello,” said Tomas.').clips[0].key).toBe(a.key)
    expect(plan('“Hello,” said Tomas.', { settings: { ...settings, castVoices: false } }).clips[0].key).not.toBe(a.key)
  })

  it('lists the lines nobody can be sure of, for the AI', () => {
    expect([...(plan('“Who’s there?”').unplaced.get('p1') ?? [])]).toEqual(['who s there'])
    expect(plan('“Hello,” said Ann.').unplaced.size).toBe(0)
    // A tag naming someone outside the cast.
    expect([...(plan('“Fine,” someone muttered.').unplaced.get('p1') ?? [])]).toEqual(['fine'])
    // An empty quote has nothing to ask about.
    expect(plan('He said nothing. “”').unplaced.size).toBe(0)
  })

  it('makes no clip of a quote with no words in it, and keeps its pause', () => {
    const clips = plan('', {
      paragraphs: [
        { pid: 'p1', text: '“Hello,” said Ann. “”' },
        { pid: 'p2', text: 'Then quiet.' }
      ]
    }).clips
    expect(clips.map((c) => c.clip.input)).toEqual(['Hello,', 'said Ann.', 'Then quiet.'])
    expect(clips[1].restMs).toBe(450)
  })

  it('has the clips the AI is marking wait for it, except a new reading’s first narration', () => {
    const paragraphs = [
      { pid: 'p1', text: 'The lamps went out one by one along the wall. Then the dark came.' },
      { pid: 'p2', text: '“Who’s there?”' }
    ]
    const marking = plan('', { paragraphs, quick: true, marking: new Set(['p1', 'p2']) }).clips.map((c) => c.waits)
    expect(marking).toEqual([false, true, true])
    const labelling = plan('', { paragraphs, labelling: new Set(['p2']) }).clips.map((c) => c.waits)
    expect(labelling).toEqual([false, true])
  })

  it('rests between paragraphs, and longest at the end of the stretch', () => {
    const clips = plan('', {
      paragraphs: [
        { pid: 'p1', text: 'One.' },
        { pid: 'p2', text: 'Two.' }
      ]
    }).clips
    expect(clips.map((c) => [c.pid, c.restMs])).toEqual([
      ['p1', 450],
      ['p2', 0]
    ])
  })
})

describe('notes that slipped onto the wrong line when the scene was marked', () => {
  it('reads the quote in its speaker’s own voice, and the narration without the character’s note', () => {
    // Saved by a model that renumbered: the quote "said by" a mood, the narration given Mara's note.
    const marks = new Map<string, ParagraphMarks>([
      [
        'p1',
        {
          speakers: { 'get out': 'hushed, dread building' },
          delivery: { 'get out': { pace: 'slow' }, '~mara looked up': { tone: 'Mara Quill, sharp, daring him to argue' } }
        }
      ]
    ])
    expect(said('Mara looked up. “Get out,” she snapped.', { marks })).toEqual([
      { who: 'Narrator', how: '', input: 'Mara looked up.', voice: 'narrator', design: '' },
      { who: 'Mara Quill', how: 'sharp and irritated', input: 'Get out,', voice: 'narrator', design: 'A low, dry woman’s voice.' },
      { who: 'Narrator', how: '', input: 'she snapped.', voice: 'narrator', design: '' }
    ])
    // The same keys, marked well, are used as they are.
    const good = new Map<string, ParagraphMarks>([['p1', { speakers: { 'get out': 'Tomas' }, delivery: { '~mara looked up': { tone: 'tense' } } }]])
    expect(said('Mara looked up. “Get out,” she snapped.', { marks: good }).map((c) => [c.who, c.how])).toEqual([
      ['Narrator', 'tense'],
      ['Tomas', 'sharp and irritated'],
      ['Narrator', 'tense']
    ])
  })
})
