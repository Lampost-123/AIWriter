// The SQL for memory over time (src/main/db/memory.ts): changes, first-exists points, placement,
// the shape of a world's stories, summaries, pins and block modes, and the lists entry pages show.

import { describe, expect, it } from 'vitest'
import type { ChangeInput, ID } from '@shared/types'
import * as repo from '../../src/main/db/repo'
import * as mem from '../../src/main/db/memory'
import { entryHistory, addLink } from '../../src/main/db/history'
import { changeViews, sceneMemory } from '../../src/main/memory/scene'
import { buildLine, knowsSentence } from '../../src/main/memory/line'
import { UserError } from '../../src/main/util'
import { memoryWorld } from './helpers'

type DB = ReturnType<typeof memoryWorld>

/** Book 1 with three chapters (two scenes each) and Book 2 after it, with Mara and Tobin. */
function small(): { db: DB; b1: ID; b2: ID; ch: ID[]; sc: ID[][]; b2sc: ID; mara: ID; tobin: ID } {
  const db = memoryWorld()
  const b1 = repo.listStories(db)[0].id
  const outline = repo.getOutline(db, b1)
  const ch = [outline.chapters[0].id, repo.createChapter(db, b1).id, repo.createChapter(db, b1).id]
  const sc = ch.map((c, i) => [i === 0 ? outline.scenes[0].id : repo.createScene(db, c).id, repo.createScene(db, c).id])
  const b2 = repo.createStory(db, { title: 'Book 2' }).id
  const b2sc = repo.createScene(db, repo.createChapter(db, b2).id).id
  const mara = repo.createEntry(db, 'character', { name: 'Mara' }).id
  const tobin = repo.createEntry(db, 'character', { name: 'Tobin' }).id
  return { db, b1, b2, ch, sc, b2sc, mara, tobin }
}

const update = (entryId: ID, sceneId: ID, note: string): ChangeInput & { origin: 'adam' } => ({
  entryId,
  anchor: 'scene',
  sceneId,
  kind: 'update',
  payload: { note },
  origin: 'adam'
})

