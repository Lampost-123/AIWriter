// The free rule-based checks in a real world (long story memory fix 8): what they find is kept in the Issues tab as a
// rule's, raised once, replaced as the scene changes, never again once ignored (meant), a slip once fixed, and given way
// to the AI check's finding of the same thing. Invented test text only.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { ID, SceneCard } from '@shared/types'
import * as repo from '../db/repo'
import * as cdb from '../db/checks'
import * as kdb from '../db/keeper'
import * as mem from '../db/memory'
import { memoryWorld } from '../../../tests/unit/helpers'
import { lessonsBefore } from './lessons'
import { ruleKey, runRuleChecks } from './ruleChecks'

/** A story with three scenes in one chapter, Mara and Tobin in the codex. */
function world() {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const outline = repo.getOutline(db, story.id)
  const chapter = outline.chapters[0].id
  const scenes = [outline.scenes[0].id, repo.createScene(db, chapter).id, repo.createScene(db, chapter).id]
  const mara = repo.createEntry(db, 'character', { name: 'Mara' })
  const tobin = repo.createEntry(db, 'character', { name: 'Tobin' })
  const card = (sceneId: ID, c: Partial<SceneCard>): void => void repo.updateSceneCard(db, sceneId, { ...repo.getScene(db, sceneId).card, ...c })
  const write = (sceneId: ID, text: string): void => void repo.saveSceneText(db, sceneId, null, text)
  const open = (sceneId: ID) => cdb.sceneIssueRows(db, sceneId).filter((r) => r.status === 'open')
  return { db, story, scenes, mara, tobin, card, write, open }
}

/** Tobin dies in Scene 1 (Adam's own change) and speaks in Scene 2. */
function deadSpeaks() {
  const w = world()
  w.write(w.scenes[0], 'Tobin walked into the fire.')
  mem.insertChange(w.db, { kind: 'update', payload: { note: 'died in the fire' }, entryId: w.tobin.id, anchor: 'scene', sceneId: w.scenes[0], origin: 'adam' })
  w.write(w.scenes[1], 'Mara pushed the door open. "You took your time," said Tobin.')
  w.write(w.scenes[2], 'Mara waited by the ferry.')
  return w
}

const NAMES: cdb.IssueNames = { entry: () => null, sceneLabel: () => null, storyTitle: () => null }

