// Clear actions for the memory model (World Memory Overhaul B7, 2026-10-08): besides new facts, the reading reply can
// act on what the memory holds, each with a quote: "end" a fact (B1), "guess" to confirm or withdraw one of its own
// guesses, "close" an open thread, and "summary" for a new one-line summary. Each is applied under the usual rules, with
// Undo, and never touches what Adam made himself. The reading prompt stays small enough for a 3,000-token model. All text
// is invented; the memory model is the fake one, its replies shaped per test: no paid calls.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import { entryNamed, readScene, saveParas, testWorld } from '../../../tests/unit/keeperRead'
import * as repo from '../db/repo'
import * as hist from '../db/history'
import * as kdb from '../db/keeper'
import { READING_SYSTEM } from './prompts'
import { readingBudget } from './request'
import { undoItem } from './undo'
import { sceneMemory } from '../memory/scene'
import { threadsBoardOf } from '../worldViews'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0 })
})
afterAll(() => fake.close())

const logLine = (db: Parameters<typeof kdb.listLog>[0], text: string) => kdb.listLog(db, { limit: 100 }).find((l) => l.text === text) ?? null

/** Kell, found in the story by the memory, whose eye colour the AI guessed. */
function withGuess() {
  const w = testWorld(1)
  const kell = repo.createEntry(w.db, 'character', { name: 'Kell', fields: { eyes: 'grey', hair: 'black' } }, { origin: 'text' })
  kdb.setFieldOrigins(w.db, kell.id, { eyes: 'ai', hair: 'ai' })
  return { ...w, kell }
}

const EYES = "Kell's grey eyes narrowed at the stranger."

describe('the reading prompt', () => {
  it('lists each action, compactly, and still fits a 3,000-token model', () => {
    for (const item of [
      '{"type": "end", "entry": "E1"',
      '{"type": "guess", "entry": "E1", "field": "eyes", "do": "confirm|withdraw"',
      '{"type": "close", "entry": "E5"',
      '{"type": "summary", "entry": "E3"'
    ])
      expect(READING_SYSTEM).toContain(item)
    expect(READING_SYSTEM).toContain('Actions on the memory:')
    expect(READING_SYSTEM.length).toBeLessThanOrEqual(6000)
    expect(readingBudget({ contextLength: 3000, maxOutput: null })).not.toBeNull()
  })

  it('marks the memory’s own guesses, so the model can act on them', async () => {
    const w = withGuess()
    saveParas(w.db, w.scenes[0], [['p1', EYES]])
    const out = await readScene(w.db, fake, w.scenes[0], { nothing: true })
    expect(out.asked.join('\n')).toMatch(/eyes: grey \(guess\)/)
  })
})

describe('a guess', () => {
  it('confirmed: it rests on the words from then on, and Undo makes it a guess again', async () => {
    const w = withGuess()
    saveParas(w.db, w.scenes[0], [['p1', EYES]])
    await readScene(w.db, fake, w.scenes[0], { add: [{ type: 'guess', entry: 'Kell', field: 'eyes', do: 'confirm', quote: EYES }] })
    const kell = entryNamed(w.db, 'Kell')!
    expect(kell.fieldOrigins?.eyes).toBe('text')
    expect(hist.linksForEntry(w.db, kell.id).some((l) => hist.isFieldLink(l, 'eyes') && l.state === 'ok')).toBe(true)
    // The writer no longer hears it as a guess.
    expect(sceneMemory(w.db, w.scenes[1], { forWriter: true }).entries.find((e) => e.id === kell.id)?.guesses ?? []).not.toContain('eyes')
    const line = logLine(w.db, 'Eyes: the story bears out the guess')!
    undoItem(w.db, line.id)
    const back = entryNamed(w.db, 'Kell')!
    expect(back.fieldOrigins?.eyes).toBe('ai')
    expect(back.fields.eyes).toBe('grey')
    expect(hist.linksForEntry(w.db, kell.id).some((l) => hist.isFieldLink(l, 'eyes'))).toBe(false)
  })

  it('withdrawn: it goes, with Undo', async () => {
    const w = withGuess()
    const BLUE = "Kell's eyes were a startling blue, nothing like the grey she had imagined."
    saveParas(w.db, w.scenes[0], [['p1', BLUE]])
    await readScene(w.db, fake, w.scenes[0], { nothing: true, add: [{ type: 'guess', entry: 'Kell', field: 'hair', do: 'withdraw', quote: BLUE }] })
    expect(entryNamed(w.db, 'Kell')!.fields.hair ?? '').toBe('')
    const line = logLine(w.db, "Hair: a guess the story doesn't bear out")!
    expect(line.quote).toBe(BLUE)
    undoItem(w.db, line.id)
    expect(entryNamed(w.db, 'Kell')!.fields.hair).toBe('black')
  })

  it("never touches Adam's own fields, nor the world builder's drafts on his entries", async () => {
    const w = testWorld(1)
    const mara = repo.createEntry(w.db, 'character', { name: 'Mara', fields: { eyes: 'green', hair: 'red' } })
    kdb.setFieldOrigins(w.db, mara.id, { hair: 'ai' })
    const LINE = 'Mara turned away from the window.'
    saveParas(w.db, w.scenes[0], [['p1', LINE]])
    await readScene(w.db, fake, w.scenes[0], {
      nothing: true,
      add: [
        { type: 'guess', entry: 'Mara', field: 'eyes', do: 'withdraw', quote: LINE },
        { type: 'guess', entry: 'Mara', field: 'hair', do: 'withdraw', quote: LINE }
      ]
    })
    const after = entryNamed(w.db, 'Mara')!
    expect([after.fields.eyes, after.fields.hair]).toEqual(['green', 'red'])
  })
})

describe('closing a thread', () => {
  it('resolves it when the payoff is on the page', async () => {
    const w = testWorld(1)
    const [s1, s2] = w.scenes
    saveParas(w.db, s1, [['p1', 'Nobody knew who rang the bell at night.']])
    await readScene(w.db, fake, s1)
    const PAYOFF = 'It was the keeper’s son who rang it, every night, for his drowned mother.'
    saveParas(w.db, s2, [['p1', PAYOFF]])
    await readScene(w.db, fake, s2, { nothing: true, add: [{ type: 'close', entry: 'Who rang the bell at night', note: 'the keeper’s son rang it', quote: PAYOFF }] })
    const thread = entryNamed(w.db, 'Who rang the bell at night')!
    const t = threadsBoardOf(w.db, w.storyId).threads.find((x) => x.id === thread.id)!
    expect(t.column).toBe('resolved')
    expect(t.resolved).toMatchObject({ quote: PAYOFF, byAi: true })
  })
})
