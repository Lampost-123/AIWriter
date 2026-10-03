// Filling in the gaps of thin entries, against the fake provider (tests/fake-provider/server.mjs answers a
// fill-gaps request with "<Label> of <name>, filled in from the story." for each field it is asked about).

import type Database from 'better-sqlite3'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Entry, ID } from '@shared/types'
import { defaultWritingPrefs } from '@shared/defaults'
import { memoryWorld } from '../../../tests/unit/helpers'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import * as repo from '../db/repo'
import type { JobModel } from '../ai/jobModel'
import { fillGaps, fillTargets, paragraphsNaming, saveFilled, storySaid, type FillOptions } from './fill'
import { profileKeys } from './profile'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0, slowDelayMs: 15 })
})
afterAll(() => fake.close())
beforeEach(() => fake.reset())

function modelFor(modelId = 'fake/writer'): JobModel {
  return {
    job: 'writer',
    target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: 'test' },
    choice: { providerId: 'p1', modelId, label: modelId, contextLength: 32000, promptPrice: 0.000001, completionPrice: 0.000002 },
    thinking: 'off'
  }
}

const doc = (paragraphs: string[]): unknown => ({
  type: 'doc',
  content: paragraphs.map((text, i) => ({ type: 'paragraph', attrs: { pid: `p${i}` }, content: [{ type: 'text', text }] }))
})

const SCENE = [
  'The storm threw them onto the sand at dawn.',
  'Erin coughed up seawater and pushed her red hair out of her eyes.',
  'Tom found the wreck of the boat further along the beach.',
  '"We are not dying here," Erin said, and started walking.'
]

/** A world with a scene that has text, and Erin, found in it by the memory keeper: a name, a line and her pronouns. */
function world(): { db: Database.Database; storyId: ID; sceneId: ID; erin: Entry } {
  const db = memoryWorld()
  const storyId = repo.listStories(db)[0].id
  const sceneId = repo.getOutline(db, storyId).scenes[0].id
  repo.saveSceneText(db, sceneId, doc(SCENE), SCENE.join('\n\n'))
  const erin = repo.createEntry(
    db,
    'character',
    { name: 'Erin', summary: 'A castaway who washed up with Tom.', fields: { pronouns: 'she/her' } },
    { origin: 'text', originStoryId: storyId, originSceneId: sceneId }
  )
  return { db, storyId, sceneId, erin }
}

function options(db: Database.Database, storyId: ID | null, more: Partial<FillOptions> = {}): FillOptions {
  return {
    db,
    model: modelFor(),
    job: 'memory',
    prefs: defaultWritingPrefs(),
    storyId,
    saidAbout: (e) => storySaid(db, e),
    retryDelays: [1, 1],
    ...more
  }
}

const get = (db: Database.Database, id: ID): Entry => repo.getEntries(db, [id])[0]
const originOf = (e: Entry, key: string): string => e.fieldOrigins[key] ?? e.origin

describe('which fields are filled', () => {
  it('fills only the empty fields of a thin entry, never its name or other names', () => {
    const { erin } = world()
    const targets = fillTargets(erin)
    expect(targets).toContain('description')
    expect(targets).toContain('traits')
    expect(targets).not.toContain('name')
    expect(targets).not.toContain('aliases')
    expect(targets).not.toContain('summary')
    expect(targets).not.toContain('pronouns')
  })

  it('leaves an entry alone when it is full enough, and kinds with no profile', () => {
    const db = memoryWorld()
    const keys = profileKeys('character').filter((k) => !['name', 'aliases', 'summary', 'description'].includes(k))
    // Summary and description written, and fewer than a third of the fields empty.
    const fields = Object.fromEntries(keys.slice(0, Math.ceil((keys.length + 4) * 0.7)).map((k) => [k, `Some ${k}.`]))
    const full = repo.createEntry(db, 'character', { name: 'Ada', summary: 'A sailor.', description: 'Tall and quiet.', fields })
    expect(fillTargets(full)).toEqual([])
    // A missing description makes it thin again.
    expect(fillTargets({ ...full, description: '' })).toEqual(expect.arrayContaining(['description']))
    expect(fillTargets(repo.createEntry(db, 'lore', { name: 'Magic', summary: '' }))).toEqual([])
  })

  it('saves only fields that are still empty, as the AI’s', () => {
    const { db, erin } = world()
    expect(saveFilled(db, erin.id, { name: 'Someone else', summary: 'Another line.', pronouns: 'they/them', hair: 'Red.' })).toBe(true)
    const after = get(db, erin.id)
    expect(after.name).toBe('Erin')
    expect(after.summary).toBe('A castaway who washed up with Tom.')
    expect(after.fields.pronouns).toBe('she/her')
    expect(after.fields.hair).toBe('Red.')
    expect(originOf(after, 'hair')).toBe('ai')
    expect(originOf(after, 'summary')).toBe('text')
    // Nothing new to save.
    expect(saveFilled(db, erin.id, { summary: 'Again.' })).toBe(false)
  })
})

