// The memory keeper leaves no summary marked "being brought up to date" with nothing to clear it, brings hand edits of
// the record into the snapshots and roll-ups as a read does (the books after it too), and never holds a draft up for
// longer than the draft waits for the memory at all (long story memory fix 15, review of 2026-10-16). The fake memory
// model; invented text. Hand edits go through the open world's handlers in recordEdited.test.ts.

import type Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import { chapterWorld, change, setCard, type ChapterWorld } from '../../../tests/unit/chapterWorld'
import { fakeModel, saveParas, shapedFetch, textOf } from '../../../tests/unit/keeperRead'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as kdb from '../db/keeper'
import { storedSnapshots } from '../db/snapshots'
import { Keeper, RETRY_TRIES, type KeeperDeps } from './engine'
import { SUMMARY_MARKER } from './prompts'
import { sceneSourceHash } from './summaries'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0 })
})
afterAll(() => fake.close())

type DB = Database.Database

/** Every scene with a summary that fits its words, as the memory would have written them. */
function summarised(): ChapterWorld {
  const w = chapterWorld()
  w.scenes.forEach((list, c) =>
    list.forEach((id, i) => {
      const s = kdb.keeperScene(w.db, id)!
      mem.putSummary(w.db, { level: 'scene', targetId: id, text: `By the end, chapter ${c + 1} scene ${i + 1} is over.`, origin: 'text', sourceHash: sceneSourceHash(s.text, s.doc) })
    })
  )
  return w
}

/**
 * A keeper on the fake model whose reads find nothing new. `summary`: what a summary request gets instead of the fake
 * model's answer ('fail': an error; a number: that many ms of delay first), by the request's first words; `sent`: each
 * summary request's first words.
 */
function keeper(db: DB, o: { summary?: (user: string) => 'fail' | number | null; sent?: string[] } & Partial<KeeperDeps> = {}): Keeper {
  const reads = shapedFetch({ nothing: true })
  return new Keeper({
    db,
    model: () => fakeModel(fake),
    emitStatus: () => {},
    emitChanged: () => {},
    quietMs: 60_000,
    retryDelays: [0],
    backlogGapMs: 0,
    retryFirstMs: 10,
    ...o,
    fetchImpl: async (input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: { role: string; content: unknown }[] }
      if (textOf(body.messages?.find((m) => m.role === 'system')?.content).includes(SUMMARY_MARKER)) {
        const user = textOf(body.messages?.find((m) => m.role === 'user')?.content)
        o.sent?.push(user.slice(0, 40))
        const what = o.summary?.(user) ?? null
        if (what === 'fail') return new Response('{"error": {"message": "down"}}', { status: 500 })
        if (typeof what === 'number') await new Promise((r) => setTimeout(r, what))
      }
      return reads(input, init)
    }
  })
}

/** Waits until `ok` holds (timers the keeper set run meanwhile), at most `ms`. */
async function until(ok: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms
  while (!ok()) {
    if (Date.now() > end) throw new Error('waited too long')
    await new Promise((r) => setTimeout(r, 10))
  }
}

const stale = (db: DB, level: 'scene' | 'chapter' | 'story', id: ID): boolean | undefined => kdb.summaryRow(db, level, id)?.stale

/** About fifty invented words: long enough for a summary. */
const LONG =
  'Then the weir gave way in the night, and the whole of the lower town woke to water in the streets, lamps out, bells ringing, the ferry gone downriver with the mill wheel, and everyone who had slept on the quay standing wet through in the chapel yard.'

/** Gives a scene words enough for a summary, read by the memory already (nothing to read), and `summary` if given. */
function longScene(db: DB, sceneId: ID, words: string, summary?: string): void {
  saveParas(db, sceneId, [['l1', words]], false)
  db.prepare("UPDATE scenes SET memory_version = text_version, memory_status = 'current' WHERE id = ?").run(sceneId)
  if (summary) {
    const sc = kdb.keeperScene(db, sceneId)!
    mem.putSummary(db, { level: 'scene', targetId: sceneId, text: summary, origin: 'text', sourceHash: sceneSourceHash(sc.text, sc.doc) })
  }
}

/** How many summary requests of a kind arrive while waiting `ms` more (none, once given up). */
async function quietFor(count: () => number, ms = 300): Promise<number> {
  const before = count()
  await new Promise((r) => setTimeout(r, ms))
  return count() - before
}

