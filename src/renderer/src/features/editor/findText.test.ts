import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { sceneExtensions } from './extensions'
import { findParagraphRange, findTextRange } from './findText'

const schema = getSchema(sceneExtensions())
const p = (...parts: (string | 'br')[]): PMNode =>
  schema.nodes.paragraph.create(
    null,
    parts.map((t) => (t === 'br' ? schema.nodes.hardBreak.create() : schema.text(t)))
  )
const doc = schema.nodes.doc.create(null, [
  p('Mara held up what was left of her arm.'),
  schema.nodes.horizontalRule.create(),
  p('“You’ll want the ferry,” she said.', 'br', 'Tobin   did not answer.'),
  schema.nodes.blockquote.create(null, [p('A line in a quote.')])
])

const at = (quote: string): string | null => {
  const r = findTextRange(doc, quote)
  return r ? doc.textBetween(r.from, r.to, ' ', ' ') : null
}

describe('findTextRange', () => {
  it('finds the words and covers exactly them', () => {
    expect(at('what was left of her arm')).toBe('what was left of her arm')
    expect(at('A line in a quote.')).toBe('A line in a quote.')
  })

  it("doesn't mind case, curly quotes or spacing", () => {
    expect(at('"you\'ll want the FERRY,"')).toBe('“You’ll want the ferry,”')
    expect(at('Tobin did not\nanswer')).toBe('Tobin   did not answer')
  })

  it('reads a line break inside a paragraph as a space', () => {
    expect(at('she said. Tobin')).toBe('she said. Tobin')
  })

  it('finds words spanning paragraphs by their first part', () => {
    expect(at('her arm.\n\n“You’ll want')).toBe('her arm.')
  })

  it('is null when the words are gone, or there are none', () => {
    expect(at('the Duke')).toBeNull()
    expect(at('   ')).toBeNull()
  })
})

describe('findTextRange with whole words', () => {
  const words = schema.nodes.doc.create(null, [p('Her brain ached in the rain.')])
  const find = (quote: string, wholeWord: boolean): string | null => {
    const r = findTextRange(words, quote, { wholeWord })
    return r ? `${r.from}:${words.textBetween(r.from, r.to)}` : null
  }
  it('skips a match inside a longer word only when asked', () => {
    expect(find('rain', false)).toBe('6:rain')
    expect(find('rain', true)).toBe('24:rain')
    expect(find('ache', true)).toBeNull()
  })
})

describe('finding words by their paragraph (Jump to source, World Memory Overhaul B2)', () => {
  const para = (pid: string, text: string): PMNode => schema.nodes.paragraph.create({ pid }, schema.text(text))
  const twice = schema.nodes.doc.create(null, [
    para('a1', 'The bell rang twice before dawn.'),
    para('b2', 'Later, the bell rang twice again, and Mara woke.'),
    para('c3', 'The ferry left without her.')
  ])
  const found = (r: { from: number; to: number } | null): string | null => (r ? twice.textBetween(r.from, r.to) : null)

  it('prefers the words in their own paragraph when they appear more than once', () => {
    expect(findTextRange(twice, 'the bell rang twice', { paragraphId: 'b2' })?.from).toBeGreaterThan(findTextRange(twice, 'the bell rang twice')!.from)
    expect(found(findTextRange(twice, 'the bell rang twice', { paragraphId: 'b2' }))).toBe('the bell rang twice')
  })

  it('still finds the words elsewhere when their paragraph no longer has them', () => {
    expect(found(findTextRange(twice, 'The ferry left', { paragraphId: 'a1' }))).toBe('The ferry left')
  })

  it('finds a whole paragraph by its id, for words that were edited since', () => {
    expect(found(findParagraphRange(twice, 'c3'))).toBe('The ferry left without her.')
    expect(findParagraphRange(twice, 'zz')).toBeNull()
    expect(findParagraphRange(twice, '')).toBeNull()
  })
})
