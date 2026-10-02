import { describe, expect, it } from 'vitest'
import type { Entry } from '@shared/types'
import { parsePartial } from './partial'
import {
  cleanValue,
  collectValues,
  fleshOutTargets,
  fleshOutValues,
  fromHisWords,
  interviewReply,
  optionsFrom,
  optionsFromText,
  pickThree,
  profileKeys,
  quickStartView,
  toInput,
  valuesOf,
  writingField
} from './profile'

const NOTES = `Brann Holt runs the ferry across the Narrows.
A grumpy ex-soldier who owes the Duke money.
Missing two fingers on his left hand.`

describe("keeping Adam's words", () => {
  it('knows words copied from his notes, whatever the capitals, quotes and spacing', () => {
    expect(fromHisWords(NOTES, 'A grumpy ex-soldier who owes the Duke money.')).toBe(true)
    expect(fromHisWords(NOTES, 'a grumpy  ex–soldier who owes the duke money')).toBe(true)
    // Phrases gathered from different places in the notes.
    expect(fromHisWords(NOTES, 'Grumpy ex-soldier; missing two fingers on his left hand')).toBe(true)
    expect(fromHisWords(NOTES, 'Runs the ferry across the Narrows, owes the Duke money.')).toBe(true)
  })

  it("doesn't count words he didn't write", () => {
    expect(fromHisWords(NOTES, 'A grumpy former soldier who owes the Duke money.')).toBe(false)
    expect(fromHisWords(NOTES, 'Missing two fingers on his left hand. He hides it in a glove.')).toBe(false)
    expect(fromHisWords(NOTES, '...')).toBe(false)
  })

  it("reads a Quick start reply: his words are his, and win over the AI's for the same field", () => {
    const reply = JSON.stringify({
      fromNotes: { name: 'Brann Holt', summary: 'Brann Holt runs the ferry across the Narrows.', marks: 'Missing two fingers on his left hand.' },
      drafted: { name: 'Someone else', summary: 'A ferryman.', hair: 'Grey and cropped close', age: 52 }
    })
    const v = quickStartView('character', NOTES, parsePartial(reply))
    expect(v.values).toEqual({
      name: 'Brann Holt',
      summary: 'Brann Holt runs the ferry across the Narrows.',
      marks: 'Missing two fingers on his left hand.',
      hair: 'Grey and cropped close',
      age: '52'
    })
    expect(v.fromNotes.sort()).toEqual(['marks', 'name', 'summary'])
    expect(v.writing).toBeNull()
  })

  it("counts words the model claimed were his but weren't as the AI's, used only where nothing else was drafted", () => {
    const reply = JSON.stringify({
      fromNotes: { traits: 'Grumpy and proud', flaws: 'Gambles' },
      drafted: { name: 'Brann', traits: 'Short-tempered, loyal' }
    })
    const v = quickStartView('character', NOTES, parsePartial(reply))
    expect(v.values.traits).toBe('Short-tempered, loyal')
    expect(v.values.flaws).toBe('Gambles')
    expect(v.fromNotes).toEqual([])
  })

  it('reads a reply without the two parts as all drafted, and shows the field being written', () => {
    const v = quickStartView('place', 'A port town', parsePartial('{"name": "Saltmere", "atmosphere": "Salt and wet ro'))
    expect(v.values).toEqual({ name: 'Saltmere' })
    expect(v.writing).toEqual({ key: 'atmosphere', text: 'Salt and wet ro' })
  })
})