describe('a hand edit of the record is brought in as a read is (recordEdited)', () => {
  it('works the chapter’s snapshot out again and rolls its summary up again with the new record', async () => {
    const w = summarised()
    const first = keeper(w.db)
    first.start()
    await first.whenIdle()
    first.stop()
    const before = kdb.summaryRow(w.db, 'chapter', w.chapters[0])!
    // Adam adds a change on an entry page (no read follows).
    change(w.db, w.ids.ash, w.scenes[0][1], { kind: 'update', payload: { note: 'broke the ferry chain' } })
    const sent: string[] = []
    const k = keeper(w.db, { sent })
    k.recordEdited([w.storyId])
    await k.whenIdle()
    k.stop()
    expect(storedSnapshots(w.db).get(w.chapters[0])!.snapshot!.changed.map((c) => c.note)).toContain('broke the ferry chain')
    const after = kdb.summaryRow(w.db, 'chapter', w.chapters[0])!
    expect(after.sourceHash).not.toBe(before.sourceHash)
    expect(after.stale).toBe(false)
    expect(sent.filter((s) => s.startsWith('Summarise this chapter'))).toHaveLength(1)
  })

  it('brings in the books after the edited one too, whose record rests on it', async () => {
    const w = summarised()
    const book2 = repo.createStory(w.db, { title: 'Book 2', startStoryId: w.storyId }).id
    const chapter2 = repo.getOutline(w.db, book2).chapters[0]?.id ?? repo.createChapter(w.db, book2).id
    const scene2 = repo.getOutline(w.db, book2).scenes[0]?.id ?? repo.createScene(w.db, chapter2).id
    saveParas(w.db, scene2, [['b1', 'The ferry crossed in the rain and nobody aboard said a word to Tobin.']], false)
    setCard(w.db, scene2, { presentIds: [w.ids.tobin], when: 'Day 9' })
    const first = keeper(w.db)
    first.start()
    await first.whenIdle()
    first.stop()
    const tobinIn2 = () => storedSnapshots(w.db).get(repo.getOutline(w.db, book2).chapters[0].id)!.snapshot!.people.find((p) => p.who === w.ids.tobin)
    expect(tobinIn2()?.looks).toBeUndefined()
    // A scar for Tobin in Book 1, by hand: only Book 1 is named, yet Book 2's snapshot has it.
    change(w.db, w.ids.tobin, w.scenes[0][0], { kind: 'update', payload: { note: 'cut his cheek', fields: { marks: 'scar on his cheek' } } })
    const k = keeper(w.db)
    k.recordEdited([w.storyId])
    await k.whenIdle()
    k.stop()
    expect(tobinIn2()?.looks).toEqual(['Distinguishing marks: scar on his cheek'])
  })
})

