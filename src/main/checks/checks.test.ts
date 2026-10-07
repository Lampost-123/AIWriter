import { describe, expect, it } from 'vitest'
import type { EntryState, ID } from '@shared/types'
import * as repo from '../db/repo'
import * as cdb from '../db/checks'
import * as kdb from '../db/keeper'
import { dbWorld, pureWorld, ashHairLast } from '../../../tests/unit/testWorld'
import { memoryWorld } from '../../../tests/unit/helpers'
import { issueKey, occurrenceAt, plainQuote, sceneQuote, stillThere } from './quote'
import { memoryFixable } from './memoryFix'
import { canUpdateField } from './run'
import { checkOf, fieldOf, foundIssues, readCheckReply, severityOf, type ReadContext } from './parse'
import { checkRequest, checkSections, factsThatMatter, gatherSceneCheck, splitScene } from './context'
import * as mem from '../db/memory'
import { storyComparisons, storyIssues } from './stories'
import { sceneSystem } from './prompts'
import { loadMemoryData, loadShape } from '../memory/scene'
import { sideClashes } from '../memory/state'

const PREFS = { spelling: 'UK' as const, pov: '', tense: '', voiceNotes: '', avoidWords: [] }

const SCENE = `Rain came off the river in sheets.

Mara turned at the door. Mara’s eyes were green in the lamplight, and she did not smile.

"You’re late," said Tobin, from the dark.`

describe('quotes', () => {
  it('keeps the scene’s own words when the quote differs only in quotation marks, dashes, capitals or spacing', () => {
    expect(sceneQuote(SCENE, "Mara's eyes were green")).toBe('Mara’s eyes were green')
    expect(sceneQuote(SCENE, '"you’re   late," said tobin')).toBe('"You’re late," said Tobin')
    expect(sceneQuote(SCENE, '“Mara turned at the door.”')).toBe('Mara turned at the door.')
  })

  it('takes the longest piece of a quote joined with "..." and drops one that isn’t in the scene', () => {
    expect(sceneQuote(SCENE, 'Mara turned at the door ... she did not smile at all today')).toBe('Mara turned at the door')
    expect(sceneQuote(SCENE, 'Her eyes were blue as the sea')).toBeNull()
    expect(sceneQuote(SCENE, '')).toBeNull()
    expect(sceneQuote(SCENE, 42)).toBeNull()
  })

  it('knows when the words have gone from the text', () => {
    expect(stillThere(SCENE, 'Mara’s eyes were green')).toBe(true)
    expect(stillThere(SCENE.replace('green', 'grey'), 'Mara’s eyes were green')).toBe(false)
    expect(stillThere('anything', '')).toBe(true)
  })

  it('makes the same key for the same issue however the quote is written', () => {
    expect(issueKey('facts', 'e1', 'Mara’s eyes were green.')).toBe(issueKey('facts', 'e1', "  mara's EYES were green "))
    expect(issueKey('facts', 'e1', 'a')).not.toBe(issueKey('knowledge', 'e1', 'a'))
    expect(plainQuote('“Hello,” she said.')).toBe('hello," she said')
  })
})

const mara = {
  id: 'm1',
  kind: 'character',
  name: 'Mara',
  aliases: ['the heir'],
  summary: '',
  description: '',
  tags: [],
  notes: '',
  fields: { eyes: 'blue', hair: 'dark' },
  parentId: null,
  hardRule: false,
  origin: 'text',
  fieldOrigins: { eyes: 'adam' },
  originStoryId: null,
  originSceneId: null,
  originStart: false,
  byHand: true,
  createdAt: '',
  updatedAt: '',
  happened: [],
  changed: []
} as unknown as EntryState
const tobin = { ...mara, id: 't1', name: 'Tobin', aliases: [], fields: {}, fieldOrigins: {} } as EntryState

const ctx = (over: Partial<ReadContext> = {}): ReadContext => ({
  sceneId: 's1',
  storyId: 'b1',
  text: SCENE,
  checks: ['facts', 'knowledge', 'timeline'],
  entries: new Map([
    ['E1', mara],
    ['E2', tobin]
  ]),
  scenes: new Map([['S1', { sceneId: 's0', label: 'Book 1, Ch 1, Sc 1' }]]),
  canUpdateMemory: (id, field) => id === 'm1' && field === 'eyes',
  ...over
})

