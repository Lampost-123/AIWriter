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
    expect(sourceNames(['“Well, I’m here,” he said, and I’ll stay, and I’d go.'])).toEqual(new Set())
  })

  it('takes the title’s words, but not its little ones, as names (looked for only when capitalised)', () => {
    expect(sourceNames([], 'The Ferry at Varn')).toEqual(new Set(['Ferry', 'Varn']))
  })

  it('takes a name that is also an ordinary word when it is capitalised mid-sentence twice, or once and never in lower case', () => {
    const n = sourceNames([
      'They sent for Will at dawn. Nobody expected Will to come.',
      'The roses were red, and a rose grew by the gate. She gave the letter to Rose, and Rose read it twice.',
      'In the end it was Grace who opened the door.',
      'He met Hope once, by the canal.'
    ])
    for (const w of ['Will', 'Rose', 'Grace', 'Hope']) expect(n).toContain(w)
    expect(n).not.toContain('Nobody')
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

  it('finds plain prose copied word for word, even when every word is a common one', () => {
    const plain = buildCheck(['She walked to the door and looked back at him one last time before the night came.'])
    expect(findLeaks('In the end she walked to the door and looked back at him one last time before the night came.', plain)).toEqual([
      { kind: 'copied', words: 'she walked to the door and looked back at him one last time before the night came' }
    ])
    const short = buildCheck(['He took the cup and put it down on the table by the bed.'])
    expect(findLeaks('The lead took the cup and put it down on the table.', short)).toHaveLength(1)
  })

  it('judges a long copied run as a whole, not by its first words', () => {
    const plain = buildCheck(['and then he said that it was the night the river rose over the mill.'])
    expect(findLeaks('And then he said that it was the night the river rose over the mill.', plain)).toHaveLength(1)
  })

  it('lets shorter echoes and runs of little words pass', () => {
    expect(findLeaks('The rain moved across the bay.', check)).toEqual([])
    const plain = buildCheck(['and then he said that it was all to him'])
    expect(findLeaks('And then he said that it was all to him.', plain)).toEqual([])
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