describe('no summary is left marked out of date with nothing to clear it', () => {
  it('a world opens with summaries marked out of date: each is written again, one at a time; one too short just loses its mark', async () => {
    const w = summarised()
    // As the first open after an upgrade leaves them (tidy.ts): scenes the memory has read since their summaries were
    // written, marked out of date; and one too short for a summary now.
    longScene(w.db, w.scenes[1][0], LONG)
    longScene(w.db, w.scenes[1][1], `${LONG} Again.`)
    longScene(w.db, w.scenes[2][0], 'Rain.')
    for (const id of [w.scenes[1][0], w.scenes[1][1], w.scenes[2][0]]) kdb.markTextSummaryStale(w.db, 'scene', id)
    expect(kdb.staleSceneSummaries(w.db)).toEqual([w.scenes[1][0], w.scenes[1][1], w.scenes[2][0]])
    // With the usual gap between them, only the first is written while the keeper is idle; the rest wait their turn.
    const slow = keeper(w.db, { backlogGapMs: 60_000, summaries: true })
    slow.start()
    await slow.whenIdle()
    slow.stop()
    expect(stale(w.db, 'scene', w.scenes[1][0])).toBe(false)
    expect(stale(w.db, 'scene', w.scenes[1][1])).toBe(true)
    // Opened again: the next one, and the short one loses its mark.
    const k = keeper(w.db)
    k.start()
    await k.whenIdle()
    k.stop()
    expect(kdb.staleSceneSummaries(w.db)).toEqual([])
    expect(kdb.summaryRow(w.db, 'scene', w.scenes[1][1])!.sourceHash).toBe(sceneSourceHash(kdb.keeperScene(w.db, w.scenes[1][1])!.text, kdb.keeperScene(w.db, w.scenes[1][1])!.doc))
  })

  it('a summary marked out of date whose words are as they were is written again, never kept marked', async () => {
    const w = summarised()
    longScene(w.db, w.scenes[0][0], LONG, 'By the end, the weir held.')
    kdb.markTextSummaryStale(w.db, 'scene', w.scenes[0][0])
    const k = keeper(w.db)
    k.start()
    await k.whenIdle()
    k.stop()
    expect(stale(w.db, 'scene', w.scenes[0][0])).toBe(false)
    expect(kdb.summaryRow(w.db, 'scene', w.scenes[0][0])!.text).toMatch(/^This part of the story begins: Then the weir gave way/)
  })

  it('a summary that fails is tried again with growing waits, then given up and its mark cleared', async () => {
    const w = summarised()
    longScene(w.db, w.scenes[0][0], LONG, 'By the end, the weir held.')
    kdb.markTextSummaryStale(w.db, 'scene', w.scenes[0][0])
    let tries = 0
    const k = keeper(w.db, { summary: (user) => (user.startsWith('Summarise this scene') ? (tries++, 'fail') : null) })
    k.start()
    await k.whenIdle()
    // Failed once: still marked, as it will be tried again.
    expect(tries).toBeGreaterThan(0)
    expect(stale(w.db, 'scene', w.scenes[0][0])).toBe(true)
    const once = tries
    await until(() => stale(w.db, 'scene', w.scenes[0][0]) === false)
    // Given up after RETRY_TRIES tries (each its own requests), and nothing more is asked.
    expect(tries).toBe(once * RETRY_TRIES)
    expect(await quietFor(() => tries)).toBe(0)
    k.stop()
    expect(kdb.summaryRow(w.db, 'scene', w.scenes[0][0])!.text).toBe('By the end, the weir held.')
  })

  it('a summary that fails then works is written on a later try', async () => {
    const w = summarised()
    longScene(w.db, w.scenes[0][0], LONG, 'By the end, the weir held.')
    kdb.markTextSummaryStale(w.db, 'scene', w.scenes[0][0])
    let failing = true
    const k = keeper(w.db, { summary: (user) => (user.startsWith('Summarise this scene') && failing ? 'fail' : null) })
    k.start()
    await k.whenIdle()
    expect(stale(w.db, 'scene', w.scenes[0][0])).toBe(true)
    failing = false
    await until(() => stale(w.db, 'scene', w.scenes[0][0]) === false)
    k.stop()
    expect(kdb.summaryRow(w.db, 'scene', w.scenes[0][0])!.text).toMatch(/^This part of the story begins: Then the weir gave way/)
  })

  it('a roll-up that keeps failing is marked while it is tried again, then given up and no longer marked', async () => {
    const w = summarised()
    const first = keeper(w.db)
    first.start()
    await first.whenIdle()
    first.stop()
    mem.putSummary(w.db, { level: 'scene', targetId: w.scenes[1][0], text: 'By the end, the weir is broken.', origin: 'text' })
    let tries = 0
    const k = keeper(w.db, { summary: (user) => (user.startsWith('Summarise this chapter') ? (tries++, 'fail') : null) })
    k.recordEdited([w.storyId])
    await k.whenIdle()
    expect(tries).toBeGreaterThan(0)
    expect(stale(w.db, 'chapter', w.chapters[1])).toBe(true)
    const once = tries
    await until(() => stale(w.db, 'chapter', w.chapters[1]) === false)
    expect(tries).toBe(once * RETRY_TRIES)
    expect(await quietFor(() => tries)).toBe(0)
    k.stop()
  })
})

describe('a draft waits for the summaries it needs no longer than it waits for the memory at all', () => {
  it('goes ahead after its limit, and the summary is written in the background', async () => {
    const w = summarised()
    const [s1, s2] = w.scenes[0]
    // No summary yet for the scene before: the draft of the next one needs it.
    longScene(w.db, s1, LONG)
    w.db.prepare("DELETE FROM summaries WHERE level = 'scene' AND target_id = ?").run(s1)
    const k = keeper(w.db, { summary: (user) => (user.startsWith('Summarise this scene') ? 1500 : null) })
    const t = Date.now()
    await k.beforeDraft(s2, 100, 200)
    expect(Date.now() - t).toBeLessThan(1200)
    expect(kdb.summaryRow(w.db, 'scene', s1)).toBeFalsy()
    await k.whenIdle()
    k.stop()
    expect(kdb.summaryRow(w.db, 'scene', s1)?.text).toBeTruthy()
  })
})
