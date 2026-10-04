// "Interview me": what the World builder model is told for each question, how its reply is read, and one
// question asked of the fake provider (tests/fake-provider/m4/worldInterview.mjs).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { memoryWorld } from '../../../tests/unit/helpers'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import * as gens from '../db/generations'
import { stopTask } from '../ai/tasks'
import type { JobModel } from '../ai/jobModel'
import { estimateTokens } from '../keeper/text'
import {
  askedText,
  askQuestion,
  cleanTopic,
  fitSummary,
  interviewMessages,
  interviewSystem,
  interviewUser,
  NO_QUESTION,
  readQuestion,
  repeatOf
} from './interview'

const SUMMARY = 'Mara Venn is a smuggler captain who owes the Salt Guild a fortune. Magic always costs blood.'

describe('what the model is told', () => {
  it('starts with the World builder marker and asks for one short question as JSON', () => {
    const system = interviewSystem()
    expect(system.startsWith('[AIWRITE-WORLD v1] interview\n')).toBe(true)
    expect(system).toContain('{"topic": "...", "question": "..."}')
    expect(system).toMatch(/one sentence of at most 25 words/)
    expect(system).toMatch(/Never ask again about a topic already asked/)
  })

  it('gives the summary as it stands, and what was asked before, answered or skipped', () => {
    const user = interviewUser(SUMMARY, [
      { topic: 'Premise', question: 'What is it about?', skipped: false },
      { topic: 'Tone', question: 'How should it feel?', skipped: true }
    ])
    expect(user).toContain(`"""\n${SUMMARY}\n"""`)
    expect(user).toContain('- Premise: What is it about? (answered: the answer is now in the summary)')
    expect(user).toContain('- Tone: How should it feel? (skipped)')
    expect(user.endsWith('Ask the next question now, as one JSON object.')).toBe(true)
  })

  it('starts with the premise when there is no summary yet', () => {
    expect(interviewUser('  ', [])).toContain("The author hasn't written a summary yet. Start with the premise.")
    expect(askedText([])).toBe('')
  })

  it('tells only the latest questions of a long interview', () => {
    const asked = Array.from({ length: 40 }, (_, i) => ({ topic: `Topic ${i}`, question: `Question ${i}?`, skipped: false }))
    const text = askedText(asked)
    expect(text).not.toContain('Topic 9:')
    expect(text).toContain('Topic 10:')
    expect(text).toContain('Topic 39:')
  })

  it('cuts a summary too long for the model in the middle, keeping its start and end', () => {
    const long = `START ${'word '.repeat(20_000)}END`
    const fitted = fitSummary(long, 2000)
    expect(estimateTokens(fitted)).toBeLessThanOrEqual(2000)
    expect(fitted.startsWith('START')).toBe(true)
    expect(fitted.endsWith('END')).toBe(true)
    expect(fitted).toContain('\n[…]\n')
    expect(fitSummary(SUMMARY, 2000)).toBe(SUMMARY)
    // The messages leave room for the instructions and the reply in a small window.
    const messages = interviewMessages(long, [], 8000)
    expect(estimateTokens(messages.map((m) => m.content).join('\n'))).toBeLessThan(8000 - 400)
  })
})

describe('reading the reply', () => {
  it('reads the JSON asked for, fenced or not, whatever the keys are called', () => {
    expect(readQuestion('{"topic": "Setting", "question": "Where does it take place?"}')).toEqual({
      topic: 'Setting',
      question: 'Where does it take place?'
    })
    expect(readQuestion('```json\n{"Topic": "mara\'s goal:", "Question": "What does Mara want most?"}\n```')).toEqual({
      topic: "Mara's goal",
      question: 'What does Mara want most?'
    })
    expect(readQuestion('{"question": "How does it end?"}')).toEqual({ topic: 'More', question: 'How does it end?' })
  })

  it('reads plain lines, or a lone question, from a model that ignored the JSON', () => {
    expect(readQuestion('Topic: **The ending**\nQuestion: How does the story end?')).toEqual({
      topic: 'The ending',
      question: 'How does the story end?'
    })
    expect(readQuestion('Sure!\nWho is Mara up against?')).toEqual({ topic: 'More', question: 'Who is Mara up against?' })
  })

  it('finds nothing in a reply with no question', () => {
    expect(readQuestion('')).toBeNull()
    expect(readQuestion('I read it, and it is a fine world.')).toBeNull()
    expect(readQuestion('{"topic": "Setting"}')).toBeNull()
  })

  it('makes a topic read well as a label: one line, a capital first, not too long', () => {
    expect(cleanTopic('  setting.  ')).toBe('Setting')
    expect(cleanTopic('Topic: How\nmagic works:')).toBe('How magic works')
    expect(cleanTopic('The long and winding history of the Salt Guild and its many wars')).toBe('The long and winding history of the Salt')
    expect(cleanTopic(42)).toBe('42')
    expect(cleanTopic(null)).toBe('')
  })
})

