// The interviews by topic (2026-10-20): the prompts, reading the replies, settling the suggestions against the world,
// Keep with its Undo, what each topic has kept, and the calls themselves against the fake provider
// (tests/fake-provider/m4/worldTopics.mjs). Invented world only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { TopicEntry, TopicLink } from '@shared/contracts/worldInterviews'
import { memoryWorld } from '../../../tests/unit/helpers'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as gens from '../db/generations'
import { lastBuildRun } from '../db/worldBuilder'
import type { JobModel } from '../ai/jobModel'
import { redoBuild, undoBuild } from '../worldBuilder/lines'
import { askedText, connectSystem, MOST_QUESTIONS, questionsSystem, suggestSystem } from './prompts'
import { newQuestions, readEntries, readLinks, readQuestions, sameQuestion } from './parse'
import { settleEntries, settleLinks } from './settle'
import { interviewProgress, keepSuggestion } from './keep'
import { askTopicQuestions, suggestFromTopic } from './jobs'
import { cleanEntry, cleanLink } from './clean'

const entry = (over: Partial<TopicEntry>): TopicEntry => ({
  key: 'e1',
  kind: 'character',
  name: 'Mara Venn',
  aliases: [],
  summary: 'A smuggler captain who owes the Salt Guild a fortune.',
  fields: {},
  in: '',
  rule: false,
  existing: null,
  his: [],
  ...over
})

describe('the prompts', () => {
  it('open with the World builder marker and the job, and keep to their own topic', () => {
    const q = questionsSystem('places', true)
    expect(q.startsWith('[AIWRITE-WORLD v1] topic-questions places\n')).toBe(true)
    expect(q).toContain('the places of their story')
    expect(q).toContain('what lies inside what')
    expect(q).toContain('at most 3 questions')
    expect(questionsSystem('lore', false)).toContain('the lore and history of their world')
    const s = suggestSystem('characters', 'character', false)
    expect(s.startsWith('[AIWRITE-WORLD v1] topic-suggest characters\n')).toBe(true)
    expect(s).toContain('"wants" (What they want)')
    expect(s).toContain('"speech" (How they speak)')
    expect(suggestSystem('places', 'place', false)).toContain('"in": the place it lies inside')
    expect(suggestSystem('lore', 'lore', false)).toContain('"rule": true only for something always so')
    expect(connectSystem(true)).toContain('{"from": "...", "inside": "...", "why": "..."}')
  })

  it('tell the interview so far, skipped questions said so, long answers cut short', () => {
    expect(askedText([])).toBe('Nothing yet: this is the first round.')
    const text = askedText(
      [
        { question: 'Who is she?', answer: 'Mara Venn, a smuggler.', skipped: false },
        { question: 'What does she fear?', answer: '', skipped: true },
        { question: 'Where is she from?', answer: 'word '.repeat(200), skipped: false }
      ],
      50
    )
    expect(text).toContain('- Who is she?\n  Answer: Mara Venn, a smuggler.')
    expect(text).toContain('- What does she fear?\n  (skipped)')
    expect(text).toMatch(/Answer: (word ){5,}word…/)
  })
})

