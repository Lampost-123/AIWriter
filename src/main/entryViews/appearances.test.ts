import { describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'
import { emptySceneCard } from '@shared/defaults'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { memoryWorld } from '../../../tests/unit/helpers'
import { appearancesOf, forgetReadings, readAhead, worldAppearances } from './appearances'
import { codexCards } from './codex'
import { warmReadings } from './warm'

type DB = Database.Database

/** Book 1 with two chapters (Sc 1 and 2, then Sc 1), and Book 2 continuing after it with one scene. */
function world(): { db: DB; s: Record<string, ID>; b1: ID; b2: ID } {
  const db = memoryWorld()
  const b1 = repo.listStories(db)[0].id
  const o = repo.getOutline(db, b1)
  const c1 = o.chapters[0].id
  const s11 = o.scenes[0].id
  const s12 = repo.createScene(db, c1).id
  const s21 = repo.createScene(db, repo.createChapter(db, b1).id).id
  const b2 = repo.createStory(db, { title: 'Book 2' }).id
  const s31 = repo.createScene(db, repo.createChapter(db, b2).id).id
  return { db, s: { s11, s12, s21, s31 }, b1, b2 }
}

const text = (db: DB, id: ID, t: string): void => void repo.saveSceneText(db, id, null, t)
const card = (db: DB, id: ID, c: Partial<ReturnType<typeof emptySceneCard>>): void =>
  void repo.updateSceneCard(db, id, { ...emptySceneCard(), ...c })
const where = (db: DB, id: ID): [string, string[]][] =>
  appearancesOf(db, repo.getEntry(db, id), repo.listEntries(db)).map((a) => [a.label, a.how])

/** How many times `fn` reads scenes' words (each time is one query, for one scene or many). */
function wordReads(db: DB, fn: () => unknown): number {
  const prepare = db.prepare.bind(db)
  let n = 0
  db.prepare = ((q: string) => {
    if (/SELECT id, text\b/.test(q)) n++
    return prepare(q)
  }) as typeof db.prepare
  try {
    fn()
  } finally {
    db.prepare = prepare
  }
  return n
}
const readsWords = (db: DB, fn: () => unknown): boolean => wordReads(db, fn) > 0

describe('where an entry appears', () => {
  it('counts the scene card, the words (names and aliases, by the memory keeper’s rule) and changes pinned there', () => {
    const { db, s } = world()
    const mara = repo.createEntry(db, 'character', { name: 'Mara', aliases: ['the ferrywoman'] }).id
    const tobin = repo.createEntry(db, 'character', { name: 'Tobin' }).id
    const eel = repo.createEntry(db, 'place', { name: 'Eelmouth' }).id
    card(db, s.s11, { povId: mara, presentIds: [mara, tobin], locationId: eel })
    text(db, s.s12, 'Nobody spoke. The Ferrywoman waited at the steps.')
    text(db, s.s21, 'mara is not a name here, and nor is maraud.')
    mem.insertChange(db, {
      entryId: tobin,
      anchor: 'scene',
      sceneId: s.s31,
      kind: 'relationship',
      payload: { otherId: mara, type: 'rival', feels: '', otherFeels: '' },
      origin: 'adam'
    })

    expect(where(db, mara)).toEqual([
      ['Book 1, Ch 1, Sc 1', ['pov', 'present']],
      ['Book 1, Ch 1, Sc 2', ['named']],
      ['Book 2, Ch 1, Sc 1', ['changes']]
    ])
    expect(where(db, tobin)).toEqual([
      ['Book 1, Ch 1, Sc 1', ['present']],
      ['Book 2, Ch 1, Sc 1', ['changes']]
    ])
    expect(where(db, eel)).toEqual([['Book 1, Ch 1, Sc 1', ['location']]])
  })

  it('gives the words around the first mention, cut from the scene exactly', () => {
    const { db, s } = world()
    const mara = repo.createEntry(db, 'character', { name: 'Mara' }).id
    text(db, s.s12, 'Rain.\n\nThe bell rang twice. Mara kept her hood low, and Mara waited.')
    const [a] = appearancesOf(db, repo.getEntry(db, mara), repo.listEntries(db))
    expect(a.quote).toBe('Mara kept her hood low, and Mara waited.')
    expect(a.title).toBe('Scene 2')
    // Quotes are remembered with the scene's words, so new words give a new quote.
    expect(appearancesOf(db, repo.getEntry(db, mara), repo.listEntries(db))[0].quote).toBe(a.quote)
    text(db, s.s12, 'Later, Mara slept.')
    expect(appearancesOf(db, repo.getEntry(db, mara), repo.listEntries(db))[0].quote).toBe('Later, Mara slept.')
  })

  it('keeps up as words, names and scenes change', () => {
    const { db, s } = world()
    const mara = repo.createEntry(db, 'character', { name: 'Mara' }).id
    text(db, s.s11, 'Mara is here.')
    expect(where(db, mara).map(([l]) => l)).toEqual(['Book 1, Ch 1, Sc 1'])
    // The words change.
    text(db, s.s11, 'Nobody is here.')
    text(db, s.s21, 'Mara came back.')
    expect(where(db, mara).map(([l]) => l)).toEqual(['Book 1, Ch 2, Sc 1'])
    // A new alias is found in scenes read before it existed.
    text(db, s.s12, 'The old woman sat.')
    expect(where(db, mara).map(([l]) => l)).toEqual(['Book 1, Ch 2, Sc 1'])
    repo.updateEntry(db, mara, { aliases: ['the old woman'] })
    expect(where(db, mara).map(([l]) => l)).toEqual(['Book 1, Ch 1, Sc 2', 'Book 1, Ch 2, Sc 1'])
    // A rename: the old name no longer counts.
    repo.updateEntry(db, mara, { name: 'Mira', aliases: [] })
    expect(where(db, mara)).toEqual([])
    // A new entry is found in every scene.
    const kell = repo.createEntry(db, 'character', { name: 'Kell' }).id
    text(db, s.s31, 'Kell rode in.')
    expect(where(db, kell).map(([l]) => l)).toEqual(['Book 2, Ch 1, Sc 1'])
    // A deleted scene doesn't count.
    repo.deleteScene(db, s.s31)
    expect(where(db, kell)).toEqual([])
  })

  it('reads a scene back from Recently deleted for the names that are new since it was deleted', () => {
    const { db, s } = world()
    const mara = repo.createEntry(db, 'character', { name: 'Mara' }).id
    text(db, s.s12, 'Tobin crossed the river. Mara saw him go.')
    expect(where(db, mara).map(([l]) => l)).toEqual(['Book 1, Ch 1, Sc 2'])
    repo.deleteScene(db, s.s12)
    const tobin = repo.createEntry(db, 'character', { name: 'Tobin' }).id
    expect(where(db, tobin)).toEqual([])
    repo.restoreDeleted(db, 'scene', s.s12)
    const seen = [where(db, tobin), where(db, mara)]
    expect(seen).toEqual([[['Book 1, Ch 1, Sc 2', ['named']]], [['Book 1, Ch 1, Sc 2', ['named']]]])
    // The same as reading every scene afresh.
    forgetReadings(db)
    expect([where(db, tobin), where(db, mara)]).toEqual(seen)
  })

  it('reads a chapter back from Recently deleted for new entries, names and aliases', () => {
    const { db, s, b1 } = world()
    const c1 = repo.getOutline(db, b1).chapters[0].id
    const mara = repo.createEntry(db, 'character', { name: 'Mara' }).id
    const kell = repo.createEntry(db, 'character', { name: 'Kell' }).id
    text(db, s.s11, 'The ferryman waited by the steps.')
    text(db, s.s12, 'Tobin crossed the river. Mara saw him go, and Kellan too.')
    expect(where(db, mara).map(([l]) => l)).toEqual(['Book 1, Ch 1, Sc 2'])
    expect(where(db, kell)).toEqual([])
    repo.deleteChapter(db, c1)
    const tobin = repo.createEntry(db, 'character', { name: 'Tobin' }).id
    repo.updateEntry(db, mara, { aliases: ['the ferryman'] })
    repo.updateEntry(db, kell, { name: 'Kellan' })
    expect([where(db, tobin), where(db, mara), where(db, kell)]).toEqual([[], [], []])
    repo.restoreDeleted(db, 'chapter', c1)
    const seen = [where(db, tobin), where(db, mara), where(db, kell)]
    expect(seen.map((list) => list.map(([l]) => l))).toEqual([
      ['Book 1, Ch 1, Sc 2'],
      ['Book 1, Ch 1, Sc 1', 'Book 1, Ch 1, Sc 2'],
      ['Book 1, Ch 1, Sc 2']
    ])
    expect(codexCards(db).find((c) => c.id === tobin)).toMatchObject({ scenes: 1 })
    // The same as reading every scene afresh.
    forgetReadings(db)
    expect([where(db, tobin), where(db, mara), where(db, kell)]).toEqual(seen)
  })

  it('reads each scene’s words once, until they change', () => {
    const { db, s } = world()
    repo.createEntry(db, 'character', { name: 'Mara' })
    text(db, s.s11, 'Mara is here.')
    const entries = repo.listEntries(db)
    expect(readsWords(db, () => worldAppearances(db, entries))).toBe(true)
    expect(readsWords(db, () => worldAppearances(db, entries))).toBe(false)
  })
})

describe('reading scenes ahead', () => {
  it('finds the same as the first look would, which then reads no words', () => {
    const { db, s } = world()
    const mara = repo.createEntry(db, 'character', { name: 'Mara', aliases: ['the ferrywoman'] }).id
    text(db, s.s11, 'Mara is here.')
    text(db, s.s21, 'The ferrywoman waited.')
    const entries = repo.listEntries(db)
    expect(readAhead(db, entries, [s.s11, s.s12])).toBe(true)
    expect(readAhead(db, entries, [s.s21, s.s31])).toBe(true)
    expect(readsWords(db, () => worldAppearances(db, entries))).toBe(false)
    expect(where(db, mara).map(([l]) => l)).toEqual(['Book 1, Ch 1, Sc 1', 'Book 1, Ch 2, Sc 1'])
  })

  it('stops once the names change, leaving the rest to the next look', () => {
    const { db, s } = world()
    repo.createEntry(db, 'character', { name: 'Mara' })
    text(db, s.s11, 'Mara is here.')
    expect(readAhead(db, repo.listEntries(db), [s.s11])).toBe(true)
    const kell = repo.createEntry(db, 'character', { name: 'Kell' }).id
    text(db, s.s12, 'Kell rode in.')
    expect(readsWords(db, () => expect(readAhead(db, repo.listEntries(db), [s.s12])).toBe(false))).toBe(false)
    expect(where(db, kell).map(([l]) => l)).toEqual(['Book 1, Ch 1, Sc 2'])
  })

  it('happens a slice at a time once a world opens, so the codex then reads no words', () => {
    vi.useFakeTimers()
    try {
      const { db, s } = world()
      repo.createEntry(db, 'character', { name: 'Mara' })
      text(db, s.s21, 'Mara is here.')
      warmReadings(db, () => true, { delayMs: 50, slice: 1 })
      expect(wordReads(db, () => vi.advanceTimersByTime(40))).toBe(0)
      // Four scenes, one slice each.
      expect(wordReads(db, () => vi.runAllTimers())).toBe(4)
      expect(readsWords(db, () => codexCards(db))).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops once the world is closed', () => {
    vi.useFakeTimers()
    try {
      const { db } = world()
      let open = true
      warmReadings(db, () => open, { delayMs: 0, slice: 2 })
      expect(wordReads(db, () => vi.advanceTimersToNextTimer())).toBe(1)
      open = false
      expect(wordReads(db, () => vi.runAllTimers())).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('codex cards', () => {
  it('know how important each entry is, where it last appears and the stories it belongs to', () => {
    const { db, s, b1, b2 } = world()
    const mara = repo.createEntry(db, 'character', { name: 'Mara', fields: { role: 'protagonist' }, tags: ['family'] }).id
    const tobin = repo.createEntry(db, 'character', { name: 'Tobin' }).id
    // Made while working in Book 2: it first exists there.
    const kell = repo.createEntry(db, 'character', { name: 'Kell', originStoryId: b2 }).id
    card(db, s.s11, { povId: mara })
    card(db, s.s12, { presentIds: [tobin] })
    text(db, s.s21, 'Tobin and Mara.')
    text(db, s.s31, 'Tobin alone.')
    const cards = new Map(codexCards(db).map((c) => [c.id, c]))
    expect(cards.get(mara)).toMatchObject({ role: 'protagonist', tags: ['family'], scenes: 2, importance: 3 + 1 })
    expect(cards.get(mara)!.last?.label).toBe('Book 1, Ch 2, Sc 1')
    expect(cards.get(tobin)).toMatchObject({ scenes: 3, importance: 2 + 1 + 1 })
    expect(cards.get(tobin)!.last?.label).toBe('Book 2, Ch 1, Sc 1')
    expect(cards.get(tobin)!.last!.order).toBeGreaterThan(cards.get(mara)!.last!.order)
    // The beginning of the world counts as the world's first story.
    expect(cards.get(mara)!.storyIds).toEqual([b1])
    expect(new Set(cards.get(tobin)!.storyIds)).toEqual(new Set([b1, b2]))
    expect(cards.get(kell)).toMatchObject({ scenes: 0, importance: 0, last: null, storyIds: [b2] })
  })
})
