import { describe, expect, it } from 'vitest'
import { buildCheck, COPY_RUN, findLeaks, scrubText, sourceNames } from './leaks'

// A made-up story, written for these tests.
const STORY = [
  'Mara waited on the quay at Varn Harbour while the ferry came in.',
  'The gulls were loud. She thought of Tobin, who had promised to meet her and had not come.',
  'Rain moved across the bay like a grey curtain drawn by a careless hand.',
  '“You are late,” said Tobin when he came at last, shaking water from his coat.',
  'Mara laughed. Mara always laughed when she was afraid.',
  'They walked up through the town to the Lantern, where the fire was already lit.',
  'He said he would wait, and she said she would see.'
]

describe('the names a story uses', () => {
  const names = sourceNames(STORY, 'The Ferry at Varn')

  it('finds people and places named in the middle of sentences, and possessives as the name', () => {
    expect(names).toContain('Tobin')
    expect(names).toContain('Varn')
    expect(names).toContain('Harbour')
    expect(names).toContain('Lantern')
  })

  it('finds a name only ever at the start of sentences, when it is no ordinary word', () => {
    expect(names).toContain('Mara')
  })

  it('leaves out ordinary words capitalised at the start of sentences, and titles', () => {
    for (const w of ['Rain', 'The', 'They', 'He', 'She', 'You']) expect(names).not.toContain(w)
    expect(sourceNames(['She met Mr Ash and Lady Wren at noon.'])).not.toContain('Mr')
  })

  it('takes the title’s words, but not its little ones, as names (looked for only when capitalised)', () => {
    expect(sourceNames([], 'The Ferry at Varn')).toEqual(new Set(['Ferry', 'Varn']))
  })

  it('does not take a word used mostly in lower case for a name', () => {
    const n = sourceNames(['The rose was red. A rose by the door. They saw Rose once.'])
    expect(n).not.toContain('Rose')
  })
})

describe('checking a recipe against the story', () => {
  const check = buildCheck(STORY, 'The Ferry at Varn')

  it('finds the story’s names, as whole words', () => {
    expect(findLeaks('The lead, Mara, wants to stay in the harbour town.', check)).toEqual([{ kind: 'name', words: 'Mara' }])
    expect(findLeaks("The mentor's debt comes due. Marathon runner.", check)).toEqual([])
  })

  it(`finds ${COPY_RUN} or more words in a row copied from the story, whatever the case and punctuation`, () => {
    const leaks = findLeaks('Weather turns: rain moved across the bay like a grey curtain, and the lead hides.', check)
    expect(leaks).toEqual([{ kind: 'copied', words: 'rain moved across the bay like a grey curtain' }])
  })

  it('lets shorter echoes and runs of little words pass', () => {
    expect(findLeaks('The rain moved across the bay.', check)).toEqual([])
    const plain = buildCheck(['and then he said that it was all the same to him'])
    expect(findLeaks('And then he said that it was all the same to him.', plain)).toEqual([])
  })

  it('takes out only the sentences that leak, keeping the rest of the line and the list shape', () => {
    const text = '- The lead arrives. She meets Tobin at the quay.\n- The mentor waits.\n- Mara laughs.'
    const out = scrubText(text, check)
    expect(out.text).toBe('- The lead arrives.\n- The mentor waits.')
    expect(out.removed).toBe(2)
    expect(findLeaks(out.text, check)).toEqual([])
  })

  it('leaves clean text exactly as it was', () => {
    const text = 'Plain, short sentences.\n\nScenes open on a small task.'
    expect(scrubText(text, check)).toEqual({ text, removed: 0 })
  })
})
