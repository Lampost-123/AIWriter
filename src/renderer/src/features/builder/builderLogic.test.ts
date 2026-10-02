import { describe, expect, it } from 'vitest'
import type { Entry } from '@shared/types'
import {
  aiAfterSave,
  arrivalOrder,
  fleshOutKeys,
  hasSampleLine,
  labelOf,
  markOf,
  mergeSuggestions,
  openSuggestions,
  patchFor,
  profileKeys,
  shownValue,
  stepStatus,
  stepsFor,
  valuesOf,
  withSampleLine
} from './builderLogic'

const entry = (over: Partial<Entry> = {}): Entry =>
  ({
    id: 'e1',
    kind: 'character',
    name: 'Brann Holt',
    aliases: ['Old Brann'],
    summary: 'Runs the ferry',
    description: '',
    tags: [],
    notes: '',
    fields: { hair: 'Grey', eyes: '' },
    origin: 'adam',
    fieldOrigins: { hair: 'ai' },
    byHand: true,
    ...over
  }) as Entry

describe('the steps', () => {
  it("follow the character's profile, with relationships and a review at the end", () => {
    expect(stepsFor('character').map((s) => s.label)).toEqual([
      'Basics',
      'Looks',
      'Personality',
      'Backstory and secrets',
      'Goals and arc',
      'Voice',
      'Relationships',
      'Review'
    ])
    const basics = stepsFor('character')[0].fields.map((f) => f.key)
    expect(basics).toEqual(['name', 'aliases', 'pronouns', 'age', 'role', 'summary', 'description'])
    expect(stepsFor('character')[0].fields.find((f) => f.key === 'role')?.type).toBe('role')
  })

  it('are fewer for places, groups and items, and cover every one of their fields', () => {
    expect(stepsFor('place').map((s) => s.label)).toEqual([
      'Basics',
      'Look and feel',
      'Sights, sounds and smells',
      'History',
      'Who is there',
      'Review'
    ])
    expect(stepsFor('group')).toHaveLength(4)
    expect(stepsFor('item')).toHaveLength(4)
    const place = ['aliases', 'atmosphere', 'description', 'geography', 'history', 'name', 'people', 'senses', 'summary']
    expect(profileKeys('place').sort()).toEqual(place)
    expect(profileKeys('item')).toEqual(['name', 'aliases', 'category', 'summary', 'description', 'powers', 'limits', 'origin'])
    expect(labelOf('group', 'rivals')).toBe('Rivals and allies')
  })

  it('show as empty, partly done or complete', () => {
    const [basics, looks, , , , , relationships, review] = stepsFor('character')
    expect(stepStatus('character', looks, {}, 0)).toBe('empty')
    expect(stepStatus('character', looks, { hair: 'Grey', eyes: '   ' }, 0)).toBe('partly')
    const all = Object.fromEntries(looks.fields.map((f) => [f.key, 'x']))
    expect(stepStatus('character', looks, all, 0)).toBe('complete')
    expect(stepStatus('character', basics, { name: 'Brann' }, 0)).toBe('partly')
    expect(stepStatus('character', relationships, {}, 0)).toBe('empty')
    expect(stepStatus('character', relationships, {}, 2)).toBe('complete')
    expect(stepStatus('character', review, { name: 'Brann' }, 0)).toBe('partly')
  })
})

describe('saving as Adam types', () => {
  it('reads an entry into the profile', () => {
    expect(valuesOf('character', entry())).toEqual({ name: 'Brann Holt', aliases: 'Old Brann', summary: 'Runs the ferry', hair: 'Grey' })
  })

  it('sends only what changed since the last save', () => {
    const base = { name: 'Brann', hair: 'Grey' }
    expect(patchFor('character', base, base)).toBeNull()
    const typed = { name: 'Brann Holt ', hair: 'Grey', eyes: 'Blue', aliases: 'Old Brann, old brann, Ferryman' }
    expect(patchFor('character', typed, base)).toEqual({
      input: { name: 'Brann Holt', aliases: ['Old Brann', 'Ferryman'], fields: { eyes: 'Blue' } },
      sent: { name: 'Brann Holt ', eyes: 'Blue', aliases: 'Old Brann, old brann, Ferryman' }
    })
    // A field emptied is saved empty.
    expect(patchFor('character', { name: 'Brann' }, base)?.input).toEqual({ fields: { hair: '' } })
  })

  it("keeps the last name while a new one is being typed over it", () => {
    expect(patchFor('character', { name: '  ', hair: 'Grey' }, { name: 'Brann', hair: 'Grey' })).toBeNull()
  })
})

