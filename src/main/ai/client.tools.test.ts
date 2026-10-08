// Streamed tool calls (the editor chat) in ai/client.ts: assembled from pieces, with or without ids and indexes, and
// the thinking that comes with them kept to send back. A scripted server; invented text only.
import { describe, expect, it } from 'vitest'
import { sentMessages, streamChat } from './client'

type Chunk = Record<string, unknown>

const piece = (calls: Record<string, unknown>[]): Chunk => ({ choices: [{ delta: { tool_calls: calls }, finish_reason: null }] })
const done = (reason = 'tool_calls'): Chunk => ({ choices: [{ delta: {}, finish_reason: reason }] })

async function streamOf(chunks: Chunk[]) {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
  const fetchImpl = (async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })) as unknown as typeof fetch
  const shown: string[] = []
  const outcome = await streamChat({
    target: { name: 'Scripted', kind: 'custom', baseUrl: 'http://scripted.test', apiKey: 'k' },
    body: {
      model: 'scripted/model',
      messages: [{ role: 'user', content: 'Who keeps the Brass Lantern?' }],
      temperature: 0.7,
      top_p: 0.95,
      max_tokens: 400,
      tools: [{ name: 'read_scene', description: 'Reads a scene.', parameters: {} }]
    },
    signal: new AbortController().signal,
    onText: (t) => shown.push(t),
    fetchImpl,
    delays: [1]
  })
  return { outcome, shown: shown.join('') }
}

describe('streamed tool calls', () => {
  it('puts each call together from its pieces by index, making up an id when the server sends none', async () => {
    const { outcome } = await streamOf([
      piece([{ index: 0, function: { name: 'read_', arguments: '' } }]),
      piece([{ index: 0, function: { name: 'scene', arguments: '{"sc' } }]),
      piece([{ index: 0, function: { arguments: 'ene":2}' } }]),
      piece([{ index: 1, id: 'real-id', type: 'function', function: { name: 'search', arguments: '{}' } }]),
      done()
    ])
    expect(outcome.status).toBe('complete')
    const calls = outcome.toolCalls!
    expect(calls.map((c) => [c.name, c.arguments])).toEqual([
      ['read_scene', '{"scene":2}'],
      ['search', '{}']
    ])
    expect(calls[0].id).toMatch(/^call_/)
    expect(calls[1].id).toBe('real-id')
  })

  it('made-up ids are never the same twice, so every answer matches its own call', async () => {
    const a = await streamOf([piece([{ index: 0, function: { name: 'read_scene', arguments: '{}' } }]), done()])
    const b = await streamOf([piece([{ index: 0, function: { name: 'read_scene', arguments: '{}' } }]), done()])
    expect(a.outcome.toolCalls![0].id).not.toBe(b.outcome.toolCalls![0].id)
  })

  it('keeps calls apart when the server leaves out the index: a new id starts a new call', async () => {
    const { outcome } = await streamOf([
      piece([{ id: 'a', function: { name: 'read_scene', arguments: '{"sc' } }]),
      piece([{ function: { arguments: 'ene":1}' } }]),
      piece([{ id: 'b', function: { name: 'read_scene', arguments: '{"scene":3}' } }]),
      piece([{ id: 'b', function: { arguments: '' } }]),
      done()
    ])
    expect(outcome.toolCalls!.map((c) => [c.id, c.arguments])).toEqual([
      ['a', '{"scene":1}'],
      ['b', '{"scene":3}']
    ])
  })

  it('keeps the thinking sent with tool calls to send back, and never shows it', async () => {
    const think = (t: string): Chunk => ({ choices: [{ delta: { reasoning_content: t }, finish_reason: null }] })
    const { outcome, shown } = await streamOf([
      think('Scene two names '),
      think('the innkeeper.'),
      piece([{ index: 0, id: 'c1', function: { name: 'read_scene', arguments: '{}' } }]),
      done()
    ])
    expect(outcome.reasoning).toBe('Scene two names the innkeeper.')
    expect(shown).toBe('')
    expect(outcome.text).toBe('')
  })

  it('keeps no thinking for an answer without tool calls', async () => {
    const { outcome } = await streamOf([
      { choices: [{ delta: { reasoning_content: 'Hmm.' }, finish_reason: null }] },
      { choices: [{ delta: { content: 'Odile keeps it.' }, finish_reason: null }] },
      done('stop')
    ])
    expect(outcome.text).toBe('Odile keeps it.')
    expect(outcome.reasoning).toBeUndefined()
  })
})

describe('sentMessages and thinking', () => {
  it('sends reasoning_content back only on an assistant turn with tool calls, and only when there is some', () => {
    const sent = sentMessages({ kind: 'custom' }, 'scripted/model', [
      { role: 'user', content: 'Who keeps the inn?' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'read_scene', arguments: '{}' }], reasoning: 'Look first.' },
      { role: 'tool', toolCallId: 'c1', content: 'Odile pours ale.' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c2', name: 'read_scene', arguments: '{}' }] },
      { role: 'tool', toolCallId: 'c2', content: 'Odile again.' },
      { role: 'assistant', content: 'Odile.', reasoning: 'Never sent.' }
    ]) as Record<string, unknown>[]
    expect(sent[1].reasoning_content).toBe('Look first.')
    expect('reasoning_content' in sent[3]).toBe(false)
    expect(sent[5]).toEqual({ role: 'assistant', content: 'Odile.' })
    expect(sent.some((m) => 'reasoning' in m)).toBe(false)
  })
})