describe('reading the replies', () => {
  it('reads questions however they come, at most a round of them, and "done"', () => {
    expect(readQuestions('{"questions": ["Who is she?", "What does she want?"]}', 3)).toEqual({ questions: ['Who is she?', 'What does she want?'], done: false })
    expect(readQuestions('```json\n{"Questions": ["A?", "Where does it happen?", "Who rules?", "Why?"]}\n```', 3)?.questions).toEqual([
      'Where does it happen?',
      'Who rules?',
      'Why?'
    ])
    expect(readQuestions('["Who is she?"]', 3)?.questions).toEqual(['Who is she?'])
    expect(readQuestions('{"done": true}', 3)).toEqual({ questions: [], done: true })
    expect(readQuestions('Sure!\n1. Who is she?\n2. What does she want?', 3)?.questions).toEqual(['Who is she?', 'What does she want?'])
    expect(readQuestions('I read it, and it is a fine world.', 3)).toBeNull()
    expect(readQuestions('{"topic": "x"}', 3)).toBeNull()
  })

  it('tells a question asked before, in other words too', () => {
    expect(sameQuestion('What does Mara want most?', 'What does Mara want most?')).toBe(true)
    expect(sameQuestion('What does Mara Venn want most?', 'Most of all, what is it Mara Venn wants?')).toBe(true)
    expect(sameQuestion('Where does Mara live?', 'Who rules the Salt Guild?')).toBe(false)
    expect(newQuestions(['What does Mara want most?', 'Who rules the Salt Guild?', 'Who rules the Salt Guild?'], [{ question: 'What does Mara want most?' }])).toEqual([
      'Who rules the Salt Guild?'
    ])
  })

  it('reads pages with their parts under "fields" or beside the name, known parts only', () => {
    const read = readEntries(
      '{"entries": [{"name": "Mara Venn", "aliases": ["Captain"], "summary": "A smuggler.", "fields": {"wants": "To pay her debt", "made_up": "x"}, "Fears": "Drowning"}, {"summary": "no name"}]}',
      ['wants', 'fears']
    )
    expect(read).toEqual([{ name: 'Mara Venn', aliases: ['Captain'], summary: 'A smuggler.', fields: { wants: 'To pay her debt', fears: 'Drowning' }, in: '', rule: false }])
    expect(readEntries('{"places": [{"name": "The Back Room", "in": "The Anchor Inn"}]}', [])?.[0].in).toBe('The Anchor Inn')
    expect(readEntries('[{"name": "Blood magic", "rule": true}]', [])?.[0].rule).toBe(true)
    expect(readEntries('not a list', [])).toBeNull()
  })

  it('reads the three kinds of link', () => {
    expect(
      readLinks(
        JSON.stringify({
          links: [
            { from: 'Mara Venn', to: 'Saltmarsh', type: 'lives at', why: 'She said so.' },
            { from: 'The Back Room', inside: 'The Anchor Inn' },
            { entry: 'Tobin', field: 'secrets', text: 'He sank the Merrow.' },
            { from: 'Nobody' }
          ]
        })
      )
    ).toEqual([
      { link: 'relationship', from: 'Mara Venn', to: 'Saltmarsh', type: 'lives at', feels: '', otherFeels: '', why: 'She said so.' },
      { link: 'inside', from: 'The Back Room', to: 'The Anchor Inn', why: '' },
      { link: 'detail', from: 'Tobin', field: 'secrets', text: 'He sank the Merrow.', why: '' }
    ])
    expect(readLinks('nothing here')).toBeNull()
  })
})

/** A world with Mara (her wants written), Saltmarsh, an inn inside it and a room in the inn's place. */
function grey() {
  const db = memoryWorld()
  const mara = repo.createEntry(db, 'character', { name: 'Mara Venn', summary: 'A smuggler captain.', fields: { wants: 'To pay the Guild.' } })
  const tobin = repo.createEntry(db, 'character', { name: 'Tobin' })
  const marsh = repo.createEntry(db, 'place', { name: 'Saltmarsh' })
  const inn = repo.createEntry(db, 'place', { name: 'The Anchor Inn', parentId: marsh.id })
  const room = repo.createEntry(db, 'place', { name: 'The Back Room' })
  return { db, mara, tobin, marsh, inn, room }
}

