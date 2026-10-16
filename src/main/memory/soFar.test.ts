// Carrying on inside a scene (Add below, a later beat, Continue; review 2026-10-16): what the memory read from the scene
// so far counts, so a secret told or a thread paid off in its first part is no longer kept or open in the next. Only a
// change read from words that are in the scene so far; never Adam's own changes for the scene (aims). Every name and
// fact is invented.

import { describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as hist from '../db/history'
import { gatherContextInput } from '../ai/gather'
import { buildBlocks, MUST_BLOCK } from '../ai/context'
import { sceneMemory } from './scene'

const TOLD = '“The will was burned,” she told Tobin.'
const WORDS = `Mara stood by the fire.\n\n${TOLD} He said nothing.\n\nThe matter of the debt was settled at last.`

function world() {
  const db = memoryWorld()
  const [story] = repo.listStories(db)
  const outline = repo.getOutline(db, story.id)
  const s1 = outline.scenes[0].id
  const s2 = repo.createScene(db, outline.chapters[0].id, { title: 'The fire' }).id
  const mara = repo.createEntry(db, 'character', { name: 'Mara' })
  const tobin = repo.createEntry(db, 'character', { name: 'Tobin' })
  const debt = repo.createEntry(db, 'thread', { name: 'The debt' })
  repo.saveSceneText(db, s1, null, 'Mara came home late.')
  repo.saveSceneText(db, s2, null, WORDS)
  repo.updateSceneCard(db, s2, { ...repo.getScene(db, s2).card, povId: mara.id, presentIds: [mara.id, tobin.id] })
  const knows = (entryId: ID, factId: string, fact: string) => ({ entryId, kind: 'knowledge' as const, payload: { factId, fact } })
  // Mara knows two things from the start; the debt is set up in the first scene.
  mem.insertChange(db, { ...knows(mara.id, 'will', 'The will was burned'), anchor: 'baseline', origin: 'adam' })
  mem.insertChange(db, { ...knows(mara.id, 'heir', 'Mara is the heir'), anchor: 'baseline', origin: 'adam' })
  mem.insertChange(db, { entryId: debt.id, anchor: 'scene', sceneId: s1, kind: 'thread', payload: { status: 'open', note: 'Mara owes the miller' }, origin: 'adam' })
  // Read from this scene's words: Tobin is told, and the debt is paid off.
  const read = (c: Parameters<typeof mem.insertChange>[1], quote: string) => {
    const change = mem.insertChange(db, c)
    hist.addLink(db, { factKind: 'change', factId: change.id, field: null, sceneId: s2, sceneVersion: 1, paragraphId: null, start: 0, end: quote.length, quote })
  }
  read({ ...knows(tobin.id, 'will', 'The will was burned'), anchor: 'scene', sceneId: s2, origin: 'text' }, TOLD)
  read({ entryId: debt.id, anchor: 'scene', sceneId: s2, kind: 'thread', payload: { status: 'resolved', note: 'Paid' }, origin: 'text' }, 'The matter of the debt was settled at last.')
  // Adam's aim for the scene: Tobin is to learn that Mara is the heir. It isn't on the page yet.
  mem.insertChange(db, { ...knows(tobin.id, 'heir', 'Mara is the heir'), anchor: 'scene', sceneId: s2, origin: 'adam' })
  return { db, s2, mara: mara.id, tobin: tobin.id, debt: debt.id }
}

const knownBy = (m: ReturnType<typeof sceneMemory>, factId: string): ID[] => (m.facts.find((f) => f.factId === factId)?.knownBy ?? []).slice().sort()
const status = (m: ReturnType<typeof sceneMemory>, id: ID): string | undefined => m.threads.find((t) => t.entryId === id)?.status

describe('the memory carrying on inside a scene', () => {
  it('counts what the memory read from the scene so far, and only that', () => {
    const w = world()
    const begins = sceneMemory(w.db, w.s2, { forWriter: true })
    expect(knownBy(begins, 'will')).toEqual([w.mara])
    expect(status(begins, w.debt)).toBe('open')

    const later = sceneMemory(w.db, w.s2, { forWriter: true, soFar: WORDS })
    expect(knownBy(later, 'will')).toEqual([w.mara, w.tobin].sort())
    expect(status(later, w.debt)).toBe('resolved')
    // Adam's aim for the scene is no fact yet.
    expect(knownBy(later, 'heir')).toEqual([w.mara])
    // What the scene is to bring about is still told from his own changes.
    expect(later.bringAbout.some((c) => c.origin === 'adam')).toBe(true)

    // Continue from before the telling: the words after the cursor don't count.
    const early = sceneMemory(w.db, w.s2, { forWriter: true, soFar: 'Mara stood by the fire.' })
    expect(knownBy(early, 'will')).toEqual([w.mara])
    expect(status(early, w.debt)).toBe('open')
  })

  it('no longer tells the writer a secret is kept from someone the scene so far told', () => {
    const w = world()
    const must = (soFar?: string): string => {
      const input = gatherContextInput(w.db, w.s2, { addBelow: !!soFar }, {
        prefs: { spelling: 'UK', pov: '', tense: '', voiceNotes: '', avoidWords: [] },
        contextLength: null,
        creativity: 'steady',
        ...(soFar ? { soFar } : {})
      })
      return buildBlocks(input).find((b) => b.id === MUST_BLOCK)?.text ?? ''
    }
    expect(must()).toContain('Kept from Tobin: The will was burned')
    expect(must(WORDS)).not.toContain('The will was burned')
    // What is still kept from him stays.
    expect(must(WORDS)).toContain('Kept from Tobin: Mara is the heir')
  })
})
