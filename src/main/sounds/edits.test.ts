import { describe, expect, it } from 'vitest'
import type { CueAnchor, SceneCue, SoundEdits } from '@shared/contracts/sounds'
import * as repo from '../db/repo'
import { memoryWorld } from '../../../tests/unit/helpers'
import { cleanEdits, cueInputOf, editCue, saveSceneEdits, sceneEdits } from './edits'
import { sceneCues, type MarkedCue } from './scene'

const paragraphs = [
  { pid: 'p1', text: 'Rain hammered the roof.' },
  { pid: 'p2', text: 'The door slammed. A dog barked.' },
  { pid: 'p3', text: 'She went inside.' }
]
const on = (pid: string, word: string): CueAnchor => {
  const text = paragraphs.find((p) => p.pid === pid)!.text
  const from = text.indexOf(word)
  return { pid, from, to: from + word.length, words: word }
}
const ai = new Map<string, MarkedCue[]>([
  ['p1', [{ id: 'ai:rain', kind: 'ambience', description: 'steady rain on a roof', at: on('p1', 'Rain'), until: null }]],
  [
    'p2',
    [
      { id: 'ai:door', kind: 'effect', description: 'a door slamming', at: on('p2', 'slammed'), until: null },
      { id: 'ai:dog', kind: 'effect', description: 'a dog barking', at: on('p2', 'barked'), until: null }
    ]
  ]
])
const cuesWith = (edits: SoundEdits): SceneCue[] => sceneCues({ paragraphs, ai, edits, sound: () => null })
let n = 0
const newId = (): string => `n${++n}`

describe('Adam’s changes to a scene’s sounds', () => {
  it('makes the paragraph his: the AI’s sounds there are kept as his, then the change is made', () => {
    const none: SoundEdits = { owned: {} }
    const input = cueInputOf({ kind: 'effect', description: 'a heavy door slamming shut', at: on('p2', 'slammed') }, paragraphs)
    const edits = editCue({ edits: none, cues: cuesWith(none), cueId: 'ai:door', cue: input, newId })
    expect(Object.keys(edits.owned)).toEqual(['p2'])
    expect(edits.owned.p2!.map((c) => [c.id, c.description, c.origin])).toEqual([
      ['ai:door', 'a heavy door slamming shut', 'adam'],
      ['ai:dog', 'a dog barking', 'adam']
    ])
    // The AI's marks in p2 no longer count; its others still do.
    const after = cuesWith(edits)
    expect(after.map((c) => [c.id, c.origin])).toEqual([
      ['ai:rain', 'ai'],
      ['ai:door', 'adam'],
      ['ai:dog', 'adam']
    ])
    expect(none.owned).toEqual({})
  })

  it('adds a sound with an id of its own', () => {
    const edits = editCue({
      edits: { owned: {} },
      cues: cuesWith({ owned: {} }),
      cueId: null,
      cue: cueInputOf({ kind: 'effect', description: 'footsteps', at: on('p3', 'went') }, paragraphs),
      newId
    })
    expect(edits.owned.p3).toEqual([
      { id: expect.stringMatching(/^adam:n\d+$/), kind: 'effect', description: 'footsteps', soundId: '', at: on('p3', 'went'), origin: 'adam' }
    ])
  })

  it('keeps a paragraph his with no sounds when the last is removed', () => {
    let edits: SoundEdits = { owned: {} }
    edits = editCue({ edits, cues: cuesWith(edits), cueId: 'ai:rain', cue: null, newId })
    expect(edits.owned).toEqual({ p1: [] })
    expect(cuesWith(edits).map((c) => c.id)).toEqual(['ai:door', 'ai:dog'])
  })

  it('moves a sound to another paragraph, making both his', () => {
    const none: SoundEdits = { owned: {} }
    const edits = editCue({
      edits: none,
      cues: cuesWith(none),
      cueId: 'ai:dog',
      cue: cueInputOf({ kind: 'effect', description: 'a dog barking', at: on('p3', 'inside') }, paragraphs),
      newId
    })
    expect(edits.owned.p2!.map((c) => c.id)).toEqual(['ai:door'])
    expect(edits.owned.p3!.map((c) => c.id)).toEqual(['ai:dog'])
  })

  it('refuses a sound that isn’t there', () => {
    expect(() => editCue({ edits: { owned: {} }, cues: [], cueId: 'ai:nope', cue: null, newId })).toThrow("That sound isn't there any more.")
  })
})

