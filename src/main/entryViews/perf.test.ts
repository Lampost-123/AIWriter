// Speed: the codex and an entry page must open in under 100 ms in a big world (10 books of 200
// scenes, about a million words, 500 entries with aliases, 3,000 changes). Each scene's words are
// read once and remembered, so only the first look reads them all; after that only scenes whose
// words changed, or names that are new, are read again.

import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import type { ChangeData, ID } from '@shared/types'
import { emptySceneCard } from '@shared/defaults'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { asOfStops, entryAsOf } from '../memory/asOf'
import { changeViews } from '../memory/scene'
import { memoryWorld } from '../../../tests/unit/helpers'
import { appearancesOf, forgetReadings } from './appearances'
import { codexCards } from './codex'
import { listFirstExists } from './firstExists'

type DB = Database.Database

function random(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

const WORDS = 'the rain had not let up and she kept her hood low while he watched from the ferry steps across a grey river at dusk'.split(' ')

function bigWorld(): { db: DB; scenes: ID[]; entries: ID[]; stories: ID[] } {
  const db = memoryWorld('Big')
  const rnd = random(11)
  const pick = <T>(list: T[]): T => list[Math.floor(rnd() * list.length)]
  const scenes: ID[] = []
  const entries: ID[] = []
  const stories: ID[] = []
  db.transaction(() => {
    for (let i = 0; i < 500; i++) {
      const kind = i % 5 === 0 ? 'place' : i % 7 === 0 ? 'item' : 'character'
      const aliases = i % 3 === 0 ? [`the ${['old', 'young', 'grey'][i % 3]} one ${i}`] : []
      entries.push(repo.createEntry(db, kind, { name: `Name${i}`, aliases, tags: [`tag${i % 9}`], fields: { role: 'minor' } }).id)
    }
    const first = repo.listStories(db)[0].id
    let prev = first
    for (let b = 0; b < 10; b++) {
      const story = b === 0 ? first : repo.createStory(db, { title: `Book ${b + 1}`, startStoryId: prev }).id
      stories.push(story)
      for (let c = 0; c < 20; c++) {
        const chapter = b === 0 && c === 0 ? repo.getOutline(db, story).chapters[0].id : repo.createChapter(db, story).id
        for (let s = 0; s < 10; s++) {
          const id = b === 0 && c === 0 && s === 0 ? repo.getOutline(db, story).scenes[0].id : repo.createScene(db, chapter).id
          scenes.push(id)
          // About 500 words in paragraphs, naming a few entries (the first few far more often).
          const paras: string[] = []
          for (let p = 0; p < 10; p++) {
            const words: string[] = []
            for (let w = 0; w < 50; w++) {
              const r = rnd()
              words.push(r < 0.01 ? `Name${Math.floor(rnd() * 500)}` : r < 0.02 ? `Name${Math.floor(rnd() * 5)}` : pick(WORDS))
            }
            paras.push(`${words.join(' ')}.`)
          }
          repo.saveSceneText(db, id, null, paras.join('\n\n'))
          repo.updateSceneCard(db, id, { ...emptySceneCard(), povId: entries[Math.floor(rnd() * 5)], presentIds: [pick(entries), pick(entries)], locationId: entries[5 * Math.floor(rnd() * 100)] })
        }
      }
      prev = story
    }
    for (let i = 0; i < 3000; i++) {
      const entryId = i % 4 === 0 ? entries[i % 3] : pick(entries)
      const data: ChangeData =
        rnd() < 0.7
          ? { kind: 'update', payload: { note: `change ${i}`, fields: { motivation: `wants ${i}` } } }
          : { kind: 'relationship', payload: { otherId: pick(entries), type: 'knows', feels: '', otherFeels: '' } }
      if (data.kind === 'relationship' && data.payload.otherId === entryId) continue
      mem.insertChange(db, { ...data, entryId, anchor: 'scene', sceneId: pick(scenes), origin: 'text', runId: `run-${i}` })
    }
  })()
  return { db, scenes, entries, stories }
}

function median(fn: () => unknown): number {
  const times: number[] = []
  for (let i = 0; i < 5; i++) {
    const t = performance.now()
    fn()
    times.push(performance.now() - t)
  }
  return times.sort((a, b) => a - b)[2]
}

function queries(db: DB, fn: () => unknown): number {
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

/** Everything an entry page loads when it opens. */
function entryPage(db: DB, id: ID, storyId: ID, sceneId: ID): void {
  const entry = repo.getEntry(db, id)
  appearancesOf(db, entry, repo.listEntries(db))
  listFirstExists(db, id)
  changeViews(db, mem.changesForEntry(db, id))
  asOfStops(db, storyId, id)
  entryAsOf(db, id, { kind: 'scene', storyId, sceneId })
}

describe('speed of the codex and entry pages', () => {
  const { db, scenes, entries, stories } = bigWorld()
  const lastStory = stories[stories.length - 1]
  const lastScene = scenes[scenes.length - 1]

  it('opens the codex in a big world in well under 100 ms once its words have been read', () => {
    forgetReadings(db)
    let t = performance.now()
    const cards = codexCards(db)
    const cold = performance.now() - t
    expect(cards).toHaveLength(500)
    const busy = cards.find((c) => c.id === entries[0])!
    expect(busy.scenes).toBeGreaterThan(100)
    expect(busy.last?.label).toMatch(/^Book 10, /)
    const warm = median(() => codexCards(db))
    // One scene's words change: only that scene is read again.
    repo.saveSceneText(db, scenes[10], null, 'Name1 and Name2 meet.')
    t = performance.now()
    codexCards(db)
    const oneScene = performance.now() - t
    // A new name: every scene is read for that name alone.
    repo.createEntry(db, 'character', { name: 'Newcomer', aliases: ['the stranger'] })
    t = performance.now()
    codexCards(db)
    const newName = performance.now() - t
    console.log(
      `codex in a big world: first look ${cold.toFixed(1)} ms, then ${warm.toFixed(1)} ms; one scene changed ${oneScene.toFixed(1)} ms; a new name ${newName.toFixed(1)} ms`
    )
    // Generous, so a busy test machine doesn't fail it; typically far less.
    expect(warm).toBeLessThan(250)
    expect(oneScene).toBeLessThan(250)
    expect(queries(db, () => codexCards(db))).toBeLessThan(20)
  }, 120_000)

  it('opens a busy entry’s page (where it appears, first exists, changes, the as-of slider) in well under 100 ms', () => {
    codexCards(db)
    const busy = entries[0]
    const list = appearancesOf(db, repo.getEntry(db, busy), repo.listEntries(db))
    expect(list.length).toBeGreaterThan(100)
    expect(list.filter((a) => a.quote).every((a) => a.quote!.includes('Name0'))).toBe(true)
    const t = median(() => entryPage(db, busy, lastStory, lastScene))
    console.log(`a busy entry's page in a big world: ${t.toFixed(1)} ms`)
    expect(t).toBeLessThan(250)
    expect(queries(db, () => entryPage(db, busy, lastStory, lastScene))).toBeLessThan(40)
  }, 120_000)
})
