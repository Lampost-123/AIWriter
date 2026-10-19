// The free rules over words in a real world (free rules, 2026-10-19): time claims and the card place's name, found by the
// rule-based checks after a reading (with the sentence put right as the fix to review) and by check and repair as a
// draft's new words land, with no AI call: a wrong church name mended in place where safe, a wrong month asked. Both kept
// under one key, so a finding is never raised twice, and one Adam took back is never mended or asked again. Invented text.
import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import type { ID, SceneCard } from '@shared/types'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import * as cdb from '../db/checks'
import * as gens from '../db/generations'
import type { MemoryModel } from '../keeper/model'
import { checkNewWords, freeCheckNewWords, repairsApplied, resetRepairsForTests } from '../repair'
import { ruleKey, runRuleChecks } from './ruleChecks'
import { placeAbout } from './freeRules'

type DB = Database.Database

/** A story of two scenes; Ashby, St Anne's church in it, and Mara and Tobin in the codex. */
function world() {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const outline = repo.getOutline(db, story.id)
  const scenes = [outline.scenes[0].id, repo.createScene(db, outline.chapters[0].id).id]
  const ashby = repo.createEntry(db, 'place', { name: 'Ashby' }).id
  const anne = repo.createEntry(db, 'place', { name: "St Anne's church, Ashby", parentId: ashby }).id
  const mara = repo.createEntry(db, 'character', { name: 'Mara' }).id
  repo.createEntry(db, 'character', { name: 'Tobin' })
  const card = (sceneId: ID, c: Partial<SceneCard>): void => void repo.updateSceneCard(db, sceneId, { ...repo.getScene(db, sceneId).card, ...c })
  const open = (sceneId: ID) => cdb.sceneIssueRows(db, sceneId).filter((r) => r.status === 'open')
  return { db, story, scenes, ashby, anne, mara, card, open }
}

/** A scene's words as paragraphs in the page's document. */
function save(db: DB, sceneId: ID, text: string): void {
  repo.saveSceneText(db, sceneId, { type: 'doc', content: text.split('\n\n').map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) }, text)
}

/** The record of the AI's words, as a draft leaves it. */
function record(db: DB, sceneId: ID, words: string): ID {
  const id = `draft-${sceneId}`
  gens.insertGeneration(db, {
    id,
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
    createdAt: '2026-10-19T09:00:00.000Z'
  })
  gens.finishGeneration(db, id, { status: 'complete', error: null, response: words, promptTokens: 1, completionTokens: 1, cost: null, finishedAt: '2026-10-19T09:00:01.000Z' })
  return id
}

const landed = (sceneId: ID, recordId: ID, words: string) => ({
  sceneId,
  recordId,
  paragraphs: words.split('\n\n').map((text) => ({ text, from: 0, to: text.length })),
  leadIn: '',
  beforeChars: 0
})

const model: MemoryModel = {
  target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'test' },
  choice: { providerId: 'p1', modelId: 'fake/memory', label: 'fake', contextLength: 32000, promptPrice: null, completionPrice: null }
}
/** A memory model whose every call fails: what is found is the free rules' alone. */
const failing = (async () => new Response(JSON.stringify({ error: { message: 'down' } }), { status: 500 })) as unknown as typeof fetch

afterEach(() => resetRepairsForTests())

const WORDS = 'It was a raw March morning, and Mara knelt in the cold nave of St Chad’s.\n\nTobin waited by the door.'

describe('the free rules after a reading', () => {
  it('raise a month the calendar has otherwise and a church named wrong, each with the sentence put right', () => {
    const w = world()
    w.card(w.scenes[0], { when: '12 June 1820, morning', locationId: w.anne, povId: w.mara })
    save(w.db, w.scenes[0], WORDS)
    expect(runRuleChecks(w.db, w.scenes[0])).toBe(2)
    const rows = w.open(w.scenes[0])
    const time = rows.find((r) => cdb.payloadOf(r).rule === 'time-claim')!
    const place = rows.find((r) => cdb.payloadOf(r).rule === 'place-name')!
    expect(time).toMatchObject({ kind: 'timeline', severity: 'warning', message: 'This says it is March, but by the scene cards this scene is in June (12 June 1820).' })
    expect(cdb.payloadOf(time)).toMatchObject({ by: 'rule', fix: 'It was a raw June morning, and Mara knelt in the cold nave of St Chad’s.' })
    expect(place).toMatchObject({ kind: 'fact', message: "This scene is at St Anne's church, Ashby, but the words call it St Chad’s. St Chad’s isn’t in the codex: use St Anne's?" })
    expect(cdb.payloadOf(place)).toMatchObject({
      entryId: w.anne,
      fix: 'It was a raw March morning, and Mara knelt in the cold nave of St Anne\'s.',
      key: ruleKey({ rule: 'place-name', about: placeAbout(w.anne, 'St Chad’s') }, w.scenes[0])
    })
    // Found again as it was: nothing new.
    expect(runRuleChecks(w.db, w.scenes[0])).toBe(0)
  })

  it('ask about a month in a story that only counts its days, as worth a look', () => {
    const w = world()
    w.card(w.scenes[0], { when: 'Day 1, dusk' })
    w.card(w.scenes[1], { when: 'Day 8, morning' })
    save(w.db, w.scenes[0], 'Mara lit the lamp.')
    save(w.db, w.scenes[1], 'It was a raw March morning. Mara lit the fire.')
    runRuleChecks(w.db, w.scenes[1])
    expect(w.open(w.scenes[1]).map((r) => [r.severity, r.message])).toEqual([
      ['minor', 'The story counts its days (Day 8) and no scene card or codex entry names a month, so March is new here. Keep it, or take it out?']
    ])
  })

  it('say nothing of a long scene whose times and places fit, with memories in dialogue and a second real church', () => {
    const w = world()
    repo.createEntry(w.db, 'place', { name: "St Mary's chapel", parentId: w.ashby })
    w.card(w.scenes[0], { when: '10 June 1820' })
    w.card(w.scenes[1], { when: '12 June 1820, morning', locationId: w.anne, povId: w.mara })
    save(w.db, w.scenes[0], 'Mara left Ashby for the coast.')
    save(
      w.db,
      w.scenes[1],
      [
        'Two days later it was a bright June morning, and the bells of St Anne’s were ringing for the early service.',
        '‘Last March the river froze,’ Tobin said. ‘You remember. It was a Thursday, and cold as charity.’',
        'Mara remembered. In March they had walked to St Mary’s chapel every Sunday, and in the spring of 1815 her mother had been buried there.',
        'It was summer now, and the war was over.'
      ].join('\n\n')
    )
    expect(runRuleChecks(w.db, w.scenes[1])).toBe(0)
  })
})

