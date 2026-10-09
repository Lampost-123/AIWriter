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
  ownInput,
  partsBegun,
  pickThree,
  profileKeys,
  questionsFrom,
  questionsFromText,
  quickStartView,
  toInput,
  valuesOf,
  writingField
} from './profile'

describe('the follow-up questions in a reply', () => {
  it('reads them from JSON, one line each, without numbers, quotes or repeats, five at most', () => {
    expect(questionsFrom({ questions: ['1. What does she want?', '"Who is her father?"', 'what does she WANT?', '  Where\n does she sleep?  '] })).toEqual([
      'What does she want?',
      'Who is her father?',
      'Where does she sleep?'
    ])
    expect(questionsFrom({ list: ['A?', 'B?'] })).toEqual(['A?', 'B?'])
    expect(questionsFrom({ questions: [{ question: 'Objects too?' }, 7, null, ''] })).toEqual(['Objects too?'])
    expect(questionsFrom({ questions: ['A?', 'B?', 'C?', 'D?', 'E?', 'F?'] })).toHaveLength(5)
    expect(questionsFrom(null)).toEqual([])
    expect(questionsFrom({ questions: ['x'.repeat(300)] })[0]).toHaveLength(240)
  })

  it('reads a plain list too: each line that is a question', () => {
    expect(questionsFromText('Here you go:\n1. Who raised her?\n2. Does she keep a weapon?\nThat is all.')).toEqual(['Who raised her?', 'Does she keep a weapon?'])
  })
})

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

  it('counts only whole words: a name or a number inside a longer one is not his', () => {
    expect(fromHisWords('Marat is a smuggler.', 'Mara')).toBe(false)
    expect(fromHisWords('He owes 400 crowns.', '40')).toBe(false)
    expect(fromHisWords('Hannah keeps the inn.', 'Ann')).toBe(false)
    expect(fromHisWords('Hannah keeps the inn.', 'Hannah')).toBe(true)
    expect(fromHisWords('Brann’s ferry crosses the Narrows.', 'Brann')).toBe(true)
    expect(fromHisWords(NOTES, 'ex-soldier')).toBe(true)
    const v = quickStartView('character', 'Marat is a smuggler.', parsePartial('{"fromNotes": {"name": "Mara"}}'))
    expect(v.values.name).toBe('Mara')
    expect(v.fromNotes).toEqual([])
  })

  it('does not count a reply stuck repeating his words as his', () => {
    expect(fromHisWords('He runs the ferry.', 'He runs the ferry.')).toBe(true)
    expect(fromHisWords('He runs the ferry.', 'He runs the ferry. He runs the ferry.')).toBe(false)
  })

  it("reads a Quick start reply: his words are his, and win over the AI's for the same field", () => {
    const reply = JSON.stringify({
      fromNotes: {
        name: 'Brann Holt',
        summary: 'Brann Holt runs the ferry across the Narrows.',
        marks: 'Missing two fingers on his left hand.'
      },
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
    // Only the name is his: "Brann" is a word of his notes, even under "drafted".
    expect(v.fromNotes).toEqual(['name'])
  })

  it('lists the fields in the order they first arrived, so a profile shown as it arrives only grows at the end', () => {
    const cut =
      '{"fromNotes": {"name": "Brann Holt", "marks": "Missing two fingers on his left hand."}, "drafted": {"aliases": "Old Brann", "summary": "A ferryman.", "hair": "Gr'
    const v = quickStartView('character', NOTES, parsePartial(cut))
    expect(Object.keys(v.values)).toEqual(['name', 'marks', 'aliases', 'summary'])
    expect(v.writing).toEqual({ key: 'hair', text: 'Gr' })
    // His words win wherever they come, and a field keeps the place where it first came.
    const late =
      '{"drafted": {"name": "Someone", "hair": "Grey"}, "fromNotes": {"marks": "Missing two fingers on his left hand.", "name": "Brann Holt"}}'
    const w = quickStartView('character', NOTES, parsePartial(late))
    expect(Object.keys(w.values)).toEqual(['name', 'hair', 'marks'])
    expect(w.values.name).toBe('Brann Holt')
    expect(w.fromNotes).toEqual(['name', 'marks'])
  })

  it('never cuts his words short, though a runaway line from the AI is', () => {
    const long = `Brann Holt runs the ferry, ${'rain or shine, '.repeat(30)}and always has.`
    expect(cleanValue('character', 'summary', long, true)).toBe(long)
    expect(cleanValue('character', 'summary', long)).toHaveLength(300)
    const reply = JSON.stringify({ fromNotes: { name: 'Brann Holt', summary: long } })
    expect(quickStartView('character', long, parsePartial(reply)).values.summary).toBe(long)
  })

  it('keeps a long passage of his whole, and cuts the same words short when they are not his', () => {
    const winter = (i: number): string => `Winter ${i + 1}: he hauled ${i + 3} carts across the river and nobody thanked him.`
    const past = Array.from({ length: 150 }, (_, i) => winter(i)).join(' ')
    expect(past.length).toBeGreaterThan(10_000)
    expect(cleanValue('character', 'pastEvents', past, true)).toBe(past)
    const reply = JSON.stringify({ fromNotes: { name: 'Brann Holt', pastEvents: past } })
    const v = quickStartView('character', `Brann Holt runs the ferry.\n${past}`, parsePartial(reply))
    expect(v.values.pastEvents).toBe(past)
    expect(v.fromNotes).toEqual(['name', 'pastEvents'])
    const w = quickStartView('character', 'Brann Holt runs the ferry.', parsePartial(reply))
    expect(w.values.pastEvents.length).toBeLessThanOrEqual(6000)
    expect(w.fromNotes).toEqual(['name'])
  })

  it('reads a reply without the two parts, his words still his, and shows the field being written', () => {
    const v = quickStartView('place', 'A port town', parsePartial('{"name": "Saltmere", "atmosphere": "Salt and wet ro'))
    expect(v.values).toEqual({ name: 'Saltmere' })
    expect(v.fromNotes).toEqual([])
    expect(v.writing).toEqual({ key: 'atmosphere', text: 'Salt and wet ro' })

    const long = `Brann Holt runs the ferry across the Narrows, ${'rain or shine, '.repeat(30)}and always has.`
    const notes = `${long}\nA grumpy ex-soldier who owes the Duke money.`
    const flat = {
      name: 'Brann Holt',
      summary: long,
      traits: 'A grumpy ex-soldier who owes the Duke money.',
      hair: 'Grey and cropped close'
    }
    const w = quickStartView('character', notes, parsePartial(JSON.stringify(flat)))
    expect(w.values).toEqual(flat)
    expect(w.fromNotes).toEqual(['name', 'summary', 'traits'])
    expect(partsBegun(parsePartial(JSON.stringify(flat)).value)).toBe(0)
  })

  it('counts words copied from his notes as his wherever the model put them', () => {
    const reply = JSON.stringify({
      fromNotes: { traits: 'Grumpy and proud' },
      drafted: {
        name: 'Brann Holt',
        traits: 'A grumpy ex-soldier who owes the Duke money.',
        marks: 'Missing two fingers on his left hand.',
        hair: 'Grey'
      }
    })
    const v = quickStartView('character', NOTES, parsePartial(reply))
    expect(v.values.traits).toBe('A grumpy ex-soldier who owes the Duke money.')
    expect(v.fromNotes).toEqual(['traits', 'name', 'marks'])
  })

  it('reads the two parts when the model wraps them in an outer object', () => {
    const parts = { fromNotes: { name: 'Brann Holt', marks: 'Missing two fingers on his left hand.' }, drafted: { hair: 'Grey' } }
    const reply = JSON.stringify({ character: parts })
    const v = quickStartView('character', NOTES, parsePartial(reply))
    expect(v.values).toEqual({ name: 'Brann Holt', marks: 'Missing two fingers on his left hand.', hair: 'Grey' })
    expect(v.fromNotes).toEqual(['name', 'marks'])
    expect(partsBegun(parsePartial(reply).value)).toBe(2)
    expect(partsBegun(parsePartial('{"character": {"from_notes": {"name": "Br').value)).toBe(1)
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
    expect(profileKeys('group').join(' ')).toBe('name aliases summary description category goals ranks rivals customs history')
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
    const list = 'Here you go:\n1. Born on the river.\n2. Raised in the barracks,\nthen sold.\n3) "A foundling."'
    const options = ['Born on the river.', 'Raised in the barracks,\nthen sold.', 'A foundling.']
    expect(optionsFromText('character', 'origin', list)).toEqual(options)
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

  it("saves Adam's own words as he wrote them, and the AI's tidied", () => {
    const own = {
      name: ' Brann  Holt ',
      aliases: 'Old Brann; "the Ferryman", Brann, brann',
      summary: 'Runs  the ferry ',
      hair: 'Grey\nand short'
    }
    expect(ownInput('character', own)).toEqual({
      name: 'Brann  Holt',
      aliases: ['Old Brann; "the Ferryman"', 'Brann'],
      summary: 'Runs  the ferry ',
      fields: { hair: 'Grey\nand short' }
    })
    const tidied = { name: 'Brann Holt', aliases: ['Old Brann', 'the Ferryman', 'Brann'], summary: 'Runs the ferry' }
    expect(toInput('character', own)).toMatchObject(tidied)
  })

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