describe('suggestions', () => {
  it("never cover Adam's words: one he typed first wins", () => {
    expect(openSuggestions({ hair: 'Black', eyes: 'Blue', face: '' }, { hair: 'Grey', eyes: ' ' })).toEqual({ eyes: 'Blue' })
  })

  it('stay gone once Adam has kept or discarded them, though Flesh out sends them all again as it writes', () => {
    const decided = new Set(['build'])
    const shown = mergeSuggestions({ eyes: 'Blue' }, { build: 'Broad', face: 'Lean' }, decided)
    expect(shown).toEqual({ eyes: 'Blue', face: 'Lean' })
    const later = mergeSuggestions(shown, { build: 'Broad', face: 'Lean', hair: 'Red' }, decided)
    expect(later).toEqual({ eyes: 'Blue', face: 'Lean', hair: 'Red' })
  })

  it('are asked for only for empty fields without one waiting', () => {
    const looks = stepsFor('character')[1]
    const keys = fleshOutKeys(looks, { hair: 'Grey', build: '' }, { eyes: 'Blue' })
    expect(keys).not.toContain('hair')
    expect(keys).not.toContain('eyes')
    expect(keys).toContain('build')
    expect(keys).toHaveLength(looks.fields.length - 2)
  })
})

describe('Quick start', () => {
  it('shows a profile in the order it arrives, so it only ever grows at the end', () => {
    let order = arrivalOrder([], { name: 'Brann', summary: 'Runs the ferry', hair: '' })
    expect(order).toEqual(['name', 'summary'])
    // Fields already shown keep their places, whatever order the next message lists them in.
    order = arrivalOrder(order, { hair: 'Grey', summary: 'Runs the ferry', name: 'Brann', aliases: 'Old Brann' })
    expect(order).toEqual(['name', 'summary', 'hair', 'aliases'])
    expect(arrivalOrder(order, { name: 'Brann' })).toEqual(order)
  })

  it('names the role as its picker does', () => {
    expect(shownValue('role', 'supporting')).toBe('Supporting')
    expect(shownValue('role', 'Protagonist')).toBe('Protagonist')
    expect(shownValue('role', 'mentor')).toBe('Mentor')
    expect(shownValue('hair', 'grey')).toBe('grey')
  })
})

describe('"Drafted by AI"', () => {
  it("shows on the AI's words until Adam changes them, then says he did", () => {
    const ai = { hair: 'Grey' }
    expect(markOf('hair', 'Grey', ai)).toBe('ai')
    expect(markOf('hair', 'Grey and thin', ai)).toBe('edited')
    expect(markOf('eyes', 'Blue', ai)).toBeNull()
  })

  it('follows what each save says about who wrote each field', () => {
    const saved = entry({ fields: { hair: 'Grey', eyes: 'Blue' }, fieldOrigins: { hair: 'ai', eyes: 'adam' } })
    expect(aiAfterSave('character', { eyes: 'Green' }, saved)).toEqual({ hair: 'Grey', eyes: '' })
  })
})

describe('sample lines from the interview', () => {
  it('adds a reply as a quoted row on its own', () => {
    expect(withSampleLine('', 'Pay first.')).toBe('"Pay first."')
    expect(withSampleLine('"One."\n', 'Two,\nthree.')).toBe('"One."\n"Two, three."')
    expect(withSampleLine('"One."', '"Pay first," he said.')).toBe('"One."\n"Pay first," he said.')
    expect(withSampleLine('"One."', '  ')).toBe('"One."')
  })

  it('knows a reply that is already there', () => {
    expect(hasSampleLine('"One."\n"Pay first."', 'Pay first.')).toBe(true)
    expect(hasSampleLine('"One."', 'Pay first.')).toBe(false)
  })
})
