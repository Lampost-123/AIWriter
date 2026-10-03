import { describe, expect, it } from 'vitest'
import type { SceneCue } from '@shared/contracts/sounds'
import { getSchema } from '@tiptap/core'
import { sceneExtensions } from '@/features/editor/extensions'
import { pageParagraphs, posIn } from '@/features/readAloud/pageText'
import { anchorRange, comesAfter, countWords, pickWords, quote, soundNotes, soundWords, stateWords, whereWords } from './soundsLogic'

const schema = getSchema(sceneExtensions())
const para = (pid: string, words: string) => schema.nodes.paragraph.create({ pid }, words ? schema.text(words) : undefined)
const P1 = 'Rain hammered the tin roof.'
const P2 = 'Then the door slammed shut.'
const doc = schema.nodes.doc.create(null, [para('p1', P1), para('p2', P2)])
const paragraphs = pageParagraphs(doc)

const cue = (over: Partial<SceneCue>): SceneCue => ({
  id: 'c1',
  kind: 'effect',
  description: 'a heavy door slamming shut',
  soundId: 's1',
  at: { pid: 'p2', from: 14, to: 21, words: 'slammed' },
  until: null,
  origin: 'ai',
  placed: true,
  sound: 'ready',
  retake: null,
  ...over
})

describe('where a sound plays, in plain words', () => {
  it('names the word an effect fires on, and an ambience’s stretch', () => {
    expect(whereWords(cue({}))).toBe('on “slammed”')
    expect(whereWords(cue({ placed: false }))).toBe('near “slammed”')
    const rain = { kind: 'ambience' as const, at: { pid: 'p1', from: 0, to: 4, words: 'Rain' } }
    expect(whereWords(cue({ ...rain }))).toBe('from “Rain” to the end of the scene')
    expect(whereWords(cue({ ...rain, until: { pid: 'p2', from: 14, to: 21, words: 'slammed' } }))).toBe('from “Rain” until “slammed”')
  })

  it('cuts long words short at a word', () => {
    expect(quote('the door')).toBe('“the door”')
    expect(quote('  the   door  ')).toBe('“the door”')
    expect(quote('the heavy oak door at the end of the long hall slammed', 20)).toBe('“the heavy oak door…”')
  })

  it('says when a sound can’t play yet', () => {
    expect(stateWords(cue({}))).toBe('')
    expect(stateWords(cue({ sound: 'waiting' }))).toBe('Being made…')
    expect(stateWords(cue({ sound: 'making' }))).toBe('Being made…')
    expect(stateWords(cue({ sound: 'failed' }))).toBe('Couldn’t be made')
    // Muted, its own volume when not as made, and a new take being made.
    expect(soundNotes(cue({}))).toEqual([])
    expect(soundNotes(cue({ volume: 1 }))).toEqual([])
    expect(soundNotes(cue({ muted: true, volume: 1.5, retake: 'making' }))).toEqual(['Muted', '150% volume', 'Making a new take…'])
    expect(soundNotes(cue({ volume: 0.25, retake: 'ready' }))).toEqual(['25% volume'])
    expect(countWords(1)).toBe('1 sound')
    expect(countWords(3)).toBe('3 sounds')
  })
})

describe('the words selected as a place for a sound', () => {
  const p2 = paragraphs[1]
  it('takes the words in one paragraph, without the spaces at their ends', () => {
    expect(pickWords(paragraphs, posIn(p2, 13), posIn(p2, 22))).toEqual({ anchor: { pid: 'p2', from: 14, to: 21, words: 'slammed' } })
  })

  it('says why a selection can’t be one', () => {
    expect(pickWords(paragraphs, posIn(p2, 9), posIn(p2, 9))).toEqual({ problem: 'none' })
    expect(pickWords(paragraphs, posIn(p2, 4), posIn(p2, 5))).toEqual({ problem: 'none' })
    expect(pickWords(paragraphs, posIn(paragraphs[0], 5), posIn(p2, 4))).toEqual({ problem: 'paragraphs' })
  })

  it('knows whether an ambience’s end comes after its start', () => {
    const rain = { pid: 'p1', from: 0, to: 4, words: 'Rain' }
    const roof = { pid: 'p1', from: 22, to: 26, words: 'roof' }
    const shut = { pid: 'p2', from: 22, to: 26, words: 'shut' }
    expect(comesAfter(paragraphs, rain, roof)).toBe(true)
    expect(comesAfter(paragraphs, rain, shut)).toBe(true)
    expect(comesAfter(paragraphs, shut, rain)).toBe(false)
    expect(comesAfter(paragraphs, rain, rain)).toBe(false)
    expect(comesAfter(paragraphs, rain, { ...shut, pid: 'gone' })).toBe(false)
  })
})

describe('where a sound’s words are on the page', () => {
  it('finds them where they were, or nearest where they were after an edit, or not at all', () => {
    const p2 = paragraphs[1]
    const at = { pid: 'p2', from: 14, to: 21, words: 'slammed' }
    expect(anchorRange(paragraphs, at)).toEqual({ from: posIn(p2, 14), to: posIn(p2, 21) })
    // Words added before them: found again by their words.
    const edited = pageParagraphs(schema.nodes.doc.create(null, [para('p1', P1), para('p2', 'And then the door slammed shut.')]))
    expect(anchorRange(edited, at)).toEqual({ from: posIn(edited[1], 18), to: posIn(edited[1], 25) })
    expect(anchorRange(paragraphs, { ...at, words: 'banged' })).toBeNull()
    expect(anchorRange(paragraphs, { ...at, pid: 'p9' })).toBeNull()
  })

  it('lists the words each sound is placed on, an ambience’s end too', () => {
    const until = { pid: 'p2', from: 22, to: 26, words: 'shut' }
    expect(soundWords([cue({}), cue({ id: 'c2', kind: 'ambience', until, muted: true })]).map((w) => [w.cueId, w.role, !!w.muted])).toEqual([
      ['c1', 'at', false],
      ['c2', 'at', true],
      ['c2', 'until', true]
    ])
  })
})
