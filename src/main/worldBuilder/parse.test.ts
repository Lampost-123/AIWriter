import { describe, expect, it } from 'vitest'
import {
  conflictItems,
  hasOverviewLists,
  overviewItems,
  profileExtras,
  readProfile,
  relationshipItems,
  replyItems,
  sentencesNaming,
  splitSummary,
  textAbout,
  themesReply
} from './parse'
import { mergePlan, parentsFirst } from './run'
import { existingText, planText } from './prompts'

const SUMMARY = `Mara Venn is a smuggler captain who owes the Salt Guild a fortune. Tobin is Mara Venn's younger brother.
Saltmarsh is a port town in the Grey Coast. Magic always costs blood.`

describe("the first look's reply", () => {
  it('reads every kind, however the model named its lists, and leaves out what has no name', () => {
    const items = overviewItems({
      Characters: [{ name: 'Mara Venn', aliases: ['Mara', 'mara venn'], about: 'a smuggler captain' }, 'Tobin', { about: 'nameless' }],
      locations: [{ name: 'Saltmarsh', in: 'The Grey Coast' }],
      factions: ['The Salt Guild'],
      lore_and_rules: [
        { name: 'Blood magic', rule: true },
        { name: 'Tide songs', rule: 'no' }
      ],
      events: [{ name: 'The Great Flood', when: 'in the year 312' }],
      plot_threads: [{ title: 'Who sank the Merrow?' }],
      terms: [{ word: 'drowner', meaning: 'a ghost from the sea' }]
    })
    expect(items.map((i) => `${i.kind}:${i.name}`)).toEqual([
      'character:Mara Venn',
      'character:Tobin',
      'place:Saltmarsh',
      'group:The Salt Guild',
      'lore:Blood magic',
      'lore:Tide songs',
      'event:The Great Flood',
      'thread:Who sank the Merrow?',
      'glossary:drowner'
    ])
    expect(items[0].aliases).toEqual(['Mara'])
    expect(items[2].in).toBe('The Grey Coast')
    expect(items[4].rule).toBe(true)
    expect(items[5].rule).toBe(false)
    expect(items[6].when).toBe('in the year 312')
    expect(items[8].about).toBe('a ghost from the sea')
  })

  it('knows a reply that has none of the lists', () => {
    expect(hasOverviewLists({ characters: [] })).toBe(true)
    expect(hasOverviewLists({ answer: 'a fine world' })).toBe(false)
    expect(hasOverviewLists(null)).toBe(false)
  })

  it('merges the same thing named in two parts of a long summary', () => {
    const plan = mergePlan([
      ...overviewItems({ characters: [{ name: 'Mara Venn', about: 'a captain' }], places: [{ name: 'Saltmarsh' }] }),
      ...overviewItems({ characters: [{ name: 'Mara', aliases: ['Captain Venn'] }], places: [{ name: 'Saltmarsh', in: 'Grey Coast' }] })
    ])
    expect(plan.map((p) => p.name)).toEqual(['Mara Venn', 'Saltmarsh'])
    expect(plan[0].aliases).toEqual(['Mara', 'Captain Venn'])
    expect(plan[1].in).toBe('Grey Coast')
  })

  it('lays out the places others are inside first', () => {
    const plan = overviewItems({
      places: [{ name: 'The Anchor Inn', in: 'Saltmarsh' }, { name: 'Saltmarsh', in: 'The Grey Coast' }, { name: 'The Grey Coast' }]
    })
    expect(parentsFirst(plan).map((p) => p.name)).toEqual(['The Grey Coast', 'Saltmarsh', 'The Anchor Inn'])
  })
})

