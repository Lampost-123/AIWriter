// Reading aloud's own casting (studio.ts castVoiceless): a character who speaks with no voice at all is given a studio
// voice that fits them, saved on their page.
import type Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import type { Entry } from '@shared/types'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import { castsByItself, castVoiceless, studioClip, type StudioVoice } from './studio'
import { keepVoice } from './autoVoice'
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

describe('casting by itself (as it reads, and over the whole world once the studio voices are here)', () => {
  const more: StudioVoice[] = [
    ...voices,
    { id: 'p006', gender: 'female', age: '26-35', pitch: 'mid' },
    { id: 'p007', gender: 'female', age: '46-55', pitch: 'mid' }
  ]
  const aged = (db: Database.Database, name: string, age: string): Entry =>
    repo.createEntry(db, 'character', { name, summary: 'A ferry clerk, a little too young for it.', fields: { pronouns: 'she/her', age } }, { origin: 'text' })

  it('goes by the Age field first: 34 is a woman of 26-35, mid-50s one of 46-55', () => {
    const db = memoryWorld()
    const wren = aged(db, 'Wren', '34')
    const odile = aged(db, 'Odile', 'mid-50s')
    castVoiceless(db, more, 'narrator', [wren.id, odile.id])
    expect(getEntryReadAloud(db, wren.id).voice.voice).toBe(studioClip('p006'))
    expect(getEntryReadAloud(db, odile.id).voice.voice).toBe(studioClip('p007'))
  })

  it('casts over a description the AI wrote, keeping it underneath, but never over one Adam wrote or changed', () => {
    const db = memoryWorld()
    const bram = character(db, 'Bram', 'An old man who mends nets.')
    const kit = character(db, 'Kit', 'A young man, a lamplighter.')
    const ivo = character(db, 'Ivo', 'A man who sells eels.')
    // The AI described Bram and Ivo; Adam then changed Ivo's. Kit's is Adam's own.
    keepVoice(db, bram.id, { design: 'A slow, cracked old voice.', say: '' })
    keepVoice(db, ivo.id, { design: 'A loud market voice.', say: '' })
    setEntryReadAloud(db, ivo.id, { ...getEntryReadAloud(db, ivo.id), voice: { design: 'A loud, wheedling market voice.', voice: '' } })
    setEntryReadAloud(db, kit.id, { ...getEntryReadAloud(db, kit.id), voice: { design: 'A bright, quick tenor.', voice: '' } })
    expect(castVoiceless(db, more, 'narrator', [bram.id, kit.id, ivo.id])).toEqual([bram.id])
    expect(getEntryReadAloud(db, bram.id).voice).toEqual({ design: 'A slow, cracked old voice.', voice: studioClip('p004') })
    expect(getEntryReadAloud(db, kit.id).voice).toEqual({ design: 'A bright, quick tenor.', voice: '' })
    expect(getEntryReadAloud(db, ivo.id).voice.voice).toBe('')
  })

  it('never replaces a voice Adam picked, and gives everyone a different voice', () => {
    const db = memoryWorld()
    const picked = character(db, 'Nell', 'A young woman.')
    setEntryReadAloud(db, picked.id, { ...getEntryReadAloud(db, picked.id), voice: { design: '', voice: 'Serena' } })
    const crowd = ['Ada', 'Bea', 'Cora', 'Dot'].map((n) => character(db, n, 'A woman of the harbour.'))
    const given = castVoiceless(db, more, studioClip('p001'), [picked.id, ...crowd.map((e) => e.id)])
    expect(given).not.toContain(picked.id)
    expect(getEntryReadAloud(db, picked.id).voice.voice).toBe('Serena')
    const clips = given.map((id) => getEntryReadAloud(db, id).voice.voice)
    expect(new Set(clips).size).toBe(clips.length)
    expect(clips).not.toContain(studioClip('p001'))
  })

  it('does nothing with either setting off', () => {
    expect(castsByItself({ castVoices: true, studioVoices: true })).toBe(true)
    expect(castsByItself({ castVoices: false, studioVoices: true })).toBe(false)
    expect(castsByItself({ castVoices: true, studioVoices: false })).toBe(false)
  })
})
