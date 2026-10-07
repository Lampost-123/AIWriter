// Check and repair end to end in the main process: one call on the memory model per landing, told where things stood
// as the writer was told it (with each value's words) and the new words; the small slip goes back to the page to mend,
// the slip that needs a choice is raised as a question at once, and once the page says what it mended, that is kept as
// a fixed issue (what it couldn't mend becomes a question too). A slip Adam said is meant to be so is never mended or
// asked again. The model is a stand-in; the text is invented.
import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import type { SceneState } from '@shared/continuity'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import * as gens from '../db/generations'
import * as cdb from '../db/checks'
import type { MemoryModel } from '../keeper/model'
import { checkNewWords, noteStage, repairedSince, repairsApplied, resetRepairsForTests } from './index'
import { REPAIR_MARKER } from './prompts'

const model: MemoryModel = {
  target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'test' },
  choice: { providerId: 'p1', modelId: 'fake/writer', label: 'fake', contextLength: 32000, promptPrice: null, completionPrice: null }
}

const ADAMS = 'Mara pushed her hood back and lay down on the bench. Tobin left for the docks.'
const AI = 'Mara kept her hood low and watched the fire.\n\nTobin was waiting by the door, as he had promised.'

const STAGE: SceneState = {
  time: '',
  weather: '',
  light: '',
  characters: [
    { name: 'Mara', where: 'the inn', wearing: 'hood back', posture: 'lying on the bench', holding: '', condition: '', mood: '', lastAction: '' },
    { name: 'Tobin', where: 'gone to the docks', wearing: '', posture: '', holding: '', condition: '', mood: '', lastAction: '' }
  ],
  said: {
    'mara|wearing': { quote: 'pushed her hood back', sceneId: 's' },
    'tobin|where': { quote: 'Tobin left for the docks', sceneId: 's' }
  }
}

/** The stand-in memory model: answers every request with `reply`, and keeps what it was asked. */
function answering(reply: unknown, status = 200): typeof fetch & { asked: { system: string; user: string }[] } {
  const asked: { system: string; user: string }[] = []
  const f = (async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { messages: { content: string }[] }
    asked.push({ system: body.messages[0].content, user: body.messages[1].content })
    if (status !== 200) return new Response(JSON.stringify({ error: { message: 'Bad request' } }), { status })
    const chunk = { choices: [{ index: 0, delta: { content: JSON.stringify(reply) }, finish_reason: 'stop' }] }
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  }) as typeof fetch & { asked: { system: string; user: string }[] }
  f.asked = asked
  return f
}

const SLIPS = {
  claims: [
    {
      quote: 'Mara kept her hood low',
      who: 'Mara',
      about: 'wearing',
      line: 'W2',
      verdict: 'slip',
      why: 'Mara pushed her hood back earlier, so it is down.',
      fix: { replace: 'kept her hood low', with: 'kept her hood down' }
    },
    {
      quote: 'Tobin was waiting by the door',
      who: 'Tobin',
      about: 'where',
      line: 'W4',
      verdict: 'slip',
      why: 'Tobin left for the docks.',
      question: 'Tobin left for the docks. Should he come back first, or is someone else waiting?'
    },
    { quote: 'watched the fire', who: 'Mara', about: 'posture', line: 'W3', verdict: 'fits', why: '' }
  ]
}

function world(): { db: Database.Database; sceneId: ID; recordId: ID } {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const sceneId = repo.getOutline(db, story.id).scenes[0].id
  repo.createEntry(db, 'character', { name: 'Mara' })
  repo.createEntry(db, 'character', { name: 'Tobin' })
  const text = `${ADAMS}\n\n${AI}`
  repo.saveSceneText(db, sceneId, { type: 'doc', content: text.split('\n\n').map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) }, text)
  const recordId = 'draft-1'
  gens.insertGeneration(db, {
    id: recordId,
    sceneId,
    job: 'draft',
    providerId: 'p1',
    providerName: 'Fake',
    modelId: 'fake/writer',
    params: { temperature: 1, top_p: 1, max_tokens: 1000 },
    direction: '',
    blocks: [],
    messages: [],
    budget: { contextLength: 0, reserved: 0, available: 0, used: 0 },
    entries: [],
    createdAt: '2026-10-07T09:00:00.000Z'
  })
  gens.finishGeneration(db, recordId, { status: 'complete', error: null, response: AI, promptTokens: 1, completionTokens: 1, cost: null, finishedAt: '2026-10-07T09:00:01.000Z' })
  return { db, sceneId, recordId }
}

const landed = (sceneId: ID, recordId: ID) => ({
  sceneId,
  recordId,
  paragraphs: AI.split('\n\n').map((text) => ({ text, from: 0, to: text.length })),
  leadIn: ADAMS
})

const opts = (db: Database.Database, fetchImpl: typeof fetch) => ({ db, model, prefs: {} as never, closed: () => false, fetchImpl, retryDelays: [0] })

afterEach(() => resetRepairsForTests())

