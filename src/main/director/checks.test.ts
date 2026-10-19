// Directed writing's free checks over a stretch, in a real world (no AI call): someone dead speaking, the card's place
// named wrong, a piece of clothing already off, and a thing the story index has elsewhere; each says whether it is in the
// stretch's last paragraph (a retake can put it right). Nothing in a stretch that keeps to the record. Invented text only.
import { afterEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import type { ID, SceneCard } from '@shared/types'
import type { SceneState } from '@shared/continuity'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { gatherContextInput } from '../ai/gather'
import { checkStretch, checkWorld } from './checks'

let db: Database.Database | null = null
afterEach(() => {
  db?.close()
  db = null
})

/** Two scenes: Tobin dies in the first; the second, at St Anne's church in Ashby, is being written with Mara. */
function world() {
  db = memoryWorld()
  const story = repo.listStories(db)[0]
  const outline = repo.getOutline(db, story.id)
  const scenes = [outline.scenes[0].id, repo.createScene(db, outline.chapters[0].id).id]
  const ashby = repo.createEntry(db, 'place', { name: 'Ashby' }).id
  const anne = repo.createEntry(db, 'place', { name: "St Anne's church, Ashby", parentId: ashby }).id
  const mara = repo.createEntry(db, 'character', { name: 'Mara', fields: { pronouns: 'she/her' } }).id
  const tobin = repo.createEntry(db, 'character', { name: 'Tobin', fields: { pronouns: 'he/him' } }).id
  const card = (sceneId: ID, c: Partial<SceneCard>): void => void repo.updateSceneCard(db!, sceneId, { ...repo.getScene(db!, sceneId).card, ...c })
  repo.saveSceneText(db, scenes[0], null, 'Tobin walked into the fire.')
  mem.insertChange(db, { kind: 'update', payload: { note: 'died in the fire' }, entryId: tobin, anchor: 'scene', sceneId: scenes[0], origin: 'adam' })
  card(scenes[1], { povId: mara, presentIds: [mara], locationId: anne })
  const input = gatherContextInput(db, scenes[1], { targetWords: 400, creativity: 'balanced', direction: '' }, {
    prefs: { spelling: 'UK', pov: 'Close third', tense: 'Past', voiceNotes: '', avoidWords: [] },
    contextLength: 32000,
    creativity: 'balanced'
  })
  // Where things stand as the scene begins, as the writer is told it: Mara's coat is off, on the peg.
  const stand: SceneState = {
    time: 'evening',
    weather: '',
    light: '',
    characters: [{ name: 'Mara', where: 'by the font', posture: '', holding: '', condition: '', mood: '', lastAction: '', clothes: [{ name: 'grey coat', state: 'off, on the peg by the door' }] }]
  }
  input.continuity = stand
  return { db, scenes, input, mara, tobin }
}

describe('the free checks over a stretch', () => {
  it('find the dead speaking, the place named wrong and a coat already off, saying which are in the last paragraph', () => {
    const w = world()
    const checks = checkWorld(w.db, w.scenes[1], w.input, '')
    const stretch = [
      'Mara knelt in the cold nave of St Chad’s and waited.',
      '“You took your time,” said Tobin.',
      'Mara pulled her coat tighter against the draught.'
    ].join('\n\n')
    // The draft's own words before the stretch took the coat off (where things stand at a new scene's start never tells
    // a piece taken off in the scene before: shared/continuity's reach).
    const found = checkStretch(checks, { before: 'Mara hung her coat on the peg by the door.', stretch })
    const by = (rule: string) => found.find((f) => f.rule === rule)
    expect(by('place-name')).toMatchObject({ mustFix: true, inLast: false })
    expect(by('place-name')?.message).toContain('St Chad’s')
    expect(by('dead')).toMatchObject({ mustFix: true, inLast: false, quote: '“You took your time,” said Tobin.' })
    expect(by('dead')?.message).toContain('Tobin died in')
    expect(by('clothes')).toMatchObject({ mustFix: true, inLast: true })
    expect(by('clothes')?.message).toBe('Mara’s coat is off, but here: “pulled her coat tighter against”.')
  })

  it('a piece the writer was told is off, carrying on from the scene so far', () => {
    const w = world()
    // Add below: where things stand at the end of the scene so far, from its own words.
    w.input.continuityAtSoFar = true
    w.input.continuityAtStart = null
    const checks = checkWorld(w.db, w.scenes[1], w.input, 'Mara shrugged off her grey coat and hung it on the peg by the door.')
    const found = checkStretch(checks, { before: 'Mara shrugged off her grey coat and hung it on the peg by the door.', stretch: 'She buttoned her coat to the chin.' })
    expect(found.map((f) => f.rule)).toEqual(['clothes'])
  })

  it('say nothing of a stretch that keeps to the record', () => {
    const w = world()
    const checks = checkWorld(w.db, w.scenes[1], w.input, '')
    const stretch = 'Mara knelt in the cold nave of St Anne’s and waited.\n\nShe remembered Tobin, and how he had laughed.\n\nMara took her coat from the peg and put her coat on.'
    expect(checkStretch(checks, { before: '', stretch })).toEqual([])
  })
})
