import { describe, expect, it } from 'vitest'
import { hasDialogue, quoteSpans } from '@shared/contracts/edits'
import { whoSpeaks, type Speaker } from './speakers'

const MARA: Speaker = { id: 'mara', name: 'Mara Venn', aliases: [], pronouns: 'she/her' }
const TOBIN: Speaker = { id: 'tobin', name: 'Tobin', aliases: ['the smith'], pronouns: 'he/him' }
const WILL: Speaker = { id: 'will', name: 'Will', aliases: [], pronouns: 'he/him' }
const CAST = [MARA, TOBIN, WILL]

const lines = (text: string) => quoteSpans(text).map((s) => text.slice(s.start, s.end))
const who = (selection: string, o: { before?: string; after?: string; povId?: string | null; cast?: Speaker[] } = {}) =>
  whoSpeaks({ before: o.before ?? '', selection, after: o.after ?? '', cast: o.cast ?? CAST, povId: o.povId ?? null }).map((l) => [
    l.quote,
    l.speakerId,
    l.how
  ])

describe('lines of dialogue', () => {
  it('finds words between curly or straight double quotation marks', () => {
    expect(lines('“We leave at dawn,” said Mara. “Pack light.”')).toEqual(['“We leave at dawn,”', '“Pack light.”'])
    expect(lines('"Fine," he said. "Go."')).toEqual(['"Fine,"', '"Go."'])
    expect(lines('«Non,» dit-elle.')).toEqual(['«Non,»'])
  })

  it('reads single curly quotation marks only where there are no double ones, never ending a line at an apostrophe', () => {
    expect(lines('‘Don’t go,’ she said. ‘It isn’t safe.’')).toEqual(['‘Don’t go,’', '‘It isn’t safe.’'])
    expect(lines('The smith’s hammer rang. Nobody’s fault.')).toEqual([])
    expect(lines('“She said ‘no’ twice,” Tobin said.')).toEqual(['“She said ‘no’ twice,”'])
  })

  it('runs a line still open at the end of the paragraph to its end (speech carrying on)', () => {
    expect(lines('“The road north is closed, and the river is high')).toEqual(['“The road north is closed, and the river is high'])
  })

  it('knows when words have dialogue in them', () => {
    expect(hasDialogue('She waited.\n\n“Well?” he asked.')).toBe(true)
    expect(hasDialogue('She waited. The rain kept on.')).toBe(false)
  })
})

describe('who says each line', () => {
  it('reads speech tags naming a character, after or before the line', () => {
    expect(who('“We leave at dawn,” said Mara. “Pack light.”')).toEqual([
      ['“We leave at dawn,”', 'mara', 'tag'],
      ['“Pack light.”', 'mara', 'carry']
    ])
    expect(who('“Not a chance,” Tobin muttered.')).toEqual([['“Not a chance,”', 'tobin', 'tag']])
    expect(who('Tobin said quietly, “Not a chance.”')).toEqual([['“Not a chance.”', 'tobin', 'tag']])
    expect(who('“Not a chance,” the smith said.')).toEqual([['“Not a chance,”', 'tobin', 'tag']])
  })

  it('needs a single capitalised name to be capitalised ("will" is not Will)', () => {
    expect(who('“I will,” will said.')).toEqual([['“I will,”', null, null]])
    expect(who('“I will,” Will said.')).toEqual([['“I will,”', 'will', 'tag']])
  })

  it('gives a line to the one character its paragraph names, or to the one its lead-in starts with', () => {
    expect(who('Mara set down her cup. “We leave at dawn.”')).toEqual([['“We leave at dawn.”', 'mara', 'named']])
    expect(who('Tobin watched Mara over the rim of his cup. “You’re late.”')).toEqual([['“You’re late.”', 'tobin', 'named']])
    // "She looked at Tobin": Tobin is spoken to, so the line isn't his; with Mara just before, it's hers.
    expect(who('She looked at Tobin. “You’re late.”')).toEqual([['“You’re late.”', null, null]])
    expect(who('She looked at Tobin. “You’re late.”', { before: '“Well?” Mara asked.\n\n' })).toEqual([
      ['“You’re late.”', 'mara', 'pronoun']
    ])
  })

  it('takes turns in a two-person exchange', () => {
    const selection = ['“Where were you?” Mara asked.', '“Out,” said Tobin.', '“Out where?”', '“Just out.”'].join('\n\n')
    expect(who(selection)).toEqual([
      ['“Where were you?”', 'mara', 'tag'],
      ['“Out,”', 'tobin', 'tag'],
      ['“Out where?”', 'mara', 'turn'],
      ['“Just out.”', 'tobin', 'turn']
    ])
  })

  it('reads the exchange so far from the words before, and a tag from the rest of the paragraph after', () => {
    const before = '“Where were you?” Mara asked.\n\n“Out,” said Tobin.\n\n'
    expect(who('“Out where?”', { before })).toEqual([['“Out where?”', 'mara', 'turn']])
    // A pronoun alone, with no one about it could be, tells nothing.
    expect(who('“Out where?”', { after: ' she asked again.' })).toEqual([['“Out where?”', null, null]])
    expect(who('“Out where?”', { before, after: ' Mara asked again.' })).toEqual([['“Out where?”', 'mara', 'tag']])
  })

  it('fits a pronoun tag to the one person about it fits', () => {
    const before = '“Where were you?” Mara asked.\n\n“Out,” said Tobin.\n\n'
    expect(who('“Out where?” she asked.', { before })).toEqual([['“Out where?”', 'mara', 'pronoun']])
    expect(who('“Nowhere,” he said.', { before })).toEqual([['“Nowhere,”', 'tobin', 'pronoun']])
  })

  it('gives "I said" and first-person lead-ins to the point-of-view character', () => {
    expect(who('“Fine,” I said.', { povId: 'mara' })).toEqual([['“Fine,”', 'mara', 'tag']])
    expect(who('I shrugged. “Fine.”', { povId: 'mara' })).toEqual([['“Fine.”', 'mara', 'named']])
    expect(who('“Fine,” I said.')).toEqual([['“Fine,”', null, null]])
  })

  it('says nothing about lines it cannot tell, and starts afresh after a scene break', () => {
    expect(who('“Who goes there?”')).toEqual([['“Who goes there?”', null, null]])
    const selection = ['“Where were you?” Mara asked.', '“Out,” said Tobin.', '* * *', '“Morning.”'].join('\n\n')
    expect(who(selection).at(-1)).toEqual(['“Morning.”', null, null])
  })

  it('only looks for the scene’s cast', () => {
    expect(who('“We leave at dawn,” said Mara.', { cast: [TOBIN] })).toEqual([['“We leave at dawn,”', null, null]])
  })

  it('lists only the lines in the selected words', () => {
    const before = '“Where were you?” Mara asked. '
    expect(who('“Out,” said Tobin.', { before })).toEqual([['“Out,”', 'tobin', 'tag']])
  })
})
