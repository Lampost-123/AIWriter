// Who the words put on stage, and who they only mention (two stand-in runs, 2026-10-19): Continue was told "Mother Agate:
// in the scene" because the landlady is Mother Rook; the plan's "everyone in the scene" and where things stand had Gale,
// Oskar Venn and Warden Vey in an inn on the coast road, because the words said "Gale would be watching it", "Oskar had
// said" and "the Warden's men". Invented test story.
import { describe, expect, it } from 'vitest'
import type { SceneState } from '@shared/continuity'
import { memoryWorld } from '../../../tests/unit/helpers'
import { keepStages, person, setCard, stage } from '../../../tests/unit/storyIndexWorld'
import * as repo from '../db/repo'
import type { Person } from '../keeper/presence'
import { buildStoryIndex, presentAt } from '.'
import { onStageIn, withoutMentioned, withoutMentions } from './there'

const who = (name: string, aliases: string[] = []): Person => ({ id: name, name, kind: 'character', aliases })
const AGATE = who('Mother Agate', ['Agate'])
const VEY = who('Warden Corran Vey', ['the Warden', 'Vey'])
const OSKAR = who('Oskar Venn', ['Oskar'])
const GALE = who('Gale', ['Master Gale'])

// Lines from the runs' scene so far.
const ROOK = 'The landlady, a broad woman called Mother Rook, looked at the state of them and put them in the back parlour, where the fire was.'
const ROAD =
  'The coast road was the quick way, and Edric had written not to take it. Gale would be watching it. Ash had said the Warden’s men were on it, and she had not asked him how he knew.'
const LINN = 'Carrow lay east and south of the Linn, Oskar had said, and she had no idea where the Linn was from here.'
const PUNT = 'In a day and a half the salt road would bring them round to the coast, and Oskar Venn’s punt would be there or not.'
const SPOKEN = '‘Then the survey’s worth nothing, and Gale can have Carrow Fell drawn any shape Warden Vey likes.’'

describe('who the words put on stage (2026-10-19)', () => {
  it('only mentioned: someone else’s name, a title alone, what is theirs, what they once said or may do', () => {
    expect(onStageIn(ROOK, AGATE)).toBe(false)
    expect(onStageIn(ROAD, GALE)).toBe(false)
    expect(onStageIn(ROAD, VEY)).toBe(false)
    expect(onStageIn(LINN, OSKAR)).toBe(false)
    expect(onStageIn(PUNT, OSKAR)).toBe(false)
    expect(onStageIn('They crossed at Oskar’s ferry.', OSKAR)).toBe(false)
    expect(onStageIn(SPOKEN, GALE)).toBe(false)
    expect(onStageIn(SPOKEN, VEY)).toBe(false)
    expect(onStageIn([ROOK, ROAD, LINN, PUNT, SPOKEN].join('\n\n'), AGATE)).toBe(false)
    expect(withoutMentions(ROOK, AGATE)).toContain('______ Rook')
  })

  it('there: by name or other name, doing something, their voice or hand, even with a title', () => {
    expect(onStageIn('Mother Agate came out of the toll-house with the lamp.', AGATE)).toBe(true)
    expect(onStageIn('Agate held the gate.', AGATE)).toBe(true)
    expect(onStageIn('The Warden came into the yard.', VEY)).toBe(true)
    expect(onStageIn('Warden Vey stood by the door.', VEY)).toBe(true)
    expect(onStageIn('Oskar held the rope and looked at the track.', OSKAR)).toBe(true)
    expect(onStageIn('Gale’s voice came through the door.', GALE)).toBe(true)
    expect(onStageIn(`${ROAD}\n\nGale stood in the doorway with his hat in his hand.`, GALE)).toBe(true)
  })

  it('where things stand as told: nobody off the card the words only mention', () => {
    const stand: SceneState = {
      time: 'evening',
      weather: '',
      light: '',
      characters: [person('Wren Hollis', { where: 'by the fire' }), person('Gale', { where: 'in the scene' })]
    }
    const scope = { onCard: [{ name: 'Wren Hollis', aliases: ['Wren'] }], cast: [{ name: 'Wren Hollis', aliases: ['Wren'] }, { name: 'Gale', aliases: [] }], words: ROAD }
    expect(withoutMentioned(stand, scope)?.characters.map((c) => c.name)).toEqual(['Wren Hollis'])
    const came = { ...scope, words: `${ROAD}\n\nGale stood in the doorway.` }
    expect(withoutMentioned(stand, came)).toBe(stand)
  })

  it('in the story index, they are named in the scene, not there, whatever where things stand lists', () => {
    const db = memoryWorld()
    const story = repo.listStories(db)[0]
    const scene = repo.getOutline(db, story.id).scenes[0].id
    const wren = repo.createEntry(db, 'character', { name: 'Wren Hollis', aliases: ['Wren'] }).id
    const ash = repo.createEntry(db, 'character', { name: 'Ash Penrose', aliases: ['Ash'] }).id
    const ids = [AGATE, VEY, OSKAR, GALE].map((p) => repo.createEntry(db, 'character', { name: p.name, aliases: p.aliases }).id)
    repo.saveSceneText(db, scene, null, ['Wren and Ash came in out of the rain.', ROOK, ROAD, LINN, PUNT].join('\n\n'))
    setCard(db, scene, { povId: wren, presentIds: [ash] })
    // A stage read that put Gale "in the scene" from those words.
    keepStages(db, { [scene]: stage(scene, [person('Gale', { where: 'in the scene' })], { 'gale|where': 'Gale would be watching it.' }) })
    buildStoryIndex(db, story.id)
    const at = presentAt(db, scene)!
    expect(at.present.map((p) => p.id).sort()).toEqual([wren, ash].sort())
    expect(at.mentioned.map((p) => p.id).sort()).toEqual([...ids].sort())
  })
})
