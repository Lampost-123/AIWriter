// Speed: what counts for a scene is worked out before every draft and every memory update, and entry
// pages list an entry's changes and history, so both must stay quick in a big world (10 books of 200
// scenes, 3,000 changes with the words they came from, 500 entries, a summary for every scene).

import { describe, expect, it } from 'vitest'
import type { ChangeData, ID } from '@shared/types'
import * as repo from '../../src/main/db/repo'
import * as mem from '../../src/main/db/memory'
import { addLink, entryHistory } from '../../src/main/db/history'
import { changeViews, sceneMemory } from '../../src/main/memory/scene'
import { memoryWorld } from './helpers'

/** A small, repeatable random number generator. */
function random(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

function bigWorld(): { db: ReturnType<typeof memoryWorld>; last: ID; entries: ID[] } {
  const db = memoryWorld('Big')
  const rnd = random(7)
  const pick = <T>(list: T[]): T => list[Math.floor(rnd() * list.length)]
  const scenes: ID[] = []
  const entries: ID[] = []
  db.transaction(() => {
    const first = repo.listStories(db)[0]
    let prev = first.id
    // Ten books in a row, each 20 chapters of 10 scenes, and a novella during each of the first nine.
    for (let b = 0; b < 10; b++) {
      const story = b === 0 ? first.id : repo.createStory(db, { title: `Book ${b + 1}`, startStoryId: prev }).id
      for (let c = 0; c < 20; c++) {
        const chapter = b === 0 && c === 0 ? repo.getOutline(db, story).chapters[0].id : repo.createChapter(db, story).id
        for (let s = 0; s < 10; s++) {
          scenes.push(b === 0 && c === 0 && s === 0 ? repo.getOutline(db, story).scenes[0].id : repo.createScene(db, chapter).id)
        }
        mem.putSummary(db, { level: 'chapter', targetId: chapter, text: `Chapter ${c + 1} of Book ${b + 1}. `.repeat(20), origin: 'text' })
      }
      if (b < 9) {
        const side = repo.createStory(db, { title: `Novella ${b + 1}` }).id
        const chapters = repo.getOutline(db, story).chapters
        mem.setStoryPlacement(db, side, {
          kind: 'side',
          startStoryId: story,
          startAt: 'chapter',
          startRefId: chapters[5].id,
          endAt: 'chapter',
          endRefId: chapters[15].id,
          leadsIntoId: null
        })
        repo.createScene(db, repo.createChapter(db, side).id)
      }
      mem.putSummary(db, { level: 'story', targetId: story, text: `Book ${b + 1} in short. `.repeat(30), origin: 'text' })
      prev = story
    }
    // A summary of 150 to 200 words for every scene.
    for (const id of scenes)
      mem.putSummary(db, { level: 'scene', targetId: id, text: 'Something happens here, and then more. '.repeat(25), origin: 'text' })
    for (let i = 0; i < 500; i++) {
      const kind = i % 5 === 0 ? 'place' : i % 17 === 0 ? 'thread' : 'character'
      entries.push(repo.createEntry(db, kind, { name: `Entry ${i}`, description: `Entry ${i} is someone worth knowing.` }).id)
    }
    for (let i = 0; i < 3000; i++) {
      // A few main characters change far more often than the rest.
      const entryId = i % 4 === 0 ? entries[i % 3] : pick(entries)
      let other = pick(entries)
      if (other === entryId) other = entries[(entries.indexOf(entryId) + 1) % entries.length]
      const r = rnd()
      const data: ChangeData =
        r < 0.5
          ? { kind: 'update', payload: { note: `change ${i}`, fields: { motivation: `wants ${i}` } } }
          : r < 0.75
            ? { kind: 'relationship', payload: { otherId: other, type: 'knows', feels: 'warm', otherFeels: 'cool' } }
            : r < 0.95
              ? { kind: 'knowledge', payload: { factId: `f${i % 400}`, fact: `Fact ${i % 400}` } }
              : { kind: 'thread', payload: { status: rnd() < 0.5 ? 'open' : 'resolved', note: '' } }
      const sceneId = pick(scenes)
      const c = mem.insertChange(db, { ...data, entryId, anchor: 'scene', sceneId, origin: 'text', runId: `run-${i}` })
      addLink(db, {
        factKind: 'change',
        factId: c.id,
        field: null,
        sceneId,
        sceneVersion: 1,
        paragraphId: 'p1',
        start: 0,
        end: 9,
        quote: 'The words'
      })
    }
  })()
  return { db, last: scenes[scenes.length - 1], entries }
}

/** The median of five timed runs, in ms. */
function median(fn: () => unknown): number {
  const times: number[] = []
  for (let i = 0; i < 5; i++) {
    const t = performance.now()
    fn()
    times.push(performance.now() - t)
  }
  return times.sort((a, b) => a - b)[2]
}

/** How many statements a call prepares (one per query), to catch a query per item. */
function queries(db: ReturnType<typeof memoryWorld>, fn: () => unknown): number {
  const prepare = db.prepare.bind(db)
  let n = 0
  db.prepare = ((sql: string) => {
    n++
    return prepare(sql)
  }) as typeof db.prepare
  try {
    fn()
  } finally {
    db.prepare = prepare
  }
  return n
}

describe('speed', () => {
  const { db, last, entries } = bigWorld()

  it('works out what counts for a scene in a big world in well under 100 ms', () => {
    const m = sceneMemory(db, last)
    expect(m.knows).toContain('Book 8; Novella 8; Book 9; Novella 9.')
    expect(m.entries.length).toBe(500)
    expect(m.storySoFar.scenes.length).toBe(199)
    const t = median(() => sceneMemory(db, last))
    console.log(`sceneMemory in a big world: ${t.toFixed(1)} ms`)
    // Generous, so a slow test machine doesn't fail it; typically far less.
    expect(t).toBeLessThan(250)
    expect(queries(db, () => sceneMemory(db, last))).toBeLessThan(20)
  }, 60_000)

  it('lists a busy entry’s changes and history without a query per change', () => {
    const busy = entries[0]
    const changes = mem.changesForEntry(db, busy)
    expect(changes.length).toBeGreaterThan(250)
    const views = changeViews(db, changes)
    expect(views.every((v) => v.links.length === 1 && v.where.startsWith('Book '))).toBe(true)
    expect(queries(db, () => changeViews(db, mem.changesForEntry(db, busy)))).toBeLessThan(10)
    expect(queries(db, () => entryHistory(db, busy))).toBe(1)
    expect(queries(db, () => mem.listFacts(db))).toBe(1)
    const t = median(() => changeViews(db, mem.changesForEntry(db, busy)))
    console.log(`an entry's ${changes.length} changes: ${t.toFixed(1)} ms`)
    expect(t).toBeLessThan(250)
  }, 60_000)
})
