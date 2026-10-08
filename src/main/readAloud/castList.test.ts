// Settings › Read aloud › Cast (castList.ts): every character with their voice, whether the app gave it, and who
// "Give everyone without a voice a voice" is for.
import type Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import type { Entry } from '@shared/types'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import { castList, voicelessCharacters } from './castList'
import { castVoiceless, studioClip, type StudioVoice } from './studio'
import { autoVoicesOf, getEntryReadAloud, setEntryReadAloud } from './voiceStore'

const voices: StudioVoice[] = [
  { id: 'p001', gender: 'female', age: '26-35', pitch: 'mid', name: 'Clara' },
  { id: 'p002', gender: 'male', age: '46-55', pitch: 'low', name: 'Arthur' }
]

const character = (db: Database.Database, name: string, summary: string): Entry =>
  repo.createEntry(db, 'character', { name, summary }, { origin: 'adam' })

describe('the Cast list', () => {
  it('lists every character by name with their voice, and no other kinds', () => {
    const db = memoryWorld()
    const wren = character(db, 'Wren', 'A young keeper of the light.')
    const ansel = character(db, 'Ansel', 'An old harbour master.')
    repo.createEntry(db, 'place', { name: 'The Quay' }, { origin: 'adam' })
    setEntryReadAloud(db, ansel.id, { voice: { design: 'Gravelly and slow.', voice: '' }, say: '' })
    const list = castList(db, voices)
    expect(list.map((r) => r.name)).toEqual(['Ansel', 'Wren'])
    expect(list[0]).toMatchObject({
      id: ansel.id,
      auto: false,
      studioName: null,
      value: { voice: { design: 'Gravelly and slow.', voice: '' } }
    })
    expect(list[1]).toMatchObject({ id: wren.id, image: null, value: { voice: { design: '', voice: '' }, say: '' } })
  })

  it('says when the app gave a studio voice, until it is changed by hand', () => {
    const db = memoryWorld()
    const wren = character(db, 'Wren', 'A young woman who keeps the light.')
    const ansel = character(db, 'Ansel', 'An old man, the harbour master.')
    expect(voicelessCharacters(db).sort()).toEqual([wren.id, ansel.id].sort())
    const given = castVoiceless(db, voices, '', voicelessCharacters(db))
    expect(given.sort()).toEqual([wren.id, ansel.id].sort())
    expect(voicelessCharacters(db)).toEqual([])
    const byName = (n: string) => castList(db, voices).find((r) => r.name === n)!
    expect(byName('Wren')).toMatchObject({ auto: true, studioName: 'Clara', value: { voice: { voice: studioClip('p001') } } })
    expect(byName('Ansel')).toMatchObject({ auto: true, studioName: 'Arthur' })

    // Picked by hand (even the same kind of voice): no longer the app's.
    setEntryReadAloud(db, wren.id, { ...getEntryReadAloud(db, wren.id), voice: { design: '', voice: 'ava' } })
    expect(byName('Wren')).toMatchObject({ auto: false, studioName: null })
    expect(Object.keys(autoVoicesOf(db))).toEqual([ansel.id])
    // A description added beside the given voice keeps it the app's.
    setEntryReadAloud(db, ansel.id, { ...getEntryReadAloud(db, ansel.id), say: 'AN-sel' })
    expect(byName('Ansel').auto).toBe(true)
  })

  it('leaves a character with a description, or a voice picked, out of Give everyone a voice', () => {
    const db = memoryWorld()
    const iska = character(db, 'Iska', 'A smuggler.')
    const edric = character(db, 'Edric', 'A clerk.')
    character(db, 'Wren', 'A keeper.')
    setEntryReadAloud(db, iska.id, { voice: { design: 'Husky, quick.', voice: '' }, say: '' })
    setEntryReadAloud(db, edric.id, { voice: { design: '', voice: 'ava' }, say: '' })
    expect(voicelessCharacters(db).map((id) => repo.getEntry(db, id).name)).toEqual(['Wren'])
  })
})
