// Chapter, story and series summaries are made from the level below and the story record, never from older summaries of
// themselves, and each is tied to what it was made from, so a change makes only what rests on it out of date (long story
// memory fix 15). Invented story (tests/unit/chapterWorld.ts); the fake memory model writes the roll-ups: no paid calls.

import type Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import { chapterWorld, change, type ChapterWorld } from '../../../tests/unit/chapterWorld'
import { fakeModel, textOf } from '../../../tests/unit/keeperRead'
import * as mem from '../db/memory'
import * as kdb from '../db/keeper'
import { SUMMARY_MARKER } from './prompts'
import { markOutOfDate, nextRollUp, suppressSummary, writeRollUp, type RollUp, type SummaryOptions } from './summaries'
import { refreshSnapshots } from './snapshots'
import { hashText } from './text'
import { undoItem } from './undo'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0 })
})
afterAll(() => fake.close())

type DB = Database.Database

const label = (place: { storyId: ID; chapterId?: ID | null }): string => (place.chapterId ? 'Book 1, Ch' : 'Book 1')

function options(db: DB, sent: string[] = []): SummaryOptions {
  return {
    db,
    model: fakeModel(fake),
    signal: new AbortController().signal,
    closed: () => false,
    retryDelays: [0],
    fetchImpl: async (input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { messages: { role: string; content: unknown }[] }
      if (textOf(body.messages.find((m) => m.role === 'system')?.content).includes(SUMMARY_MARKER))
        sent.push(textOf(body.messages.find((m) => m.role === 'user')?.content))
      return fetch(input, init)
    }
  }
}

/** Every scene gets a summary (as the memory writes them), and the snapshots are worked out. */
function summarised(): ChapterWorld {
  const w = chapterWorld()
  w.scenes.forEach((list, c) =>
    list.forEach((id, i) => mem.putSummary(w.db, { level: 'scene', targetId: id, text: `By the end, chapter ${c + 1} scene ${i + 1} is over.`, origin: 'text' }))
  )
  refreshSnapshots(w.db, w.storyId, 10)
  return w
}

/** Writes every roll-up that is due, in order; what each was asked. */
async function rollAll(w: ChapterWorld, sent: string[] = []): Promise<RollUp[]> {
  const done: RollUp[] = []
  const model = fakeModel(fake)
  for (let r = nextRollUp(w.db, [w.storyId], label, model); r; r = nextRollUp(w.db, [w.storyId], label, model)) {
    expect(await writeRollUp(options(w.db, sent), r)).toBe(true)
    markOutOfDate(w.db, w.storyId)
    done.push(r)
    if (done.length > 10) throw new Error('roll-ups never settle')
  }
  return done
}

const stale = (db: DB, level: 'chapter' | 'story' | 'series', id: ID): boolean | undefined => kdb.summaryRow(db, level, id)?.stale

