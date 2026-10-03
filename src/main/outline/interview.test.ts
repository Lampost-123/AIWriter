import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { emptySceneCard } from '@shared/defaults'
import type { ModelChoice } from '@shared/types'
import * as repo from '../db/repo'
import * as gens from '../db/generations'
import type { JobModel } from '../ai/jobModel'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import { dbWorld } from '../../../tests/unit/testWorld'
import { chapterAroundText } from './brief'
import { storyPlan } from './context'
import {
  answersText,
  askPlanQuestion,
  cleanAnswers,
  emptyParts,
  fillSceneCard,
  matchEntry,
  MOST_QUESTIONS,
  readPlanQuestion,
  readSceneFill,
  startChapterPlan
} from './interview'
import { MARKER } from './prompts'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0 })
})
afterAll(() => fake.close())

const choice: ModelChoice = {
  providerId: 'p1',
  modelId: 'fake/writer',
  label: 'Fake',
  contextLength: 32000,
  promptPrice: null,
  completionPrice: null
}
const model = (): JobModel => ({
  job: 'chat',
  target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: 'k' },
  choice,
  thinking: 'off'
})
const deps = (db: ReturnType<typeof dbWorld>['db']) => ({ db, model: model(), emit: () => undefined })

describe('reading the interview’s replies', () => {
  it('reads a question, or that the AI is done', () => {
    expect(readPlanQuestion('{"topic": "who\'s there.", "question": "Who walks in first?"}')).toEqual({
      topic: "Who's there",
      question: 'Who walks in first?',
      done: false
    })
    expect(readPlanQuestion('```json\n{"done": true}\n```')).toEqual({ topic: '', question: '', done: true })
    expect(readPlanQuestion('Done.')).toEqual({ topic: '', question: '', done: true })
    expect(readPlanQuestion('Topic: The ending\nQuestion: How should it end?')).toEqual({
      topic: 'The ending',
      question: 'How should it end?',
      done: false
    })
    expect(readPlanQuestion('Sure! How should it end?')).toEqual({ topic: 'More', question: 'Sure! How should it end?', done: false })
    expect(readPlanQuestion('{"nothing": 1}')).toBeNull()
  })

  it('matches names to the world’s entries, by name, alias or a first name that only one has', () => {
    const people = [
      { id: 'm', name: 'Mara Venn', aliases: ['the thief'] },
      { id: 't', name: 'Tobin', aliases: [] },
      { id: 'k1', name: 'Kell Ash', aliases: [] },
      { id: 'k2', name: 'Kell Brand', aliases: [] }
    ]
    expect(matchEntry('mara venn', people)?.id).toBe('m')
    expect(matchEntry('Mara', people)?.id).toBe('m')
    expect(matchEntry("Mara's", people)?.id).toBe('m')
    expect(matchEntry('The Thief', people)?.id).toBe('m')
    expect(matchEntry('Kell', people)).toBeNull()
    expect(matchEntry('Wren', people)).toBeNull()
  })

  it('reads a filled card, keeping only names the world has', () => {
    const fill = readSceneFill(
      JSON.stringify({
        pov: 'Mara',
        present: ['Tobin', 'Someone new'],
        location: 'Harrow Mill',
        goal: ' Get   across. ',
        beats: ['One', '', 'Two'],
        mood: 'Tense',
        conflict: ''
      }),
      [
        { id: 'm', name: 'Mara', aliases: [] },
        { id: 't', name: 'Tobin', aliases: [] }
      ],
      [{ id: 'h', name: 'Harrow Mill', aliases: [] }]
    )
    expect(fill).toEqual({ povId: 'm', presentIds: ['m', 't'], locationId: 'h', goal: 'Get across.', beats: ['One', 'Two'], mood: 'Tense' })
    expect(readSceneFill('not JSON', [], [])).toBeNull()
  })

  it('names a card’s empty parts, and tidies the answers it sends', () => {
    expect(emptyParts(emptySceneCard())).toEqual([
      'point of view',
      'characters present',
      'location',
      'goal',
      'conflict',
      'beats',
      'outcome',
      'mood'
    ])
    expect(emptyParts({ ...emptySceneCard(), goal: 'x', beats: ['a'], mood: 'm', povId: 'p' })).toEqual([
      'characters present',
      'location',
      'conflict',
      'outcome'
    ])
    const asked = cleanAnswers([
      { topic: ' The  end ', question: 'How should it end?', answer: ' She drowns.\r\nOr nearly. ', skipped: false },
      { topic: 'Mood', question: 'How should it feel?', answer: '', skipped: true },
      { topic: 'x', question: '', answer: 'no question' }
    ])
    expect(asked).toHaveLength(2)
    expect(answersText(asked)).toBe(
      "- The end: How should it end?\n  Answer: She drowns. / Or nearly.\n- Mood: How should it feel?\n  (skipped: the author doesn't want to say now)"
    )
  })
})

