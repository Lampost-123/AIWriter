// What one run of Write the whole chapter asks of the AI (token audit, 2026-10-19): a fake-provider run of a chapter of
// three scenes after a chapter of long ones, with models that read a million tokens (as DeepSeek Flash does) and an
// agent that looks things up three at a time until it is told there are no more look-ups (fake/agent-greedy, as a live
// model did). Every chat request is counted, with the characters of its messages, by what asked it; the run must stay
// within what the quick wins brought it down to.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import { ALL_CHECKS } from '@shared/contracts/checks'
import * as repo from '../db/repo'
import { memoryWorld } from '../../../tests/unit/helpers'
import { fakeProse, startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import type { JobModel } from '../ai/jobModel'
import { checkScene } from '../checks/run'
import { runCritique } from '../critique/run'
import { ChapterRun, type RunDeps } from './run'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0 })
})
afterAll(() => fake.close())

const PREFS = { spelling: 'UK' as const, pov: '', tense: '', voiceNotes: '', avoidWords: [] }
const MILLION = 1_000_000

const model = (modelId: string, job: JobModel['job']): JobModel => ({
  job,
  target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' },
  choice: { providerId: 'p1', modelId, label: modelId, contextLength: MILLION, promptPrice: null, completionPrice: null },
  thinking: 'off'
})

/** A scene's words, every paragraph its own (so a revise finds its words once). */
const prose = (tag: string, paragraphs: number): string =>
  Array.from({ length: paragraphs }, (_, i) =>
    [
      `${tag} paragraph ${i + 1} opens as Mara walks down to the water past the ${i + 1} sheds.`,
      `Tobin watches her from post ${i + 1} of the jetty and says nothing for a long while.`,
      `Rain keeps on over the ${tag} roofs, slow and grey, as the tide turns.`
    ].join(' ')
  ).join('\n\n')

/** Chapter 1: three long scenes, written. Chapter 2: three scene cards, to be written. */
function world() {
  const db = memoryWorld()
  const [story] = repo.listStories(db)
  const outline = repo.getOutline(db, story.id)
  const one = outline.chapters[0].id
  const earlier = [outline.scenes[0].id, repo.createScene(db, one).id, repo.createScene(db, one).id]
  for (const id of earlier) repo.saveSceneText(db, id, null, fakeProse(4000))
  const two = repo.createChapter(db, story.id, { title: 'The crossing' }).id
  const scenes = [repo.createScene(db, two, { title: 'The ferry' }).id, repo.createScene(db, two, { title: 'The inn' }).id, repo.createScene(db, two, { title: 'The road' }).id]
  repo.createEntry(db, 'character', { name: 'Mara', summary: 'Runs the ferry.' })
  repo.createEntry(db, 'character', { name: 'Tobin', summary: 'A ferryman.' })
  scenes.forEach((id, i) => repo.updateSceneCard(db, id, { ...repo.getScene(db, id).card, goal: `Mara crosses, part ${i + 1}.` }))
  return { db, chapterId: two, scenes }
}

function deps(db: RunDeps['db'], scenes: ID[], agent: string): RunDeps {
  return {
    db,
    agentModel: model(agent, 'chapter'),
    prefs: PREFS,
    taskEmit: () => undefined,
    progress: () => undefined,
    sceneChanged: () => undefined,
    draft: async (sceneId) => ({ status: 'complete', text: prose(`Sc${scenes.indexOf(sceneId) + 1}`, 16), error: null }),
    save: (sceneId, page) => {
      repo.saveSceneText(db, sceneId, page.doc, page.text)
    },
    check: async (sceneId, _signal, checks = ALL_CHECKS) => {
      const r = await checkScene({ db, model: model('fake/writer', 'check'), prefs: PREFS, stopped: () => false, retryDelays: [] }, sceneId, checks)
      return r.status === 'error' ? { status: 'error', error: r.error } : { status: r.status }
    },
    critique: (target, again) =>
      runCritique({ db, model: model('fake/writer', 'writer'), prefs: PREFS, emit: () => undefined, retryDelays: [] }, { taskId: crypto.randomUUID(), target, again, by: 'chapter-writer' }),
    limitNote: () => null,
    closed: () => false,
    retryDelays: []
  }
}

interface Sent {
  /** What asked it: "chapter study", "check", "critique"... (the system prompt's marker). */
  by: string
  chars: number
}

/** Every chat request sent to the fake provider while `fn` runs. */
async function recording<T>(fn: () => Promise<T>): Promise<{ result: T; sent: Sent[] }> {
  const real = globalThis.fetch
  const sent: Sent[] = []
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.startsWith(fake.url) && url.endsWith('/chat/completions') && typeof init?.body === 'string') {
      const body = JSON.parse(init.body) as { messages: { content?: unknown; tool_calls?: { function?: { arguments?: string } }[] }[] }
      const text = (c: unknown): string => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => (p as { text?: string }).text ?? '').join('') : '')
      const system = text(body.messages[0]?.content)
      const m = /^\[AIWRITE-([A-Z-]+) v\d+\]\s*(\w*)/.exec(system)
      sent.push({
        by: m ? `${m[1].toLowerCase()}${m[1] === 'CHAPTER' ? ` ${m[2]}` : ''}` : 'other',
        chars: body.messages.reduce((n, x) => n + text(x.content).length + (x.tool_calls ?? []).reduce((k, c) => k + (c.function?.arguments?.length ?? 0), 0), 0)
      })
    }
    return real(input, init)
  }) as typeof fetch
  try {
    return { result: await fn(), sent }
  } finally {
    globalThis.fetch = real
  }
}

afterEach(() => fake.reset())

/** A run with this agent model: its report, and its requests by what asked them and in all. */
async function measure(agent: string) {
  const { db, chapterId, scenes } = world()
  const run = new ChapterRun(deps(db, scenes, agent), `run-${agent}`, chapterId)
  run.prepare()
  const { result: report, sent } = await recording(() => run.run())
  const by: Record<string, { requests: number; chars: number }> = {}
  for (const s of sent) by[s.by] = { requests: (by[s.by]?.requests ?? 0) + 1, chars: (by[s.by]?.chars ?? 0) + s.chars }
  const total = { requests: sent.length, chars: sent.reduce((n, s) => n + s.chars, 0) }
  console.log(`${agent}: ${total.requests} requests, ${total.chars.toLocaleString('en-GB')} characters, ${report.status} after ${report.rounds} rounds`, by)
  return { report, by, total }
}

describe('what a chapter run asks of the AI', () => {
  it('with an agent that looks things up until it is stopped', { timeout: 60_000 }, async () => {
    const { report, total } = await measure('fake/agent-greedy')
    expect(['done', 'stuck']).toContain(report.status)
    // The study writes its brief within its requests (with 16 requests and 40 look-ups it ran out first).
    expect(report.brief).toContain('Keep Sc 3 true to the memory.')
    expect(total.requests).toBeGreaterThan(0)
  })

  it('with an agent that goes straight to work', { timeout: 60_000 }, async () => {
    const { report, total } = await measure('fake/writer')
    expect(report.status).toBe('done')
    expect(total.requests).toBeGreaterThan(0)
  })
})