describe('reading a reply', () => {
  it('reads the issues list, fenced or bare, and says why when it can’t', () => {
    expect(readCheckReply('```json\n{"issues": [{"quote": "a"}]}\n```')).toEqual({ ok: true, items: [{ quote: 'a' }], complete: true })
    expect(readCheckReply('[{"quote": "a"}]')).toEqual({ ok: true, items: [{ quote: 'a' }], complete: true })
    expect(readCheckReply('{"issues": []}')).toEqual({ ok: true, items: [], complete: true })
    expect(readCheckReply('Nothing to see here.')).toMatchObject({ ok: false })
    expect(readCheckReply('{"found": []}')).toEqual({ ok: false, why: 'it had no "issues" list' })
    expect(readCheckReply('{"issues": [{"quote": "a"')).toMatchObject({ ok: false })
  })

  it('reads a list after words of its own, fenced or not, whole; one issue found inside something else is read only in part', () => {
    const two = '[{"quote": "a", "message": "x"}, {"quote": "b", "message": "y",}]'
    const fence = '```'
    expect(readCheckReply(`Here is what I found:\n\n${fence}json\n${two}\n${fence}`)).toEqual({
      ok: true,
      items: [
        { quote: 'a', message: 'x' },
        { quote: 'b', message: 'y' }
      ],
      complete: true
    })
    expect(readCheckReply(`I found two: ${two} That is all.`)).toMatchObject({ ok: true, complete: true })
    expect((readCheckReply(`I found two: ${two}`) as { items: unknown[] }).items).toHaveLength(2)
    // A single issue with no list around it: read, but not as the whole answer.
    expect(readCheckReply('Something like {"quote": "a", "message": "x"} maybe')).toEqual({
      ok: true,
      items: [{ quote: 'a', message: 'x' }],
      complete: false
    })
  })

  it('drops a rewrite of "A ... B" (only A is in the scene), and notes which of the quote’s places it is', () => {
    const text = 'He waited. Mara turned at the door and looked back. Later, Mara turned at the door and looked back.'
    const at = foundIssues(
      [{ check: 'facts', quote: 'Mara turned at the door ... looked back at nobody at all', message: 'M.', fix: 'Mara paused at the door.' }],
      ctx({ text })
    )[0]
    expect(at.quote).toBe('Mara turned at the door')
    expect(at.payload.fix).toBeNull()
    expect(at.payload.occurrence).toBe(0)
    const whole = foundIssues([{ check: 'facts', quote: 'Later, Mara turned at the door', message: 'M.', fix: 'Later, Mara paused.' }], ctx({ text }))[0]
    expect(whole.payload.fix).toBe('Later, Mara paused.')
    expect(occurrenceAt(text, 'Mara turned at the door', text.lastIndexOf('Mara turned'))).toBe(1)
  })

  it('reads checks, severities and fields as the model may write them', () => {
    expect(checkOf('Facts', ['facts'])).toBe('facts')
    expect(checkOf('timeline and place', ['facts', 'timeline'])).toBe('timeline')
    expect(checkOf('voice', ['facts'])).toBeNull()
    expect(checkOf(undefined, ['style'])).toBe('style')
    expect(severityOf('Must fix')).toBe('must-fix')
    expect(severityOf('minor')).toBe('minor')
    expect(severityOf('worth a look')).toBe('warning')
    expect(fieldOf(mara, 'eyes')).toBe('eyes')
    expect(fieldOf(mara, 'Eyes')).toBe('eyes')
    expect(fieldOf(mara, 'Distinguishing marks')).toBe('marks')
    expect(fieldOf(mara, 'favourite colour')).toBeNull()
  })

  it('keeps what can be trusted: the scene’s exact words, entries and scenes by id or name, one per key', () => {
    const found = foundIssues(
      [
        {
          check: 'facts',
          severity: 'warning',
          quote: "Mara's eyes were green",
          message: 'E1’s eyes are blue in the memory, but green here.',
          conflicts: { entry: 'E1', field: 'Eyes' },
          memory: 'blue',
          text: 'green',
          fix: 'Mara’s eyes were blue'
        },
        // The same again: one issue.
        { check: 'facts', quote: 'Mara’s eyes were green', message: 'Again.', conflicts: { entry: 'Mara', field: 'eyes' } },
        // Not in the scene: dropped.
        { check: 'facts', quote: 'Mara drew her sword', message: 'She has no sword.' },
        // A check not asked for: dropped.
        { check: 'voice', quote: 'You’re late', message: 'Tobin never says that.' },
        // No message: dropped.
        { check: 'timeline', quote: 'You’re late' },
        { check: 'timeline', severity: 'must fix', quote: '“You’re late,” said Tobin', message: 'Tobin was in S1 a moment ago.', conflicts: { scene: 'S1' } }
      ],
      ctx()
    )
    expect(found).toHaveLength(2)
    const [eyes, late] = found
    expect(eyes.quote).toBe('Mara’s eyes were green')
    expect(eyes.message).toBe('Mara’s eyes are blue in the memory, but green here.')
    expect(eyes.kind).toBe('fact')
    expect(eyes.payload.sources).toEqual([{ kind: 'entry', entryId: 'm1', name: 'Mara', field: 'eyes' }])
    expect(eyes.payload.fix).toBe('Mara’s eyes were blue')
    // Eyes are Adam's own note: the memory can be updated from the text.
    expect(eyes.payload.memoryFix).toEqual({ entryId: 'm1', field: 'eyes', value: 'green' })
    expect(eyes.key).toBe(issueKey('facts', 'm1', 'Mara’s eyes were green'))
    expect(late.quote).toBe('"You’re late," said Tobin')
    expect(late.severity).toBe('must-fix')
    expect(late.message).toBe('Tobin was in Book 1, Ch 1, Sc 1 a moment ago.')
    expect(late.payload.sources).toEqual([{ kind: 'scene', sceneId: 's0', label: 'Book 1, Ch 1, Sc 1' }])
    expect(late.payload.memoryFix).toBeNull()
  })

  it('offers to update the memory only for a fact about one of Adam’s own fields', () => {
    const item = { check: 'facts', quote: 'Mara’s eyes were green', message: 'Eyes.', conflicts: { entry: 'E1', field: 'eyes' }, text: 'green' }
    expect(foundIssues([item], ctx({ canUpdateMemory: () => false }))[0].payload.memoryFix).toBeNull()
    expect(foundIssues([{ ...item, text: '' }], ctx())[0].payload.memoryFix).toBeNull()
    // Never a description, a many-line field or a long value: a few words from the text would wipe them out.
    expect(foundIssues([{ ...item, conflicts: { entry: 'E1', field: 'description' } }], ctx())[0].payload.memoryFix).toBeNull()
    expect(foundIssues([{ ...item, conflicts: { entry: 'E1', field: 'traits' } }], ctx())[0].payload.memoryFix).toBeNull()
    expect(foundIssues([{ ...item, text: 'green, though in some lights they look grey and in others almost gold' }], ctx())[0].payload.memoryFix).toBeNull()
    expect(memoryFixable('character', 'eyes', 'green')).toBe(true)
    expect(memoryFixable('character', 'summary', 'green')).toBe(false)
    expect(memoryFixable('character', 'sampleLines', 'Hello')).toBe(false)
    // A fix that changes nothing isn't offered.
    expect(foundIssues([{ ...item, fix: 'Mara’s eyes were green.' }], ctx())[0].payload.fix).toBeNull()
  })
})

