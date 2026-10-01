import { describe, expect, it } from 'vitest'
import { ThinkFilter } from './think'

const run = (chunks: string[]): string => {
  const f = new ThinkFilter()
  return chunks.map((c) => f.push(c)).join('') + f.end()
}

describe('ThinkFilter', () => {
  it('passes ordinary text through unchanged', () => {
    expect(run(['The rain ', 'came down.'])).toBe('The rain came down.')
  })

  it('removes a think block at the start, and the blank lines after it', () => {
    expect(run(['<think>Plan: rain, then the knock.</think>\n\nThe rain came.'])).toBe('The rain came.')
  })

  it('removes thinking split across chunks, including split tags', () => {
    const text = '<think>secret plan</think>\n\nShe waited. <thinking>more</thinking>Then the knock.'
    const expected = 'She waited. Then the knock.'
    for (let cut = 1; cut < text.length; cut++) {
      expect(run([text.slice(0, cut), text.slice(cut)])).toBe(expected)
    }
    expect(run(text.split(''))).toBe(expected)
  })

  it('is case-insensitive about the tags', () => {
    expect(run(['<THINK>x</Think>Hello'])).toBe('Hello')
  })

  it('drops a stray closing tag', () => {
    expect(run(['</think>Hello'])).toBe('Hello')
  })

  it('keeps a lone "<" that turns out not to be a tag', () => {
    expect(run(['a <', ' b'])).toBe('a < b')
    expect(run(['ends with <'])).toBe('ends with <')
    expect(run(['<thin', 'g>'])).toBe('<thing>')
  })

  it('drops an unfinished think block at the end', () => {
    expect(run(['Hello <think>never closed'])).toBe('Hello ')
  })

  it('trims whitespace before the first real text only', () => {
    expect(run(['\n\n  ', 'Hello\n\n', 'World'])).toBe('Hello\n\nWorld')
  })
})