describe('changes', () => {
  it('numbers changes at each place, moves a change to the end of a new place, deletes and restores, and records versions', () => {
    const w = small()
    const a = mem.insertChange(w.db, update(w.mara, w.sc[0][0], 'a'))
    const b = mem.insertChange(w.db, update(w.mara, w.sc[0][0], 'b'))
    const c = mem.insertChange(w.db, update(w.mara, w.sc[1][0], 'c'))
    const s = mem.insertChange(w.db, {
      entryId: w.mara,
      anchor: 'story-start',
      storyId: w.b2,
      kind: 'update',
      payload: { note: 's' },
      origin: 'adam'
    })
    expect([a.position, b.position, c.position, s.position]).toEqual([0, 1, 0, 0])
    expect(a.storyId).toBe(w.b1)
    const moved = mem.replaceChange(w.db, c.id, { ...update(w.mara, w.sc[0][0], 'c moved'), origin: 'text' })
    expect(moved.position).toBe(2)
    expect(moved.origin).toBe('text')
    const kept = mem.replaceChange(w.db, a.id, { ...update(w.mara, w.sc[0][0], 'a again'), origin: 'adam' })
    expect(kept.position).toBe(0)
    mem.deleteChange(w.db, b.id)
    expect(() => mem.getChange(w.db, b.id)).toThrow(UserError)
    expect(mem.changesInScene(w.db, w.sc[0][0]).map((x) => x.id)).toEqual([a.id, c.id])
    mem.restoreChange(w.db, b.id)
    expect(mem.changesInScene(w.db, w.sc[0][0]).map((x) => x.id)).toEqual([a.id, b.id, c.id])
    expect(
      entryHistory(w.db, w.mara)
        .filter((v) => v.factKind === 'change' && v.factId === b.id)
        .map((v) => v.data === null)
    ).toEqual([false, true, false])
  })

  it('refuses a change with no place, in plain words', () => {
    const w = small()
    expect(() =>
      mem.insertChange(w.db, { entryId: w.mara, anchor: 'story-start', kind: 'update', payload: { note: 'x' }, origin: 'adam' })
    ).toThrow('A change at the start of a story needs its story.')
    expect(() =>
      mem.insertChange(w.db, {
        entryId: w.mara,
        anchor: 'story-start',
        storyId: 'gone',
        kind: 'update',
        payload: { note: 'x' },
        origin: 'adam'
      })
    ).toThrow('That story no longer exists.')
    expect(() => mem.insertChange(w.db, { ...update(w.mara, 'gone', 'x') })).toThrow('That scene no longer exists.')
  })

  it("lists an entry's changes with relationships from the other side, in story order, with where each happened", () => {
    const w = small()
    const late = mem.insertChange(w.db, update(w.mara, w.b2sc, 'in Book 2'))
    const early = mem.insertChange(w.db, update(w.mara, w.sc[1][1], 'in Ch 2'))
    const start = mem.insertChange(w.db, {
      entryId: w.mara,
      anchor: 'story-start',
      storyId: w.b2,
      kind: 'update',
      payload: { note: 'gap' },
      origin: 'adam'
    })
    const other = mem.insertChange(w.db, {
      entryId: w.tobin,
      anchor: 'baseline',
      kind: 'relationship',
      payload: { otherId: w.mara, type: 'friend', feels: '', otherFeels: '' },
      origin: 'adam'
    })
    const full = mem.insertChange(w.db, {
      entryId: w.tobin,
      anchor: 'story-start',
      storyId: w.b2,
      kind: 'full',
      payload: { description: 'Old Tobin.', knows: [], relationships: [{ otherId: w.mara, type: 'brother', feels: '', otherFeels: '' }] },
      origin: 'adam'
    })
    mem.insertChange(w.db, update(w.tobin, w.sc[0][0], 'not about Mara'))
    const gone = mem.insertChange(w.db, update(w.mara, w.sc[2][0], 'deleted scene'))
    repo.deleteScene(w.db, w.sc[2][0])
    addLink(w.db, {
      factKind: 'change',
      factId: early.id,
      field: null,
      sceneId: w.sc[1][1],
      sceneVersion: 1,
      paragraphId: 'p1',
      start: 0,
      end: 4,
      quote: 'Mara'
    })

    const views = changeViews(w.db, mem.changesForEntry(w.db, w.mara))
    expect(views.map((v) => [v.id, v.where])).toEqual([
      [other.id, 'Before any story'],
      [early.id, 'Book 1, Ch 2, Sc 2'],
      [start.id, 'the start of Book 2'],
      [full.id, 'the start of Book 2'],
      [late.id, 'Book 2, Ch 1, Sc 1']
    ])
    expect(views.find((v) => v.id === early.id)?.links.map((l) => l.quote)).toEqual(['Mara'])
    expect(views.some((v) => v.id === gone.id)).toBe(false)
  })

  it('lists every fact once, with its latest wording, leaving out facts only deleted entries knew', () => {
    const w = small()
    const kell = repo.createEntry(w.db, 'character', { name: 'Kell' }).id
    const know = (entryId: ID, factId: ID, fact: string) =>
      mem.insertChange(w.db, { entryId, anchor: 'baseline', kind: 'knowledge', payload: { factId, fact }, origin: 'adam' })
    know(w.tobin, 'f1', 'Mara is the heir.')
    know(w.mara, 'f1', 'Mara is the true heir.')
    know(kell, 'f2', 'Only Kell knew.')
    mem.insertChange(w.db, {
      entryId: w.mara,
      anchor: 'story-start',
      storyId: w.b2,
      kind: 'full',
      payload: { description: 'x', knows: [{ factId: 'f3', fact: 'A full description fact.' }], relationships: [] },
      origin: 'adam'
    })
    repo.deleteEntry(w.db, kell)
    expect(mem.listFacts(w.db)).toEqual([
      { factId: 'f3', fact: 'A full description fact.' },
      { factId: 'f1', fact: 'Mara is the true heir.' }
    ])
  })

  it("checks Adam's changes in plain words and tidies them", () => {
    const w = small()
    const base = { entryId: w.mara, anchor: 'baseline' as const }
    const check = (input: Partial<ChangeInput>) => mem.cleanChangeInput(w.db, { ...base, ...input } as ChangeInput)
    expect(() => check({ kind: 'update', payload: { note: '  ' } })).toThrow('Write what changed first.')
    expect(check({ kind: 'update', payload: { note: ' lost a hand ' } }).payload).toEqual({ note: 'lost a hand' })
    expect(() => check({ kind: 'relationship', payload: { otherId: '', type: '', feels: '', otherFeels: '' } })).toThrow(
      'Pick who or what this relationship is with.'
    )
    expect(() => check({ kind: 'relationship', payload: { otherId: w.mara, type: '', feels: '', otherFeels: '' } })).toThrow(
      'A relationship needs two different entries.'
    )
    expect(() => check({ kind: 'knowledge', payload: { factId: '', fact: ' ' } })).toThrow('Write what they learn first.')
    const k = check({ kind: 'knowledge', payload: { factId: '', fact: 'A new fact.' } })
    expect(k.kind === 'knowledge' && k.payload.factId.length).toBeGreaterThan(10)
    expect(() => check({ kind: 'full', payload: { description: '', knows: [], relationships: [] } })).toThrow(
      'Write the starting description first.'
    )
    const full = check({
      kind: 'full',
      payload: {
        description: 'Young.',
        knows: [
          { factId: '', fact: '' },
          { factId: 'f', fact: 'Kept.' }
        ],
        relationships: []
      }
    })
    expect(full.kind === 'full' && full.payload.knows).toEqual([{ factId: 'f', fact: 'Kept.' }])
    expect(check({ kind: 'thread', payload: { status: 'nonsense' as 'open', note: '' } }).payload).toEqual({ status: 'open', note: '' })
    expect(() => mem.cleanChangeInput(w.db, { ...base, entryId: 'gone', kind: 'update', payload: { note: 'x' } })).toThrow(
      'That entry no longer exists.'
    )
    expect(
      mem.entriesTouched({ entryId: w.mara, kind: 'relationship', payload: { otherId: w.tobin, type: '', feels: '', otherFeels: '' } })
    ).toEqual([w.mara, w.tobin])
  })
})

