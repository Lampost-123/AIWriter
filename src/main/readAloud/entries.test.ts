import { describe, expect, it, vi } from 'vitest'
import { defaultSpeechSettings } from '@shared/defaults'
import * as repo from '../db/repo'
import { memoryWorld } from '../../../tests/unit/helpers'
import { memberNamed } from './cast'
import { readingCast, setEntryReadAloud } from './entries'
import { planClips } from './plan'

vi.mock('../settings', () => ({ getWritingPrefs: () => ({ pov: '' }) }))

const voice = { design: 'An old, dry, amused voice.', voice: '' }

describe('the cast a scene is read with', () => {
  it('has a talking thing with a voice of its own beside the characters, so its lines are read in its voice', () => {
    const db = memoryWorld()
    repo.createEntry(db, 'character', { name: 'Mara' })
    const ring = repo.createEntry(db, 'item', { name: 'Ring', aliases: ['the ring'] })
    setEntryReadAloud(db, ring.id, { voice, say: '' })
    const text = '“Go on,” said the ring. “Take the floor, boy.”'
    const rc = readingCast(db, null, text)
    expect(rc.cast.all.map((c) => c.name)).toEqual(['Mara', 'Ring'])
    expect(rc.forAi(text).map((c) => c.name)).toEqual(['Ring'])
    // The writer's own tag names it, however the AI writes the name.
    expect(memberNamed(rc.cast.all, 'the ring')?.id).toBe(ring.id)
    expect(memberNamed(rc.cast.all, 'Ring (sly)')?.id).toBe(ring.id)
    const { clips } = planClips({ paragraphs: [{ pid: 'p1', text }], settings: defaultSpeechSettings(), cast: rc.cast, lexicon: [], marks: new Map() })
    expect(clips.map((c) => [c.who, c.clip.voiceDesign])).toEqual([
      ['Ring', voice.design],
      ['Narrator', ''],
      ['Ring', voice.design]
    ])
  })

  it('leaves things with no voice out: a place named in the narration is never taken for a speaker', () => {
    const db = memoryWorld()
    repo.createEntry(db, 'character', { name: 'Mara' })
    repo.createEntry(db, 'place', { name: 'Ferry' })
    repo.createEntry(db, 'item', { name: 'Ring' })
    const rc = readingCast(db, null, 'The Ferry rocked. “Go on,” said the ring.')
    expect(rc.cast.all.map((c) => c.name)).toEqual(['Mara'])
  })
})
