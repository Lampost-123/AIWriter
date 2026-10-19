// Continue's "everyone in the scene" (stand-in runs, 2026-10-19): every Continue request listed "Mother Agate: in the
// scene" (the landlady is Mother Rook), and later Oskar Venn and Warden Vey, in an inn on the coast road where none of
// them was. Only the card's people and whoever the words put there are listed. Invented test story.
import { describe, expect, it, vi } from 'vitest'

vi.mock('../world', () => ({ db: () => null, maybeCurrentWorld: () => null }))
vi.mock('../events', () => ({ emit: () => undefined }))
vi.mock('../readAloud', () => ({ noteWriterSpeakers: () => undefined, noteGenerationSpeakers: () => undefined }))
vi.mock('../retrieval', () => ({ recallForBriefing: async () => null, findInStory: async () => null }))

import { memoryWorld } from '../../../tests/unit/helpers'
import { setCard } from '../../../tests/unit/storyIndexWorld'
import * as repo from '../db/repo'
import { sceneMemory } from '../memory/scene'
import { continuePeople } from '.'

function world() {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const o = repo.getOutline(db, story.id)
  const bridge = o.scenes[0].id
  const inn = repo.createScene(db, o.chapters[0].id, { title: 'The inn on the coast road' }).id
  const wren = repo.createEntry(db, 'character', { name: 'Wren Hollis', aliases: ['Wren'] }).id
  const ash = repo.createEntry(db, 'character', { name: 'Ash Penrose', aliases: ['Ash'] }).id
  const agate = repo.createEntry(db, 'character', { name: 'Mother Agate', aliases: ['Agate'] }).id
  const oskar = repo.createEntry(db, 'character', { name: 'Oskar Venn', aliases: ['Oskar'] }).id
  const vey = repo.createEntry(db, 'character', { name: 'Warden Corran Vey', aliases: ['the Warden', 'Vey'] }).id
  const gale = repo.createEntry(db, 'character', { name: 'Gale' }).id
  const toll = repo.createEntry(db, 'place', { name: 'Haldon Bridge' }).id
  // Everyone was at the bridge in the scene before.
  repo.saveSceneText(db, bridge, null, 'Mother Agate took the toll. Oskar Venn, Gale and Warden Corran Vey crossed behind them.')
  setCard(db, bridge, { povId: wren, presentIds: [ash, agate, oskar, gale, vey], locationId: toll })
  setCard(db, inn, { povId: wren, presentIds: [ash] })
  return { db, inn, wren, ash, gale }
}

const BEFORE = [
  'The inn stood on its own where the coast road dropped towards the sea. The landlady, a broad woman called Mother Rook, put them in the back parlour, where the fire was.',
  'Carrow lay east and south of the Linn, Oskar had said. The coast road was the quick way, and Gale would be watching it. Ash had said the Warden’s men were on it.',
  'Wren set the case on the settle and sat beside it.'
].join('\n\n')

describe('Continue’s everyone in the scene (2026-10-19)', () => {
  it('the card’s people, never someone only mentioned: another’s name, what is theirs, what they once said or may do', () => {
    const w = world()
    const memory = sceneMemory(w.db, w.inn, { forWriter: true })
    const card = repo.getScene(w.db, w.inn).card
    const lines = continuePeople(w.db, { sceneId: w.inn, before: BEFORE, after: '' }, memory, card, null)
    expect(lines.some((l) => l.startsWith('Wren Hollis'))).toBe(true)
    for (const name of ['Mother Agate', 'Oskar Venn', 'Warden Corran Vey', 'Gale']) expect(lines.filter((l) => l.startsWith(name))).toEqual([])
    // Gale walks in: now he is there.
    const came = continuePeople(w.db, { sceneId: w.inn, before: `${BEFORE}\n\nGale stood in the doorway with his hat in his hand.`, after: '' }, memory, card, null)
    expect(came.some((l) => l.startsWith('Gale'))).toBe(true)
  })
})