describe('where entries first exist', () => {
  it('follows the rules for each way an entry is made', () => {
    const w = small()
    const point = (kind: Parameters<typeof repo.createEntry>[1], making: Parameters<typeof repo.createEntry>[3]) => {
      const e = repo.createEntry(w.db, kind, { name: 'X' }, making)
      return mem.listExistsPoints(w.db, e.id).map((p) => [p.kind, p.storyId, p.sceneId])
    }
    expect(point('character', { origin: 'adam' })).toEqual([['world', null, null]])
    expect(point('character', { origin: 'adam', originStoryId: w.b1 })).toEqual([['world', null, null]])
    expect(point('character', { origin: 'adam', originStoryId: w.b2 })).toEqual([['story-pre', w.b2, null]])
    expect(point('character', { origin: 'text', originStoryId: w.b1, originSceneId: w.sc[1][0] })).toEqual([['scene', w.b1, w.sc[1][0]]])
    expect(point('item', { origin: 'text', originSceneId: w.sc[1][0] })).toEqual([['scene', w.b1, w.sc[1][0]]])
    expect(point('thread', { origin: 'text', originSceneId: w.sc[1][0] })).toEqual([['scene', w.b1, w.sc[1][0]]])
    // Places found in the text exist from that story's start, even in the first story.
    expect(point('place', { origin: 'text', originStoryId: w.b1, originSceneId: w.sc[1][0] })).toEqual([['story-pre', w.b1, null]])
    expect(point('lore', { origin: 'text', originSceneId: w.b2sc })).toEqual([['story-pre', w.b2, null]])
    expect(point('character', { origin: 'ai', originStoryId: w.b2, originStart: true })).toEqual([['story-post', w.b2, null]])
  })

  it('works defaults out again when a story becomes its own version of events, keeping points Adam set', () => {
    const w = small()
    const inBook1 = repo.createEntry(w.db, 'character', { name: 'Made in Book 1', originStoryId: w.b1 }).id
    const mine = repo.createEntry(w.db, 'character', { name: 'Set by hand', originStoryId: w.b1 }).id
    mem.setDefaultExistsPoints(w.db, mine, [])
    mem.addExistsPoint(w.db, { entryId: mine, kind: 'scene', storyId: w.b1, sceneId: w.sc[0][1], byHand: true })
    expect(mem.firstStoryId(w.db)).toBe(w.b1)

    const changed = mem.setStoryPlacement(w.db, w.b1, {
      kind: 'own',
      startStoryId: null,
      startAt: 'end',
      startRefId: null,
      endAt: null,
      endRefId: null,
      leadsIntoId: null
    })
    expect(mem.firstStoryId(w.db)).toBeNull()
    expect(changed).toEqual([inBook1])
    expect(mem.listExistsPoints(w.db, inBook1).map((p) => [p.kind, p.storyId])).toEqual([['story-pre', w.b1]])
    expect(mem.listExistsPoints(w.db, mine).map((p) => [p.kind, p.byHand])).toEqual([['scene', true]])
  })

  it('keeps the points the memory keeper added when it works defaults out again, and changes the default in place', () => {
    const w = small()
    const found = repo.createEntry(
      w.db,
      'character',
      { name: 'Kell' },
      { origin: 'text', originStoryId: w.b1, originSceneId: w.sc[0][1] }
    ).id
    const made = repo.createEntry(w.db, 'character', { name: 'Wren', originStoryId: w.b1 }).id
    // "First seen elsewhere": the keeper linked a later mention in Book 2 to each of them.
    for (const id of [found, made]) mem.addExistsPoint(w.db, { entryId: id, kind: 'scene', storyId: w.b2, sceneId: w.b2sc, byHand: false })
    const before = mem.listExistsPoints(w.db, made)

    const changed = mem.setStoryPlacement(w.db, w.b1, {
      kind: 'own',
      startStoryId: null,
      startAt: 'end',
      startRefId: null,
      endAt: null,
      endRefId: null,
      leadsIntoId: null
    })
    expect(changed).toEqual([made])
    const points = (id: ID) => mem.listExistsPoints(w.db, id).map((p) => [p.kind, p.storyId, p.sceneId])
    expect(points(found)).toEqual([
      ['scene', w.b1, w.sc[0][1]],
      ['scene', w.b2, w.b2sc]
    ])
    expect(points(made)).toEqual([
      ['story-pre', w.b1, null],
      ['scene', w.b2, w.b2sc]
    ])
    // The same rows: the keeper's own undo still finds its point by id.
    expect(mem.listExistsPoints(w.db, made).map((p) => p.id)).toEqual(before.map((p) => p.id))
  })
})

