// The trap harness's helpers (tests/traps): the held-out prose measures (slop-score's "not X, but Y" contrasts,
// fragments, repeats, Holodeck's echo and loop detectors), which saved worlds a chain run may start from, and the
// provider guard. Invented lines only, no model.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Budget } from '../traps/budget'
import { cutRepeat, echoesInScene, loopAt, looping, repeatedParas } from '../traps/echo'
import { errorMessage, guardFetch, rateLimitWait, stopReason } from '../traps/guard'
import { heldOut, isFragment, proseMetrics, proseRows, summariseProse } from '../traps/prose'
import { contrastHits } from '../traps/slopScore'
import { storyHash, storyHashes, WORLD_CODE, worldCodeFits } from '../traps/worldCode.mjs'

describe('held-out prose measures', () => {
  it('"not X, but Y" contrasts, as slop-score counts them, per 1,000 words', () => {
    expect(contrastHits('It was not anger, but something colder that kept her at the window.')).toHaveLength(1)
    expect(contrastHits('It wasn’t the rain. It was the waiting.')).toHaveLength(1)
    expect(contrastHits('The road was not long, but when it rained it flooded.')).toHaveLength(0)
    expect(contrastHits('She poured the tea and sat down.')).toHaveLength(0)
    const text = 'It was not anger, but something colder. She poured the tea and sat down by the range for a while.'
    const h = heldOut(text, '')
    expect(h.contrasts).toBe(1)
    expect(h.contrastRate).toBeCloseTo((1 / 20) * 1000)
  })
  it('one-line fragment paragraphs: five words or fewer, no speech', () => {
    expect(isFragment('Then nothing.')).toBe(true)
    expect(isFragment('“Then nothing.”')).toBe(false)
    expect(isFragment('Orla set the kettle on the range.')).toBe(false)
    const h = heldOut('Orla set the kettle on the range and waited.\n\nThen nothing.\n\n“Not yet,” he said.\n\nSilence.', '')
    expect(h.paragraphs).toBe(4)
    expect(h.fragments).toBe(2)
    expect(h.fragmentRate).toBe(0.5)
  })
  it('5-word runs seen in earlier steps of the same chain', () => {
    const earlier = ['Orla set the kettle on the range and counted the cups.']
    // "orla set the kettle on", "set the kettle on the", "the kettle on the range"
    expect(heldOut('Again Orla set the kettle on the range.', '', earlier).repeat5).toBe(3)
    expect(heldOut('Brannoch shut the ledger with a slap.', '', earlier).repeat5).toBe(0)
  })
  it('a paragraph already on the page, and a line of dialogue said twice in the scene (Holodeck detectors)', () => {
    const page = ['Orla set the kettle on the range and counted the cups twice, then once more for luck.', '“We leave at first light,” said Brannoch.']
    expect(repeatedParas(['Orla set the kettle on the range and counted the cups twice, then once more for luck.'], page)).toEqual([0])
    expect(repeatedParas(['The yard was dark and the gate stood open to the lane.'], page)).toEqual([])
    const h = heldOut('He went to the door.\n\n“We leave at first light,” said Brannoch.', page.join('\n\n'))
    expect(h.sceneEchoes).toBeGreaterThan(0)
    expect(heldOut('He went to the door.', page.join('\n\n')).sceneEchoes).toBe(0)
    expect(echoesInScene(['“Not now, Orla.”', 'She shut the gate.', '“Not now, Orla.”']).length).toBeGreaterThan(0)
    // Two words ("Not now.") may come twice on purpose.
    expect(echoesInScene(['“Not now.”', 'She shut the gate.', '“Not now.”'])).toEqual([])
  })
  it('in each passage’s prose figures and the summary rows', () => {
    const m = proseMetrics({ text: 'It wasn’t the rain. It was the waiting.\n\nThen nothing.', before: '', target: null, samples: [], earlier: [] })
    expect(m.contrasts).toBe(1)
    expect(m.fragments).toBe(1)
    const s = summariseProse([{ where: 'x', kind: 'continue', text: 'a', prose: m }])
    expect(s.heldOut?.measured).toBe(1)
    expect(proseRows(s).some(([k]) => /not X, but Y/.test(k))).toBe(true)
  })
})

describe('echo.ts: loops (Holodeck)', () => {
  it('a run of words said back to back is a loop; the text keeps its first copy', () => {
    expect(looping('She waited. And waited and waited and waited and waited and waited and waited.')).toBe(true)
    const words = 'the gate the gate the gate the gate the gate the gate'.split(' ')
    expect(loopAt(words)).toBeGreaterThan(0)
    expect(cutRepeat('He said it was over, it was over, it was over, it was over, it was over.')).toBe('He said it was over.')
    expect(looping('Orla set the kettle on the range and counted the cups twice, then went to the door.')).toBe(false)
  })
})