describe('settling the suggestions against the world', () => {
  it('offers a page the world has only for its empty parts, and marks the parts in his words his', () => {
    const { db, mara } = grey()
    const list = settleEntries(
      db,
      'character',
      [
        { name: 'Mara Venn', aliases: [], summary: 'Someone else.', fields: { wants: 'Gold', fears: 'The sea took her father.' }, in: '', rule: false },
        { name: 'Ada Lorne', aliases: [], summary: 'A lighthouse keeper.', fields: { wants: 'To keep the light lit', bogus: 'x' }, in: '', rule: false },
        { name: 'ada lorne', aliases: [], summary: 'Again.', fields: {}, in: '', rule: false }
      ],
      'Ada wants To keep the light lit. The sea took her father.'
    )
    expect(list.map((e) => e.name)).toEqual(['Mara Venn', 'Ada Lorne'])
    expect(list[0]).toMatchObject({ existing: { entryId: mara.id, name: 'Mara Venn' }, summary: '', fields: { fears: 'The sea took her father.' }, his: ['fears'] })
    expect(list[1]).toMatchObject({ existing: null, fields: { wants: 'To keep the light lit' }, his: ['wants'] })
  })

  it('leaves out a page the world has in full', () => {
    const { db } = grey()
    expect(settleEntries(db, 'character', [{ name: 'Mara Venn', aliases: [], summary: 'x', fields: { wants: 'y' }, in: '', rule: false }], '')).toEqual([])
  })

  it('keeps only links it can make, between pages the world has, that it hasn’t already', () => {
    const { db, mara, tobin, marsh, inn, room } = grey()
    mem.insertChange(db, { kind: 'relationship', payload: { otherId: tobin.id, type: 'sister of', feels: '', otherFeels: '' }, entryId: mara.id, anchor: 'baseline', storyId: null, origin: 'adam' })
    const links = settleLinks(db, [
      { link: 'relationship', from: 'Mara Venn', to: 'Saltmarsh', type: 'lives at', feels: 'loves it', otherFeels: '', why: 'Her home.' },
      { link: 'relationship', from: 'Tobin', to: 'Mara Venn', type: 'brother of', feels: '', otherFeels: '', why: '' },
      { link: 'relationship', from: 'Mara Venn', to: 'Nobody Known', type: 'owes', feels: '', otherFeels: '', why: '' },
      { link: 'inside', from: 'The Back Room', to: 'The Anchor Inn', why: '' },
      { link: 'inside', from: 'The Anchor Inn', to: 'The Back Room', why: '' },
      { link: 'inside', from: 'Saltmarsh', to: 'The Anchor Inn', why: '' },
      { link: 'detail', from: 'Mara Venn', field: 'wants', text: 'More gold.', why: '' },
      { link: 'detail', from: 'Mara Venn', field: 'secrets', text: 'She sank the Merrow.', why: '' }
    ])
    expect(links.map((l) => [l.link, l.from.name, l.to?.name ?? l.field])).toEqual([
      ['relationship', 'Mara Venn', 'Saltmarsh'],
      ['inside', 'The Back Room', 'The Anchor Inn'],
      ['detail', 'Mara Venn', 'secrets']
    ])
    // Feelings only between two people.
    expect(links[0].feels).toBe('')
    expect(links[1]).toMatchObject({ from: { entryId: room.id }, to: { entryId: inn.id } })
    expect(marsh.parentId).toBeNull()
  })
})