describe('issue rows', () => {
  const names = (adams = true): cdb.IssueNames => ({
    entry: (id) => (id === 'm1' ? { name: 'Mara', kind: 'character', isAdams: () => adams, value: (f) => (f === 'eyes' ? 'blue' : f === 'age' ? '30' : '') } : null),
    sceneLabel: (id) => (id === 's0' ? 'Book 1, Ch 1, Sc 1' : null),
    storyTitle: (id) => (id === 'b2' ? 'Book 2' : null)
  })
  const row = (payload: object, over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'i1',
    scene_id: 's1',
    story_id: 'b1',
    kind: 'fact',
    severity: 'warning',
    status: 'open',
    quote: 'q',
    message: 'm',
    payload_json: JSON.stringify(payload),
    created_at: 't',
    updated_at: 't',
    ...over
  })

  it('reads the memory keeper’s clash as an issue linked to the entry, offering to update one of Adam’s fields', () => {
    const keeper = { entryId: 'm1', field: 'eyes', memory: 'blue', text: 'green', key: 'clash:m1:eyes:green' }
    const i = cdb.readIssue(row(keeper), names())
    expect(i).toMatchObject({ sceneId: 's1', storyId: 'b1', kind: 'fact', severity: 'warning', status: 'open', fix: null })
    expect(i.sources).toEqual([{ kind: 'entry', entryId: 'm1', name: 'Mara', field: 'eyes' }])
    expect(i.memoryFix).toEqual({ entryId: 'm1', field: 'eyes', value: 'green' })
    // A field that isn't his: the text already wins there, so nothing to update.
    expect(cdb.readIssue(row(keeper), names(false)).memoryFix).toBeNull()
    expect(cdb.readIssue(row({ ...keeper, field: null }), names()).memoryFix).toBeNull()
    // The memory said something else than his note (an earlier scene's change): updating his note wouldn't settle it.
    expect(cdb.readIssue(row({ ...keeper, memory: 'grey' }), names()).memoryFix).toBeNull()
  })

  it('reads the world builder’s as story-wide, and the checks’ with their sources brought up to date', () => {
    const wb = cdb.readIssue(row({ entryId: 'm1', field: 'age', memory: '30', text: '31', from: 'summary', key: 'k' }, { scene_id: '', story_id: '' }), names())
    expect(wb.sceneId).toBeNull()
    expect(wb.storyId).toBeNull()
    expect(wb.memoryFix).toEqual({ entryId: 'm1', field: 'age', value: '31' })
    const check = cdb.readIssue(
      row({
        by: 'check',
        check: 'timeline',
        key: 'k',
        fix: 'new words',
        memoryFix: null,
        sources: [
          { kind: 'entry', entryId: 'm1', name: 'Old name', field: null },
          { kind: 'scene', sceneId: 's0', label: 'old' },
          { kind: 'story', storyId: 'b2', title: 'old' },
          { kind: 'entry', entryId: 'gone', name: 'Kept', field: null }
        ]
      }),
      names()
    )
    expect(check.fix).toBe('new words')
    expect(check.memoryFix).toBeNull()
    expect(check.sources).toEqual([
      { kind: 'entry', entryId: 'm1', name: 'Mara', field: null },
      { kind: 'scene', sceneId: 's0', label: 'Book 1, Ch 1, Sc 1' },
      { kind: 'story', storyId: 'b2', title: 'Book 2' },
      { kind: 'entry', entryId: 'gone', name: 'Kept', field: null }
    ])
  })
})