describe('check and repair', () => {
  it('checks the new words in one call against the stage the writer was told, mends the small slip and asks the other', async () => {
    const { db, sceneId, recordId } = world()
    noteStage(recordId, sceneId, STAGE)
    const started = Date.now()
    const fetchImpl = answering(SLIPS)
    const out = await checkNewWords(opts(db, fetchImpl), landed(sceneId, recordId))

    // One call, with the stage's values and their words, and the new words to check.
    expect(fetchImpl.asked).toHaveLength(1)
    expect(fetchImpl.asked[0].system.startsWith(REPAIR_MARKER)).toBe(true)
    expect(fetchImpl.asked[0].user).toContain('- [W2] Mara · wearing: hood back · words: "pushed her hood back"')
    expect(fetchImpl.asked[0].user).toContain(`## The new words (check these)\n"""\n${AI}\n"""`)
    expect(repairedSince(sceneId, started)).toBe(true)

    expect(out).toMatchObject({ questions: 1, claims: 3, slips: 2 })
    expect(out.fixes).toEqual([
      expect.objectContaining({ para: 0, start: 'Mara '.length, end: 'Mara kept her hood low'.length, was: 'kept her hood low', now: 'kept her hood down' })
    ])
    // The question is in the Issues tab now, on the draft's own words.
    const open = cdb.sceneIssueRows(db, sceneId).filter((r) => r.status === 'open')
    expect(open.map((r) => [r.kind, r.quote, r.message])).toEqual([
      ['continuity', 'Tobin was waiting by the door', 'Tobin left for the docks. Should he come back first, or is someone else waiting?']
    ])

    // The page mended it: kept as a fixed issue.
    const ids = repairsApplied(out.repairId!, [out.fixes[0].id])
    const fixed = cdb.issueRow(db, ids[out.fixes[0].id])!
    expect(fixed).toMatchObject({ status: 'fixed', kind: 'continuity', quote: 'Mara kept her hood low' })
    expect(JSON.parse(fixed.payload_json as string)).toMatchObject({ fix: 'Mara kept her hood down' })
  })

  it('asks about a fix the page could not make (Adam was in those words), with the fix to review', async () => {
    const { db, sceneId, recordId } = world()
    noteStage(recordId, sceneId, STAGE)
    const out = await checkNewWords(opts(db, answering(SLIPS)), landed(sceneId, recordId))
    expect(repairsApplied(out.repairId!, [])).toEqual({})
    const asked = cdb.sceneIssueRows(db, sceneId).find((r) => r.quote === 'Mara kept her hood low')!
    expect(asked.status).toBe('open')
    expect(asked.message).toBe('Mara pushed her hood back earlier, so it is down. Use the fix, or keep it as it is?')
    expect(JSON.parse(asked.payload_json as string)).toMatchObject({ fix: 'Mara kept her hood down' })
  })

  it('never mends or asks again about a slip Adam said is meant to be so', async () => {
    const { db, sceneId, recordId } = world()
    noteStage(recordId, sceneId, STAGE)
    const first = await checkNewWords(opts(db, answering(SLIPS)), landed(sceneId, recordId))
    const ids = repairsApplied(first.repairId!, [first.fixes[0].id])
    // Undo in the page: the AI's words are back, and that slip is ignored.
    cdb.setIssueStatus(db, ids[first.fixes[0].id], 'ignored')
    const question = cdb.sceneIssueRows(db, sceneId).find((r) => r.status === 'open')!
    cdb.setIssueStatus(db, question.id as ID, 'ignored')
    const again = await checkNewWords(opts(db, answering(SLIPS)), landed(sceneId, recordId))
    expect(again.fixes).toEqual([])
    expect(again.questions).toBe(0)
  })

  it('mends nothing on the stage when it is not known where things stood', async () => {
    const { db, sceneId, recordId } = world()
    const fetchImpl = answering(SLIPS)
    const out = await checkNewWords(opts(db, fetchImpl), landed(sceneId, recordId))
    expect(fetchImpl.asked[0].user).toContain('Nothing is known yet about where things stand.')
    expect(out).toMatchObject({ fixes: [], questions: 0, claims: 0 })
  })

  it('finds nothing when the model fails, and leaves the whole check to the critic', async () => {
    const { db, sceneId, recordId } = world()
    noteStage(recordId, sceneId, STAGE)
    const out = await checkNewWords(opts(db, answering(null, 400)), landed(sceneId, recordId))
    expect(out.repairId).toBeNull()
    expect(repairedSince(sceneId, 0)).toBe(false)
    expect(cdb.sceneIssueRows(db, sceneId)).toEqual([])
  })

  it('asks nothing for too few new words', async () => {
    const { db, sceneId, recordId } = world()
    const fetchImpl = answering(SLIPS)
    const out = await checkNewWords(opts(db, fetchImpl), { ...landed(sceneId, recordId), paragraphs: [{ text: 'Yes.', from: 0, to: 4 }] })
    expect(out.repairId).toBeNull()
    expect(fetchImpl.asked).toHaveLength(0)
  })
})
