// The interviews by topic on screen (2026-10-20): how a topic stands, when How it all connects is offered, a round of
// answers as recorded, how suggestions read, and Change making the changed parts his.
import { describe, expect, it } from 'vitest'
import type { TopicEntry, TopicLink } from '@shared/contracts/worldInterviews'
import { answeredWords, batchWords, changedEntry, connectionsOpen, entryLines, hasAnswers, linkWords, partsToShow, roundAsked, topicStatus } from './topicLogic'

const page: TopicEntry = {
  key: 'e1',
  kind: 'place',
  name: 'The Back Room',
  aliases: [],
  summary: 'Where the smugglers meet.',
  fields: { atmosphere: 'Smoky and low.', history: 'Once a chapel.' },
  in: 'The Anchor Inn',
  rule: false,
  existing: null,
  his: ['summary']
}

const ref = (name: string, kind: 'character' | 'place' = 'character') => ({ entryId: name, name, kind })

describe('how the topics stand', () => {
  it('is done once something is kept, else under way or not started', () => {
    expect(topicStatus(3, true)).toEqual({ words: 'Done · 3 kept', done: true })
    expect(topicStatus(0, true)).toEqual({ words: 'Under way', done: false })
    expect(topicStatus(0, false)).toEqual({ words: 'Not started', done: false })
  })

  it('offers How it all connects once a page topic has kept something', () => {
    expect(connectionsOpen(null)).toBe(false)
    expect(connectionsOpen({ characters: 0, places: 0, lore: 0, connections: 4 })).toBe(false)
    expect(connectionsOpen({ characters: 0, places: 1, lore: 0, connections: 0 })).toBe(true)
  })
})

describe('a round of answers', () => {
  it('records each question with his answer, an empty box as skipped', () => {
    const asked = roundAsked(['Who is she?', 'What does she fear?'], ['  Mara Venn. ', ''])
    expect(asked).toEqual([
      { question: 'Who is she?', answer: 'Mara Venn.', skipped: false },
      { question: 'What does she fear?', answer: '', skipped: true }
    ])
    expect(hasAnswers(asked)).toBe(true)
    expect(hasAnswers(roundAsked(['Q?'], []))).toBe(false)
    expect(answeredWords(asked)).toBe('1 answered, 1 skipped')
    expect(answeredWords([])).toBe('')
  })
})

describe('how suggestions read', () => {
  it('lists a page’s parts by their labels, where it lies and whether it is a rule', () => {
    expect(entryLines(page)).toEqual(['Inside The Anchor Inn', 'Atmosphere: Smoky and low.', 'History: Once a chapel.'])
    expect(entryLines({ kind: 'lore', fields: { limits: 'Costs blood.' }, in: '', rule: true })).toEqual(['Always true, never to be broken', 'Limits and costs: Costs blood.'])
    expect(partsToShow(page)).toEqual(['atmosphere', 'history', 'senses', 'geography', 'people'])
  })

  it('says a link in plain words', () => {
    const base: Omit<TopicLink, 'link'> = { key: 'l', from: ref('Mara Venn'), to: ref('Saltmarsh', 'place'), type: 'lives at', feels: '', otherFeels: '', field: '', text: '', why: '' }
    expect(linkWords({ ...base, link: 'relationship' })).toBe('Mara Venn lives at Saltmarsh')
    expect(linkWords({ ...base, link: 'inside', from: ref('The Back Room', 'place'), to: ref('The Anchor Inn', 'place') })).toBe('The Back Room is inside The Anchor Inn')
    expect(linkWords({ ...base, link: 'detail', to: null, field: 'secrets' })).toBe('Mara Venn: Secrets they keep')
  })

  it('counts what is left to decide and what was kept', () => {
    const kept = { status: 'kept' as const, runId: 'r', entryId: null }
    expect(batchWords(['a', 'b', 'c'], {}, false)).toBe('3 pages to keep, change or discard')
    expect(batchWords(['a', 'b', 'c'], { a: kept, b: { status: 'discarded' } }, true)).toBe('1 link to keep, change or discard · 1 kept')
    expect(batchWords(['a'], { a: kept }, false)).toBe('All decided · 1 kept')
    expect(batchWords(['a'], { a: { status: 'discarded' } }, false)).toBe('All decided')
  })
})

describe('Change', () => {
  it('makes the parts he changed his, and drops parts he emptied', () => {
    const next = changedEntry(page, { summary: 'Where the crew meets.', fields: { atmosphere: 'Smoky and low.', history: '', people: 'Smugglers.' } })
    expect(next.summary).toBe('Where the crew meets.')
    expect(next.fields).toEqual({ atmosphere: 'Smoky and low.', people: 'Smugglers.' })
    expect(next.his.sort()).toEqual(['people', 'summary'])
  })
})