describe('reading fields from a reply', () => {
  it('finds fields wherever they are, by key or by label, and tidies them', () => {
    const v = collectValues('character', {
      basics: { Pronouns: 'he/him', 'Age or birth date': 52 },
      looks: { hair: '  Grey,\n cropped  ' },
      'Sample lines of dialogue': ['"Pay first."', '"Then we talk."'],
      aliases: ['Old Brann', 'old brann', 'the Ferryman'],
      nonsense: 'ignored',
      description: 'One.\n\n\n\nTwo.'
    })
    expect(v).toEqual({
      pronouns: 'he/him',
      age: '52',
      hair: 'Grey, cropped',
      sampleLines: '"Pay first."\n"Then we talk."',
      aliases: 'Old Brann, the Ferryman',
      description: 'One.\n\nTwo.'
    })
  })

  it('has only the kind’s own fields', () => {
    expect(collectValues('item', { powers: 'Cuts anything', hair: 'none' })).toEqual({ powers: 'Cuts anything' })
    expect(profileKeys('group')).toEqual(['name', 'aliases', 'summary', 'description', 'category', 'goals', 'ranks', 'rivals', 'customs', 'history'])
  })

  it('knows which field is being written', () => {
    expect(writingField('character', { path: ['drafted', 'Core traits'], text: 'Stub' })).toEqual({ key: 'traits', text: 'Stub' })
    expect(writingField('character', { path: ['drafted', 'traits'], text: 'Stub' }, ['hair'])).toBeNull()
    expect(writingField('character', { path: ['drafted', 'mystery'], text: 'x' })).toBeNull()
  })

  it('keeps names and short fields on one line', () => {
    expect(cleanValue('character', 'name', ' Brann\n Holt ')).toBe('Brann Holt')
    expect(cleanValue('character', 'hair', 'Grey\nand short')).toBe('Grey and short')
    expect(cleanValue('character', 'sampleLines', '"One."\n\n\n"Two."')).toBe('"One."\n\n"Two."')
  })
})

describe('Flesh out', () => {
  it('fills only empty fields, so his words (and anything already there) are left alone', () => {
    const values = { name: 'Brann', hair: 'Grey, his own words', eyes: '  ', build: '' }
    expect(fleshOutTargets('character', ['build', 'face', 'hair', 'eyes', 'hair', 'unknown'], values)).toEqual(['build', 'face', 'eyes'])
  })

  it('keeps only suggestions for the fields it was asked about', () => {
    expect(fleshOutValues('character', { build: 'Broad', hair: 'Black', face: '' }, ['build', 'face'])).toEqual({ build: 'Broad' })
  })
})

describe('Give me options', () => {
  it('returns exactly three different options, or none', () => {
    expect(pickThree(['A', 'B', 'a', 'C', 'D'])).toEqual(['A', 'B', 'C'])
    expect(pickThree(['A', 'B', 'b'])).toBeNull()
    expect(pickThree([])).toBeNull()
  })

  it('reads options from JSON, or from a numbered list', () => {
    expect(optionsFrom('character', 'origin', { options: ['One', 2, null, 'Three'] })).toEqual(['One', '2', 'Three'])
    expect(optionsFrom('character', 'origin', { choices: ['One'] })).toEqual(['One'])
    expect(optionsFromText('character', 'origin', 'Here you go:\n1. Born on the river.\n2. Raised in the barracks,\nthen sold.\n3) "A foundling."')).toEqual([
      'Born on the river.',
      'Raised in the barracks,\nthen sold.',
      'A foundling.'
    ])
  })
})

describe('Interview', () => {
  it('turns a reply into a line of dialogue', () => {
    expect(interviewReply('Brann: "The Duke? A thief with a crown."', 'Brann Holt')).toBe('The Duke? A thief with a crown.')
    expect(interviewReply('**Brann Holt**: Ask me tomorrow.', 'Brann Holt')).toBe('Ask me tomorrow.')
    expect(interviewReply('"Pay first," he said. "Then talk."', 'Brann')).toBe('"Pay first," he said. "Then talk."')
    expect(interviewReply('“The river keeps', 'Brann', true)).toBe('The river keeps')
  })
})

describe('entries', () => {
  const entry = {
    name: 'Brann',
    aliases: ['Old Brann'],
    summary: 'A ferryman',
    description: '',
    fields: { hair: 'Grey', eyes: '' }
  } as unknown as Entry

  it('reads a profile from an entry, and writes only the fields given', () => {
    expect(valuesOf('character', entry)).toEqual({ name: 'Brann', aliases: 'Old Brann', summary: 'A ferryman', hair: 'Grey' })
    expect(toInput('character', { name: ' Brann  Holt ', aliases: 'A, b,, A', hair: 'Grey', unknown: 'x' })).toEqual({
      name: 'Brann Holt',
      aliases: ['A', 'b'],
      fields: { hair: 'Grey' }
    })
    expect(toInput('character', { summary: 'One line' })).toEqual({ summary: 'One line' })
  })
})