describe('a chapter summary is made from its scenes’ summaries and the story record', () => {
  it('is asked with what the record says changed in it (not how things stand at its end, nor when), and tied to its scenes', () => {
    const w = summarised()
    const r = nextRollUp(w.db, [w.storyId], label, fakeModel(fake))!
    expect(r).toMatchObject({ level: 'chapter', targetId: w.chapters[0], sceneId: w.scenes[0][1] })
    expect(r.sourceHash.startsWith('ch2|')).toBe(true)
    expect(r.sourceHash).toContain(`${w.scenes[0][0]}~`)
    expect(r.sourceHash).toContain(`${w.scenes[0][1]}~`)
    expect(r.ask).toMatchObject({
      level: 'chapter',
      record: ['Plot thread set up: The ferryman’s debt (scene 1)']
    })
    expect(r.ask).not.toHaveProperty('end')
  })

  it('writes every roll-up from the level below and the record, never from an older summary of itself', async () => {
    const w = summarised()
    const sent: string[] = []
    const done = await rollAll(w, sent)
    expect(done.map((r) => r.level)).toEqual(['chapter', 'chapter', 'chapter', 'story', 'series'])
    const [, ch2, , story, series] = sent
    expect(ch2).toContain('- Edric: died in his chair (scene 3)')
    expect(ch2).toContain('- Ash and Tobin learned: Mara is the heir (saw it, scene 3)')
    expect(ch2).not.toContain('How things stand')
    expect(ch2).not.toContain('When:')
    expect(story).toContain("Chapter 2: This part of the story begins: Scene 1: By the end, chapter 2 scene 1 is over.")
    expect(story).toContain('How things stand at the end, by the story record:\n- Mara: last at The Mill (scene 2); Distinguishing marks: left hand missing; has the brass key')
    expect(series).toContain('How things stand at the end of the last book, by the story record:')
    // Nothing is out of date now.
    for (const id of w.chapters) expect(stale(w.db, 'chapter', id)).toBe(false)
    expect(stale(w.db, 'story', w.storyId)).toBe(false)

    // One scene's summary in chapter 2 is written again: only chapter 2 is rolled up, then the story, made from its
    // chapters again, never from its own older summary. The series isn't: the story's summary came out the same (the
    // fake model sums up the opening), and how things stand at its end didn't change.
    const oldStory = kdb.summaryRow(w.db, 'story', w.storyId)!.text
    mem.putSummary(w.db, { level: 'scene', targetId: w.scenes[1][0], text: 'By the end, Mara has lost her hand at the weir.', origin: 'text' })
    const again: string[] = []
    const next = await rollAll(w, again)
    expect(next.map((r) => [r.level, r.targetId])).toEqual([
      ['chapter', w.chapters[1]],
      ['story', w.storyId]
    ])
    expect(again[0]).toContain('Mara has lost her hand at the weir')
    expect(again[1]).not.toContain(oldStory)
  })

  it('a roll-up written before this change (from its summaries alone) counts as up to date until they change', () => {
    const w = summarised()
    const texts = w.scenes[0].map((id) => kdb.summaryRow(w.db, 'scene', id)!.text)
    mem.putSummary(w.db, { level: 'chapter', targetId: w.chapters[0], text: 'Chapter 1, as summed up before.', origin: 'text', sourceHash: hashText(texts.join('\n')) })
    expect(nextRollUp(w.db, [w.storyId], label, fakeModel(fake))!.targetId).toBe(w.chapters[1])
    markOutOfDate(w.db, w.storyId)
    expect(stale(w.db, 'chapter', w.chapters[0])).toBe(false)
    mem.putSummary(w.db, { level: 'scene', targetId: w.scenes[0][1], text: 'By the end, the ferry has sunk.', origin: 'text' })
    expect(nextRollUp(w.db, [w.storyId], label, fakeModel(fake))!.targetId).toBe(w.chapters[0])
    markOutOfDate(w.db, w.storyId)
    expect(stale(w.db, 'chapter', w.chapters[0])).toBe(true)
  })
})

