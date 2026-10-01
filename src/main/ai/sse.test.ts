import { describe, expect, it } from 'vitest'
import { parsePayload, SseParser } from './sse'

const feed = (chunks: string[]): string[] => {
  const p = new SseParser()
  const out: string[] = []
  for (const c of chunks) out.push(...p.push(c))
  out.push(...p.end())
  return out
}

describe('SseParser', () => {
  it('reads simple events', () => {
    expect(feed(['data: {"a":1}\n\ndata: {"a":2}\n\n'])).toEqual(['{"a":1}', '{"a":2}'])
  })

  it('joins events split at any point across chunks', () => {
    const stream = 'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: {"choices":[{"delta":{"content":" world"}}]}\n\ndata: [DONE]\n\n'
    const expected = ['{"choices":[{"delta":{"content":"Hello"}}]}', '{"choices":[{"delta":{"content":" world"}}]}', '[DONE]']
    for (let cut = 1; cut < stream.length; cut++) {
      expect(feed([stream.slice(0, cut), stream.slice(cut)])).toEqual(expected)
    }
    // One character at a time.
    expect(feed(stream.split(''))).toEqual(expected)
  })

  it('handles CRLF and lone CR line endings, even split between chunks', () => {
    expect(feed(['data: one\r\n\r\ndata: two\r', '\n\r\n'])).toEqual(['one', 'two'])
    expect(feed(['data: one\r\rdata: two\r\r'])).toEqual(['one', 'two'])
    expect(feed(['data: x\r', '\r'])).toEqual(['x'])
  })

  it('skips comment and keep-alive lines', () => {
    expect(feed([': OPENROUTER PROCESSING\n\n', 'data: a\n\n', ':keep-alive\n\n', 'data: b\n\n'])).toEqual(['a', 'b'])
  })

  it('joins multi-line data fields with newlines and ignores other fields', () => {
    expect(feed(['event: message\nid: 7\ndata: line 1\ndata: line 2\nretry: 100\n\n'])).toEqual(['line 1\nline 2'])
  })

  it('accepts data without the space after the colon', () => {
    expect(feed(['data:{"x":1}\n\n'])).toEqual(['{"x":1}'])
  })

  it('completes a final event that has no blank line after it', () => {
    expect(feed(['data: last'])).toEqual(['last'])
  })
})

describe('parsePayload', () => {
  it('parses JSON and the DONE marker', () => {
    expect(parsePayload('{"a":1}')).toEqual({ done: false, objects: [{ a: 1 }], bad: [] })
    expect(parsePayload('[DONE]').done).toBe(true)
    expect(parsePayload('   ').objects).toEqual([])
  })

  it('splits events glued together by a server that forgot blank lines', () => {
    const p = parsePayload('{"a":1}\n{"a":2}\n[DONE]')
    expect(p.objects).toEqual([{ a: 1 }, { a: 2 }])
    expect(p.done).toBe(true)
  })

  it('reports lines that are not JSON instead of throwing', () => {
    const p = parsePayload('{"a":1}\nnot json')
    expect(p.objects).toEqual([{ a: 1 }])
    expect(p.bad).toEqual(['not json'])
  })
})