describe('rule findings in the Issues tab', () => {
  it('raises the dead speaking once, as a rule’s, and takes it away when the words no longer say it', async () => {
    const { db, scenes, tobin, write, open } = deadSpeaks()
    expect(runRuleChecks(db, scenes[1])).toBe(1)
    const [row] = open(scenes[1])
    expect(row).toMatchObject({
      kind: 'fact',
      severity: 'must-fix',
      quote: '"You took your time," said Tobin.',
      message: 'Tobin died in Ch 1, Sc 1, but speaks here.'
    })
    expect(cdb.payloadOf(row)).toMatchObject({ by: 'rule', rule: 'dead', entryId: tobin.id, key: ruleKey({ rule: 'dead', about: tobin.id }, scenes[1]) })
    const issue = cdb.readIssue(row, NAMES)
    expect(issue.byRule).toBe(true)
    expect(issue.memoryFix).toBeNull()
    // Found again: the same issue, not a second, and the window isn't told of a change that isn't one.
    const told: ID[][] = []
    cdb.onIssuesTouched((_story, sceneIds) => told.push(sceneIds))
    expect(runRuleChecks(db, scenes[1])).toBe(0)
    await new Promise((r) => setTimeout(r, 5))
    cdb.onIssuesTouched(null)
    expect(told).toEqual([])
    expect(open(scenes[1])).toHaveLength(1)
    // Nothing in a scene where he is only remembered.
    write(scenes[2], 'Mara thought of Tobin, and of the fire.')
    expect(runRuleChecks(db, scenes[2])).toBe(0)
    // The line rewritten: what the rule found there goes.
    write(scenes[1], 'Mara pushed the door open. The room was empty.')
    expect(runRuleChecks(db, scenes[1])).toBe(0)
    expect(cdb.sceneIssueRows(db, scenes[1])).toEqual([])
  })

  it('never raises one Adam ignored again, and tells later checks it is meant; one fixed is a slip later scenes are warned of', () => {
    const { db, scenes, open } = deadSpeaks()
    runRuleChecks(db, scenes[1])
    const id = open(scenes[1])[0].id as ID
    cdb.setIssueStatus(db, id, 'ignored')
    expect(runRuleChecks(db, scenes[1])).toBe(0)
    expect(cdb.sceneIssueRows(db, scenes[1]).map((r) => r.status)).toEqual(['ignored'])
    expect(lessonsBefore(db, scenes[2]).meant.map((l) => [l.text, l.where])).toEqual([['Tobin died in Ch 1, Sc 1, but speaks here.', 'Book 1, Ch 1, Sc 2']])
    cdb.reopenIssue(db, id)
    cdb.setIssueStatus(db, id, 'fixed')
    expect(lessonsBefore(db, scenes[2]).slips.map((l) => l.text)).toEqual(['Tobin died in Ch 1, Sc 1, but speaks here.'])
  })

  it('gives way to the AI check’s finding of the same thing, whichever runs first, and comes back if the AI drops it', () => {
    const { db, story, scenes, tobin, open } = deadSpeaks()
    const ai: cdb.FoundIssue = {
      sceneId: scenes[1],
      storyId: story.id,
      kind: 'fact',
      severity: 'must-fix',
      quote: '"You took your time," said Tobin.',
      message: 'Tobin is dead by this point in the story, but speaks here.',
      key: `check:facts:${tobin.id}:you took your time said tobin`,
      payload: { by: 'check', check: 'facts', sources: [], fix: null, advice: 'Give the line to someone alive, or cut it.', memoryFix: null, entryId: tobin.id }
    }
    const facts = (p: cdb.IssuePayload): boolean => p.check === 'facts'
    // The rule first: the AI's finding takes its place.
    runRuleChecks(db, scenes[1])
    expect(cdb.saveFound(db, cdb.rowsInScenes(db, [scenes[1]]), [ai], facts)).toBe(0)
    let rows = open(scenes[1])
    expect(rows).toHaveLength(1)
    expect(rows[0].message).toBe(ai.message)
    expect(cdb.readIssue(rows[0], NAMES)).toMatchObject({ advice: 'Give the line to someone alive, or cut it.' })
    expect(cdb.readIssue(rows[0], NAMES).byRule).toBeUndefined()
    // The rules again: nothing new.
    expect(runRuleChecks(db, scenes[1])).toBe(0)
    expect(open(scenes[1]).map((r) => r.message)).toEqual([ai.message])
    // A whole AI re-run that doesn't find it takes its own away; the rule brings it back.
    cdb.saveFound(db, cdb.rowsInScenes(db, [scenes[1]]), [], facts)
    expect(open(scenes[1])).toEqual([])
    expect(runRuleChecks(db, scenes[1])).toBe(1)
    rows = open(scenes[1])
    expect(cdb.readIssue(rows[0], NAMES).byRule).toBe(true)
    // The AI first: the rule raises nothing beside it, and never takes an AI's finding away.
    db.prepare('DELETE FROM issues').run()
    expect(cdb.saveFound(db, [], [ai], facts)).toBe(1)
    expect(runRuleChecks(db, scenes[1])).toBe(0)
    expect(open(scenes[1]).map((r) => r.message)).toEqual([ai.message])
  })

  it('does nothing for a scene that is gone, and keeps nothing for one emptied', () => {
    const { db, scenes, write } = deadSpeaks()
    expect(runRuleChecks(db, 'no-such-scene')).toBe(0)
    runRuleChecks(db, scenes[1])
    write(scenes[1], '')
    expect(runRuleChecks(db, scenes[1])).toBe(0)
    expect(cdb.sceneIssueRows(db, scenes[1])).toEqual([])
  })
})