describe('the interview’s calls', () => {
  it('asks about a scene from its card as it is on screen, then says it is done', async () => {
    const w = dbWorld()
    const sceneId = w.id('b1.c2.s1')
    const card = { ...emptySceneCard(), goal: 'Find the ledger' }
    const first = await askPlanQuestion(deps(w.db), { taskId: 'q1', target: { kind: 'scene', sceneId }, card, asked: [] })
    expect(first).toMatchObject({ status: 'complete', topic: "Who's there", question: 'Who walks in first?', done: false })
    const record = gens.getGeneration(w.db, first.generationId!)
    expect(record.job).toBe('outline')
    expect(record.sceneId).toBe(sceneId)
    const [system, user] = record.messages
    expect(system.content.startsWith(`${MARKER} interview scene`)).toBe(true)
    expect(user.content).toContain('Goal: Find the ledger')
    expect(user.content).toContain('Empty on the card: point of view, characters present, location, conflict, beats, outcome, mood.')
    expect(user.content).toContain('Ask the first question now')

    const asked = [
      { topic: "Who's there", question: 'Who walks in first?', answer: 'Mara', skipped: false },
      { topic: 'The ending', question: 'How should it end?', answer: '', skipped: true },
      { topic: 'The mood', question: 'How should it feel?', answer: 'Cold', skipped: false }
    ]
    const last = await askPlanQuestion(deps(w.db), { taskId: 'q2', target: { kind: 'scene', sceneId }, card, asked })
    expect(last).toMatchObject({ status: 'complete', done: true })
    const user2 = gens.getGeneration(w.db, last.generationId!).messages[1].content
    expect(user2).toContain("## The interview so far\n- Who's there: Who walks in first?\n  Answer: Mara")
  })

  it('stops asking after enough questions, without a call', async () => {
    const w = dbWorld()
    const asked = Array.from({ length: MOST_QUESTIONS }, (_, i) => ({ topic: `T${i}`, question: `Q${i}?`, answer: 'a', skipped: false }))
    const out = await askPlanQuestion(deps(w.db), { taskId: 'q3', target: { kind: 'scene', sceneId: w.id('b1.c1.s1') }, asked })
    expect(out).toEqual({ status: 'complete', generationId: null, topic: '', question: '', done: true, error: null })
  })

  it('fills a scene card from the answers, with names matched to the world', async () => {
    const w = dbWorld()
    const sceneId = w.id('b1.c2.s1')
    const answers = [{ topic: 'Goal', question: 'What does she want?', answer: 'To get the ledger back', skipped: false }]
    const out = await fillSceneCard(deps(w.db), { taskId: 'f1', sceneId, card: emptySceneCard(), answers })
    expect(out.status).toBe('complete')
    expect(out.fill.goal).toBe('To get the ledger back')
    expect(out.fill.beats).toHaveLength(4)
    const entries = repo.listEntries(w.db)
    const pov = entries.find((e) => e.id === out.fill.povId)
    expect(pov?.kind).toBe('character')
    expect(out.fill.presentIds).toEqual([out.fill.povId])
    expect(gens.getGeneration(w.db, out.generationId!).messages[0].content.startsWith(`${MARKER} fill scene`)).toBe(true)
  })

  it('asks nothing to fill a card that is already full', async () => {
    const w = dbWorld()
    const full = {
      ...emptySceneCard(),
      povId: 'p',
      presentIds: ['p'],
      locationId: 'l',
      goal: 'g',
      conflict: 'c',
      beats: ['b'],
      outcome: 'o',
      mood: 'm'
    }
    const out = await fillSceneCard(deps(w.db), { taskId: 'f2', sceneId: w.id('b1.c1.s1'), card: full, answers: [] })
    expect(out).toEqual({ status: 'complete', generationId: null, fill: {}, error: null })
  })

  it('plans a chapter: the chapter and the outline around it, with the answers', async () => {
    const w = dbWorld()
    const chapterId = repo.getSceneMeta(w.db, w.id('b1.c2.s1')).chapterId
    const plan = storyPlan(w.db, w.id('b1'))
    const around = chapterAroundText(plan, chapterId, 'Book 1', 0)
    expect(around).toContain('THE CHAPTER TO PLAN (chapter 2 of 3)')
    expect(around).toContain('The chapter before: Chapter: Chapter 1')
    expect(around).toContain('The chapter after: Chapter: Chapter 3')

    const answers = [
      { topic: 'What happens', question: 'What happens in this chapter?', answer: 'A letter comes for Mara', skipped: false }
    ]
    const { generationId } = startChapterPlan(deps(w.db), { taskId: 'c1', chapterId, answers })
    const t0 = Date.now()
    while (gens.getGeneration(w.db, generationId).status === 'streaming') {
      if (Date.now() - t0 > 10_000) throw new Error('The plan never finished')
      await new Promise((r) => setTimeout(r, 10))
    }
    const record = gens.getGeneration(w.db, generationId)
    expect(record.job).toBe('outline')
    expect(record.sceneId).toBe('')
    expect(record.messages[0].content.startsWith(`${MARKER} plan chapter`)).toBe(true)
    expect(record.messages[1].content).toContain('Answer: A letter comes for Mara')
    expect(record.response).toMatch(/^Goal: A letter comes for Mara\.\n\n### Scene: A letter at dawn/)
  })
})

describe('keeping a chapter’s scene cards', () => {
  it('puts the first into the chapter’s lone empty “Scene 1”, and its Undo puts that back', async () => {
    const { keepOutline } = await import('./structure')
    const { takeBackKept } = await import('../db/acts')
    const w = dbWorld()
    const storyId = w.id('b1')
    const chapter = repo.createChapter(w.db, storyId, { title: 'The letter' })
    const lone = repo.createScene(w.db, chapter.id, { title: 'Scene 1' })
    const item = (key: string, title: string) => ({ key, kind: 'scene' as const, parent: { id: chapter.id }, title, text: `${title}.`, beats: ['b'] })
    const [first] = keepOutline(w.db, storyId, [item('s1', 'A letter at dawn')])
    expect(first).toMatchObject({ id: lone.id, reused: true })
    expect(repo.getScene(w.db, lone.id).title).toBe('A letter at dawn')
    const [second] = keepOutline(w.db, storyId, [item('s2', 'The market')])
    expect(second.reused).toBeUndefined()
    expect(second.id).not.toBe(lone.id)

    takeBackKept(w.db, [first, second])
    const scenes = repo.getOutline(w.db, storyId).scenes.filter((s) => s.chapterId === chapter.id)
    expect(scenes.map((s) => s.title)).toEqual(['Scene 1'])
    expect(repo.getScene(w.db, lone.id).card.goal).toBe('')
  })

  it('never takes a “Scene 1” that has something on its card', async () => {
    const { keepOutline } = await import('./structure')
    const w = dbWorld()
    const storyId = w.id('b1')
    const chapter = repo.createChapter(w.db, storyId, { title: 'The letter' })
    const lone = repo.createScene(w.db, chapter.id, { title: 'Scene 1' })
    repo.updateSceneCard(w.db, lone.id, { ...emptySceneCard(), notes: 'Keep the rain' })
    const [kept] = keepOutline(w.db, storyId, [{ key: 's1', kind: 'scene', parent: { id: chapter.id }, title: 'A letter', text: 'x' }])
    expect(kept.id).not.toBe(lone.id)
  })
})
