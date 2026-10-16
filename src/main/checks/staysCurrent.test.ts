// Findings that stay current (2026-10-16): a scene's issues follow its words as they are saved. Those whose words went
// are put away; one found at a place follows its own words by their paragraph, so fixing one of two identical phrases
// settles only the issue about that one; a row put away comes back when its words do (Ctrl+Z); Later lasts until the
// paragraph changes or the next check; an entry saved by hand settles the clashes it answers. Invented text only.
import { afterEach, describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import * as repo from '../db/repo'
import * as cdb from '../db/checks'
import * as kdb from '../db/keeper'
import { memoryWorld } from '../../../tests/unit/helpers'
import { checkReport, checkReportNow, saveContractCheck, saveReport, savedContract } from './report'
import { contractResults } from '../repair/contract'
import type { SceneContract } from '../ai/contract'
import { hashText } from '../keeper/text'

type Para = [pid: string, text: string]

/** A scene's editor document and plain text, as the page saves them (each paragraph with its id). */
function page(paras: Para[]): { doc: unknown; text: string } {
  return {
    doc: { type: 'doc', content: paras.map(([pid, t]) => ({ type: 'paragraph', attrs: { pid }, content: t ? [{ type: 'text', text: t }] : [] })) },
    text: paras.map(([, t]) => t).join('\n\n')
  }
}

/** A world with one scene saved from these paragraphs. */
function world(paras: Para[]) {
  const db = memoryWorld()
  const [story] = repo.listStories(db)
  const sceneId = repo.getOutline(db, story.id).scenes[0].id
  const p = page(paras)
  repo.saveSceneText(db, sceneId, p.doc, p.text)
  return { db, storyId: story.id, sceneId }
}

/** Saves the scene as the page does, sweeping its issues (ipc/core.ts saveSceneText). */
function save(db: ReturnType<typeof memoryWorld>, sceneId: ID, paras: Para[]): ID[] {
  const p = page(paras)
  repo.saveSceneText(db, sceneId, p.doc, p.text)
  return cdb.sweepGone(db, { sceneId }, p)
}

const found = (sceneId: ID, storyId: ID, key: string, quote: string, payload: cdb.IssuePayload = {}): cdb.FoundIssue => ({
  sceneId,
  storyId,
  kind: 'fact',
  severity: 'warning',
  quote,
  message: `About “${quote}”.`,
  key,
  payload: { by: 'check', check: 'facts', sources: [], fix: null, memoryFix: null, ...payload }
})

const rowOf = (db: ReturnType<typeof memoryWorld>, sceneId: ID, key: string) => cdb.rowsInScenes(db, [sceneId]).find((r) => cdb.payloadOf(r).key === key)!
const statusOf = (db: ReturnType<typeof memoryWorld>, sceneId: ID, key: string): string => rowOf(db, sceneId, key).status as string

afterEach(() => cdb.onIssuesTouched(null))

describe('every save sweeps the scene’s issues', () => {
  it('puts away an issue whose words went, tells the window, and leaves the scene alone when nothing changed', async () => {
    const { db, storyId, sceneId } = world([
      ['p1', 'Rain came off the river.'],
      ['p2', 'Mara’s eyes were green in the lamplight.']
    ])
    cdb.saveFound(db, [], [found(sceneId, storyId, 'k1', 'Mara’s eyes were green')], () => false)
    const told: ID[][] = []
    cdb.onIssuesTouched((_story, scenes) => told.push(scenes))
    // Typing elsewhere: nothing to say.
    expect(
      save(db, sceneId, [
        ['p1', 'Rain came off the river in sheets.'],
        ['p2', 'Mara’s eyes were green in the lamplight.']
      ])
    ).toEqual([])
    expect(statusOf(db, sceneId, 'k1')).toBe('open')
    // The words rewritten: the issue goes, and the window hears it.
    expect(
      save(db, sceneId, [
        ['p1', 'Rain came off the river in sheets.'],
        ['p2', 'Mara’s eyes were blue in the lamplight.']
      ])
    ).toEqual([sceneId])
    expect(statusOf(db, sceneId, 'k1')).toBe('gone')
    await new Promise((r) => setTimeout(r, 5))
    expect(told).toEqual([[sceneId]])
  })

  it('is quick on a long scene: a 10,000-word scene with 30 issues is swept in well under a keystroke’s pause', () => {
    const paras: Para[] = Array.from({ length: 400 }, (_, i) => [`p${i}`, `Paragraph ${i} of the long scene, where Mara walks the river path and counts the doors again, slowly, while the rain keeps falling on the old stone bridge.`])
    const { db, storyId, sceneId } = world(paras)
    cdb.saveFound(
      db,
      [],
      Array.from({ length: 30 }, (_, i) => found(sceneId, storyId, `k${i}`, `Paragraph ${i * 10} of the long scene`, { occurrence: 0 })),
      () => false
    )
    paras[5] = ['p5', 'A new line here.']
    const t = performance.now()
    save(db, sceneId, paras)
    expect(performance.now() - t).toBeLessThan(400)
  })
})

describe('an issue found at a place follows its own words', () => {
  const twice: Para[] = [
    ['p1', 'Tobin said nothing.'],
    ['p2', 'The bell rang twice.'],
    ['p3', 'Later, the bell rang twice.']
  ]

  it('goes when its own copy of two identical phrases is fixed, though the other copy is still there', () => {
    const { db, storyId, sceneId } = world(twice)
    // About the second appearance (in p3).
    cdb.saveFound(db, [], [found(sceneId, storyId, 'k', 'the bell rang twice', { occurrence: 1 })], () => false)
    save(db, sceneId, twice)
    expect(cdb.payloadOf(rowOf(db, sceneId, 'k')).at).toEqual({ pid: 'p3', n: 0 })
    save(db, sceneId, [twice[0], twice[1], ['p3', 'Later, the bell was silent.']])
    expect(statusOf(db, sceneId, 'k')).toBe('gone')
  })

  it('stays open when the other copy is fixed, and keeps its place right when text before it changes', () => {
    const { db, storyId, sceneId } = world(twice)
    cdb.saveFound(db, [], [found(sceneId, storyId, 'k', 'the bell rang twice', { occurrence: 1 })], () => false)
    save(db, sceneId, twice)
    // The first copy rewritten: this one is now the scene's only appearance.
    save(db, sceneId, [twice[0], ['p2', 'The bell rang once.'], twice[2]])
    expect(statusOf(db, sceneId, 'k')).toBe('open')
    expect(cdb.payloadOf(rowOf(db, sceneId, 'k')).occurrence).toBe(0)
    // Another copy added before it: it is the third appearance now, still in p3.
    save(db, sceneId, [['p0', 'The bell rang twice, they said.'], ['p1', 'The bell rang twice.'], ['p2', 'The bell rang once.'], twice[2]])
    const p = cdb.payloadOf(rowOf(db, sceneId, 'k'))
    expect(p.occurrence).toBe(2)
    expect(p.at).toEqual({ pid: 'p3', n: 0 })
    expect(cdb.readIssue(rowOf(db, sceneId, 'k'), { entry: () => null, sceneLabel: () => null, storyTitle: () => null }).occurrence).toBe(2)
  })

  it('with no paragraph ids, goes when the scene has fewer appearances than its place needs', () => {
    const { db, storyId, sceneId } = world(twice)
    cdb.saveFound(db, [], [found(sceneId, storyId, 'k', 'the bell rang twice', { occurrence: 1 })], () => false)
    const text = 'Tobin said nothing.\n\nThe bell rang twice.\n\nLater, the bell was silent.'
    repo.saveSceneText(db, sceneId, null, text)
    cdb.sweepGone(db, { sceneId }, { doc: null, text })
    expect(statusOf(db, sceneId, 'k')).toBe('gone')
  })

  it('an issue with no place counts its words anywhere in the scene, as before', () => {
    const { db, storyId, sceneId } = world(twice)
    cdb.saveFound(db, [], [found(sceneId, storyId, 'k', 'the bell rang twice')], () => false)
    save(db, sceneId, twice)
    save(db, sceneId, [twice[0], twice[1], ['p3', 'Later, the bell was silent.']])
    expect(statusOf(db, sceneId, 'k')).toBe('open')
  })

  it('the story-wide pass (badges) puts away one found at a later place than the scene now has', () => {
    const { db, storyId, sceneId } = world(twice)
    cdb.saveFound(db, [], [found(sceneId, storyId, 'k', 'the bell rang twice', { occurrence: 1 })], () => false)
    repo.saveSceneText(db, sceneId, null, 'The bell rang twice. The bell was silent.')
    expect(cdb.sweepGone(db, { storyId })).toEqual([sceneId])
    expect(statusOf(db, sceneId, 'k')).toBe('gone')
  })
})

describe('a row put away comes back with its words', () => {
  const scene: Para[] = [
    ['p1', 'Rain came off the river.'],
    ['p2', 'Mara’s eyes were green in the lamplight.']
  ]
  const rewritten: Para[] = [scene[0], ['p2', 'Mara’s eyes were blue in the lamplight.']]

  it('Ctrl+Z bringing the words back reopens what the sweep put away; never what Adam ignored or fixed', () => {
    const { db, storyId, sceneId } = world(scene)
    cdb.saveFound(
      db,
      [],
      [
        found(sceneId, storyId, 'k1', 'Mara’s eyes were green'),
        { ...found(sceneId, storyId, 'k2', 'eyes were green in the lamplight', { check: 'continuity' }), kind: 'continuity' },
        { ...found(sceneId, storyId, 'k3', 'green in the lamplight', { check: 'voice' }), kind: 'voice' }
      ],
      () => false
    )
    save(db, sceneId, scene)
    cdb.setIssueStatus(db, rowOf(db, sceneId, 'k3').id as ID, 'ignored')
    save(db, sceneId, rewritten)
    expect(statusOf(db, sceneId, 'k1')).toBe('gone')
    expect(statusOf(db, sceneId, 'k2')).toBe('gone')
    cdb.setIssueStatus(db, rowOf(db, sceneId, 'k2').id as ID, 'fixed')
    // Undone: the words are back in their paragraph.
    expect(save(db, sceneId, scene)).toEqual([sceneId])
    expect(statusOf(db, sceneId, 'k1')).toBe('open')
    expect(statusOf(db, sceneId, 'k2')).toBe('fixed')
    expect(statusOf(db, sceneId, 'k3')).toBe('ignored')
  })

  it('not when the words come back in another paragraph, nor beside an open issue about the same thing', () => {
    const { db, storyId, sceneId } = world(scene)
    cdb.saveFound(db, [], [found(sceneId, storyId, 'k1', 'Mara’s eyes were green')], () => false)
    save(db, sceneId, scene)
    save(db, sceneId, rewritten)
    save(db, sceneId, [...rewritten, ['p9', 'Mara’s eyes were green, once.']])
    expect(statusOf(db, sceneId, 'k1')).toBe('gone')
    // The memory keeper raised the same thing meanwhile: the old row stays put away.
    save(db, sceneId, rewritten)
    kdb.raiseIssue(db, { sceneId, storyId, kind: 'fact', severity: 'warning', quote: 'Mara’s eyes were green', message: 'Clash.', key: 'clash:m:eyes:green', payload: {} })
    save(db, sceneId, scene)
    expect(statusOf(db, sceneId, 'k1')).toBe('gone')
    expect(cdb.sceneIssueRows(db, sceneId).filter((r) => r.status === 'open')).toHaveLength(1)
  })
})

describe('Later', () => {
  const scene: Para[] = [
    ['p1', 'Rain came off the river.'],
    ['p2', 'Mara’s eyes were green in the lamplight.']
  ]

  it('hides an issue from the badges until the paragraph its words are in changes; typing elsewhere keeps it hidden', () => {
    const { db, storyId, sceneId } = world(scene)
    cdb.saveFound(db, [], [found(sceneId, storyId, 'k', 'Mara’s eyes were green')], () => false)
    const id = rowOf(db, sceneId, 'k').id as ID
    const names = { entry: () => null, sceneLabel: () => null, storyTitle: () => null }
    expect(cdb.readIssue(cdb.setLater(db, id)!, names).later).toBe(true)
    expect(cdb.openCounts(db, storyId)).toEqual({})
    save(db, sceneId, [['p1', 'Rain came off the river in sheets.'], scene[1]])
    expect(cdb.payloadOf(rowOf(db, sceneId, 'k')).later).toBeDefined()
    save(db, sceneId, [scene[0], ['p2', 'Mara’s eyes were green in the lamplight, and she smiled.']])
    expect(cdb.payloadOf(rowOf(db, sceneId, 'k')).later).toBeUndefined()
    expect(cdb.openCounts(db, storyId)).toEqual({ [sceneId]: { count: 1, mustFix: 0 } })
  })

  it('lasts until the next check of the scene (clearLater); the rules finding it again after a read keep it; Reopen ends it', () => {
    const { db, storyId, sceneId } = world(scene)
    const rule = found(sceneId, storyId, 'rule:dead:x:m', 'Rain came off the river', { by: 'rule', rule: 'dead', check: undefined })
    cdb.saveFound(db, [], [found(sceneId, storyId, 'k', 'Mara’s eyes were green'), rule], () => false)
    cdb.setLater(db, rowOf(db, sceneId, 'k').id as ID)
    cdb.setLater(db, rowOf(db, sceneId, 'rule:dead:x:m').id as ID)
    // The rules run again after a reading of the scene: found just as it was, still put off.
    cdb.saveFound(db, cdb.rowsInScenes(db, [sceneId]), [rule], (p) => p.by === 'rule')
    expect(cdb.payloadOf(rowOf(db, sceneId, 'rule:dead:x:m')).later).toBeDefined()
    expect(cdb.clearLater(db, sceneId)).toBe(2)
    expect(cdb.payloadOf(rowOf(db, sceneId, 'k')).later).toBeUndefined()
    cdb.setLater(db, rowOf(db, sceneId, 'k').id as ID)
    expect(cdb.reopenIssue(db, rowOf(db, sceneId, 'k').id as ID)!.status).toBe('open')
    expect(cdb.payloadOf(rowOf(db, sceneId, 'k')).later).toBeUndefined()
  })
})

describe('an entry saved by hand settles the clashes it answers', () => {
  it('fixes, by the memory, an open clash whose field now says what the scene says; leaves the rest', () => {
    const { db, storyId, sceneId } = world([['p1', 'Mara’s eyes were green.']])
    const m = repo.createEntry(db, 'character', { name: 'Mara', fields: { eyes: 'blue', hair: 'dark' } })
    kdb.raiseIssue(db, {
      sceneId,
      storyId,
      kind: 'fact',
      severity: 'warning',
      quote: 'Mara’s eyes were green',
      message: 'Eyes.',
      key: `clash:${m.id}:eyes:green`,
      payload: { entryId: m.id, field: 'eyes', memory: 'blue', text: 'green' }
    })
    cdb.saveFound(
      db,
      cdb.rowsInScenes(db, [sceneId]),
      [{ ...found(sceneId, storyId, 'k-hair', 'Mara', { entryId: m.id, field: 'hair', memoryFix: { entryId: m.id, field: 'hair', value: 'red' } }), kind: 'continuity' }],
      () => false
    )
    const value = (fields: Record<string, string>) => (f: string) => fields[f] ?? ''
    // Hair set to something else: nothing settled.
    expect(cdb.settleByEntry(db, m.id, value({ eyes: 'blue', hair: 'brown' }))).toBe(0)
    // Eyes now green, as the scene says: the clash is settled by the memory.
    expect(cdb.settleByEntry(db, m.id, value({ eyes: 'Green', hair: 'brown' }))).toBe(1)
    const clash = rowOf(db, sceneId, `clash:${m.id}:eyes:green`)
    expect(clash.status).toBe('fixed')
    expect(cdb.payloadOf(clash).fixedBy).toBe('memory')
    expect(statusOf(db, sceneId, 'k-hair')).toBe('open')
    // Hair as Update the memory would set it.
    expect(cdb.settleByEntry(db, m.id, value({ eyes: 'green', hair: 'red' }))).toBe(1)
    expect(statusOf(db, sceneId, 'k-hair')).toBe('fixed')
  })
})

describe('the check report and the scene’s contract', () => {
  it('says when the scene’s words have changed since the check', () => {
    const { db, sceneId } = world([['p1', 'Rain came off the river.']])
    saveReport(db, { sceneId, after: 'request', items: [], found: 0, textHash: 'nothing like it' })
    expect(checkReportNow(db, sceneId)!.changed).toBe(true)
    const text = repo.getScene(db, sceneId).text
    saveReport(db, { sceneId, after: 'request', items: [], found: 0, textHash: hashText(text) })
    expect(checkReportNow(db, sceneId)!.changed).toBe(false)
    // A report from before fingerprints says nothing either way.
    saveReport(db, { sceneId, after: 'request', items: [], found: 0 })
    expect(checkReportNow(db, sceneId)!.changed).toBeUndefined()
  })

  it('keeps the contract’s items whole, so a later check of the scene can go through it again; older reports read too', () => {
    const { db, sceneId } = world([['p1', 'Rain came off the river.']])
    const contract: SceneContract = {
      asks: 'beat',
      items: [
        { code: 'C1', part: 'change', text: 'Mara opens the hatch', check: 'continuity', entryIds: ['e1'] },
        { code: 'C2', part: 'keep', text: 'Tobin is dead', check: 'facts', entryIds: [] }
      ]
    }
    const items = contractResults(contract, { broken: [], notYet: [], said: new Map() }, { broken: new Set(), notYet: new Set(['C1']) })
    saveContractCheck(db, sceneId, { at: new Date().toISOString(), asks: 'beat', items })
    expect(savedContract(db, sceneId)).toEqual(contract)
    // A report kept before the items carried their codes: read as facts about no one in particular.
    saveContractCheck(db, sceneId, { at: '', asks: 'scene', items: [{ part: 'change', text: 'Mara opens the hatch', result: 'not yet' }] })
    expect(savedContract(db, sceneId)).toEqual({ asks: 'scene', items: [{ code: 'C1', part: 'change', text: 'Mara opens the hatch', check: 'facts', entryIds: [] }] })
    expect(checkReport(db, sceneId)!.contract!.items).toHaveLength(1)
  })
})