describe('Keep, and its Undo', () => {
  it('makes a new page, his words his and the rest drafted by AI, inside the place named, in a run of its own', () => {
    const { db, inn } = grey()
    const kept = keepSuggestion(db, {
      storyId: null,
      topic: 'places',
      entry: entry({ kind: 'place', name: 'The Cellar', summary: 'Cold and damp.', fields: { atmosphere: 'Smells of brine.' }, in: 'The Anchor Inn', his: ['summary'] })
    })
    const e = repo.getEntry(db, kept.entryId!)
    expect(e).toMatchObject({ name: 'The Cellar', summary: 'Cold and damp.', parentId: inn.id })
    expect(e.fields.atmosphere).toBe('Smells of brine.')
    expect(e.fieldOrigins.atmosphere).toBe('ai')
    expect(e.fieldOrigins.summary ?? e.origin).toBe('adam')
    // Not a build: the World builder page's last build stays as it was.
    expect(lastBuildRun(db)).toBeNull()
    expect(interviewProgress(db, null)).toEqual({ characters: 0, places: 1, lore: 0, connections: 0 })
    // Undo takes it away; its Undo brings it back.
    const undone = db.transaction(() => undoBuild(db, kept.runId))()
    expect(repo.listEntries(db, 'place').map((p) => p.name)).not.toContain('The Cellar')
    expect(interviewProgress(db, null).places).toBe(0)
    db.transaction(() => redoBuild(db, kept.runId, undone.lineIds))()
    expect(repo.listEntries(db, 'place').map((p) => p.name)).toContain('The Cellar')
    expect(interviewProgress(db, null).places).toBe(1)
  })

  it('fills only the empty parts of a page the world has, and never makes a page twice', () => {
    const { db, mara } = grey()
    const kept = keepSuggestion(db, {
      storyId: null,
      topic: 'characters',
      entry: entry({ existing: { entryId: mara.id, name: 'Mara Venn' }, summary: '', fields: { wants: 'Gold', fears: 'Deep water.' } })
    })
    expect(kept.entryId).toBe(mara.id)
    const e = repo.getEntry(db, mara.id)
    expect(e.fields).toMatchObject({ wants: 'To pay the Guild.', fears: 'Deep water.' })
    // The same suggestion with no page given: it finds Mara by name rather than making another.
    expect(() => keepSuggestion(db, { storyId: null, topic: 'characters', entry: entry({ summary: '', fields: { fears: 'Deep water.' } }) })).toThrow('already has all of that')
    expect(repo.listEntries(db, 'character').filter((c) => c.name === 'Mara Venn')).toHaveLength(1)
  })

  it('makes a relationship, a place inside another and words for an empty part, each with Undo', () => {
    const { db, mara, marsh, inn, room } = grey()
    const story = repo.listStories(db)[0]
    const ref = (e: { id: string; name: string; kind: 'character' | 'place' }) => ({ entryId: e.id, name: e.name, kind: e.kind })
    const link = (over: Partial<TopicLink>): TopicLink => ({ key: 'l1', link: 'relationship', from: ref(mara as never), to: ref(marsh as never), type: 'lives at', feels: '', otherFeels: '', field: '', text: '', why: '', ...over })
    const lives = keepSuggestion(db, { storyId: story.id, topic: 'connections', link: link({}) })
    const rel = mem.changesForEntry(db, mara.id).find((c) => c.kind === 'relationship')
    expect(rel).toMatchObject({ anchor: 'story-start', storyId: story.id, origin: 'ai', payload: { otherId: marsh.id, type: 'lives at' } })
    keepSuggestion(db, { storyId: story.id, topic: 'connections', link: link({ link: 'inside', from: ref(room as never), to: ref(inn as never), type: 'inside' }) })
    expect(repo.getEntry(db, room.id).parentId).toBe(inn.id)
    expect(() => keepSuggestion(db, { storyId: story.id, topic: 'connections', link: link({ link: 'inside', from: ref(room as never), to: ref(marsh as never) }) })).toThrow('already inside The Anchor Inn')
    keepSuggestion(db, { storyId: story.id, topic: 'connections', link: link({ link: 'detail', to: null, field: 'secrets', text: 'She sank the Merrow.' }) })
    expect(repo.getEntry(db, mara.id).fields.secrets).toBe('She sank the Merrow.')
    expect(() => keepSuggestion(db, { storyId: story.id, topic: 'connections', link: link({ link: 'detail', to: null, field: 'wants', text: 'x' }) })).toThrow('already has words there')
    expect(interviewProgress(db, story.id).connections).toBe(3)
    expect(interviewProgress(db, null).connections).toBe(0)
    db.transaction(() => undoBuild(db, lives.runId))()
    expect(mem.changesForEntry(db, mara.id).filter((c) => c.kind === 'relationship')).toEqual([])
    expect(interviewProgress(db, story.id).connections).toBe(2)
  })

  it('refuses what it can’t keep, in plain words', () => {
    const { db, mara } = grey()
    expect(cleanEntry({ kind: 'spaceship', name: 'x' })).toBeNull()
    expect(cleanEntry({ kind: 'character', name: '  ' })).toBeNull()
    expect(cleanLink({ link: 'detail', from: { entryId: mara.id, name: 'Mara', kind: 'character' }, field: 'nonsense', text: 'x' })).toBeNull()
    repo.deleteEntry(db, mara.id)
    expect(() =>
      keepSuggestion(db, {
        storyId: null,
        topic: 'connections',
        link: { key: 'l', link: 'detail', from: { entryId: mara.id, name: 'Mara Venn', kind: 'character' }, to: null, type: '', feels: '', otherFeels: '', field: 'fears', text: 'x', why: '' }
      })
    ).toThrow('isn’t in your world any more')
  })
})

