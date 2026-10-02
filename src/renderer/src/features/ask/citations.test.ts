// Reading an answer: cited names that are pages in the world become links; nothing else ever does.
import { describe, expect, it } from 'vitest'
import {
  answerLines,
  answerParagraphs,
  answerParts,
  citedTargets,
  nameIndex,
  plainAnswer,
  resolveName,
  tidyAnswer,
  type LinkTarget
} from './citations'

const mara: LinkTarget = { id: 'mara', kind: 'character', name: 'Mara Venn', aliases: ['Mara'] }
const tobin: LinkTarget = { id: 'tobin', kind: 'character', name: 'Tobin', aliases: [] }
const keep: LinkTarget = { id: 'keep', kind: 'place', name: 'The Grey Keep', aliases: [] }
const index = nameIndex([mara, tobin, keep])

/** The runs as text, with links marked as <id:text> and italics as <i:text>. */
const shown = (text: string): string =>
  answerParts(text, index)
    .map((p) => {
      const t = p.target ? `<${p.target.id}:${p.text}>` : p.text
      return p.em ? `<i:${t}>` : t
    })
    .join('')

describe('cited names', () => {
  it('link to the page they name, by its name or another name, whatever the case', () => {
    expect(shown('[[Mara Venn]] trusts [[tobin]], and [[Mara]] would know.')).toBe(
      '<mara:Mara Venn> trusts <tobin:tobin>, and <mara:Mara> would know.'
    )
  })

  it('find the page through a possessive or a missing or extra "the"', () => {
    expect(resolveName('Mara’s', index)).toBe(mara)
    expect(resolveName('Grey Keep', index)).toBe(keep)
    expect(resolveName('the Tobin', index)).toBe(tobin)
    expect(resolveName('Tobias', index)).toBe(null)
  })

  it('stay plain words when they are not a page in the world (a link is never made up)', () => {
    expect(shown('They meet at [[The Grey Ferry]].')).toBe('They meet at The Grey Ferry.')
    expect(answerParts('[[The Grey Ferry]]', index)).toEqual([{ text: 'The Grey Ferry', target: null }])
  })

  it('can show other words for the name', () => {
    expect(shown('[[Mara Venn|she]] would lie.')).toBe('<mara:she> would lie.')
  })

  it('hide their brackets while the name is still arriving', () => {
    expect(shown('She asked [[Mar')).toBe('She asked Mar')
    expect(shown('She asked [')).toBe('She asked ')
    expect(shown('[[Tobin]] and [[To')).toBe('<tobin:Tobin> and To')
  })

  it('are listed once each, in the order the answer first names them', () => {
    const cited = citedTargets('[[Tobin]] and [[Mara Venn]], then [[Tobin]] again, and [[Nobody]].', index)
    expect(cited.map((t) => t.id)).toEqual(['tobin', 'mara'])
  })
})

describe('the answer as shown', () => {
  it('is split into paragraphs at blank lines, keeping single line breaks (lists)', () => {
    const paras = answerParagraphs('Three ideas:\n1. One\n2. Two\n\n\nAnd [[Tobin]].', index)
    expect(paras).toHaveLength(2)
    expect(paras[0]).toEqual([{ text: 'Three ideas:\n1. One\n2. Two', target: null }])
    expect(paras[1].map((p) => p.target?.id ?? p.text)).toEqual(['And ', 'tobin', '.'])
  })

  it('loses the bold and heading marks a model may add', () => {
    expect(tidyAnswer('## Ideas\n**The Salt Lamp** and __The Oar__')).toBe('Ideas\nThe Salt Lamp and The Oar')
  })

  it('has a list marked with asterisks dashed, as asked', () => {
    expect(tidyAnswer('Ideas:\n* The Salt Lamp\n*   The Oar\n  * The Net')).toBe('Ideas:\n- The Salt Lamp\n- The Oar\n  - The Net')
  })

  it('shows words a model set in italics in italics, without the marks', () => {
    expect(shown('1. *The Salt Lamp*, near _the ferry_; ask [[Tobin]].')).toBe(
      '1. <i:The Salt Lamp>, near <i:the ferry>; ask <tobin:Tobin>.'
    )
    expect(answerParts('*only [[Mara]] knows*', index)).toEqual([
      { text: 'only ', target: null, em: true },
      { text: 'Mara', target: mara, em: true },
      { text: ' knows', target: null, em: true }
    ])
    expect(shown('*[[Tobin]]*, again')).toBe('<i:<tobin:Tobin>>, again')
  })

  it('leaves asterisks and underscores that aren’t italics as they are', () => {
    const text = 'A 2*3*4 grid, snake_case_name, a * b, 5 * 3 * 2, and ** alone.'
    expect(shown(text)).toBe(text)
  })

  it('hides the mark of italics still arriving, and nothing earlier', () => {
    expect(shown('Try *The Salt La')).toBe('Try The Salt La')
    expect(shown('Try *')).toBe('Try ')
    expect(shown('Try *The Salt Lamp*')).toBe('Try <i:The Salt Lamp>')
    expect(shown('*the [[Grey Ke')).toBe('the Grey Ke')
    expect(shown('*Not closed,\nthen _the Oa')).toBe('*Not closed,\nthen the Oa')
  })

  it('has its lines apart, each list item’s mark set apart from its words', () => {
    const [para] = answerParagraphs('Ideas:\n* *The Salt Lamp*, by [[Tobin]]’s ferry\n2. The Oar\n  - The Net\n-not a list', index)
    const lines = answerLines(para)
    expect(
      lines.map((l) => [l.mark, l.depth, l.parts.map((p) => (p.target ? `<${p.target.id}>` : p.em ? `<i:${p.text}>` : p.text)).join('')])
    ).toEqual([
      [null, 0, 'Ideas:'],
      ['- ', 0, '<i:The Salt Lamp>, by <tobin>’s ferry'],
      ['2. ', 0, 'The Oar'],
      ['- ', 1, 'The Net'],
      [null, 0, '-not a list']
    ])
    // A name straight after the mark stays a link.
    expect(answerLines(answerParts('- [[Mara Venn]] would.', index))).toEqual([
      {
        mark: '- ',
        depth: 0,
        parts: [
          { text: 'Mara Venn', target: mara },
          { text: ' would.', target: null }
        ]
      }
    ])
  })

  it('is kept as plain words when saved', () => {
    expect(plainAnswer('**Yes.** [[Mara Venn|Mara]] is nineteen, says [[Tobin]].\n')).toBe('Yes. Mara is nineteen, says Tobin.')
    expect(plainAnswer('1. *The Salt Lamp*\n2. _The Oar_\n\n\nAsk [[Tobin]].')).toBe('1. The Salt Lamp\n2. The Oar\n\nAsk Tobin.')
  })
})

describe('the names in the world', () => {
  it('keep the first page with a name, and ignore names too short to mean anything', () => {
    const twin: LinkTarget = { id: 'twin', kind: 'place', name: 'Tobin', aliases: ['T'] }
    const ix = nameIndex([tobin, twin])
    expect(resolveName('Tobin', ix)).toBe(tobin)
    expect(resolveName('T', ix)).toBe(null)
  })
})
