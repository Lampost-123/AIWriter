import { describe, expect, it } from 'vitest'
import type { WritingPrefs } from '@shared/types'
import { defaultStyleGuide, defaultWritingPrefs } from '@shared/defaults'
import * as repo from '../db/repo'
import { liveIgnores } from '../db/checksLive'
import { readIssue, sceneIssueRows, type IssueNames } from '../db/checks'
import { slopKey } from '@shared/liveChecks'
import { memoryWorld } from '../../../tests/unit/helpers'
import { checkWords, ignoreLive, listLiveIgnores, unignoreLive } from './live'

const prefs = (avoidWords: string[] = []): WritingPrefs => ({ ...defaultWritingPrefs(), avoidWords })

function world() {
  const db = memoryWorld()
  const [story] = repo.listStories(db)
  const { chapters, scenes } = repo.getOutline(db, story.id)
  const second = repo.createScene(db, chapters[0].id, { title: 'Two' })
  return { db, story, sceneId: scenes[0].id, otherId: second.id }
}

describe('the words the live checks need', () => {
  it('lists every live entry’s name and aliases, the glossary’s terms included, and not deleted ones', () => {
    const { db, sceneId } = world()
    const mara = repo.createEntry(db, 'character', { name: 'Mara Venn', aliases: ['Mara', ' mara venn ', ''] })
    repo.createEntry(db, 'glossary', { name: "Kel'oran" })
    const gone = repo.createEntry(db, 'place', { name: 'Thornwick' })
    repo.deleteEntry(db, gone.id)
    expect(checkWords(db, sceneId, prefs()).names).toEqual([
      { entryId: mara.id, name: 'Mara Venn', kind: 'character' },
      { entryId: mara.id, name: 'Mara', kind: 'character' },
      { entryId: expect.any(String), name: "Kel'oran", kind: 'glossary' }
    ])
  })

  it('stacks the phrases to avoid as the briefing does: Adam’s, the world’s, then the story’s', () => {
    const { db, story, sceneId } = world()
    repo.setMeta(db, 'style', JSON.stringify({ ...defaultStyleGuide(), avoidPhrases: ['Suddenly', 'all of a sudden'] }))
    repo.updateStory(db, story.id, { style: { avoidPhrases: ['very', 'suddenly'] } })
    expect(checkWords(db, sceneId, prefs(['delve'])).avoid).toEqual(['delve', 'Suddenly', 'all of a sudden', 'very'])
  })

  it('says whether to underline common AI phrases: on unless Adam turned it off', () => {
    const { db, sceneId } = world()
    expect(checkWords(db, sceneId, prefs()).aiPhrases).toBe(true)
    expect(checkWords(db, sceneId, { ...prefs(), avoidAiPhrases: undefined }).aiPhrases).toBe(true)
    expect(checkWords(db, sceneId, { ...prefs(), avoidAiPhrases: false }).aiPhrases).toBe(false)
  })
})

describe('ignored flags', () => {
  it('keeps a scene’s ignores to that scene, and a spelling’s across the world', () => {
    const { db, story, sceneId, otherId } = world()
    ignoreLive(db, sceneId, { kind: 'spelling', key: 'spelling:Marra', quote: 'Marra', message: '“Marra” looks like a misspelling of Mara.' })
    ignoreLive(db, sceneId, { kind: 'phrase', key: 'phrase:p1:suddenly', quote: 'Suddenly', message: 'x' })
    ignoreLive(db, sceneId, { kind: 'repetition', key: 'repetition:dark', quote: 'dark', message: 'x' })
    // Twice is once.
    ignoreLive(db, otherId, { kind: 'spelling', key: 'spelling:marra', quote: 'marra', message: 'x' })
    expect(listLiveIgnores(db, sceneId)).toEqual([
      { kind: 'spelling', key: 'spelling:marra' },
      { kind: 'phrase', key: 'phrase:p1:suddenly' },
      { kind: 'repetition', key: 'repetition:dark' }
    ])
    expect(listLiveIgnores(db, otherId)).toEqual([{ kind: 'spelling', key: 'spelling:marra' }])
    const row = db.prepare("SELECT * FROM issues WHERE kind = 'spelling'").all() as Record<string, unknown>[]
    expect(row).toHaveLength(1)
    expect(row[0]).toMatchObject({ scene_id: sceneId, story_id: story.id, status: 'ignored', severity: 'minor', quote: 'Marra' })
    expect(JSON.parse(row[0].payload_json as string)).toEqual({ key: 'spelling:marra' })
  })

  it('marks an ignored common AI phrase as one, and none of Adam’s own phrases', () => {
    const { db, sceneId } = world()
    ignoreLive(db, sceneId, { kind: 'phrase', key: slopKey('breath-hitch', 'p1'), quote: 'breath hitched', message: 'x' })
    ignoreLive(db, sceneId, { kind: 'phrase', key: 'phrase:p1:suddenly', quote: 'Suddenly', message: 'x' })
    const names: IssueNames = { entry: () => null, sceneLabel: () => null, storyTitle: () => null }
    const issues = sceneIssueRows(db, sceneId).map((r) => readIssue(r, names))
    expect(issues.map((i) => [i.quote, i.aiPhrase ?? false])).toEqual(
      expect.arrayContaining([
        ['breath hitched', true],
        ['Suddenly', false]
      ])
    )
    expect(issues).toHaveLength(2)
  })

  it('takes an ignore back (Undo), a spelling from any scene', () => {
    const { db, sceneId, otherId } = world()
    ignoreLive(db, sceneId, { kind: 'spelling', key: 'spelling:marra', quote: 'Marra', message: 'x' })
    ignoreLive(db, sceneId, { kind: 'repetition', key: 'repetition:dark', quote: 'dark', message: 'x' })
    expect(unignoreLive(db, otherId, 'repetition:dark')).toBe(false)
    expect(unignoreLive(db, otherId, 'spelling:marra')).toBe(true)
    expect(unignoreLive(db, sceneId, 'repetition:dark')).toBe(true)
    expect(liveIgnores(db, sceneId)).toEqual([])
  })

  it('leaves other issues alone, open ones and ignored AI ones alike', () => {
    const { db, sceneId } = world()
    const t = new Date().toISOString()
    const add = db.prepare(
      "INSERT INTO issues (id, scene_id, story_id, kind, severity, status, payload_json, created_at, updated_at) VALUES (?, ?, NULL, ?, 'warning', ?, ?, ?, ?)"
    )
    add.run('i1', sceneId, 'fact', 'ignored', JSON.stringify({ key: 'repetition:dark' }), t, t)
    add.run('i2', sceneId, 'repetition', 'open', JSON.stringify({ key: 'repetition:dark' }), t, t)
    expect(listLiveIgnores(db, sceneId)).toEqual([])
    expect(unignoreLive(db, sceneId, 'repetition:dark')).toBe(false)
    expect((db.prepare('SELECT COUNT(*) AS n FROM issues').get() as { n: number }).n).toBe(2)
  })

  it('refuses a flag that isn’t a live check', () => {
    const { db, sceneId } = world()
    expect(() => ignoreLive(db, sceneId, { kind: 'fact' as never, key: 'fact:x', quote: '', message: '' })).toThrow('can’t be ignored')
    expect(() => ignoreLive(db, sceneId, { kind: 'phrase', key: 'spelling:x', quote: '', message: '' })).toThrow('can’t be ignored')
  })
})