describe('filling in the gaps', () => {
  it('fills a character the memory found from what the story says about her, drafted by AI, and keeps what the text said', async () => {
    const { db, storyId, erin } = world()
    const filled: ID[] = []
    const result = await fillGaps(options(db, storyId, { onFilled: (id) => filled.push(id) }), [erin.id])
    expect(result.filled).toEqual([erin.id])
    expect(filled).toEqual([erin.id])
    expect(result.generationIds).toHaveLength(1)

    const after = get(db, erin.id)
    expect(after.description).toBe('Description of Erin, filled in from the story.')
    expect(after.fields.traits).toBe('Core traits of Erin, filled in from the story.')
    expect(after.fields.role).toBe('minor')
    expect(originOf(after, 'description')).toBe('ai')
    expect(originOf(after, 'traits')).toBe('ai')
    // What the text said stays the text's.
    expect(after.name).toBe('Erin')
    expect(after.summary).toBe('A castaway who washed up with Tom.')
    expect(after.fields.pronouns).toBe('she/her')
    expect(originOf(after, 'summary')).toBe('text')
    expect(originOf(after, 'pronouns')).toBe('text')
    expect(fillTargets(after)).toEqual([])

    // The request carried the scene's paragraphs that name her, and not the others.
    const user = (fake.lastRequest()?.body as { messages: { role: string; content: string }[] }).messages.find((m) => m.role === 'user')
    expect(user?.content).toContain('What the story says about the character')
    expect(user?.content).toContain('Erin coughed up seawater')
    expect(user?.content).toContain('"We are not dying here," Erin said')
    expect(user?.content).not.toContain('Tom found the wreck')

    // Recorded under the caller's job.
    const job = db.prepare('SELECT job FROM generations WHERE id = ?').get(result.generationIds[0]) as { job: string }
    expect(job.job).toBe('memory')
  })

  it('asks nothing for an entry that is full enough, or gone', async () => {
    const { db, storyId, erin } = world()
    const full = repo.createEntry(db, 'character', {
      name: 'Ada',
      summary: 'A sailor.',
      description: 'Tall and quiet.',
      fields: Object.fromEntries(
        profileKeys('character')
          .slice(4)
          .map((k) => [k, `Some ${k}.`])
      )
    })
    repo.deleteEntry(db, erin.id)
    const result = await fillGaps(options(db, storyId), [full.id, erin.id])
    expect(result).toEqual({ filled: [], generationIds: [], cost: null })
    expect(fake.lastRequest()).toBeNull()
  })

  it('leaves the fields empty when the reply fails, and goes on without throwing', async () => {
    const { db, storyId, erin } = world()
    const result = await fillGaps(options(db, storyId, { model: modelFor('fake/empty') }), [erin.id])
    expect(result.filled).toEqual([])
    const after = get(db, erin.id)
    expect(after.description).toBe('')
    expect(after.fields.traits ?? '').toBe('')
  })

  it('stops once the caller has', async () => {
    const { db, storyId, erin } = world()
    const result = await fillGaps(options(db, storyId, { stopped: () => true }), [erin.id])
    expect(result.filled).toEqual([])
    expect(fake.lastRequest()).toBeNull()
  })
})

describe('what the story says about someone', () => {
  it('keeps the paragraphs that name them or another of their names, as whole words', () => {
    const paragraphs = ['Erin ran.', 'Erinsborough was far.', 'The captain (Red) waved.', 'Nobody here.', 'They called her Red, once.']
    expect(paragraphsNaming(paragraphs, { name: 'Erin', aliases: ['Red'] })).toEqual([
      'Erin ran.',
      'The captain (Red) waved.',
      'They called her Red, once.'
    ])
    expect(paragraphsNaming(paragraphs, { name: '', aliases: [] })).toEqual([])
  })

  it('is empty for an entry not found in a scene', () => {
    const { db } = world()
    const ada = repo.createEntry(db, 'character', { name: 'Erin' })
    expect(storySaid(db, ada)).toBe('')
  })
})