describe('the free rules as new words land (check and repair)', () => {
  it('mend the church’s name in place and ask about the month, with no AI call needed, under the rules’ own keys', async () => {
    const w = world()
    w.card(w.scenes[0], { when: '12 June 1820, morning', locationId: w.anne, povId: w.mara })
    save(w.db, w.scenes[0], WORDS)
    const id = record(w.db, w.scenes[0], WORDS)
    const out = await checkNewWords({ db: w.db, model, prefs: { avoidAiPhrases: false } as never, closed: () => false, fetchImpl: failing, retryDelays: [0] }, landed(w.scenes[0], id, WORDS))
    expect(out.repairId).not.toBeNull()
    expect(out.fixes).toEqual([
      expect.objectContaining({ para: 0, was: 'St Chad’s', now: "St Anne's", why: "This scene is at St Anne's church, Ashby, so it is St Anne's, not St Chad’s." })
    ])
    expect(out.questions).toBe(1)
    expect(w.open(w.scenes[0]).map((r) => cdb.payloadOf(r).rule)).toEqual(['time-claim'])
    // The page mends it: kept as fixed, under the rule's key.
    const kept = repairsApplied(out.repairId!, [out.fixes[0].id])
    const fixed = cdb.issueRow(w.db, kept[out.fixes[0].id])!
    expect(fixed.status).toBe('fixed')
    expect(cdb.payloadOf(fixed).key).toBe(ruleKey({ rule: 'place-name', about: placeAbout(w.anne, 'St Chad’s') }, w.scenes[0]))
    // The rules after the reading find the month again, not a second time.
    save(w.db, w.scenes[0], WORDS.replace('St Chad’s', "St Anne's"))
    expect(runRuleChecks(w.db, w.scenes[0])).toBe(0)
    expect(w.open(w.scenes[0])).toHaveLength(1)
  })

  it('run with no memory model too, and never mend again what Adam took back', () => {
    const w = world()
    w.card(w.scenes[0], { when: '12 June 1820, morning', locationId: w.anne })
    save(w.db, w.scenes[0], WORDS)
    const id = record(w.db, w.scenes[0], WORDS)
    const out = freeCheckNewWords(w.db, landed(w.scenes[0], id, WORDS))
    expect(out.fixes.map((f) => f.now)).toEqual(["St Anne's"])
    const kept = repairsApplied(out.repairId!, [out.fixes[0].id])
    // Undo: the page marks it ignored.
    cdb.setIssueStatus(w.db, kept[out.fixes[0].id], 'ignored')
    const again = freeCheckNewWords(w.db, landed(w.scenes[0], id, WORDS))
    expect(again.fixes).toEqual([])
    runRuleChecks(w.db, w.scenes[0])
    expect(w.open(w.scenes[0]).map((r) => cdb.payloadOf(r).rule)).toEqual(['time-claim'])
  })

  it('ask rather than mend in a paragraph that isn’t all the AI’s own words', () => {
    const w = world()
    w.card(w.scenes[0], { when: '12 June 1820, morning', locationId: w.anne })
    save(w.db, w.scenes[0], WORDS)
    const id = record(w.db, w.scenes[0], 'Something else entirely.')
    const out = freeCheckNewWords(w.db, landed(w.scenes[0], id, WORDS))
    expect(out.fixes).toEqual([])
    expect(w.open(w.scenes[0]).map((r) => cdb.payloadOf(r).rule).sort()).toEqual(['place-name', 'time-claim'])
  })
})
