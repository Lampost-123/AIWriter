// The stand-in model (tests/standin/server.mjs) answers the app's own client: words, tool calls, a reply written to
// its outbox folder, and a log of what each request cost.
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { streamChat, type ChatBody } from '../../src/main/ai/client'
import { estimateTokens, startStandin } from '../standin/server.mjs'

const dirs: string[] = []
const closers: Array<() => Promise<void>> = []

afterEach(async () => {
  while (closers.length) await closers.pop()!()
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function folder(): string {
  const d = mkdtempSync(join(tmpdir(), 'standin-'))
  dirs.push(d)
  return d
}

function body(extra: Partial<ChatBody> = {}): ChatBody {
  return {
    model: 'standin/model',
    messages: [
      { role: 'system', content: 'You write scenes.\nKeep to the card.' },
      { role: 'user', content: 'Write the scene.' }
    ],
    temperature: 0.8,
    top_p: 0.95,
    max_tokens: 500,
    ...extra
  }
}

async function ask(url: string, b: ChatBody) {
  return streamChat({
    target: { name: 'Stand-in', kind: 'custom', baseUrl: url, apiKey: 'standin' },
    body: b,
    signal: new AbortController().signal,
    onText: () => {},
    delays: [5]
  })
}

describe('the stand-in model', () => {
  it('answers with words a test gives it, and logs the request', async () => {
    const dir = folder()
    const s = await startStandin({ dir, answer: () => ({ content: 'Mara opened the door.' }) })
    closers.push(s.close)
    const out = await ask(s.url, body())
    expect(out.status).toBe('complete')
    expect(out.text).toBe('Mara opened the door.')
    const log = readFileSync(join(dir, 'log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ id: '00001', job: 'You write scenes.', messages: 2, outcome: 'answered', max_tokens: 500 })
    expect(log[0].estimated_tokens_in).toBeGreaterThan(0)
    const saved = JSON.parse(readFileSync(join(dir, 'inbox', '00001.json'), 'utf8'))
    expect(saved.messages[1]).toEqual({ role: 'user', content: 'Write the scene.' })
  })

  it('waits for a reply file in the outbox', { timeout: 20_000 }, async () => {
    const dir = folder()
    const s = await startStandin({ dir, pollMs: 10 })
    closers.push(s.close)
    const pending = ask(s.url, body())
    // The request lands in the inbox; a stand-in (here, the test) writes the reply.
    for (let i = 0; i < 200 && !readdirSync(join(dir, 'inbox')).includes('00001.json'); i++) await new Promise((r) => setTimeout(r, 10))
    expect(s.waiting()).toEqual(['00001'])
    writeFileSync(join(dir, 'outbox', '00001.json'), JSON.stringify({ content: 'Tom laughed.' }))
    const out = await pending
    expect(out.text).toBe('Tom laughed.')
    expect(s.waiting()).toEqual([])
  })

  it('sends tool calls the app can read', async () => {
    const dir = folder()
    const s = await startStandin({ dir, answer: () => ({ tool_calls: [{ name: 'state_of', arguments: { who: 'Mara' } }] }) })
    closers.push(s.close)
    const tools = [{ name: 'state_of', description: 'Where someone is.', parameters: { type: 'object', properties: { who: { type: 'string' } } } }]
    const out = await ask(s.url, body({ tools }))
    expect(out.status).toBe('complete')
    expect(out.toolCalls).toHaveLength(1)
    expect(out.toolCalls![0].name).toBe('state_of')
    expect(JSON.parse(out.toolCalls![0].arguments)).toEqual({ who: 'Mara' })
    const saved = JSON.parse(readFileSync(join(dir, 'inbox', '00001.json'), 'utf8'))
    expect(saved.tools[0].name).toBe('state_of')
  })

  it('turns an error reply into a failed call, not a hang', async () => {
    const dir = folder()
    const s = await startStandin({ dir, answer: () => ({ error: 'no' }) })
    closers.push(s.close)
    const out = await ask(s.url, body())
    expect(out.status).toBe('error')
  })

  it('estimates tokens at about 4 characters each', () => {
    expect(estimateTokens(400)).toBe(100)
    expect(estimateTokens(1)).toBe(1)
  })
})