describe('asking a question', () => {
  let fake: FakeProvider
  beforeAll(async () => {
    fake = await startFakeProvider({ delayMs: 0, slowDelayMs: 40 })
  })
  afterAll(() => fake.close())

  const modelFor = (modelId = 'fake/writer'): JobModel => ({
    job: 'world',
    target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: 'test' },
    choice: { providerId: 'p1', modelId, label: modelId, contextLength: 32000, promptPrice: 0.000001, completionPrice: 0.000002 },
    thinking: 'off'
  })

  it('asks the World builder model once per question, recorded as a world call', async () => {
    const db = memoryWorld()
    const ctx = { db, model: modelFor(), emit: () => undefined, retryDelays: [1, 1] }
    const first = await askQuestion(ctx, { taskId: 't1', summary: SUMMARY, asked: [] })
    expect(first).toMatchObject({ status: 'complete', topic: 'Premise', error: null })
    expect(first.question).toBe('What is the story about, and what sets it going?')
    const record = gens.getGeneration(db, first.generationId)
    expect(record.job).toBe('world')
    expect(record.sceneId).toBe('')
    expect(record.messages[0].content.startsWith('[AIWRITE-WORLD v1] interview')).toBe(true)
    expect(record.messages[1].content).toContain(SUMMARY)

    const next = await askQuestion(ctx, {
      taskId: 't2',
      summary: `${SUMMARY}\n\nPremise: A debt comes due.`,
      asked: [{ topic: 'Premise', question: first.question, skipped: false }]
    })
    expect(next).toMatchObject({ status: 'complete', topic: 'Main characters' })
  })

  it('says it stopped when Stop is pressed, with no question', async () => {
    const db = memoryWorld()
    const asking = askQuestion({ db, model: modelFor('fake/slow'), emit: () => undefined }, { taskId: 't3', summary: '', asked: [] })
    await stopTask('t3')
    expect(await asking).toMatchObject({ status: 'stopped', question: '', topic: '' })
  })

  it('says so in plain words when the reply holds no question', async () => {
    const db = memoryWorld()
    const q = await askQuestion(
      { db, model: modelFor('fake/world-junk'), emit: () => undefined },
      { taskId: 't4', summary: SUMMARY, asked: [] }
    )
    expect(q).toMatchObject({ status: 'error', question: '', error: NO_QUESTION })
  })
})

describe('repeated questions', () => {
  it('shows the model each answer beside its question', () => {
    const text = askedText([{ topic: 'Setting', question: 'Where is it set?', skipped: false, answer: 'A drowned city of canals.' }])
    expect(text).toContain('- Setting: Where is it set? (answered: "A drowned city of canals.")')
  })

  it('tells a repeat: the same topic, mostly the same words, or an answer already in the summary', () => {
    const asked = [{ topic: 'Mara’s goal', question: 'What does Mara want most from the Salt Guild?', skipped: false }]
    expect(repeatOf({ topic: 'Mara’s goal', question: 'Anything?' }, asked, '')).toBe('Mara’s goal')
    expect(repeatOf({ topic: 'What Mara wants', question: 'What does Mara most want from the Salt Guild?' }, asked, '')).toBe('Mara’s goal')
    expect(repeatOf({ topic: 'Setting', question: 'Where does it happen?' }, [], 'A story.\n\nSetting: A drowned city.')).toBe('Setting')
    expect(repeatOf({ topic: 'Tone', question: 'How should it feel to read?' }, asked, 'Setting: A drowned city.')).toBeNull()
  })

  it('sends a repeated question back once, and asks something new', async () => {
    const fake = await startFakeProvider({ delayMs: 0 })
    try {
      const db = memoryWorld()
      const model: JobModel = {
        job: 'world',
        target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: 'test' },
        choice: { providerId: 'p1', modelId: 'fake/world-repeat', label: 'r', contextLength: 32000, promptPrice: 0, completionPrice: 0 },
        thinking: 'off'
      }
      const q = await askQuestion(
        { db, model, emit: () => undefined, retryDelays: [1] },
        { taskId: 'r1', summary: `${SUMMARY}\n\nPremise: A debt comes due.`, asked: [{ topic: 'Premise', question: 'What is it about?', skipped: false, answer: 'A debt comes due.' }] }
      )
      expect(q).toMatchObject({ status: 'complete', topic: 'Main characters' })
    } finally {
      await fake.close()
    }
  })
})