describe('saved worlds', () => {
  it('the story id ignores CRLF, and old ids still match', () => {
    const dir = mkdtempSync(join(tmpdir(), 'traps-story-'))
    writeFileSync(join(dir, 'lf.json'), '{\n  "title": "The Salt Lantern"\n}\n')
    writeFileSync(join(dir, 'crlf.json'), '{\r\n  "title": "The Salt Lantern"\r\n}\r\n')
    expect(storyHash(join(dir, 'crlf.json'))).toBe(storyHash(join(dir, 'lf.json')))
    const ids = storyHashes(join(dir, 'crlf.json'))
    expect(ids).toHaveLength(2)
    expect(ids).toContain(storyHash(join(dir, 'lf.json')))
  })
  it('the same src tree fits; uncommitted world code never does; the world code list is the memory’s', () => {
    expect(WORLD_CODE).toEqual(expect.arrayContaining(['src/main/keeper', 'src/main/continuity', 'src/main/db']))
    expect(WORLD_CODE.some((p: string) => /ai\/|edits|plan|repair/.test(p))).toBe(false)
    const here = { srcTree: 'abc', worldCode: 'w1', dirty: false }
    expect(worldCodeFits('.', { srcTree: 'abc', commit: 'nope', dirty: false }, here).ok).toBe(true)
    expect(worldCodeFits('.', { srcTree: 'old', worldCode: 'w1', commit: 'nope', dirty: false }, here).ok).toBe(true)
    expect(worldCodeFits('.', { srcTree: 'abc', commit: 'nope', dirty: true }, here).ok).toBe(false)
    expect(worldCodeFits('.', { srcTree: 'old', worldCode: 'w2', commit: 'nope', dirty: false }, here).ok).toBe(false)
  })
})

describe('the provider guard', () => {
  const chat = 'https://api.example.test/v1/chat/completions'
  const post = { method: 'POST', body: '{}' }
  const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
  const setUp = (replies: Response[]) => {
    const stops: string[] = []
    const lines: string[] = []
    const waits: number[] = []
    let calls = 0
    const next = (async () => replies[Math.min(calls++, replies.length - 1)].clone()) as unknown as typeof fetch
    const f = guardFetch(next, { provider: 'DeepSeek', stop: (w) => stops.push(w), log: (l) => lines.push(l), waits: [1, 2, 3], rounds: 2, sleep: async (ms) => void waits.push(ms) })
    return { f, stops, lines, waits, calls: () => calls }
  }

  it('402 Insufficient Balance: stops once, with a plain message naming the provider', async () => {
    const g = setUp([json(402, { error: { message: 'Insufficient Balance', type: 'unknown_error' } })])
    const res = await g.f(chat, post)
    expect(res.status).toBe(402)
    await g.f(chat, post)
    expect(g.stops).toHaveLength(1)
    expect(g.stops[0]).toMatch(/^PROVIDER STOP: DeepSeek said HTTP 402: "Insufficient Balance" \(out of balance\)/)
    expect(g.lines[0]).toBe(g.stops[0])
  })
  it('401 and an insufficient-credit 400 stop too; other errors and successes do not', () => {
    expect(stopReason(401, '{"error":{"message":"Invalid key"}}', 'OpenRouter')).toMatch(/^PROVIDER STOP: OpenRouter said HTTP 401/)
    expect(stopReason(400, '{"error":{"message":"insufficient_credits: add funds"}}', 'OpenRouter')).toMatch(/out of balance/)
    expect(stopReason(400, '{"error":{"message":"bad field: thinking"}}', 'OpenRouter')).toBeNull()
    expect(stopReason(500, 'oops', 'DeepSeek')).toBeNull()
    expect(errorMessage('not json at all')).toBe('not json at all')
  })
  it('429: waited out a few times (Retry-After when given), and passes once it lets up', async () => {
    const g = setUp([json(429, { error: { message: 'rate_limit_exceeded' } }, { 'retry-after': '0' }), json(429, {}), json(200, { ok: true })])
    const res = await g.f(chat, post)
    expect(res.status).toBe(200)
    expect(g.calls()).toBe(3)
    expect(g.waits).toEqual([1, 2])
    expect(g.stops).toHaveLength(0)
    expect(rateLimitWait(1, '20', [5000])).toBe(20_000)
    expect(rateLimitWait(1, '600', [5000])).toBe(60_000)
    expect(rateLimitWait(2, null, [5000, 15000])).toBe(15_000)
  })
  it('429 that never lets up: after its rounds the run stops', async () => {
    const g = setUp([json(429, { error: { message: 'rate_limit_exceeded' } })])
    expect((await g.f(chat, post)).status).toBe(429)
    expect(g.stops).toHaveLength(0)
    expect((await g.f(chat, post)).status).toBe(429)
    expect(g.stops[0]).toMatch(/^PROVIDER STOP: DeepSeek kept saying HTTP 429: "rate_limit_exceeded"/)
    // Each round: the call and 3 retries.
    expect(g.calls()).toBe(8)
  })
  it('other requests (the model list) pass untouched', async () => {
    const g = setUp([json(402, {})])
    expect((await g.f('https://api.example.test/v1/models')).status).toBe(402)
    expect(g.stops).toHaveLength(0)
  })
  it("its stop is the budget's: every later call is refused, and the run stops at its next step", async () => {
    const budget = new Budget(1_000_000, 1_000_000, () => ({ in: 0, out: 0 }))
    let sent = 0
    const next = (async () => {
      sent++
      return json(402, { error: { message: 'Insufficient Balance' } })
    }) as unknown as typeof fetch
    const f = budget.wrap(guardFetch(next, { provider: 'DeepSeek', log: () => {}, stop: (w) => (budget.hit ??= w) }))
    await f(chat, post)
    expect(budget.hit).toMatch(/^PROVIDER STOP/)
    const again = await f(chat, post)
    expect(sent).toBe(1)
    expect(await again.text()).toMatch(/The trap run stopped: PROVIDER STOP/)
  })
})

