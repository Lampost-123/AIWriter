import { describe, expect, it } from 'vitest'
import { parsePartial } from './partial'

describe('reading a reply that is still arriving', () => {
  const whole = '{"fromNotes": {"name": "Brann"}, "drafted": {"hair": "Grey, \\"cropped\\"", "age": 52, "aliases": ["Old Brann", "the Ferryman"]}}'

  it('reads a whole object', () => {
    expect(parsePartial(whole)).toEqual({
      value: { fromNotes: { name: 'Brann' }, drafted: { hair: 'Grey, "cropped"', age: 52, aliases: ['Old Brann', 'the Ferryman'] } },
      open: null,
      done: true
    })
  })

  it('has only the values that have fully arrived, and the one being written apart', () => {
    const cut = whole.indexOf('cropped')
    const p = parsePartial(whole.slice(0, cut + 3))
    expect(p.done).toBe(false)
    expect(p.value).toEqual({ fromNotes: { name: 'Brann' }, drafted: {} })
    expect(p.open).toEqual({ path: ['drafted', 'hair'], text: 'Grey, "cro' })
  })

  it('gives the same complete values at every point of the stream, never a broken one', () => {
    for (let n = 0; n <= whole.length; n++) {
      const p = parsePartial(whole.slice(0, n))
      const drafted = (p.value?.drafted ?? {}) as Record<string, unknown>
      if ('hair' in drafted) expect(drafted.hair).toBe('Grey, "cropped"')
      // A number may still be arriving ("5" of "52"), so it only shows once something follows it.
      if ('age' in drafted) expect(drafted.age).toBe(52)
      for (const a of (drafted.aliases ?? []) as string[]) expect(['Old Brann', 'the Ferryman']).toContain(a)
    }
  })

  it('reports a list item being written with its place in the list', () => {
    const p = parsePartial('{"options": ["One", "Tw')
    expect(p.value).toEqual({ options: ['One'] })
    expect(p.open).toEqual({ path: ['options', 1], text: 'Tw' })
  })

  it('forgives words and a code fence before the object, comments, missing commas and line breaks in strings', () => {
    const p = parsePartial('Here is the profile:\n```json\n{\n  // the basics\n  "name": "Mara"\n  "summary": "Line one\nline two",\n}\n```')
    expect(p).toEqual({ value: { name: 'Mara', summary: 'Line one\nline two' }, open: null, done: true })
  })

  it('drops an escape cut in half rather than show part of it', () => {
    expect(parsePartial('{"a": "x\\').open).toEqual({ path: ['a'], text: 'x' })
    expect(parsePartial('{"a": "x\\u00').open).toEqual({ path: ['a'], text: 'x' })
    expect(parsePartial('{"a": "x\\u00e9y"}').value).toEqual({ a: 'xéy' })
  })

  it('stops at something it can not read, keeping what came before', () => {
    expect(parsePartial('{"a": "1", b: "2", "c": "3"}')).toEqual({ value: { a: '1' }, open: null, done: false })
  })

  it('has nothing before the object starts', () => {
    expect(parsePartial('Thinking about it')).toEqual({ value: null, open: null, done: false })
    expect(parsePartial('{')).toEqual({ value: {}, open: null, done: false })
  })
})
