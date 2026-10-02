// Speed (spec: "Search finds anything in under 100 ms"): a search runs on every keystroke in the
// palette, so it must stay quick in a big world: 10 books of 200 scenes (300,000 words of prose, with
// the editor's document beside each scene's text), 500 entries, a summary for every scene and chapter.

import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'
import * as repo from '../../src/main/db/repo'
import * as mem from '../../src/main/db/memory'
import { searchIndex } from '../../src/main/search'
import { memoryWorld } from './helpers'

/** A small, repeatable random number generator. */
function random(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

const COMMON = `the a and of to in was he she it that his her with as had for on at by but not they from
were said would could into over back down there their then out up one all so them when what little like
him been very before after through again still never only even old long night door hand eyes face light
dark time looked turned felt knew thought came went made stood walked away against under above toward`.split(/\s+/)
const RARE = `lantern harbour ferry gate iron smugglers tide salt rope storm whisper ember ash crow bell
orchard quarry ledger cellar candle copper thistle marsh bridge lighthouse cutlass sextant tannery`.split(/\s+/)
const NAMES = ['Mara', 'Tobin', 'Élodie', 'Kell', 'Ansel', 'Brannoc', 'Ysolde', 'Wren']

function bigWorld(): { db: Database.Database; scenes: ID[]; words: number } {
  const db = memoryWorld('Big')
  const rnd = random(11)
  const pick = <T>(list: T[]): T => list[Math.floor(rnd() * list.length)]
  const sentence = (): string => {
    const n = 8 + Math.floor(rnd() * 12)
    const ws: string[] = []
    for (let i = 0; i < n; i++) ws.push(rnd() < 0.06 ? pick(NAMES) : rnd() < 0.05 ? pick(RARE) : pick(COMMON))
    const s = ws.join(' ')
    return `${s[0].toUpperCase()}${s.slice(1)}.`
  }
  const scenes: ID[] = []
  let words = 0
  db.transaction(() => {
    const first = repo.listStories(db)[0]
    let prev = first.id
    for (let b = 0; b < 10; b++) {
      const story = b === 0 ? first.id : repo.createStory(db, { title: `Book ${b + 1}`, startStoryId: prev }).id
      for (let c = 0; c < 20; c++) {
        const chapter = b === 0 && c === 0 ? repo.getOutline(db, story).chapters[0].id : repo.createChapter(db, story, { title: `Chapter ${c + 1}` }).id
        for (let s = 0; s < 10; s++) {
          const id = b === 0 && c === 0 && s === 0 ? repo.getOutline(db, story).scenes[0].id : repo.createScene(db, chapter).id
          // About 150 words in three paragraphs, and the editor's document of them.
          const paragraphs = [0, 1, 2].map(() => [sentence(), sentence(), sentence(), sentence()].join(' '))
          const text = paragraphs.join('\n\n')
          words += text.split(/\s+/).length
          const doc = { type: 'doc', content: paragraphs.map((p, i) => ({ type: 'paragraph', attrs: { id: `p${i}` }, content: [{ type: 'text', text: p }] })) }
          repo.saveSceneText(db, id, doc, text)
          mem.putSummary(db, { level: 'scene', targetId: id, text: `${sentence()} ${sentence()} ${sentence()}`, origin: 'text' })
          scenes.push(id)
        }
        mem.putSummary(db, { level: 'chapter', targetId: chapter, text: `${sentence()} ${sentence()}`.repeat(3), origin: 'text' })
      }
      prev = story
    }
    for (let i = 0; i < 500; i++) {
      const kind = i % 5 === 0 ? 'place' : i % 7 === 0 ? 'lore' : 'character'
      repo.createEntry(db, kind, {
        name: `${pick(NAMES)} ${pick(RARE)} ${i}`,
        aliases: [`${pick(RARE)} ${i}`],
        summary: sentence(),
        description: `${sentence()} ${sentence()} ${sentence()}`,
        fields: { traits: sentence(), fears: sentence() },
        notes: i % 3 === 0 ? sentence() : ''
      })
    }
  })()
  return { db, scenes, words }
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

/** How many statements a call prepares (one per query), to catch a query per row. */
function queries(db: Database.Database, fn: () => unknown): number {
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

describe('search speed', () => {
  const { db, scenes, words } = bigWorld()

  it('gets a 300,000-word world ready once, reading it with a handful of statements', () => {
    expect(words).toBeGreaterThan(290_000)
    const ix = searchIndex(db)
    const t = performance.now()
    const n = queries(db, () => ix.refresh())
    const ms = performance.now() - t
    console.log(`search: getting ${words.toLocaleString()} words ready took ${ms.toFixed(0)} ms (${n} statements)`)
    expect(n).toBeLessThan(15)
    // Once per world, ahead of the first search (prepareSearch); generous for a slow machine.
    expect(ms).toBeLessThan(3000)
  }, 60_000)

  it('finds anything in well under 100 ms, with no statements when nothing changed', () => {
    const ix = searchIndex(db)
    for (const q of ['the', 'mara', 'iron gate', 'lantern harb', 'élodie whisper', 'tho', 'zzzz', 'a b c d e']) {
      const r = ix.search(q)
      const t = median(() => ix.search(q))
      const found = r.groups.map((g) => `${g.label} ${g.total}`).join(', ') || 'nothing'
      console.log(`search "${q}": ${t.toFixed(1)} ms (${found})`)
      expect(t).toBeLessThan(100)
      expect(queries(db, () => ix.search(q))).toBe(0)
    }
    // Every scene matches a common word; the group still lists only a few, and the rest on request.
    const the = ix.search('the').groups.find((g) => g.id === 'scenes')!
    expect(the.total).toBe(2000)
    expect(the.hits).toHaveLength(4)
    const more = median(() => ix.search('the', { expand: ['scenes', 'summaries', 'character'] }))
    console.log(`search "the", three groups shown in full: ${more.toFixed(1)} ms`)
    expect(more).toBeLessThan(100)
  }, 60_000)

  it('stays quick right after Adam writes, reading back only what changed', () => {
    const ix = searchIndex(db)
    ix.search('x')
    const id = scenes[1234]
    repo.saveSceneText(db, id, null, 'The quartermaster counted the barrels twice.')
    let n = 0
    const t = performance.now()
    n = queries(db, () => expect(ix.search('quartermaster').groups[0].hits[0].open).toMatchObject({ sceneId: id }))
    const ms = performance.now() - t
    console.log(`search after a save: ${ms.toFixed(1)} ms (${n} statements)`)
    expect(n).toBe(1)
    expect(ms).toBeLessThan(100)

    // Moving a scene renumbers its chapter: the places are read again, still quickly.
    repo.moveScene(db, scenes[5], repo.getSceneMeta(db, scenes[5]).chapterId, 0)
    const t2 = performance.now()
    const n2 = queries(db, () => ix.search('the'))
    const ms2 = performance.now() - t2
    console.log(`search after moving a scene: ${ms2.toFixed(1)} ms (${n2} statements)`)
    expect(n2).toBeLessThan(10)
    expect(ms2).toBeLessThan(250)
  }, 60_000)
})
