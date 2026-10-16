// The memory keeper, end to end (long story memory fix 15): when a scene changes enough, its summary is marked out of
// date and written again from its words (never patched), its chapter is marked out of date and rebuilt from its scenes'
// summaries and the story record, and nothing else is; the end-of-chapter snapshots are kept with no AI, and the writer's
// timeline reads them, an older chapter's line the same from one scene to the next. The fake memory model; invented text.

import type Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import { defaultWritingPrefs } from '@shared/defaults'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import { chapterWorld, type ChapterWorld } from '../../../tests/unit/chapterWorld'
import { fakeModel, saveParas, shapedFetch, textOf } from '../../../tests/unit/keeperRead'
import * as mem from '../db/memory'
import * as kdb from '../db/keeper'
import { storedSnapshots } from '../db/snapshots'
import { gatherContextInput } from '../ai/gather'
import { buildBlocks } from '../ai/context'
import { Keeper } from './engine'
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

/** A keeper on the fake model whose reads find nothing new; what it sent to be summarised; who was out of date at each change. */
function keeper(w: ChapterWorld) {
  const sent: string[] = []
  const seen: { scene: boolean; chapter: boolean }[] = []
  const reads = shapedFetch({ nothing: true })
  const k = new Keeper({
    db: w.db,
    model: () => fakeModel(fake),
    emitStatus: () => {},
    emitChanged: () => {
      if (!w.db.open) return
      seen.push({ scene: !!kdb.summaryRow(w.db, 'scene', w.scenes[1][0])?.stale, chapter: !!kdb.summaryRow(w.db, 'chapter', w.chapters[1])?.stale })
    },
    quietMs: 60_000,
    retryDelays: [0],
    fetchImpl: async (input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: { role: string; content: unknown }[] }
      if (textOf(body.messages?.find((m) => m.role === 'system')?.content).includes(SUMMARY_MARKER))
        sent.push(textOf(body.messages?.find((m) => m.role === 'user')?.content))
      return reads(input, init)
    }
  })
  return { k, sent, seen }
}

const timeline = (db: DB, sceneId: ID): string =>
  buildBlocks(gatherContextInput(db, sceneId, undefined, { prefs: defaultWritingPrefs(), contextLength: 16000, creativity: 'balanced' })).find(
    (b) => b.id === 'story-so-far'
  )!.text

describe('the memory keeper rebuilds summaries from their parts', () => {
  it('keeps each chapter’s snapshot, and rolls every chapter, the story and the series up with the record', async () => {
    const w = summarised()
    const { k, sent } = keeper(w)
    k.start()
    await k.whenIdle()
    k.stop()
    expect([...storedSnapshots(w.db).keys()].sort()).toEqual([...w.chapters].sort())
    for (const id of w.chapters) expect(kdb.summaryRow(w.db, 'chapter', id)).toMatchObject({ stale: false, sourceHash: expect.stringMatching(/^ch2\|/) })
    expect(kdb.summaryRow(w.db, 'story', w.storyId)).toMatchObject({ stale: false, sourceHash: expect.stringMatching(/^st2\|/) })
    expect(sent.filter((s) => s.startsWith('Summarise this chapter'))).toHaveLength(3)
    expect(sent.find((s) => s.startsWith('Summarise this chapter (') && s.includes('Edric: died in his chair'))).toBeTruthy()
  })

  it('a scene changed enough: its summary is out of date, then written again from its words; its chapter rebuilt, the others left', async () => {
    const w = summarised()
    const first = keeper(w)
    first.k.start()
    await first.k.whenIdle()
    first.k.stop()
    const chapter1 = kdb.summaryRow(w.db, 'chapter', w.chapters[0])!
    const oldScene = kdb.summaryRow(w.db, 'scene', w.scenes[1][0])!.text

    saveParas(w.db, w.scenes[1][0], [
      ['p10', 'Chapter 2, scene 1. The river ran high under the bridge and nobody spoke of it.'],
      ['p11', 'Then the weir gave way in the night, and the whole of the lower town woke to water in the streets, lamps out, bells ringing. By dawn the mill wheel had torn loose and gone downriver, and the ferry was gone with it, and everyone who had slept on the quay was standing in the chapel yard, wet through.']
    ])
    const { k, sent, seen } = keeper(w)
    k.sceneLeft(w.scenes[1][0])
    await k.whenIdle()
    k.stop()
    // Out of date first (the scene card and the Context tab say it is being brought up to date), then written again.
    expect(seen.some((s) => s.scene)).toBe(true)
    expect(seen.some((s) => s.chapter)).toBe(true)
    const scene = kdb.summaryRow(w.db, 'scene', w.scenes[1][0])!
    expect(scene.stale).toBe(false)
    expect(scene.text).not.toBe(oldScene)
    // From the scene's words, never by patching the old summary.
    const asked = sent.find((s) => s.startsWith('Summarise this scene'))!
    expect(asked).toContain('Then the weir gave way in the night')
    expect(asked).not.toContain(oldScene)
    // Its chapter was made again from its scenes' summaries (the new one among them) and the record; chapter 1 wasn't.
    const chapter = sent.filter((s) => s.startsWith('Summarise this chapter'))
    expect(chapter).toHaveLength(1)
    expect(chapter[0]).toContain(scene.text)
    expect(chapter[0]).toContain('What the story record says changed in this chapter:')
    expect(kdb.summaryRow(w.db, 'chapter', w.chapters[0])).toEqual(chapter1)
    expect(kdb.summaryRow(w.db, 'chapter', w.chapters[1])!.stale).toBe(false)
  })

  it('gives the writer an older chapter’s days and record, the same from one scene to the next', async () => {
    const w = summarised()
    const { k } = keeper(w)
    k.start()
    await k.whenIdle()
    k.stop()
    const a = timeline(w.db, w.scenes[2][1])
    const line = a.split('\n').find((l) => l.startsWith('- Ch 1'))!
    expect(line.startsWith('- Ch 1, Day 1 to Day 2: ')).toBe(true)
    // A scene later in the same chapter: the older chapter's line is word for word the same.
    w.db.prepare('INSERT INTO scenes (id, chapter_id, title, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('s-late', w.chapters[2], 'Late', 99, '2026-10-16', '2026-10-16')
    const b = timeline(w.db, 's-late')
    expect(b.split('\n').find((l) => l.startsWith('- Ch 1'))).toBe(line)
  })
})
