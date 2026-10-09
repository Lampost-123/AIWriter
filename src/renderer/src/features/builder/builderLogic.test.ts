import { describe, expect, it } from 'vitest'
import type { Entry } from '@shared/types'
import { MOTIF_IDS } from '@shared/motifs'
import {
  aiAfterSave,
  arrivalOrder,
  cardsOf,
  countWords,
  EXAMPLES,
  profileCounts,
  stepArt,
  stepCounts,
  wideKeys,
  fleshOutKeys,
  hasSampleLine,
  labelOf,
  markOf,
  mergeSuggestions,
  notesToOfferBack,
  openSuggestions,
  originNow,
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

  it('offers back the notes a passage replaced only when they are worth having', () => {
    const typed = { notes: 'A ferryman who owes everyone', jobId: null, done: null }
    expect(notesToOfferBack(typed, 'Brann leaned on the rail.')).toBe(true)
    expect(notesToOfferBack(undefined, 'Brann leaned on the rail.')).toBe(false)
    expect(notesToOfferBack({ ...typed, notes: '  ' }, 'Brann leaned on the rail.')).toBe(false)
    // The same passage selected again, a build using the notes, or one that saved a character from them.
    expect(notesToOfferBack({ ...typed, notes: 'Brann leaned on the rail. ' }, 'Brann leaned on the rail.')).toBe(false)
    expect(notesToOfferBack({ ...typed, jobId: 'j1' }, 'Brann leaned on the rail.')).toBe(false)
    expect(notesToOfferBack({ ...typed, done: { entryId: 'e1' } }, 'Brann leaned on the rail.')).toBe(false)
    // A build that stopped before it saved anything leaves the notes worth having.
    expect(notesToOfferBack({ ...typed, done: { entryId: null } }, 'Brann leaned on the rail.')).toBe(true)
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

  it('knows who the words in a field come from, so Undo puts them back as theirs', () => {
    const saved = entry({
      summary: 'Runs the ferry',
      fields: { hair: 'Grey', eyes: 'Blue', build: 'Broad' },
      fieldOrigins: { summary: 'text', hair: 'ai', eyes: 'adam' }
    })
    const base = { summary: 'Runs the ferry', hair: 'Grey', eyes: 'Blue', build: 'Broad' }
    const ai = { hair: 'Grey', scars: 'One across the jaw' }
    // As saved: read from the story, the AI's, his, or the entry's own when the field has none.
    expect(originNow('summary', 'Runs the ferry', saved, base, ai)).toBe('text')
    expect(originNow('hair', 'Grey', saved, base, ai)).toBe('ai')
    expect(originNow('eyes', 'Blue', saved, base, ai)).toBe('adam')
    expect(originNow('build', 'Broad', saved, base, ai)).toBe('adam')
    // Changed since the last save: his, unless they are AI words he kept that aren't saved yet.
    expect(originNow('summary', 'Runs the ferry, badly', saved, base, ai)).toBe('adam')
    expect(originNow('scars', 'One across the jaw', saved, base, ai)).toBe('ai')
    expect(originNow('scars', 'One across the jaw', null, {}, ai)).toBe('ai')
    expect(originNow('eyes', 'Green', null, {}, ai)).toBe('adam')
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

describe('the overhauled builder: cards, examples, drawings and progress', () => {
  const kinds = ['character', 'place', 'group', 'item'] as const

  it('puts every field of every step in exactly one card, in the step’s order', () => {
    for (const kind of kinds) {
      for (const s of stepsFor(kind)) {
        const cards = cardsOf(kind, s)
        const keys = cards.flatMap((c) => c.keys)
        expect(keys.sort()).toEqual(s.fields.map((f) => f.key).sort())
        for (const c of cards) expect(c.keys.length).toBeGreaterThan(0)
      }
    }
    const basics = stepsFor('character')[0]
    expect(cardsOf('character', basics).map((c) => c.title)).toEqual(['Name', 'The essentials', 'In your own words'])
    // A step of one card needs no heading of its own.
    const senses = stepsFor('place').find((s) => s.id === 'senses')!
    expect(cardsOf('place', senses)).toEqual([{ id: 'rest', title: '', hint: '', keys: ['senses'] }])
  })

  it('shows an example in each box, marked as one, short enough for a one-line box', () => {
    const looks = stepsFor('character').find((s) => s.id === 'looks')!
    expect(looks.fields.find((f) => f.key === 'hair')!.placeholder).toBe('e.g. Cropped short, grey at the temples')
    // Words that are instructions, not examples, stay as they were.
    const voice = stepsFor('character').find((s) => s.id === 'voice')!
    expect(voice.fields.find((f) => f.key === 'speech')!.placeholder).toBe('Sentence length, vocabulary, dialect')
    for (const [kind, byKey] of Object.entries(EXAMPLES)) {
      const keys = new Set(stepsFor(kind as 'character').flatMap((s) => s.fields.map((f) => f.key)))
      for (const [key, text] of Object.entries(byKey!)) {
        expect(keys.has(key), `${kind}.${key}`).toBe(true)
        expect(text.length).toBeLessThanOrEqual(60)
      }
    }
  })

  it('gives every step a drawing from the library', () => {
    for (const kind of kinds) for (const s of stepsFor(kind)) expect(MOTIF_IDS).toContain(stepArt(kind, s.id))
  })

  it('counts how far along a step and the whole profile are', () => {
    const looks = stepsFor('character').find((s) => s.id === 'looks')!
    expect(stepCounts('character', looks, { hair: 'Grey', eyes: ' ' }, 0)).toEqual({ filled: 1, total: 8 })
    const rel = stepsFor('character').find((s) => s.id === 'relationships')!
    expect(stepCounts('character', rel, {}, 2)).toEqual({ filled: 1, total: 1 })
    const all = profileCounts('character', { name: 'Brann', hair: 'Grey' }, 1)
    expect(all.filled).toBe(3)
    expect(all.total).toBe(profileKeys('character').length + 1)
    const review = stepsFor('character').find((s) => s.id === 'review')!
    expect(stepCounts('character', review, { name: 'Brann', hair: 'Grey' }, 1)).toEqual(all)
    expect(countWords({ filled: 0, total: 8 }, looks)).toBe('Not started')
    expect(countWords({ filled: 3, total: 8 }, looks)).toBe('3 of 8')
    expect(countWords({ filled: 8, total: 8 }, looks)).toBe('Done')
    expect(countWords({ filled: 0, total: 1 }, rel)).toBe('Nobody yet')
  })

  it('lets paragraphs that would sit alone take the whole row, and keeps one-line boxes at half', () => {
    const f = (key: string, type: 'line' | 'text' | 'list' | 'name') => ({ key, type })
    expect([...wideKeys([f('traits', 'text'), f('values', 'text'), f('flaws', 'text')])]).toEqual(['flaws'])
    expect([...wideKeys([f('fears', 'text'), f('desires', 'text')])]).toEqual([])
    expect([...wideKeys([f('pronouns', 'line'), f('age', 'line'), f('role', 'line')])]).toEqual([])
    expect([...wideKeys([f('name', 'name'), f('aliases', 'list')])].sort()).toEqual(['aliases', 'name'])
    expect([...wideKeys([f('summary', 'line'), f('description', 'text')])].sort()).toEqual(['description', 'summary'])
  })
})