describe('a sound from the Sounds view', () => {
  it('is checked against the paragraph’s words now', () => {
    const c = cueInputOf({ kind: 'effect', description: '  a   bark ', at: { pid: 'p2', from: 24, to: 99, words: 'x' } }, paragraphs)
    expect(c).toEqual({ kind: 'effect', description: 'a bark', at: { pid: 'p2', from: 24, to: 31, words: 'barked.' } })
    // Only words to go by: found nearest where they were said to be.
    expect(cueInputOf({ kind: 'effect', description: 'bark', at: { pid: 'p2', from: 0, to: 0, words: 'dog' } }, paragraphs).at).toEqual(on('p2', 'dog'))
  })

  it('keeps an ambience’s end only after its start', () => {
    const ok = cueInputOf({ kind: 'ambience', description: 'rain', at: on('p1', 'Rain'), until: on('p3', 'inside') }, paragraphs)
    expect(ok.until).toEqual(on('p3', 'inside'))
    const back = cueInputOf({ kind: 'ambience', description: 'rain', at: on('p2', 'dog'), until: on('p1', 'Rain') }, paragraphs)
    expect(back.until).toBeNull()
    expect(cueInputOf({ kind: 'effect', description: 'bang', at: on('p1', 'Rain'), until: on('p3', 'inside') }, paragraphs)).not.toHaveProperty('until')
  })

  it('says in plain words what is wrong', () => {
    expect(() => cueInputOf({ kind: 'music', description: 'x', at: on('p1', 'Rain') }, paragraphs)).toThrow('Choose whether it is a sound effect or ambience.')
    expect(() => cueInputOf({ kind: 'effect', description: ' ', at: on('p1', 'Rain') }, paragraphs)).toThrow('Describe the sound first')
    expect(() => cueInputOf({ kind: 'effect', description: 'x', at: { pid: 'gone', from: 0, to: 1, words: 'x' } }, paragraphs)).toThrow(
      "That place isn't in the scene any more."
    )
  })
})

describe('Adam’s sounds in the world', () => {
  it('are kept in the world’s meta by scene, and can be put back (Undo)', () => {
    const db = memoryWorld()
    expect(sceneEdits(db, 's1')).toEqual({ owned: {} })
    const before = repo.getMeta(db, 'updated_at')
    const edits = editCue({ edits: { owned: {} }, cues: cuesWith({ owned: {} }), cueId: 'ai:rain', cue: null, newId })
    saveSceneEdits(db, 's1', edits)
    saveSceneEdits(db, 's2', { owned: { x: [] } })
    expect(sceneEdits(db, 's1')).toEqual({ owned: { p1: [] } })
    expect(JSON.parse(repo.getMeta(db, 'sounds')!)).toEqual({ s1: { owned: { p1: [] } }, s2: { owned: { x: [] } } })
    // Backups see the world changed.
    expect(repo.getMeta(db, 'updated_at')).not.toBe(before)
    // Undo: the scene's edits as they were (none): its entry goes.
    saveSceneEdits(db, 's1', { owned: {} })
    expect(JSON.parse(repo.getMeta(db, 'sounds')!)).toEqual({ s2: { owned: { x: [] } } })
  })

  it('reads only what could be a sound', () => {
    expect(
      cleanEdits({
        owned: {
          p1: [
            { id: 'adam:1', kind: 'effect', description: 'bang', at: { pid: 'p1', from: 0, to: 4, words: 'Rain' }, extra: 1 },
            { id: '../x', kind: 'effect', description: 'bang', at: { pid: 'p1', from: 0, to: 4, words: 'Rain' } },
            { id: 'adam:2', kind: 'effect', description: 'bang', at: { pid: 'p9', from: 0, to: 4, words: 'Rain' } },
            { id: 'adam:3', kind: 'song', description: 'la', at: { pid: 'p1', from: 0, to: 1, words: 'R' } }
          ],
          p2: 'nonsense'
        }
      })
    ).toEqual({
      owned: { p1: [{ id: 'adam:1', kind: 'effect', description: 'bang', soundId: '', at: { pid: 'p1', from: 0, to: 4, words: 'Rain' }, origin: 'adam' }] }
    })
    expect(cleanEdits(null)).toEqual({ owned: {} })
  })
})

