// Reading aloud's own casting (studio.ts castVoiceless): a character who speaks with no voice at all is given a studio
// voice that fits them, saved on their page.
import type Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import type { Entry } from '@shared/types'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import { castVoiceless, studioClip, type StudioVoice } from './studio'
import { getEntryReadAloud, setEntryReadAloud } from './voiceStore'

const voices: StudioVoice[] = [
  { id: 'p001', gender: 'female', age: '18-25', pitch: 'high' },
  { id: 'p002', gender: 'female', age: '56-65', pitch: 'low' },
  { id: 'p003', gender: 'male', age: '26-35', pitch: 'mid' },
  { id: 'p004', gender: 'male', age: '66-75', pitch: 'low' },
  { id: 'p005', gender: 'female', age: '36-45', pitch: 'mid' }
]

const character = (db: Database.Database, name: string, summary: string): Entry =>
  repo.createEntry(db, 'character', { name, summary }, { origin: 'text' })

describe('a character who speaks with no voice', () => {
  it('is given a studio voice that fits them, on their page, never the narrator’s or one taken', () => {
    const db = memoryWorld()
    const mara = character(db, 'Mara', 'A young woman, a courier.')
    const tomas = character(db, 'Tomas', 'An old man, the ferryman.')
    const ines = character(db, 'Ines', 'She runs the inn.')
    setEntryReadAloud(db, ines.id, { ...getEntryReadAloud(db, ines.id), voice: { design: '', voice: studioClip('p002') } })
    const given = castVoiceless(db, voices, studioClip('p001'), [mara.id, tomas.id, ines.id])
    expect(given.sort()).toEqual([mara.id, tomas.id].sort())
    // Mara would fit p001 best, but it is the narrator's, and p002 is Ines's.
    expect(getEntryReadAloud(db, mara.id).voice.voice).toBe(studioClip('p005'))
    expect(getEntryReadAloud(db, tomas.id).voice.voice).toBe(studioClip('p004'))
    // Ines keeps hers.
    expect(getEntryReadAloud(db, ines.id).voice.voice).toBe(studioClip('p002'))
  })

  it('leaves a character with a description of how they sound alone, and gives nobody anything with no studio voices', () => {
    const db = memoryWorld()
    const sam = character(db, 'Sam', 'A night-bus driver.')
    setEntryReadAloud(db, sam.id, { ...getEntryReadAloud(db, sam.id), voice: { design: 'A warm, tired baritone.', voice: '' } })
    expect(castVoiceless(db, voices, 'narrator', [sam.id])).toEqual([])
    expect(getEntryReadAloud(db, sam.id).voice).toEqual({ design: 'A warm, tired baritone.', voice: '' })
    const tom = character(db, 'Tom', 'A boy.')
    expect(castVoiceless(db, [], 'narrator', [tom.id])).toEqual([])
    expect(getEntryReadAloud(db, tom.id).voice.voice).toBe('')
  })
})
