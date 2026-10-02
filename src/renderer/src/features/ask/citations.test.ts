// Reading an answer: cited names that are pages in the world become links; nothing else ever does.
import { describe, expect, it } from 'vitest'
import { answerParagraphs, answerParts, citedTargets, nameIndex, plainAnswer, resolveName, tidyAnswer, type LinkTarget } from './citations'

const mara: LinkTarget = { id: 'mara', kind: 'character', name: 'Mara Venn', aliases: ['Mara'] }
const tobin: LinkTarget = { id: 'tobin', kind: 'character', name: 'Tobin', aliases: [] }
const keep: LinkTarget = { id: 'keep', kind: 'place', name: 'The Grey Keep', aliases: [] }
const index = nameIndex([mara, tobin, keep])

/** The runs as text, with links marked as <id:text>. */
const shown = (text: string): string =>
  answerParts(text, index)
    .map((p) => (p.target ? `<${p.target.id}:${p.text}>` : p.text))
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

  it('is kept as plain words when saved', () => {
    expect(plainAnswer('**Yes.** [[Mara Venn|Mara]] is nineteen, says [[Tobin]].\n')).toBe('Yes. Mara is nineteen, says Tobin.')
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
