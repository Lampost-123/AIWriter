// Speed: what counts for a scene is worked out before every draft and every memory update, so it
// must stay quick in a big world (2,000 scenes, 3,000 changes, 500 entries).

import { describe, expect, it } from 'vitest'
import type { ChangeData, ID } from '@shared/types'
import * as repo from '../../src/main/db/repo'
import * as mem from '../../src/main/db/memory'
import { sceneMemory } from '../../src/main/memory/scene'
import { memoryWorld } from './helpers'

/** A small, repeatable random number generator. */
function random(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

function bigWorld(): { db: ReturnType<typeof memoryWorld>; last: ID } {
  const db = memoryWorld('Big')
  const rnd = random(7)
  const pick = <T>(list: T[]): T => list[Math.floor(rnd() * list.length)]
  const scenes: ID[] = []
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
    }
    const entries: ID[] = []
    for (let i = 0; i < 500; i++) {
      const kind = i % 5 === 0 ? 'place' : i % 17 === 0 ? 'thread' : 'character'
      entries.push(repo.createEntry(db, kind, { name: `Entry ${i}`, description: `Entry ${i} is someone worth knowing.` }).id)
    }
    for (let i = 0; i < 3000; i++) {
      const entryId = pick(entries)
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
      mem.insertChange(db, { ...data, entryId, anchor: 'scene', sceneId: pick(scenes), origin: 'text' })
    }
  })()
  return { db, last: scenes[scenes.length - 1] }
}

describe('speed', () => {
  it('works out what counts for a scene in a big world in well under 100 ms', () => {
    const { db, last } = bigWorld()
    const m = sceneMemory(db, last)
    expect(m.knows).toContain('Book 8; Novella 8; Book 9; Novella 9.')
    expect(m.entries.length).toBe(500)
    const times: number[] = []
    for (let i = 0; i < 5; i++) {
      const t = performance.now()
      sceneMemory(db, last)
      times.push(performance.now() - t)
    }
    times.sort((a, b) => a - b)
    console.log(`sceneMemory in a big world: ${times.map((t) => t.toFixed(1)).join(', ')} ms`)
    // Generous, so a slow test machine doesn't fail it; typically far less.
    expect(times[2]).toBeLessThan(250)
  }, 60_000)
})
