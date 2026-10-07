import { describe, expect, it } from 'vitest'
import { basicTokens, WordPiece } from './wordpiece'

// A tiny made-up vocabulary in vocab.txt's layout (the id is the line number).
const VOCAB = ['[PAD]', '[UNK]', '[CLS]', '[SEP]', '[MASK]', 'hello', 'world', 'un', '##want', '##ed', ',', '.', '!', "'", 'cafe', 'the', 'well', 'runn', '##ing', '你', '好', 'a', '##b']
const vocab = new WordPiece(VOCAB.join('\n'))
const id = (p: string): number => VOCAB.indexOf(p)

describe("the search model's tokenizer (BERT, lower-cased)", () => {
  it('splits on spaces and punctuation, lower-cases and takes accents off', () => {
    expect(basicTokens('Hello, World!')).toEqual(['hello', ',', 'world', '!'])
    expect(basicTokens('Café   au\tlait\n')).toEqual(['cafe', 'au', 'lait'])
    expect(basicTokens("Mara's well...")).toEqual(['mara', "'", 's', 'well', '.', '.', '.'])
    expect(basicTokens('“Run!” she said—now.')).toEqual(['“', 'run', '!', '”', 'she', 'said', '—', 'now', '.'])
  })

  it('puts CJK characters on their own and drops control characters', () => {
    expect(basicTokens('ab你好cd')).toEqual(['ab', '你', '好', 'cd'])
    expect(basicTokens('he\u0000llo​')).toEqual(['hello'])
  })

  it('cuts words into the longest pieces the vocabulary has', () => {
    expect(vocab.wordPieces('unwanted')).toEqual([id('un'), id('##want'), id('##ed')])
    expect(vocab.wordPieces('running')).toEqual([id('runn'), id('##ing')])
    expect(vocab.wordPieces('ab')).toEqual([id('a'), id('##b')])
    // A word that can't be cut whole is unknown.
    expect(vocab.wordPieces('unwantedx')).toEqual([id('[UNK]')])
    expect(vocab.wordPieces('x'.repeat(101))).toEqual([id('[UNK]')])
  })

  it('reads a text as [CLS], its pieces and [SEP], cut to the longest the model takes', () => {
    expect(vocab.encode('Hello, unwanted world!')).toEqual([2, id('hello'), id(','), id('un'), id('##want'), id('##ed'), id('world'), id('!'), 3])
    const long = vocab.encode('hello '.repeat(20), 8)
    expect(long).toHaveLength(8)
    expect(long[0]).toBe(2)
    expect(long[7]).toBe(3)
  })

  it('needs the special pieces', () => {
    expect(() => new WordPiece('hello\nworld')).toThrow(/\[CLS\]/)
  })
})