/** A world with one scene of text, and Mara in it. */
function sceneWorld(text = SCENE) {
  const db = memoryWorld()
  const [story] = repo.listStories(db)
  const sceneId = repo.getOutline(db, story.id).scenes[0].id
  repo.saveSceneText(db, sceneId, null, text)
  const m = repo.createEntry(db, 'character', { name: 'Mara', fields: { eyes: 'blue' } })
  return { db, storyId: story.id, sceneId, maraId: m.id }
}

const found = (sceneId: ID, storyId: ID, key: string, over: Partial<cdb.FoundIssue> = {}): cdb.FoundIssue => ({
  sceneId,
  storyId,
  kind: 'fact',
  severity: 'warning',
  quote: 'Mara’s eyes were green',
  message: 'Eyes.',
  key,
  payload: { by: 'check', check: 'facts', sources: [], fix: 'Mara’s eyes were blue', memoryFix: null },
  ...over
})

describe('keys and ignored issues', () => {
  it('raises a check’s issue once, replaces what the same check found before, and never raises an ignored key again', () => {
    const { db, storyId, sceneId } = sceneWorld()
    const facts = (p: cdb.IssuePayload) => p.check === 'facts'
    const a = found(sceneId, storyId, 'check:facts:-:a')
    expect(cdb.saveFound(db, cdb.rowsInScenes(db, [sceneId]), [a], facts)).toBe(1)
    // Found again: the same issue, not a second.
    expect(cdb.saveFound(db, cdb.rowsInScenes(db, [sceneId]), [a], facts)).toBe(0)
    expect(cdb.sceneIssueRows(db, sceneId)).toHaveLength(1)
    // Ignored, then found again: stays ignored, nothing new.
    const id = cdb.sceneIssueRows(db, sceneId)[0].id as ID
    cdb.setIssueStatus(db, id, 'ignored')
    expect(cdb.saveFound(db, cdb.rowsInScenes(db, [sceneId]), [a], facts)).toBe(0)
    expect(cdb.sceneIssueRows(db, sceneId).map((r) => r.status)).toEqual(['ignored'])
    // A re-run that doesn't find an open one any more takes it away; another check's are left alone.
    const b = found(sceneId, storyId, 'check:facts:-:b', { quote: 'she did not smile' })
    const c = found(sceneId, storyId, 'check:voice:-:c', { quote: 'You’re late', kind: 'voice', payload: { by: 'check', check: 'voice' } })
    cdb.saveFound(db, cdb.rowsInScenes(db, [sceneId]), [b, c], () => true)
    cdb.saveFound(db, cdb.rowsInScenes(db, [sceneId]), [], facts)
    expect(cdb.sceneIssueRows(db, sceneId).map((r) => [r.kind, r.status]).sort()).toEqual([
      ['fact', 'ignored'],
      ['voice', 'open']
    ])
  })

  it('never raises the memory keeper’s clash again once ignored, and a check finding the same thing adds its rewrite to the keeper’s', () => {
    const { db, storyId, sceneId, maraId } = sceneWorld()
    const clash = {
      sceneId,
      storyId,
      kind: 'fact',
      severity: 'warning',
      quote: 'Mara’s eyes were green',
      message: 'Mara’s eyes: this scene says “green”, but the memory says “blue”.',
      key: `clash:${maraId}:eyes:green`,
      payload: { entryId: maraId, field: 'eyes', memory: 'blue', text: 'green' }
    }
    expect(kdb.raiseIssue(db, clash)).toBe(true)
    expect(kdb.raiseIssue(db, clash)).toBe(false)
    // The check finds the same thing (the same entry and field): no second issue, but the keeper's gets the rewrite.
    const same = found(sceneId, storyId, issueKey('facts', maraId, 'Mara’s eyes were green'), {
      payload: { by: 'check', check: 'facts', entryId: maraId, field: 'eyes', fix: 'Mara’s eyes were blue', memoryFix: null, sources: [] }
    })
    expect(cdb.saveFound(db, cdb.rowsInScenes(db, [sceneId]), [same], (p) => p.check === 'facts')).toBe(0)
    const rows = cdb.sceneIssueRows(db, sceneId)
    expect(rows).toHaveLength(1)
    expect(cdb.payloadOf(rows[0]).fix).toBe('Mara’s eyes were blue')
    // Ignored: neither the keeper nor the check raises it again.
    cdb.setIssueStatus(db, rows[0].id as ID, 'ignored')
    expect(kdb.raiseIssue(db, clash)).toBe(false)
    expect(cdb.saveFound(db, cdb.rowsInScenes(db, [sceneId]), [same], (p) => p.check === 'facts')).toBe(0)
    expect(cdb.sceneIssueRows(db, sceneId).map((r) => r.status)).toEqual(['ignored'])
  })

  it('marks open issues whose words have gone, never ignored ones, and counts what is open per scene', () => {
    const { db, storyId, sceneId } = sceneWorld()
    cdb.saveFound(db, [], [found(sceneId, storyId, 'k1'), found(sceneId, storyId, 'k2', { quote: 'she did not smile', severity: 'must-fix' })], () => false)
    cdb.saveFound(db, cdb.rowsInScenes(db, [sceneId]), [found(sceneId, storyId, 'k3', { quote: 'Rain came off the river' })], () => false)
    const k3 = cdb.rowsInScenes(db, [sceneId]).find((r) => cdb.payloadOf(r).key === 'k3')!
    cdb.setIssueStatus(db, k3.id as ID, 'ignored')
    expect(cdb.openCounts(db, storyId)).toEqual({ [sceneId]: { count: 2, mustFix: 1 } })
    repo.saveSceneText(db, sceneId, null, SCENE.replace('green', 'grey').replace('Rain came', 'Snow came'))
    expect(cdb.sweepGone(db, { storyId })).toEqual([sceneId])
    const status = new Map(cdb.rowsInScenes(db, [sceneId]).map((r) => [cdb.payloadOf(r).key, r.status]))
    expect(status.get('k1')).toBe('gone')
    expect(status.get('k2')).toBe('open')
    expect(status.get('k3')).toBe('ignored')
    expect(cdb.openCounts(db, storyId)).toEqual({ [sceneId]: { count: 1, mustFix: 1 } })
    // A list never shows the gone ones.
    expect(cdb.sceneIssueRows(db, sceneId).map((r) => cdb.payloadOf(r).key).sort()).toEqual(['k2', 'k3'])
  })

  it('keeps an ignored issue ignored when the model rewords or requotes it, whatever it names', () => {
    const { db, storyId, sceneId } = sceneWorld()
    cdb.saveFound(db, [], [found(sceneId, storyId, 'check:facts:m1:a')], () => true)
    cdb.setIssueStatus(db, cdb.sceneIssueRows(db, sceneId)[0].id as ID, 'ignored')
    const again = [
      found(sceneId, storyId, 'check:facts:-:b', { quote: 'Mara’s eyes were green in the lamplight', message: 'Reworded.' }),
      found(sceneId, storyId, 'check:facts:s0:c', { quote: 'eyes were green', message: 'Requoted, about an earlier scene.' })
    ]
    expect(cdb.saveFound(db, cdb.rowsInScenes(db, [sceneId]), again, () => true)).toBe(0)
    expect(cdb.sceneIssueRows(db, sceneId).map((r) => r.status)).toEqual(['ignored'])
    // Another kind: a new issue.
    const other = found(sceneId, storyId, 'check:voice:-:d', { kind: 'voice', quote: 'eyes were green', payload: { by: 'check', check: 'voice' } })
    expect(cdb.saveFound(db, cdb.rowsInScenes(db, [sceneId]), [other], () => false)).toBe(1)
  })

  it('the memory keeper doesn’t raise what a check already raised about the same entry and field', () => {
    const { db, storyId, sceneId, maraId } = sceneWorld()
    cdb.saveFound(
      db,
      [],
      [found(sceneId, storyId, 'check:facts:x:she did not smile', { quote: 'she did not smile', payload: { by: 'check', check: 'facts', entryId: maraId, field: 'eyes' } })],
      () => false
    )
    const clash = {
      sceneId,
      storyId,
      kind: 'fact',
      severity: 'warning',
      quote: 'Mara’s eyes were green',
      message: 'Clash.',
      key: `clash:${maraId}:eyes:green`,
      payload: { entryId: maraId, field: 'eyes', memory: 'blue', text: 'green' }
    }
    expect(kdb.raiseIssue(db, clash)).toBe(false)
    cdb.setIssueStatus(db, cdb.sceneIssueRows(db, sceneId)[0].id as ID, 'ignored')
    expect(kdb.raiseIssue(db, clash)).toBe(false)
    expect(kdb.raiseIssue(db, { ...clash, key: 'clash:other', quote: 'Rain came off the river', payload: { entryId: 'someone', field: 'hair' } })).toBe(true)
  })

  it('never counts a live flag Adam ignored as open, and Reopen takes its row away', () => {
    const { db, storyId, sceneId } = sceneWorld()
    const t = new Date().toISOString()
    const add = (id: string, kind: string, status: string): void =>
      void db
        .prepare(
          'INSERT INTO issues (id, scene_id, story_id, kind, severity, status, quote, message, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(id, sceneId, storyId, kind, 'minor', status, 'suddenly', 'Phrase to avoid.', JSON.stringify({ key: `phrase:${id}` }), t, t)
    add('live1', 'phrase', 'ignored')
    add('live2', 'spelling', 'open')
    cdb.saveFound(db, [], [found(sceneId, storyId, 'k1')], () => false)
    expect(cdb.openCounts(db, storyId)).toEqual({ [sceneId]: { count: 1, mustFix: 0 } })
    const listed = cdb.sceneIssueRows(db, sceneId).map((r) => r.id)
    expect(listed).toContain('live1')
    expect(listed).not.toContain('live2')
    expect(listed).toHaveLength(2)
    expect(cdb.reopenIssue(db, 'live1')).toMatchObject({ id: 'live1', status: 'gone' })
    expect(cdb.issueRow(db, 'live1')).toBeNull()
    const k1 = cdb.rowsInScenes(db, [sceneId]).find((r) => cdb.payloadOf(r).key === 'k1')!
    cdb.setIssueStatus(db, k1.id as ID, 'ignored')
    expect(cdb.reopenIssue(db, k1.id as ID)).toMatchObject({ status: 'open' })
  })

  it('lists open issues first, must fix first, then in reading order', () => {
    const rows = [
      { id: 'a', status: 'ignored', severity: 'must-fix', scene_id: 's', quote: 'Rain', created_at: '1' },
      { id: 'b', status: 'open', severity: 'warning', scene_id: 's', quote: 'Tobin', created_at: '1' },
      { id: 'c', status: 'open', severity: 'warning', scene_id: 's', quote: 'Mara turned', created_at: '2' },
      { id: 'd', status: 'open', severity: 'must-fix', scene_id: 's', quote: 'Tobin', created_at: '3' }
    ]
    expect(cdb.sortIssues(rows, () => SCENE).map((r) => r.id)).toEqual(['d', 'c', 'b', 'a'])
  })
})

describe('what a check of a scene is told', () => {
  it('is the memory as of the start of the scene, on its own story’s line: the scene’s own changes aren’t in it yet', () => {
    const w = dbWorld()
    repo.saveSceneText(w.db, w.id('b1.c2.s2'), null, 'Mara held the blade with both hands.')
    repo.saveSceneText(w.db, w.id('b1.c3.s1'), null, 'Mara held the blade with both hands while Tobin watched.')
    const at = (key: string) => gatherSceneCheck(w.db, w.id(key), PREFS)
    const before = at('b1.c2.s2').entries.find((c) => c.entry.name === 'Mara')!
    expect(before.why).toBe('named in the scene')
    expect(before.entry.happened.map((h) => h.note)).not.toContain('lost her left hand')
    const after = at('b1.c3.s1')
    expect(after.entries.find((c) => c.entry.name === 'Mara')!.entry.happened.map((h) => h.note)).toContain('lost her left hand')
    // The memory section says so, and who knows what as of the scene's start: Tobin learns Mara is the heir in this very scene.
    const sections = checkSections(after, ['facts', 'knowledge', 'timeline'])
    const memory = sections.find((s) => s.id === 'memory')!.text
    expect(memory).toMatch(/### E1 Mara \(character; named in the scene\)/)
    expect(memory).toContain('lost her left hand')
    expect(sections.find((s) => s.id === 'knowledge')!.text).not.toContain('Known by: Tobin')
    repo.saveSceneText(w.db, w.id('b1.c3.s2'), null, 'Tobin bowed to Mara.')
    const next = checkSections(at('b1.c3.s2'), ['knowledge'])
    expect(next.find((s) => s.id === 'knowledge')!.text).toContain('Mara is the heir to the Reach. Known by: Tobin.')
    // Earlier scenes for the timeline, nearest last, with short ids.
    expect(after.earlier.map((s) => s.code)).toEqual(['S1', 'S2', 'S3'])
    expect(after.earlier[2].sceneId).toBe(w.id('b1.c2.s2'))
  })

  it('offers to update one of Adam’s notes only while no earlier scene’s change has set that field', () => {
    const w = dbWorld()
    repo.saveSceneText(w.db, w.id('b1.c2.s1'), null, 'Mara tied back her hair.')
    repo.saveSceneText(w.db, w.id('b2.c3.s1'), null, 'Mara tied back her hair.')
    const mara = (key: string) => gatherSceneCheck(w.db, w.id(key), PREFS).entries.find((c) => c.entry.name === 'Mara')!.entry
    // Book 1: her hair is his note, as he wrote it.
    expect(canUpdateField(w.db, mara('b1.c2.s1'), 'hair')).toBe(true)
    // Book 2, after she cut it: the memory says "cropped short" here, not his note.
    expect(mara('b2.c3.s1').fields.hair).toBe('cropped short')
    expect(canUpdateField(w.db, mara('b2.c3.s1'), 'hair')).toBe(false)
  })

  it('sees a side story along its own line: the host’s later changes don’t count there', () => {
    const w = dbWorld()
    // Kell's Road runs during Book 1 Ch 2; Mara loses her hand in Book 1 Ch 2 Sc 2, which Kell's Road never sees.
    repo.saveSceneText(w.db, w.id('kr.c1.s2'), null, 'Mara waved with her left hand.')
    const c = gatherSceneCheck(w.db, w.id('kr.c1.s2'), PREFS)
    expect(c.entries.find((x) => x.entry.name === 'Mara')!.entry.happened.map((h) => h.note)).not.toContain('lost her left hand')
  })

  it('asks for every check in one request, with the scene’s text last, in parts when it is long', () => {
    const w = dbWorld()
    repo.saveSceneText(w.db, w.id('b1.c3.s1'), null, 'Mara spoke.')
    const c = gatherSceneCheck(w.db, w.id('b1.c3.s1'), PREFS)
    const req = checkRequest(checkSections(c, ['facts', 'style']), 'Mara spoke.', { part: 1, parts: 1 })
    expect(req.user.endsWith('## The scene\nMara spoke.')).toBe(true)
    expect(req.blocks.map((b) => b.id)).toEqual(['scene-card', 'memory', 'scene-text'])
    expect(sceneSystem(['style', 'facts']).split('\n')[0]).toBe('[AIWRITE-CHECK v1] facts, style')
    const long = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} goes on for a while so that it takes up some room in the request.`).join('\n\n')
    const parts = splitScene(long, 200)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.join('\n\n')).toBe(long)
  })
})

describe('who knows what that matters, and what people here gave away', () => {
  it('keeps the facts about what the words name when there are more than the list holds, in the memory’s order', () => {
    const wren = { ...tobin, id: 'w', name: 'Wren' } as EntryState
    const ash = { ...tobin, id: 'a', name: 'Ash' } as EntryState
    const compass = { ...tobin, id: 'c', kind: 'item', name: 'The brass compass' } as EntryState
    const facts = Array.from({ length: 45 }, (_, i) => ({ factId: `f${i}`, fact: `The drove road ${i} floods in spring`, knownBy: ['w', 'a'], at: i }))
    // Learned at the start of the story and listed last: the old way, cut after the first 30, left it out.
    facts.push({ factId: 'fc', fact: 'Mother Agate keeps the compass in her hut', knownBy: ['w'], at: -1 })
    const kept = factsThatMatter(facts, [wren, ash], [wren, ash, compass], 30)
    expect(kept).toHaveLength(30)
    expect(kept.at(-1)?.factId).toBe('fc')
    // The rest are the most lately learned, still in the memory's order.
    expect(kept.slice(0, -1).map((f) => f.factId)).toEqual(facts.slice(16, 45).map((f) => f.factId))
    // Fewer than the list holds: all of them, as they were.
    expect(factsThatMatter(facts.slice(0, 5), [wren, ash], [wren, ash], 30)).toEqual(facts.slice(0, 5))
  })

  it('tells the facts check what someone here gave away chapters back, as it is now', () => {
    const db = memoryWorld()
    const story = repo.listStories(db)[0]
    const outline = repo.getOutline(db, story.id)
    const [s1, s2] = [outline.scenes[0].id, repo.createScene(db, outline.chapters[0].id).id]
    const wren = repo.createEntry(db, 'character', { name: 'Wren' })
    repo.createEntry(db, 'character', { name: 'Mother Agate' })
    repo.createEntry(db, 'item', { name: 'The brass compass' })
    mem.insertChange(db, { entryId: wren.id, anchor: 'scene', sceneId: s1, kind: 'update', payload: { note: 'gave her brass compass to Mother Agate as a toll' }, origin: 'text' })
    repo.updateSceneCard(db, s2, { ...repo.getScene(db, s2).card, povId: wren.id })
    repo.saveSceneText(db, s2, null, 'Wren checked the compass in the fog.')
    const at2 = gatherSceneCheck(db, s2, PREFS)
    // Named in the scene by its main word.
    expect(at2.entries.map((c) => [c.entry.name, c.why])).toContainEqual(['The brass compass', 'named in the scene'])
    const owned = checkSections(at2, ['facts']).find((s) => s.id === 'owned')!
    expect(owned.text).toBe('- Wren: no longer has the brass compass (gave her brass compass to Mother Agate as a toll; since Book 1, Ch 1, Sc 1)')
    expect(checkSections(at2, ['voice']).some((s) => s.id === 'owned')).toBe(false)
  })
})

describe('checking across stories', () => {
  const w = pureWorld()
  it('compares a side story with its host over the stretch they share, and a prequel’s ending with the book it leads into', () => {
    expect(storyComparisons(w.shape, 'kr')).toEqual([
      { kind: 'side', storyId: 'kr', otherId: 'b1', sceneIds: ['kr.c1.s1', 'kr.c1.s2'], otherSceneIds: ['b1.c2.s1', 'b1.c2.s2'] }
    ])
    expect(storyComparisons(w.shape, 'ash')[0]).toMatchObject({ kind: 'side', otherId: 'b2' })
    // The prequel trilogy leads into Book 1 through its last book.
    expect(storyComparisons(w.shape, 'ym')).toEqual([])
    expect(storyComparisons(w.shape, 'ym3')).toEqual([
      { kind: 'prequel', storyId: 'ym3', otherId: 'b1', sceneIds: ['ym3.c1.s1'], otherSceneIds: ['b1.c1.s1', 'b1.c1.s2'] }
    ])
    expect(storyComparisons(w.shape, 'bd')[0]).toMatchObject({ kind: 'prequel', otherId: 'ld' })
    expect(storyComparisons(w.shape, 'b1')).toEqual([])
    expect(storyComparisons(w.shape, 'keep')).toEqual([])
    expect(storyComparisons(w.shape, 'missing')).toEqual([])
  })

  it('leaves out a clash "Which happened last?" already asks about', () => {
    const dw = dbWorld(undefined, [ashHairLast])
    const asked = sideClashes(loadMemoryData(dw.db), loadShape(dw.db), dw.id('ash'))
    expect(asked.some((a) => a.entryId === dw.id('mara') && a.aspect === 'hair')).toBe(true)
    const marae = { ...mara, id: dw.id('mara') } as EntryState
    const ctxOf = { storyId: dw.id('ash'), other: { id: dw.id('b2'), title: 'Book 2' }, entries: new Map([['E1', marae]]), quoteFrom: '', quoteScene: null, asked }
    const out = storyIssues(
      [
        { severity: 'warning', message: 'Mara’s hair is shaved in Ash but cropped in Book 2.', entry: 'E1', field: 'hair' },
        { severity: 'must-fix', message: 'E1 is at the ferry in Book 2 but in the hills in Ash.', entry: 'E1' },
        { severity: 'warning', message: 'Someone else entirely.', quote: 'not there' }
      ],
      ctxOf
    )
    // The hair clash is asked already; Mara's other one names no aspect, so it may be the one asked: it goes too.
    expect(out.map((i) => i.message)).toEqual(['Someone else entirely.'])
    expect(out[0]).toMatchObject({ kind: 'story', sceneId: null, quote: '' })
    expect(out[0].payload.sources).toEqual([{ kind: 'story', storyId: dw.id('b2'), title: 'Book 2' }])
    // Keyed on the other story, the entry and the field, never on the words: reworded, it is the same issue.
    const ctx2 = { ...ctxOf, entries: new Map([['E1', { ...marae, id: 'tobin' } as EntryState]]) }
    const [a] = storyIssues([{ message: 'Tobin is in two places.', entry: 'E1', field: 'age' }], ctx2)
    const [b] = storyIssues([{ message: 'Tobin can’t be at the ferry and in the hills.', entry: 'E1', field: 'age' }], ctx2)
    expect(a.key).toBe(b.key)
  })
})