describe('the summary', () => {
  it('stays whole when it fits, and goes in parts of whole paragraphs when it does not', () => {
    expect(splitSummary(SUMMARY, 4000)).toEqual([SUMMARY])
    const long = Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1}. ${'Words of the world go here. '.repeat(20)}`).join('\n')
    const parts = splitSummary(long, 400)
    expect(parts.length).toBeGreaterThan(3)
    expect(parts.join('\n\n').replace(/\s+/g, ' ').trim()).toBe(long.replace(/\s+/g, ' ').trim())
  })

  it('gives each request the paragraphs about what it lays out when the whole summary does not fit', () => {
    expect(textAbout(SUMMARY, ['Tobin'], 4000)).toBe(SUMMARY)
    const long = `${'Mara sails. '.repeat(200)}\nSaltmarsh smells of tar.\n${'The sea is wide. '.repeat(200)}`
    expect(textAbout(long, ['Saltmarsh'], 300)).toBe('Saltmarsh smells of tar.')
  })

  it("finds the sentences naming something, exactly as they're written", () => {
    expect(sentencesNaming(SUMMARY, ['Tobin'])).toEqual(["Tobin is Mara Venn's younger brother."])
    expect(sentencesNaming(SUMMARY, ['Grey Coast'])).toEqual(['Saltmarsh is a port town in the Grey Coast.'])
  })
})

describe('a profile in a reply', () => {
  it("keeps the summary's own words as Adam's, wherever the model put them, and the rest as the AI's", () => {
    const p = readProfile('character', SUMMARY, {
      fromNotes: { name: 'Mara Venn', summary: 'A smuggler captain, invented here.' },
      drafted: { traits: 'Stubborn and quick.', summary: 'Mara Venn is a smuggler captain who owes the Salt Guild a fortune.' }
    })
    expect(p.values.name).toBe('Mara Venn')
    expect(p.values.summary).toBe('Mara Venn is a smuggler captain who owes the Salt Guild a fortune.')
    expect(p.his.sort()).toEqual(['name', 'summary'])
    expect(p.values.traits).toBe('Stubborn and quick.')
  })

  it('takes the name from beside the two parts, as his when the summary has it', () => {
    const p = readProfile('lore', SUMMARY, { name: 'Magic', rule: true, fromNotes: { rules: 'Magic always costs blood.' }, drafted: {} })
    expect(p.values).toMatchObject({ name: 'Magic', rules: 'Magic always costs blood.' })
    expect(p.his.sort()).toEqual(['name', 'rules'])
    expect(profileExtras({ name: 'Magic', rule: true }).rule).toBe(true)
    expect(profileExtras({ name: 'Saltmarsh', in: 'Grey Coast' })).toMatchObject({ in: 'Grey Coast', rule: null })
    expect(profileExtras({ involved: ['Tobin', null, 'Mara'] }).involved).toEqual(['Tobin', 'Mara'])
  })

  it("finds a batch's profiles in its first list", () => {
    expect(replyItems({ places: [{ name: 'A' }, 'junk', { name: 'B' }] })).toEqual([{ name: 'A' }, { name: 'B' }])
    expect(replyItems([{ name: 'A' }])).toEqual([{ name: 'A' }])
    expect(replyItems('nothing')).toEqual([])
  })
})

describe('relationships, themes and disagreements', () => {
  it('reads relationships, leaving out any without both sides', () => {
    expect(
      relationshipItems({
        relationships: [
          { from: 'Tobin', to: 'Mara Venn', type: 'younger brother', feels: 'adores her' },
          { from: 'Tobin', type: 'friend' }
        ]
      })
    ).toEqual([{ from: 'Tobin', to: 'Mara Venn', type: 'younger brother', feels: 'adores her', otherFeels: '' }])
  })

  it('reads themes and tone, and disagreements with a field and what the summary says', () => {
    expect(themesReply({ Themes: 'Debt.', tone: 'Wary.' })).toEqual({ themes: 'Debt.', tone: 'Wary.' })
    expect(themesReply('no')).toEqual({ themes: '', tone: '' })
    expect(
      conflictItems({
        conflicts: [
          { name: 'Mara Venn', field: 'age', summary: '34', quote: 'Mara Venn is 34.' },
          { name: 'Mara Venn', field: 'age' }
        ]
      })
    ).toEqual([{ name: 'Mara Venn', field: 'age', says: '34', quote: 'Mara Venn is 34.' }])
  })
})

describe('what the model is told', () => {
  it("lists the world's names by kind, cutting the longest lists to fit", () => {
    const many = Array.from({ length: 400 }, (_, i) => ({ kind: 'character' as const, name: `Person ${i}`, aliases: [] }))
    const text = existingText([...many, { kind: 'place', name: 'Saltmarsh', aliases: ['the Marsh'] }], 300)
    expect(text).toContain('- Places: Saltmarsh (also: the Marsh)')
    expect(text).toMatch(/- Characters: Person 0; .* \(and \d+ more\)/)
    expect(existingText([])).toBe('Already in the world: nothing yet.')
    expect(planText(overviewItems({ characters: ['Tobin'], glossary: ['drowner'] }))).toBe(
      'Being laid out from the same summary:\n- Characters: Tobin\n- Glossary: drowner'
    )
  })
})