describe('a sound’s volume and mute, and muting a scene', () => {
  it('sets a sound’s volume and mute like any change: its paragraph becomes Adam’s', () => {
    const none: SoundEdits = { owned: {} }
    const input = cueInputOf({ kind: 'effect', description: 'a door slamming', at: on('p2', 'slammed'), volume: 5, muted: true }, paragraphs)
    expect(input).toMatchObject({ volume: 2, muted: true })
    const edits = editCue({ edits: none, cues: cuesWith(none), cueId: 'ai:door', cue: input, newId })
    expect(edits.owned.p2!.find((c) => c.id === 'ai:door')).toMatchObject({ volume: 2, muted: true, origin: 'adam' })
    // The dog, copied in with it, is as made.
    expect(edits.owned.p2!.find((c) => c.id === 'ai:dog')).not.toHaveProperty('volume')
    expect(cuesWith(edits).find((c) => c.id === 'ai:door')).toMatchObject({ volume: 2, muted: true })
  })

  it('keeps the volume and mute a change doesn’t mention, and drops them back to as made', () => {
    const none: SoundEdits = { owned: {} }
    let edits = editCue({
      edits: none,
      cues: cuesWith(none),
      cueId: 'ai:door',
      cue: cueInputOf({ kind: 'effect', description: 'a door slamming', at: on('p2', 'slammed'), volume: 0.1, muted: true }, paragraphs),
      newId
    })
    edits = editCue({
      edits,
      cues: cuesWith(edits),
      cueId: 'ai:door',
      cue: cueInputOf({ kind: 'effect', description: 'a heavy door slamming', at: on('p2', 'slammed') }, paragraphs),
      newId
    })
    expect(edits.owned.p2!.find((c) => c.id === 'ai:door')).toMatchObject({ description: 'a heavy door slamming', volume: 0.25, muted: true })
    edits = editCue({
      edits,
      cues: cuesWith(edits),
      cueId: 'ai:door',
      cue: cueInputOf({ kind: 'effect', description: 'a heavy door slamming', at: on('p2', 'slammed'), volume: 1, muted: false }, paragraphs),
      newId
    })
    const door = edits.owned.p2!.find((c) => c.id === 'ai:door')!
    expect(door).not.toHaveProperty('volume')
    expect(door).not.toHaveProperty('muted')
  })

  it('keeps a scene muted through Adam’s changes, and in the world with no other edits', () => {
    const muted: SoundEdits = { owned: {}, muted: true }
    expect(editCue({ edits: muted, cues: cuesWith(muted), cueId: 'ai:rain', cue: null, newId })).toEqual({ owned: { p1: [] }, muted: true })
    const db = memoryWorld()
    saveSceneEdits(db, 's1', muted)
    expect(sceneEdits(db, 's1')).toEqual({ owned: {}, muted: true })
    saveSceneEdits(db, 's1', { owned: {} })
    expect(JSON.parse(repo.getMeta(db, 'sounds')!)).toEqual({})
    expect(cleanEdits({ owned: {}, muted: 'yes' })).toEqual({ owned: {} })
  })

  it('reads a kept volume and mute', () => {
    const at = { pid: 'p1', from: 0, to: 4, words: 'Rain' }
    expect(
      cleanEdits({ owned: { p1: [{ id: 'adam:1', kind: 'effect', description: 'bang', at, volume: 7, muted: 'no' }] } }).owned.p1![0]
    ).toEqual({ id: 'adam:1', kind: 'effect', description: 'bang', soundId: '', at, origin: 'adam', volume: 2 })
  })
})