describe('rules over the cards and the stage', () => {
  it('flags a scene dated before the scene before it; a flashback, or a date it can’t place, says nothing', () => {
    const { db, scenes, card, write, open } = world()
    write(scenes[1], 'Rain on the river.')
    write(scenes[2], 'Rain on the roofs.')
    card(scenes[1], { when: 'Day 6' })
    card(scenes[2], { when: 'Day 4' })
    runRuleChecks(db, scenes[2])
    expect(open(scenes[2]).map((r) => [r.kind, r.message])).toEqual([
      ['timeline', 'This scene is dated Day 4, 2 days before the scene before it (Ch 1, Sc 2: Day 6). If it’s a flashback, start its When with “Flashback”.']
    ])
    card(scenes[2], { when: 'Flashback: Day 4' })
    runRuleChecks(db, scenes[2])
    expect(open(scenes[2])).toEqual([])
    card(scenes[2], { when: 'after the wedding' })
    runRuleChecks(db, scenes[2])
    expect(open(scenes[2])).toEqual([])
  })

  it('flags a point of view another scene has somewhere else at the same moment, never in a place inside this one', () => {
    const { db, scenes, mara, card, write, open } = world()
    const inn = repo.createEntry(db, 'place', { name: 'the Inn' })
    const room = repo.createEntry(db, 'place', { name: 'the back room', parentId: inn.id })
    const castle = repo.createEntry(db, 'place', { name: 'the Castle' })
    write(scenes[0], 'The inn was loud.')
    write(scenes[1], 'Rain fell on the castle walls.')
    card(scenes[0], { when: 'Day 3, evening', locationId: inn.id, presentIds: [mara.id] })
    card(scenes[1], { when: 'Day 3, evening', locationId: castle.id, povId: mara.id })
    runRuleChecks(db, scenes[1])
    expect(open(scenes[1]).map((r) => r.message)).toEqual([
      'Mara is the point of view here, at the Castle, but Ch 1, Sc 1 has Mara at the Inn at the same moment (Day 3 · evening).'
    ])
    // A place inside the other: the same place.
    card(scenes[1], { locationId: room.id })
    runRuleChecks(db, scenes[1])
    expect(open(scenes[1])).toEqual([])
    // "Later that evening" leans on the scene before: she may have gone there.
    card(scenes[1], { when: 'Later that evening', locationId: castle.id })
    runRuleChecks(db, scenes[1])
    expect(open(scenes[1])).toEqual([])
  })

  it('reads one thing in two hands from the stage while it still stands', () => {
    const { db, scenes, write, open } = world()
    repo.createEntry(db, 'item', { name: 'The brass compass' })
    const scene = scenes[1]
    write(scene, 'Mara held the brass compass. Tobin gripped the compass too.')
    const hash = createHash('sha1')
      .update(kdb.keeperScene(db, scene)?.text ?? '')
      .digest('hex')
      .slice(0, 16)
    const person = (name: string, holding: string) => ({ name, where: '', posture: '', holding, condition: '', mood: '', lastAction: '', clothes: [] })
    const state = {
      time: '',
      weather: '',
      light: '',
      things: [],
      characters: [person('Mara', 'the brass compass'), person('Tobin', 'the compass')],
      said: {
        'mara|holding': { quote: 'Mara held the brass compass', sceneId: scene },
        'tobin|holding': { quote: 'Tobin gripped the compass', sceneId: scene }
      }
    }
    repo.setMeta(db, 'continuity', JSON.stringify({ [scene]: { hash, base: '', state } }))
    runRuleChecks(db, scene)
    expect(open(scene).map((r) => [r.kind, r.quote, r.message])).toEqual([
      ['continuity', 'Tobin gripped the compass', 'Mara and Tobin both hold the brass compass at the end of this scene.']
    ])
    // New words: the stage no longer stands, so the rule says nothing until it is read again.
    write(scene, 'Mara held the brass compass. Tobin watched.')
    runRuleChecks(db, scene)
    expect(open(scene)).toEqual([])
  })
})