describe('only what rests on a change is out of date', () => {
  it('a scene’s summary marks its chapter and what rests on it; another chapter, and Adam’s own, stay as they are', async () => {
    const w = summarised()
    await rollAll(w)
    mem.putSummary(w.db, { level: 'chapter', targetId: w.chapters[2], text: 'My own words for chapter 3.', origin: 'adam' })
    mem.putSummary(w.db, { level: 'scene', targetId: w.scenes[1][1], text: 'By the end, Mara has the key and a plan.', origin: 'text' })
    mem.putSummary(w.db, { level: 'scene', targetId: w.scenes[2][0], text: 'By the end, Tobin is gone.', origin: 'text' })
    expect(markOutOfDate(w.db, w.storyId)).toBe(true)
    expect(stale(w.db, 'chapter', w.chapters[0])).toBe(false)
    expect(stale(w.db, 'chapter', w.chapters[1])).toBe(true)
    expect(stale(w.db, 'chapter', w.chapters[2])).toBe(false)
    expect(kdb.summaryRow(w.db, 'chapter', w.chapters[2])!.origin).toBe('adam')
    expect(stale(w.db, 'story', w.storyId)).toBe(true)
    // Nothing more to mark.
    expect(markOutOfDate(w.db, w.storyId)).toBe(false)
    // Written again, the marks go.
    await rollAll(w)
    expect(stale(w.db, 'chapter', w.chapters[1])).toBe(false)
    expect(stale(w.db, 'story', w.storyId)).toBe(false)
  })

  it('so does a change to what the record says happened in a chapter, once its snapshot is worked out again', async () => {
    const w = summarised()
    await rollAll(w)
    change(w.db, w.ids.ash, w.scenes[0][0], { kind: 'update', payload: { note: 'broke the ferry chain' } })
    expect(markOutOfDate(w.db, w.storyId)).toBe(false)
    refreshSnapshots(w.db, w.storyId, 10)
    expect(markOutOfDate(w.db, w.storyId)).toBe(true)
    expect(stale(w.db, 'chapter', w.chapters[0])).toBe(true)
    expect(stale(w.db, 'chapter', w.chapters[1])).toBe(false)
    const sent: string[] = []
    await rollAll(w, sent)
    expect(sent[0]).toContain('- Ash: broke the ferry chain (scene 1)')
  })

  it('a roll-up Adam undid before this version (no source kept, its summaries’ hash suppressed) isn’t written again (review)', () => {
    const w = summarised()
    const texts = w.scenes[0].map((id) => kdb.summaryRow(w.db, 'scene', id)!.text)
    // As an undo left it then: the older summary back with no source, and the undone one's summaries' hash suppressed.
    mem.putSummary(w.db, { level: 'chapter', targetId: w.chapters[0], text: 'Chapter 1, in Adam’s chosen words.', origin: 'text' })
    suppressSummary(w.db, 'chapter', w.chapters[0], hashText(texts.join('\n')))
    expect(nextRollUp(w.db, [w.storyId], label, fakeModel(fake))!.targetId).not.toBe(w.chapters[0])
    markOutOfDate(w.db, w.storyId)
    expect(stale(w.db, 'chapter', w.chapters[0])).toBe(false)
    // Once its summaries change, it is written again.
    mem.putSummary(w.db, { level: 'scene', targetId: w.scenes[0][0], text: 'By the end, the ferry is gone.', origin: 'text' })
    expect(nextRollUp(w.db, [w.storyId], label, fakeModel(fake))!.targetId).toBe(w.chapters[0])
  })

  it('a roll-up given up after failing isn’t marked, and one waiting to be tried again is skipped until then', async () => {
    const w = summarised()
    await rollAll(w)
    mem.putSummary(w.db, { level: 'scene', targetId: w.scenes[1][0], text: 'By the end, the weir is broken.', origin: 'text' })
    const r = nextRollUp(w.db, [w.storyId], label, fakeModel(fake))!
    expect(r.targetId).toBe(w.chapters[1])
    const key = `${r.level}:${r.targetId}:${r.sourceHash}`
    expect(nextRollUp(w.db, [w.storyId], label, fakeModel(fake), (k) => k === key)?.targetId).not.toBe(w.chapters[1])
    markOutOfDate(w.db, w.storyId)
    expect(stale(w.db, 'chapter', w.chapters[1])).toBe(true)
    markOutOfDate(w.db, w.storyId, (k) => k === key)
    expect(stale(w.db, 'chapter', w.chapters[1])).toBe(false)
  })

  it('a roll-up Adam undid isn’t marked, as it won’t be written again until what it is made from changes', async () => {
    const w = summarised()
    await rollAll(w)
    mem.putSummary(w.db, { level: 'scene', targetId: w.scenes[0][0], text: 'By the end, the bell has rung.', origin: 'text' })
    const r = nextRollUp(w.db, [w.storyId], label, fakeModel(fake))!
    expect(await writeRollUp(options(w.db), r)).toBe(true)
    const line = kdb.listLog(w.db).find((l) => l.factId === `chapter:${w.chapters[0]}` && !l.undone)!
    undoItem(w.db, line.id)
    expect(nextRollUp(w.db, [w.storyId], label, fakeModel(fake))?.targetId).not.toBe(w.chapters[0])
    markOutOfDate(w.db, w.storyId)
    expect(stale(w.db, 'chapter', w.chapters[0])).toBe(false)
  })
})
