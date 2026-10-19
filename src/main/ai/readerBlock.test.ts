// What the reader knows that someone in the scene doesn't (the reader ledger, ai/readerKnows.ts) reaches the writer as
// its own short block, sent right after who knows what (the AI overhaul, 2026-10-19). Invented world; no model.
import { describe, expect, it } from 'vitest'
import { defaultWritingPrefs } from '@shared/defaults'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import { gatherContextInput, readerKnowsFor } from './gather'
import { buildBlocks, prepareContext, READER_BLOCK, SEND_ORDER } from './context'
import { LEDGER_BLOCK } from './whoKnows'

function world() {
  const db = memoryWorld()
  const storyId = repo.listStories(db)[0].id
  return { db, storyId, scene: repo.getOutline(db, storyId).scenes[0].id }
}

function input() {
  const w = world()
  return gatherContextInput(w.db, w.scene, { direction: '', targetWords: 600, creativity: 'balanced' }, { prefs: defaultWritingPrefs(), contextLength: 64_000, creativity: 'balanced' })
}

describe('what the reader knows, in the writer’s briefing', () => {
  it('is a block of its own, a line each, after who knows what', () => {
    const lines = ['The reader knows the miller plans to flood the valley (Ch 1, Sc 2); Mara doesn’t: don’t explain it again, or let her learn or guess it without cause']
    const block = buildBlocks({ ...input(), readerKnows: lines }).find((b) => b.id === READER_BLOCK.id)
    expect(block?.title).toBe('What the reader knows')
    expect(block?.text).toContain(`- ${lines[0]}`)
    expect(SEND_ORDER.indexOf(READER_BLOCK.id)).toBe(SEND_ORDER.indexOf(LEDGER_BLOCK.id) + 1)
    expect(prepareContext({ ...input(), readerKnows: lines }).blocks.some((b) => b.id === READER_BLOCK.id && !b.dropped)).toBe(true)
  })

  it('is left out when there is nothing the reader knows that someone here doesn’t', () => {
    expect(buildBlocks({ ...input(), readerKnows: [] }).some((b) => b.id === READER_BLOCK.id)).toBe(false)
  })

  it('never stops a draft: no story or nobody on the card gives no lines', () => {
    const w = world()
    expect(readerKnowsFor(w.db, null, w.scene, ['someone'])).toEqual([])
    expect(readerKnowsFor(w.db, w.storyId, w.scene, [null, undefined])).toEqual([])
    expect(Array.isArray(readerKnowsFor(w.db, w.storyId, w.scene, ['no-such-entry']))).toBe(true)
  })
})