describe('story placement', () => {
  it('saves where a story starts and ends, with sensible defaults', () => {
    const w = small()
    const side = repo.createStory(w.db, { title: 'Side' }).id
    mem.setStoryPlacement(w.db, side, {
      kind: 'side',
      startStoryId: w.b1,
      startAt: 'chapter',
      startRefId: w.ch[0],
      endAt: null,
      endRefId: w.ch[1],
      leadsIntoId: null
    })
    expect(repo.getStory(w.db, side)).toMatchObject({
      kind: 'side',
      startStoryId: w.b1,
      startAt: 'chapter',
      startRefId: w.ch[0],
      endAt: 'end',
      endRefId: null
    })
    const pre = repo.createStory(w.db, { title: 'Prequel' }).id
    mem.setStoryPlacement(w.db, pre, {
      kind: 'prequel',
      startStoryId: w.b1,
      startAt: 'pre',
      startRefId: 'x',
      endAt: null,
      endRefId: null,
      leadsIntoId: null
    })
    expect(repo.getStory(w.db, pre)).toMatchObject({ kind: 'prequel', startAt: 'pre', startRefId: null, leadsIntoId: w.b1 })
    expect(() =>
      mem.setStoryPlacement(w.db, w.b1, {
        kind: 'continues',
        startStoryId: w.b2,
        startAt: 'end',
        startRefId: null,
        endAt: null,
        endRefId: null,
        leadsIntoId: null
      })
    ).toThrow("Book 1 can't continue after Book 2, because Book 2 continues after Book 1.")
  })

  it('moves a start or end after a deleted chapter or scene to the one before it', () => {
    const w = small()
    const own = repo.createStory(w.db, { title: 'Own' }).id
    const place = (startAt: 'chapter' | 'scene', ref: ID) =>
      mem.setStoryPlacement(w.db, own, {
        kind: 'own',
        startStoryId: w.b1,
        startAt,
        startRefId: ref,
        endAt: null,
        endRefId: null,
        leadsIntoId: null
      })
    const knows = () => knowsSentence(mem.loadShape(w.db), buildLine(mem.loadShape(w.db), { storyId: own, through: 'start' }))

    place('scene', w.sc[1][1])
    repo.deleteScene(w.db, w.sc[1][1])
    expect(knows()).toBe('This story knows what happened in: Book 1 up to Ch 2, Sc 1.')
    repo.deleteScene(w.db, w.sc[1][0])
    expect(knows()).toBe('This story knows what happened in: Book 1 up to the end of Ch 1.')
    repo.restoreDeleted(w.db, 'scene', w.sc[1][0])
    repo.restoreDeleted(w.db, 'scene', w.sc[1][1])

    place('chapter', w.ch[1])
    repo.deleteChapter(w.db, w.ch[1])
    expect(knows()).toBe('This story knows what happened in: Book 1 up to the end of Ch 1.')
    repo.deleteChapter(w.db, w.ch[0])
    expect(knows()).toBe('This story knows what happened in: the start of Book 1.')
    repo.restoreDeleted(w.db, 'chapter', w.ch[0])
    repo.restoreDeleted(w.db, 'chapter', w.ch[1])

    const side = repo.createStory(w.db, { title: 'Side' }).id
    mem.setStoryPlacement(w.db, side, {
      kind: 'side',
      startStoryId: w.b1,
      startAt: 'post',
      startRefId: null,
      endAt: 'chapter',
      endRefId: w.ch[2],
      leadsIntoId: null
    })
    repo.deleteChapter(w.db, w.ch[2])
    expect(mem.loadShape(w.db).stories.find((s) => s.id === side)).toMatchObject({ endAt: 'chapter', endRefId: w.ch[1] })
  })

  it('a story whose start story was deleted takes over its start point', () => {
    const w = small()
    const b3 = repo.createStory(w.db, { title: 'Book 3' }).id
    const side = repo.createStory(w.db, { title: 'Side' }).id
    mem.setStoryPlacement(w.db, side, {
      kind: 'side',
      startStoryId: w.b2,
      startAt: 'post',
      startRefId: null,
      endAt: 'end',
      endRefId: null,
      leadsIntoId: null
    })
    expect(repo.getStory(w.db, b3).startStoryId).toBe(w.b2)
    repo.deleteStory(w.db, w.b2)
    const shape = mem.loadShape(w.db)
    expect(shape.stories.find((s) => s.id === b3)).toMatchObject({ startStoryId: w.b1, startAt: 'end' })
    expect(shape.stories.find((s) => s.id === side)).toMatchObject({ startStoryId: w.b1, startAt: 'end', endAt: 'end' })
    expect(knowsSentence(shape, buildLine(shape, { storyId: b3, through: 'start' }))).toBe(
      'This story knows what happened in: Book 1; Side.'
    )
  })
})

