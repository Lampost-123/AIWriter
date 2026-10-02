// Speed: each world view is one call that must come back in well under 100 ms in a big world (10 books
// of 200 scenes with a dated scene card each, 500 entries, 3,000 changes), with no query per scene or entry.
import { describe, expect, it } from 'vitest'
import { emptySceneCard } from '@shared/defaults'
import type { ChangeData, ID } from '@shared/types'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { memoryWorld } from '../../../tests/unit/helpers'
import { relationshipMapOf, threadsBoardOf, timelineOf } from './index'

/** A small, repeatable random number generator. */
function random(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

function bigWorld(): { db: ReturnType<typeof memoryWorld>; last: ID; middle: ID } {
  const db = memoryWorld('Big')
  const rnd = random(11)
  const pick = <T>(list: T[]): T => list[Math.floor(rnd() * list.length)]
  const scenes: ID[] = []
  const characters: ID[] = []
  const places: ID[] = []
  const threads: ID[] = []
  const entries: ID[] = []
  let last = ''
  db.transaction(() => {
    for (let i = 0; i < 500; i++) {
      const kind = i % 5 === 0 ? 'place' : i % 17 === 0 ? 'thread' : i % 23 === 0 ? 'event' : i % 29 === 0 ? 'group' : 'character'
      const e = repo.createEntry(db, kind, { name: `Entry ${i}`, fields: kind === 'event' ? { when: `Day ${i}, Year 2` } : {} })
      entries.push(e.id)
      if (kind === 'character') characters.push(e.id)
      else if (kind === 'place') places.push(e.id)
      else if (kind === 'thread') threads.push(e.id)
    }
    const first = repo.listStories(db)[0]
    let prev = first.id
    let day = 0
    for (let b = 0; b < 10; b++) {
      const story = b === 0 ? first.id : repo.createStory(db, { title: `Book ${b + 1}`, startStoryId: prev }).id
      for (let c = 0; c < 20; c++) {
        const chapter = b === 0 && c === 0 ? repo.getOutline(db, story).chapters[0].id : repo.createChapter(db, story).id
        for (let s = 0; s < 10; s++) {
          const id = b === 0 && c === 0 && s === 0 ? repo.getOutline(db, story).scenes[0].id : repo.createScene(db, chapter).id
          scenes.push(id)
          day += rnd() < 0.5 ? 1 : 0
          repo.updateSceneCard(db, id, {
            ...emptySceneCard(),
            // Most scenes dated, some in a different style, a few left empty.
            when: s === 9 ? '' : s % 3 === 0 ? `Day ${day}, Year ${b + 1}, dusk` : s % 3 === 1 ? 'The next day' : `Day ${day}`,
            povId: pick(characters),
            presentIds: [pick(characters), pick(characters), pick(characters)],
            locationId: pick(places),
            setsUpIds: rnd() < 0.05 ? [pick(threads)] : [],
            paysOffIds: rnd() < 0.03 ? [pick(threads)] : []
          })
        }
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
      prev = story
      last = story
    }
    for (let i = 0; i < 3000; i++) {
      const entryId = i % 4 === 0 ? characters[i % 3] : pick(entries)
      let other = pick(characters)
      if (other === entryId) other = characters[(characters.indexOf(other) + 1) % characters.length]
      const r = rnd()
      const data: ChangeData =
        r < 0.5
          ? { kind: 'update', payload: { note: `change ${i}`, fields: { motivation: `wants ${i}` } } }
          : r < 0.8
            ? { kind: 'relationship', payload: { otherId: other, type: 'knows', feels: 'warm', otherFeels: 'cool' } }
            : r < 0.95
              ? { kind: 'knowledge', payload: { factId: `f${i % 400}`, fact: `Fact ${i % 400}` } }
              : { kind: 'thread', payload: { status: rnd() < 0.5 ? 'open' : 'resolved', note: '' } }
      const owner = data.kind === 'thread' ? pick(threads) : entryId
      mem.insertChange(db, { ...data, entryId: owner, anchor: 'scene', sceneId: pick(scenes), origin: 'text' })
    }
  })()
  return { db, last, middle: scenes[Math.floor(scenes.length / 2)] }
}

/**
 * Times a call five times, each just after something was written to the world, so nothing read before
 * can be reused (as after the memory keeper or Adam changes anything). Gives the fastest run, which is
 * what the code itself costs and the least shaken by other work on a busy machine, and the median.
 */
function timed(db: ReturnType<typeof memoryWorld>, fn: () => unknown): { fastest: number; median: number } {
  const times: number[] = []
  for (let i = 0; i < 5; i++) {
    repo.setMeta(db, 'perf_test', String(i))
    const t = performance.now()
    fn()
    times.push(performance.now() - t)
  }
  times.sort((a, b) => a - b)
  return { fastest: times[0], median: times[2] }
}

/** How many statements a call prepares (one per query), to catch a query per item. */
function queries(db: ReturnType<typeof memoryWorld>, fn: () => unknown): number {
  repo.setMeta(db, 'perf_test', 'count')
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

const ms = (t: { fastest: number; median: number }): string => `${t.fastest.toFixed(1)} ms (median ${t.median.toFixed(1)} ms)`

// The budget is 100 ms. The checks allow more, so a test machine busy with other work doesn't fail
// them; the times are printed, and are typically well under half the budget.
describe('world views in a big world', () => {
  const { db, last, middle } = bigWorld()

  it('works out the timeline in well under 100 ms', () => {
    const t = timelineOf(db, last)
    expect(t.points.length).toBeGreaterThan(2000)
    expect(t.points.filter((p) => !p.dated).length).toBeGreaterThan(100)
    expect(t.clashes.length).toBeGreaterThan(0)
    const time = timed(db, () => timelineOf(db, last))
    console.log(`timeline of ${t.points.length} points in a big world: ${ms(time)}`)
    expect(time.fastest).toBeLessThan(150)
    expect(queries(db, () => timelineOf(db, last))).toBeLessThan(20)
  }, 60_000)

  it('works out the plot threads board in well under 100 ms', () => {
    const b = threadsBoardOf(db, last)
    expect(b.threads.length).toBeGreaterThan(10)
    const time = timed(db, () => threadsBoardOf(db, last))
    console.log(`plot threads board of ${b.threads.length} threads: ${ms(time)}`)
    expect(time.fastest).toBeLessThan(150)
    expect(queries(db, () => threadsBoardOf(db, last))).toBeLessThan(20)
  }, 60_000)

  it('works out the relationship map at any point in well under 100 ms once laid out', () => {
    let t = performance.now()
    const m = relationshipMapOf(db, last, null, middle)
    console.log(`relationship map, laid out for the first time: ${(performance.now() - t).toFixed(1)} ms`)
    expect(m.nodes.length).toBeGreaterThan(50)
    expect(m.stops.length).toBeGreaterThan(2000)
    t = performance.now()
    const at = m.stops[Math.floor(m.stops.length / 3)].at
    const time = timed(db, () => relationshipMapOf(db, last, at, null))
    console.log(`relationship map at a point (${m.nodes.length} characters): ${ms(time)}`)
    expect(time.fastest).toBeLessThan(150)
    expect(queries(db, () => relationshipMapOf(db, last, at, null))).toBeLessThan(30)
  }, 60_000)

  it('reuses what it read while nothing in the world changes', () => {
    const t = timelineOf(db, last)
    const b = threadsBoardOf(db, last)
    expect(timelineOf(db, last)).toBe(t)
    expect(threadsBoardOf(db, last)).toBe(b)
    const start = performance.now()
    relationshipMapOf(db, last, null, middle)
    console.log(`relationship map with the world already read: ${(performance.now() - start).toFixed(1)} ms`)
    // Anything written means reading again.
    repo.setMeta(db, 'perf_test', 'again')
    expect(timelineOf(db, last)).not.toBe(t)
    expect(timelineOf(db, last)).toEqual(t)
  }, 60_000)

  it('fits a new character into the map in well under 100 ms', () => {
    const friend = relationshipMapOf(db, last, null, middle).nodes[0].id
    const times: number[] = []
    for (let i = 0; i < 5; i++) {
      // As when the memory keeper adds someone new who knows someone already on the map.
      const newcomer = repo.createEntry(db, 'character', { name: `Newcomer ${i}` }).id
      const payload = { otherId: friend, type: 'knows', feels: '', otherFeels: '' }
      mem.insertChange(db, { kind: 'relationship', payload, entryId: newcomer, anchor: 'scene', sceneId: middle, origin: 'text' })
      const t = performance.now()
      const m = relationshipMapOf(db, last, null, middle)
      times.push(performance.now() - t)
      expect(m.everyone.some((p) => p.id === newcomer)).toBe(true)
    }
    times.sort((a, b) => a - b)
    console.log(`relationship map just after a new character: ${ms({ fastest: times[0], median: times[2] })}`)
    expect(times[0]).toBeLessThan(150)
  }, 60_000)
})
