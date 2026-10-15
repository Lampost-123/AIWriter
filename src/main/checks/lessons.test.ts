// Remembering what the checks found (fix 7 of the long story memory research): a slip put right in an earlier scene
// warns the writer of a later scene with the same people, and what Adam said is meant is told to later checks. Invented
// test text only.
import { describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import * as repo from '../db/repo'
import * as cdb from '../db/checks'
import { memoryWorld } from '../../../tests/unit/helpers'
import { gatherContextInput } from '../ai/gather'
import { assembleContext, MUST_BLOCK } from '../ai/context'
import { countRaw } from '../ai/tokens'
import { mustStayTrue, MUST_SLIPS } from '../ai/mustStay'
import { checkSections, gatherSceneCheck } from './context'
import { sceneSystem } from './prompts'
import { lessonsBefore, lessonsFrom, RECENT_SCENES } from './lessons'

const PREFS = { spelling: 'UK' as const, pov: '', tense: '', voiceNotes: '', avoidWords: [] }

/** An issue row as the table keeps it. */
let n = 0
const row = (sceneId: ID, status: string, kind: string, message: string, payload: cdb.IssuePayload = { entryId: 'mara' }): Record<string, unknown> => ({
  id: `i${++n}`,
  scene_id: sceneId,
  story_id: 'b1',
  kind,
  severity: 'warning',
  status,
  quote: '',
  message,
  payload_json: JSON.stringify(payload),
  created_at: `2026-10-15T00:00:${String(n).padStart(2, '0')}.000Z`,
  updated_at: `2026-10-15T00:00:${String(n).padStart(2, '0')}.000Z`
})

describe('what the checks settled in earlier scenes', () => {
  const order = Array.from({ length: 10 }, (_, i) => `s${i + 1}`)
  const where = (id: ID): string => `Book 1, Ch 1, Sc ${id.slice(1)}`

  it('keeps slips put right in the text and what Adam said is meant, newest first', () => {
    const got = lessonsFrom(
      [
        row('s2', 'fixed', 'fact', 'Mara’s eyes are blue in the memory, but green here.', { entryId: 'mara', field: 'eyes' }),
        row('s9', 'fixed', 'fact', 'Tobin speaks, but he died in the fire.', { sources: [{ kind: 'entry', entryId: 'tobin', name: 'Tobin', field: null }] }),
        row('s8', 'ignored', 'knowledge', 'Wren knows of the toll, but no one told her.', { entryId: 'wren' }),
        row('s9', 'open', 'fact', 'Still open.'),
        row('s9', 'gone', 'fact', 'Words gone.')
      ],
      order,
      where
    )
    expect(got.slips.map((l) => [l.text, l.where, l.entryIds, l.back])).toEqual([
      ['Tobin speaks, but he died in the fire.', 'Book 1, Ch 1, Sc 9', ['tobin'], 2],
      ['Mara’s eyes are blue in the memory, but green here.', 'Book 1, Ch 1, Sc 2', ['mara'], 9]
    ])
    expect(got.meant.map((l) => l.text)).toEqual(['Wren knows of the toll, but no one told her.'])
  })

  it('leaves out style, voice and continuity, what the memory settled, and what is about no one', () => {
    const got = lessonsFrom(
      [
        row('s9', 'fixed', 'style', 'A slip into present tense.'),
        row('s9', 'fixed', 'voice', 'Tobin never swears.'),
        row('s9', 'fixed', 'continuity', 'Her coat was off.'),
        row('s9', 'fixed', 'fact', 'Settled by the memory.', { entryId: 'mara', field: 'eyes', fixedBy: 'memory' }),
        row('s9', 'fixed', 'fact', 'Settled before fixedBy was kept.', { entryId: 'mara', field: 'hair', text: 'cropped' }),
        row('s9', 'fixed', 'fact', 'About no one.', {})
      ],
      order,
      where,
      (p) => p.text === 'cropped'
    )
    expect(got).toEqual({ slips: [], meant: [] })
  })

  it('keeps who knows what and the timeline only from the last few scenes; a fact however long ago', () => {
    const old = `s${10 - RECENT_SCENES}`
    const got = lessonsFrom(
      [
        row(old, 'fixed', 'knowledge', 'Old knowledge.'),
        row(old, 'fixed', 'timeline', 'Old timeline.'),
        row('s1', 'fixed', 'fact', 'Old fact.', { entryId: 'tobin' }),
        row(`s${11 - RECENT_SCENES}`, 'fixed', 'timeline', 'Recent timeline.', { entryId: 'tobin' })
      ],
      order,
      where
    )
    expect(got.slips.map((l) => l.text)).toEqual(['Recent timeline.', 'Old fact.'])
  })

  it('says the same thing once: the newest for the same entry and field, or the same words', () => {
    const got = lessonsFrom(
      [
        row('s3', 'fixed', 'fact', 'Mara’s eyes are blue, not green.', { entryId: 'mara', field: 'eyes' }),
        row('s7', 'fixed', 'fact', 'Mara’s eyes are blue in the memory, but grey here.', { entryId: 'mara', field: 'eyes' }),
        row('s5', 'fixed', 'fact', 'Tobin is dead.', { entryId: 'tobin' }),
        row('s6', 'fixed', 'fact', 'Tobin is dead.', { entryId: 'tobin' })
      ],
      order,
      where
    )
    expect(got.slips.map((l) => [l.text, l.where])).toEqual([
      ['Mara’s eyes are blue in the memory, but grey here.', 'Book 1, Ch 1, Sc 7'],
      ['Tobin is dead.', 'Book 1, Ch 1, Sc 6']
    ])
  })
})

describe('the writer is warned of a slip put right before', () => {
  const person = (id: string, name: string) => ({ id, kind: 'character', name, aliases: [], fields: {}, changed: [], happened: [] }) as never
  const base = {
    stand: null,
    reach: 'start' as const,
    people: [person('mara', 'Mara')],
    named: [person('tobin', 'Tobin')],
    facts: [],
    sceneId: 'here',
    storyTitle: 'Book 1',
    places: {}
  }
  const slip = (text: string, entryIds: ID[]) => ({ text, where: 'Book 1, Ch 2, Sc 3', entryIds })

  it('says those about people in the scene first, then the rest of the briefing, at most MUST_SLIPS; never in the short form', () => {
    const slips = [slip('Tobin speaks, but he died in the fire.', ['tobin']), slip('Mara’s eyes are blue, not green.', ['mara']), slip('Wren is far away.', ['wren']), slip('Mara is left-handed.', ['mara'])]
    const lines = mustStayTrue({ ...base, slips })
    const said = lines.filter((l) => l.startsWith('Slipped'))
    expect(said).toEqual([
      "Slipped in Ch 2, Sc 3 and put right, so don't repeat it: Mara’s eyes are blue, not green.",
      "Slipped in Ch 2, Sc 3 and put right, so don't repeat it: Mara is left-handed."
    ])
    expect(said).toHaveLength(MUST_SLIPS)
    expect(mustStayTrue({ ...base, slips: [slips[0]] })).toEqual(["Slipped in Ch 2, Sc 3 and put right, so don't repeat it: Tobin speaks, but he died in the fire."])
    expect(mustStayTrue({ ...base, slips: [slips[2]] })).toEqual([])
    expect(mustStayTrue({ ...base, slips, short: true }).some((l) => l.startsWith('Slipped'))).toBe(false)
    expect(mustStayTrue({ ...base, slips, smallest: true }).some((l) => l.startsWith('Slipped'))).toBe(false)
  })
})

describe('in a real world', () => {
  /** A story with four scenes in one chapter, Mara and Tobin in the codex, Mara on each card, and words in each scene. */
  function world() {
    const db = memoryWorld()
    const story = repo.listStories(db)[0]
    const outline = repo.getOutline(db, story.id)
    const chapter = outline.chapters[0].id
    const scenes = [outline.scenes[0].id, repo.createScene(db, chapter).id, repo.createScene(db, chapter).id, repo.createScene(db, chapter).id]
    const mara = repo.createEntry(db, 'character', { name: 'Mara' })
    const tobin = repo.createEntry(db, 'character', { name: 'Tobin' })
    for (const s of scenes) {
      repo.updateSceneCard(db, s, { ...repo.getScene(db, s).card, povId: mara.id, presentIds: [tobin.id] })
      repo.saveSceneText(db, s, null, 'Mara waited by the ferry while Tobin talked.')
    }
    const found = (sceneId: ID, kind: 'fact' | 'knowledge', message: string, entryId: ID, field?: string): cdb.FoundIssue => ({
      sceneId,
      storyId: story.id,
      kind,
      severity: 'warning',
      quote: '',
      message,
      key: `check:${kind}:${entryId}:${message}`,
      payload: { by: 'check', check: kind === 'fact' ? 'facts' : 'knowledge', entryId, ...(field ? { field } : {}) }
    })
    return { db, story, scenes, mara, tobin, found }
  }

  it('warns the writer of a later scene of a slip put right in the text, but not of one the memory settled', () => {
    const { db, scenes, mara, tobin, found } = world()
    // Put right in the text as a draft landed (check and repair), and by Update the memory.
    cdb.saveFixed(db, found(scenes[0], 'fact', 'Mara’s eyes are blue in the memory, but green here.', mara.id, 'eyes'))
    cdb.saveFound(db, [], [found(scenes[1], 'fact', 'Tobin is a tanner in the memory, but a ferryman here.', tobin.id, 'role')], () => false)
    const settled = cdb.settledRows(db, [scenes[1]], ['fact'])
    expect(settled).toEqual([])
    const open = cdb.sceneIssueRows(db, scenes[1])[0]
    cdb.setFixedByMemory(db, open.id as ID)

    const got = lessonsBefore(db, scenes[3])
    expect(got.slips.map((l) => [l.text, l.where])).toEqual([['Mara’s eyes are blue in the memory, but green here.', 'Book 1, Ch 1, Sc 1']])
    // Reopened, it is no longer settled by the memory; put right in the text since, it is a slip like any other.
    cdb.reopenIssue(db, open.id as ID)
    cdb.setIssueStatus(db, open.id as ID, 'fixed')
    expect(lessonsBefore(db, scenes[3]).slips.map((l) => l.where)).toEqual(['Book 1, Ch 1, Sc 2', 'Book 1, Ch 1, Sc 1'])
    // Nothing from the scene itself or after it.
    expect(lessonsBefore(db, scenes[0]).slips).toEqual([])

    // The draft's briefing says it under Must stay true.
    const input = gatherContextInput(db, scenes[3], undefined, { prefs: PREFS, contextLength: 64_000, creativity: 'balanced' })
    const must = assembleContext(input, countRaw).blocks.find((b) => b.id === MUST_BLOCK)!.text
    expect(must).toContain("- Slipped in Ch 1, Sc 1 and put right, so don't repeat it: Mara’s eyes are blue in the memory, but green here.")
  })

  it('tells a later check what Adam said is meant, so it isn’t raised there either', () => {
    const { db, scenes, tobin, found } = world()
    cdb.saveFound(db, [], [found(scenes[1], 'knowledge', 'Tobin speaks of the toll, but no one told him.', tobin.id)], () => false)
    cdb.setIssueStatus(db, cdb.sceneIssueRows(db, scenes[1])[0].id as ID, 'ignored')

    const ctx = gatherSceneCheck(db, scenes[2], PREFS)
    expect(ctx.meant?.map((l) => l.text)).toEqual(['Tobin speaks of the toll, but no one told him.'])
    const meant = checkSections(ctx, ['knowledge']).find((s) => s.id === 'meant')!
    expect(meant.title).toBe('What the author has said is meant')
    expect(meant.text).toBe('- In Book 1, Ch 1, Sc 2: Tobin speaks of the toll, but no one told him.')
    // Only for the check it belongs to.
    expect(checkSections(ctx, ['facts', 'voice']).some((s) => s.id === 'meant')).toBe(false)
    expect(sceneSystem(['knowledge'])).toContain('"What the author has said is meant"')
    // A scene where Tobin isn't named or on the card isn't told.
    repo.updateSceneCard(db, scenes[3], { ...repo.getScene(db, scenes[3]).card, presentIds: [] })
    repo.saveSceneText(db, scenes[3], null, 'Mara waited by the ferry alone.')
    expect(gatherSceneCheck(db, scenes[3], PREFS).meant).toEqual([])
  })
})