describe('summaries, pins and block modes', () => {
  it("keeps Adam's summaries and knows what they are for", () => {
    const w = small()
    expect(mem.summaryTargetExists(w.db, 'scene', w.sc[0][0])).toBe(true)
    expect(mem.summaryTargetExists(w.db, 'chapter', w.ch[0])).toBe(true)
    expect(mem.summaryTargetExists(w.db, 'story', w.b1)).toBe(true)
    expect(mem.summaryTargetExists(w.db, 'series', repo.listSeries(w.db)[0].id)).toBe(true)
    repo.deleteScene(w.db, w.sc[0][0])
    expect(mem.summaryTargetExists(w.db, 'scene', w.sc[0][0])).toBe(false)
    const s = mem.putSummary(w.db, { level: 'story', targetId: w.b1, text: 'In short.', origin: 'adam' })
    expect(s).toMatchObject({ origin: 'adam', stale: false, text: 'In short.' })
    expect(mem.storySummaries(w.db, w.b1).map((x) => x.text)).toEqual(['In short.'])
  })

  it('pins and block modes refuse what they do not know', () => {
    const w = small()
    mem.setPin(w.db, w.mara, 'story', w.b1, 'pin')
    expect(mem.pinsForScene(w.db, w.sc[0][0]).map((p) => p.action)).toEqual(['pin'])
    expect(mem.pinsForScene(w.db, w.b2sc)).toEqual([])
    expect(() => mem.setPin(w.db, w.mara, 'everywhere' as 'world', null, 'pin')).toThrow(UserError)
    expect(() => mem.setPin(w.db, w.mara, 'world', null, 'love' as 'pin')).toThrow(UserError)
    expect(() => mem.setPin(w.db, 'gone', 'world', null, 'pin')).toThrow('That entry no longer exists.')
    mem.setPin(w.db, w.mara, 'story', w.b1, null)
    expect(mem.pinsForScene(w.db, w.sc[0][0])).toEqual([])
    mem.setBlockMode(w.db, w.sc[0][0], 'previous', 'short')
    expect(mem.getBlockModes(w.db, w.sc[0][0])).toEqual({ previous: 'short' })
    mem.setBlockMode(w.db, w.sc[0][0], 'previous', 'auto')
    expect(mem.getBlockModes(w.db, w.sc[0][0])).toEqual({})
    expect(() => mem.setBlockMode(w.db, w.sc[0][0], 'previous', 'tiny' as 'short')).toThrow(UserError)
  })
})

describe('a scene with nothing around it', () => {
  it('reads the first scene of a new world', () => {
    const db = memoryWorld()
    const scene = repo.getOutline(db, repo.listStories(db)[0].id).scenes[0].id
    const m = sceneMemory(db, scene)
    expect(m).toMatchObject({ knows: 'This story knows only the starting setup.', previous: null, entries: [], bringAbout: [] })
    expect(m.storySoFar).toEqual({ scenes: [], chapters: [], stories: [], series: [], leadsInto: null })
    repo.deleteScene(db, scene)
    expect(() => sceneMemory(db, scene)).toThrow('That scene no longer exists.')
  })
})