describe('asking the World builder model', () => {
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

  it('asks a few questions a round, told what is known, until it has enough', async () => {
    const { db } = grey()
    const deps = { db, model: modelFor(), emit: () => undefined, retryDelays: [1, 1] }
    const one = await askTopicQuestions(deps, { taskId: 'q1', storyId: null, topic: 'characters', asked: [] })
    expect(one).toMatchObject({ status: 'complete', enough: false, questions: ['Who is the main character, and what do they want most?', 'Who stands in their way, and why?'] })
    const record = gens.getGeneration(db, one.generationId!)
    expect(record.job).toBe('world')
    expect(record.messages[0].content.startsWith('[AIWRITE-WORLD v1] topic-questions characters')).toBe(true)
    expect(record.messages[1].content).toContain('Mara Venn')
    expect(record.blocks.map((b) => b.id)).toEqual(['idea', 'world', 'asked', 'ask'])
    const asked = one.questions.map((question) => ({ question, answer: 'Mara Venn wants her ship back.', skipped: false }))
    const two = await askTopicQuestions(deps, { taskId: 'q2', storyId: null, topic: 'characters', asked })
    expect(two.questions).toEqual(['How does the main character talk?'])
    const three = await askTopicQuestions(deps, { taskId: 'q3', storyId: null, topic: 'characters', asked: [...asked, { question: two.questions[0], answer: '', skipped: true }] })
    expect(three).toMatchObject({ status: 'complete', enough: true, questions: [] })
    // Past the most questions, no call at all.
    const many = Array.from({ length: MOST_QUESTIONS }, (_, i) => ({ question: `Question ${i}?`, answer: 'x', skipped: false }))
    expect(await askTopicQuestions(deps, { taskId: 'q4', storyId: null, topic: 'lore', asked: many })).toMatchObject({ enough: true, generationId: null })
  })

  it('suggests pages from the answers, matched to the world', async () => {
    const { db, mara } = grey()
    const deps = { db, model: modelFor(), emit: () => undefined, retryDelays: [1, 1] }
    const out = await suggestFromTopic(deps, {
      taskId: 's1',
      storyId: null,
      topic: 'characters',
      asked: [
        { question: 'Who?', answer: 'Mara Venn is a smuggler captain. Mara Venn talks in clipped orders.', skipped: false },
        { question: 'Who else?', answer: 'Ada Lorne wants to keep the light lit.', skipped: false },
        { question: 'Skipped?', answer: '', skipped: true }
      ]
    })
    expect(out.status).toBe('complete')
    expect(out.entries.map((e) => e.name)).toEqual(['Mara Venn', 'Ada Lorne'])
    expect(out.entries[0]).toMatchObject({ existing: { entryId: mara.id }, fields: { speech: 'Mara Venn talks in clipped orders.' } })
    expect(out.entries[1]).toMatchObject({ existing: null, summary: 'Ada Lorne wants to keep the light lit.', fields: { wants: 'Ada Lorne wants to keep the light lit.' } })
    expect(out.entries[1].his).toEqual(expect.arrayContaining(['summary', 'wants', 'name']))
  })

  it('suggests links for the connections, and says so in plain words when the reply is no use', async () => {
    const { db } = grey()
    const deps = { db, model: modelFor(), emit: () => undefined, retryDelays: [1, 1] }
    const out = await suggestFromTopic(deps, {
      taskId: 's2',
      storyId: null,
      topic: 'connections',
      asked: [{ question: 'Who lives where?', answer: 'Mara Venn lives at Saltmarsh. The Back Room is inside The Anchor Inn.', skipped: false }]
    })
    expect(out.links.map((l) => `${l.from.name} ${l.type} ${l.to?.name}`)).toEqual(['Mara Venn lives at Saltmarsh', 'The Back Room inside The Anchor Inn'])
    const junk = await suggestFromTopic({ ...deps, model: modelFor('fake/world-junk') }, { taskId: 's3', storyId: null, topic: 'lore', asked: [{ question: 'Q?', answer: 'Magic costs blood.', skipped: false }] })
    expect(junk.status).toBe('error')
    expect(junk.error).toContain("didn't come as a list")
    await expect(suggestFromTopic(deps, { taskId: 's4', storyId: null, topic: 'lore', asked: [{ question: 'Q?', answer: '', skipped: true }] })).rejects.toThrow('Answer at least one question first')
  })
})
