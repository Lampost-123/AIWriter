import { describe, expect, it } from 'vitest'
import { parseAnswer } from '@shared/answerBlocks'
import {
  asksForIdeas,
  durationWords,
  factParts,
  followUpsOf,
  leadWords,
  optionWords,
  readyWords,
  starterCards,
  withBeat,
  withoutBeat
} from './answerView'
import { EXAMPLES } from './askWords'

describe('an answer’s time', () => {
  it('says a time short', () => {
    expect(durationWords(300)).toBe('1s')
    expect(durationWords(59_400)).toBe('59s')
    expect(durationWords(65_000)).toBe('1m 05s')
  })
})

describe('a fact', () => {
  it('sets the scene it is from apart', () => {
    expect(factParts('[[Edric]]’s age isn’t given. Closest: “failing hands” (Ch 1, Sc 1).')).toEqual({
      text: '[[Edric]]’s age isn’t given. Closest: “failing hands”.',
      scene: 'Ch 1, Sc 1'
    })
    expect(factParts('Mara is 34 (Book 2, Ch 3, Sc 1 “The Ford”)')).toEqual({ text: 'Mara is 34', scene: 'Book 2, Ch 3, Sc 1 “The Ford”' })
    expect(factParts('Named in the memory (its entry).')).toEqual({ text: 'Named in the memory (its entry).', scene: null })
  })
})

describe('the lead with a verdict chip', () => {
  it('drops the verdict’s own word, which the chip says', () => {
    expect(leadWords('Yes. Mara is 34.', 'yes')).toBe('Mara is 34.')
    expect(leadWords('No, she never says.', 'no')).toBe('She never says.')
    expect(leadWords('**Yes.** Mara is 34.', 'yes')).toBe('Mara is 34.')
    expect(leadWords('Not in memory yet.', 'unknown')).toBe('')
    expect(leadWords('Not in memory yet: her age is never given.', 'unknown')).toBe('Her age is never given.')
  })

  it('keeps every word that isn’t the verdict alone', () => {
    expect(leadWords('The memory doesn’t say how old she is.', 'unknown')).toBe('The memory doesn’t say how old she is.')
    expect(leadWords('Nobody says.', 'no')).toBe('Nobody says.')
    expect(leadWords('Yes. Mara is 34.', undefined)).toBe('Yes. Mara is 34.')
  })
})

describe('what an answer offers', () => {
  const answer = [
    'Three ways it could break.',
    '::options',
    '- **The lamp fails**: [[Edric]] hides his hands.',
    '- **The early ferry**: Wren misses the crossing.',
    '- **A letter**: it comes too late.',
    '::',
    '::next',
    '- Which fits [[Ch 2|chapter two]] better?',
    '- More like the first',
    '- Which fits [[Ch 2|chapter two]] better?',
    '- Draft it',
    '- And another',
    '::'
  ].join('\n')

  it('has up to three follow-ups, each once, names as words', () => {
    expect(followUpsOf(parseAnswer(answer))).toEqual(['Which fits chapter two better?', 'More like the first', 'Draft it'])
  })

  it('says what is ready', () => {
    const blocks = parseAnswer(answer)
    expect(readyWords('complete', blocks, [{ id: 'a' }, { id: 'b' }] as never)).toBe('Answer ready: 3 options, 2 changes')
    expect(readyWords('complete', parseAnswer('Just words.'), undefined)).toBe('Answer ready')
    expect(readyWords('complete', parseAnswer('Fine.'), [{ id: 'a' }] as never)).toBe('Answer ready: 1 change')
    expect(readyWords('stopped', blocks, undefined)).toBe('Stopped')
    expect(readyWords('error', blocks, undefined)).toBe('Failed')
  })

  it('knows a question asking for ideas', () => {
    expect(asksForIdeas('Brainstorm a few tavern names')).toBe(true)
    expect(asksForIdeas('What could go wrong at the light?')).toBe(true)
    expect(asksForIdeas('How old is Mara?')).toBe(false)
  })
})

describe('an option used', () => {
  it('is one line of words, names without brackets', () => {
    expect(optionWords('The lamp fails:', '[[Edric]] hides his *failing* hands.')).toBe('The lamp fails — Edric hides his failing hands.')
    expect(optionWords('**The Salt Stair**', '')).toBe('The Salt Stair')
    // A plain list's idea, titled by its first words: its words once (the old answer format, FORMAT off).
    expect(optionWords('End on the line of…', 'End on the line of dialogue instead.')).toBe('End on the line of dialogue instead.')
  })

  it('goes at the end of the beats, and comes out again only as it went in', () => {
    expect(withBeat(['Wren climbs', ''], 'The lamp fails')).toEqual({ beats: ['Wren climbs', 'The lamp fails'], index: 2 })
    expect(withoutBeat(['Wren climbs', 'The lamp fails'], 'The lamp fails', 2)).toEqual(['Wren climbs'])
    // Beats moved since: its copy comes out wherever it is now.
    expect(withoutBeat(['The lamp fails', 'Wren climbs'], 'The lamp fails', 2)).toEqual(['Wren climbs'])
    // Taken out by hand already: nothing else is touched.
    expect(withoutBeat(['Wren climbs'], 'The lamp fails', 2)).toEqual(['Wren climbs'])
  })
})

describe('the empty state', () => {
  it('names the open scene’s people, else asks the examples', () => {
    const named = starterCards(['Wren', 'Edric'], EXAMPLES)
    expect(named.map((c) => c.kind)).toEqual(['brainstorm', 'check', 'tighten', 'spelling'])
    expect(named[0].question).toBe('What would Wren do if Edric lied to them?')
    expect(named[1].question).toBe('Did I already say how old Wren is?')
    expect(starterCards(['Wren'], EXAMPLES)[0].question).toBe('What could go wrong for Wren in this scene?')
    expect(starterCards([], EXAMPLES).map((c) => c.question)).toEqual([EXAMPLES[0], EXAMPLES[1], EXAMPLES[3], EXAMPLES[2]])
  })
})
