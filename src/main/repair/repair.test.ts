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
import * as mem from '../db/memory'
import type { MemoryModel } from '../keeper/model'
import { ALL_CHECKS } from '@shared/contracts/checks'
import { checkIfWanted, checkNewWords, criticChecks, KEEP_PROMPTS, noteStage, placeInScene, repairsApplied, repairWanted, resetRepairsForTests } from './index'
import { REPAIR_MARKER } from './prompts'
import { SECOND_MARKER } from './second'

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
      bothTrue: 'no',
      between: 'nothing',
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

function world(adams = ADAMS): { db: Database.Database; sceneId: ID; recordId: ID } {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const sceneId = repo.getOutline(db, story.id).scenes[0].id
  repo.createEntry(db, 'character', { name: 'Mara' })
  repo.createEntry(db, 'character', { name: 'Tobin' })
  const text = `${adams}\n\n${AI}`
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
    const fetchImpl = answering(SLIPS)
    const out = await checkNewWords(opts(db, fetchImpl), landed(sceneId, recordId))

    // One call, with the stage's values and their words, and the new words to check; then the second opinion on its
    // two slips (repair/second.ts; this stand-in's reply gives no verdicts, so it drops nothing).
    expect(fetchImpl.asked).toHaveLength(2)
    expect(fetchImpl.asked[0].system.startsWith(REPAIR_MARKER)).toBe(true)
    expect(fetchImpl.asked[1].system.startsWith(SECOND_MARKER)).toBe(true)
    expect(fetchImpl.asked[0].user).toContain('- [W2] Mara · wearing: hood back · words: "pushed her hood back"')
    expect(fetchImpl.asked[0].user).toContain(`## The new words (check these)\n"""\n${AI}\n"""`)
    // The critic after the draft leaves out continuity, which this check covered (there was a stage to compare with);
    // with no scenes before and nothing known by anyone, the timeline and who knows what stay the critic's.
    expect(await criticChecks([recordId], 0)).toEqual(['facts', 'knowledge', 'timeline', 'voice', 'style'])

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

  it('the compass case: a thing given away chapters back and used again is asked about, never mended', async () => {
    const db = memoryWorld()
    const story = repo.listStories(db)[0]
    const outline = repo.getOutline(db, story.id)
    const [s1, sceneId] = [outline.scenes[0].id, repo.createScene(db, outline.chapters[0].id).id]
    const wren = repo.createEntry(db, 'character', { name: 'Wren' })
    repo.createEntry(db, 'character', { name: 'Mother Agate' })
    const compass = repo.createEntry(db, 'item', { name: 'The brass compass', aliases: ["Wren's compass"] })
    const note = (text: string) => mem.insertChange(db, { entryId: wren.id, anchor: 'scene', sceneId: s1, kind: 'update', payload: { note: text }, origin: 'text' })
    note("gave her grandmother's brass compass to Mother Agate as a toll")
    // Many things happen to her after: it is long out of her last few.
    for (let i = 0; i < 12; i++) note(`walked on through the rain, day ${i}`)
    repo.updateSceneCard(db, sceneId, { ...repo.getScene(db, sceneId).card, povId: wren.id, presentIds: [wren.id] })
    const before = 'Fog came down on the fell.'
    const ai = 'Wren took the compass out of her pocket and looked at the needle.'
    const text = `${before}\n\n${ai}`
    repo.saveSceneText(db, sceneId, { type: 'doc', content: text.split('\n\n').map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) }, text)
    gens.insertGeneration(db, {
      id: 'draft-c',
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
    gens.finishGeneration(db, 'draft-c', { status: 'complete', error: null, response: ai, promptTokens: 1, completionTokens: 1, cost: null, finishedAt: '2026-10-07T09:00:01.000Z' })
    const claim = {
      quote: 'Wren took the compass out of her pocket',
      who: 'Wren',
      about: 'owns',
      line: 'O1',
      verdict: 'slip',
      bothTrue: 'no',
      between: 'nothing',
      why: 'Wren gave her compass to Mother Agate as a toll.',
      question: 'Wren gave her compass to Mother Agate. Should she get it back first, or find her way without it?',
      fix: { replace: 'took the compass out of her pocket', with: 'wished for the compass' }
    }
    const fetchImpl = answering({ claims: [claim] })
    const out = await checkNewWords(opts(db, fetchImpl), { sceneId, recordId: 'draft-c', paragraphs: [{ text: ai, from: 0, to: ai.length }], leadIn: before })
    const asked = fetchImpl.asked[0]
    expect(asked.system).toContain('O what people here gave away, lost or got')
    expect(asked.user).toContain(
      "## What people here no longer have, or have now (O ids)\n- [O1] Wren: no longer has the brass compass (gave her grandmother's brass compass to Mother Agate as a toll; since Book 1, Ch 1, Sc 1)"
    )
    // "the compass" in the new words finds the entry by its main word.
    expect(asked.user).toMatch(/### E\d The brass compass \(item; named in the scene\)/)
    // A slip against the memory is always a question, never mended.
    expect(out).toMatchObject({ fixes: [], questions: 1, slips: 1 })
    const open = cdb.sceneIssueRows(db, sceneId).filter((r) => r.status === 'open')
    expect(open.map((r) => [r.quote, r.message])).toEqual([['Wren took the compass out of her pocket', claim.question]])
    expect(JSON.parse(open[0].payload_json as string).sources).toEqual([{ kind: 'entry', entryId: compass.id, name: 'the brass compass', field: null }])
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
    // Nothing on the stage was compared, so the critic still checks continuity.
    expect(await criticChecks([recordId], 0)).toEqual(ALL_CHECKS)
  })

  it('finds nothing when the model fails, and leaves the whole check to the critic', async () => {
    const { db, sceneId, recordId } = world()
    noteStage(recordId, sceneId, STAGE)
    const out = await checkNewWords(opts(db, answering(null, 400)), landed(sceneId, recordId))
    expect(out.repairId).toBeNull()
    expect(await criticChecks([recordId], 0)).toEqual(ALL_CHECKS)
    expect(cdb.sceneIssueRows(db, sceneId)).toEqual([])
  })

  it('the critic waits for a check still running, and checks it all when the check is too slow or one of the drafts went unchecked', async () => {
    const { db, sceneId, recordId } = world()
    noteStage(recordId, sceneId, STAGE)
    const slow = answering(SLIPS)
    const late = ((...args: Parameters<typeof fetch>) => new Promise<Response>((r) => setTimeout(() => r(slow(...args)), 150))) as typeof fetch
    const running = checkNewWords(opts(db, late), landed(sceneId, recordId))
    // Asked while it runs: too short a wait, and it checks everything.
    expect(await criticChecks([recordId], 10)).toEqual(ALL_CHECKS)
    // Long enough: it waits, then leaves out what was covered.
    expect(await criticChecks([recordId], 5_000)).toEqual(['facts', 'knowledge', 'timeline', 'voice', 'style'])
    await running
    // Two drafts in a row, the second never checked (Adam was in another scene): everything.
    expect(await criticChecks([recordId, 'draft-2'], 0)).toEqual(ALL_CHECKS)
  })

  it('stops at once when the world closes: nothing found, nothing written, the critic checks it all', async () => {
    const { db, sceneId, recordId } = world()
    noteStage(recordId, sceneId, STAGE)
    const stop = new AbortController()
    stop.abort()
    const out = await checkNewWords({ ...opts(db, answering(SLIPS)), signal: stop.signal }, landed(sceneId, recordId))
    expect(out.repairId).toBeNull()
    expect(cdb.sceneIssueRows(db, sceneId)).toEqual([])
    expect(await criticChecks([recordId], 0)).toEqual(ALL_CHECKS)
  })

  it("never mends a paragraph Adam typed in as it streamed, or one with words that aren't in the AI's record: it asks", async () => {
    const { db, sceneId, recordId } = world()
    noteStage(recordId, sceneId, STAGE)
    const edited = landed(sceneId, recordId)
    edited.paragraphs[0] = { ...edited.paragraphs[0], edited: true } as (typeof edited.paragraphs)[number]
    const out = await checkNewWords(opts(db, answering(SLIPS)), edited)
    expect(out.fixes).toEqual([])
    expect(out.questions).toBe(2)

    // His words in the paragraph, though the page didn't see him type them: not all in the record, so not mended.
    const two = world()
    noteStage(two.recordId, two.sceneId, STAGE)
    const typed = landed(two.sceneId, two.recordId)
    const text = `Her hood was up. ${typed.paragraphs[0].text}`
    typed.paragraphs[0] = { text, from: 0, to: text.length }
    const got = await checkNewWords(opts(two.db, answering(SLIPS)), typed)
    expect(got.fixes).toEqual([])
  })

  it("points a question at the new words, not at the same words earlier in Adam's", async () => {
    const adams = `Tobin was waiting by the door, Mara thought. ${ADAMS}`
    const { db, sceneId, recordId } = world(adams)
    noteStage(recordId, sceneId, STAGE)
    await checkNewWords(opts(db, answering(SLIPS)), { ...landed(sceneId, recordId), beforeChars: adams.length })
    const asked = cdb.sceneIssueRows(db, sceneId).find((r) => r.quote === 'Tobin was waiting by the door')!
    expect(JSON.parse(asked.payload_json as string)).toMatchObject({ occurrence: 1 })
    expect(placeInScene('a cup. a cup.', 'a cup', 3)).toBe(7)
    expect(placeInScene('a cup.', 'a cup', 5)).toBe(0)
  })

  it(`keeps the whole prompt of a scene's newest ${KEEP_PROMPTS} checks only; older ones keep their cost and reply`, async () => {
    const { db, sceneId, recordId } = world()
    noteStage(recordId, sceneId, STAGE)
    for (let i = 0; i < KEEP_PROMPTS + 2; i++) await checkNewWords(opts(db, answering({ claims: [] })), landed(sceneId, recordId))
    const rows = db.prepare("SELECT messages_json, blocks_json, response FROM generations WHERE job = 'memory' AND scene_id = ?").all(sceneId) as Record<string, string>[]
    expect(rows).toHaveLength(KEEP_PROMPTS + 2)
    expect(rows.filter((r) => r.messages_json.includes(REPAIR_MARKER))).toHaveLength(KEEP_PROMPTS)
    expect(rows.filter((r) => r.messages_json === '[]' && r.blocks_json === '[]' && r.response.includes('claims'))).toHaveLength(2)
  })

  it('asks nothing for too few new words', async () => {
    const { db, sceneId, recordId } = world()
    const fetchImpl = answering(SLIPS)
    const out = await checkNewWords(opts(db, fetchImpl), { ...landed(sceneId, recordId), paragraphs: [{ text: 'Yes.', from: 0, to: 4 }] })
    expect(out.repairId).toBeNull()
    expect(fetchImpl.asked).toHaveLength(0)
  })
})

describe('the off switch', () => {
  it('is on unless Adam turns it off, and AIWRITE_REPAIR=off always turns it off', () => {
    expect(repairWanted({ checkNewWords: true }, {})).toBe(true)
    expect(repairWanted({}, {})).toBe(true)
    expect(repairWanted({ checkNewWords: true }, { AIWRITE_REPAIR: 'on' })).toBe(true)
    expect(repairWanted({ checkNewWords: false }, { AIWRITE_REPAIR: 'on' })).toBe(false)
    expect(repairWanted({ checkNewWords: true }, { AIWRITE_REPAIR: 'off' })).toBe(false)
  })

  it('off, no call is made and the critic after the draft checks everything; on, it leaves out what was checked', async () => {
    const { db, sceneId, recordId } = world()
    noteStage(recordId, sceneId, STAGE)
    const off = answering(SLIPS)
    const out = await checkIfWanted(opts(db, off), landed(sceneId, recordId), { checkNewWords: false }, {})
    expect(out).toMatchObject({ repairId: null, fixes: [], questions: 0 })
    expect(off.asked).toHaveLength(0)
    expect(cdb.sceneIssueRows(db, sceneId)).toEqual([])
    expect(await criticChecks([recordId], 0)).toEqual(ALL_CHECKS)

    const on = answering(SLIPS)
    await checkIfWanted(opts(db, on), landed(sceneId, recordId), { checkNewWords: true }, {})
    // The check, then the second opinion on its slips.
    expect(on.asked).toHaveLength(2)
    expect(await criticChecks([recordId], 0)).toEqual(['facts', 'knowledge', 'timeline', 'voice', 'style'])
  })
})
