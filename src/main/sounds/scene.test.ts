import { describe, expect, it } from 'vitest'
import type { PlannedClip } from '@shared/contracts/readAloud'
import type { CueAnchor, SceneCue, SoundEdits } from '@shared/contracts/sounds'
import { textHash } from '../readAloud/marks'
import { ambienceAt, cleanVolume, clipSounds, relocate, sceneCues, soundsAhead, type MarkedCue, type Paragraph } from './scene'

const paragraphs: Paragraph[] = [
  { pid: 'p1', text: 'Rain hammered the roof of the inn.' },
  { pid: 'p2', text: 'Inside, the fire crackled. The door slammed shut.' },
  { pid: 'p3', text: 'She stepped out into the street.' },
  { pid: 'p4', text: 'Thunder rolled over the hills.' }
]
const textOf = (pid: string): string => paragraphs.find((p) => p.pid === pid)!.text

/** An anchor on a word of a paragraph. */
const on = (pid: string, word: string): CueAnchor => {
  const from = textOf(pid).indexOf(word)
  if (from < 0) throw new Error(`no ${word} in ${pid}`)
  return { pid, from, to: from + word.length, words: word }
}

const cue = (id: string, kind: SceneCue['kind'], at: CueAnchor, o: Partial<SceneCue> = {}): SceneCue => ({
  id,
  kind,
  description: id,
  soundId: `s-${id}`,
  at,
  ...(kind === 'ambience' ? { until: null } : {}),
  origin: 'ai',
  placed: true,
  sound: 'ready',
  retake: null,
  ...o
})

/** A clip of a paragraph, [from, to) of its words. */
const clip = (pid: string, from: number, to = textOf(pid).length): PlannedClip => ({
  key: `${pid}:${from}`,
  pid,
  from,
  to,
  sentences: [[from, to]],
  who: 'Narrator',
  how: '',
  restMs: 0,
  waits: false,
  clip: { input: '', voice: '', voiceDesign: '', instruct: '', delivery: '', pace: '', gentle: false, sounds: false }
})

describe('finding a sound’s words again', () => {
  it('keeps them where they are, or finds the nearest, or keeps the place', () => {
    const text = 'the door, then the door again'
    expect(relocate(text, { pid: 'p', from: 4, to: 8, words: 'door' })).toEqual({ anchor: { pid: 'p', from: 4, to: 8, words: 'door' }, placed: true })
    // Words were added before it: the nearest "door" to where it was.
    expect(relocate('Then ' + text, { pid: 'p', from: 20, to: 24, words: 'door' }).anchor.from).toBe(24)
    expect(relocate('THE DOOR', { pid: 'p', from: 0, to: 3, words: 'door' })).toMatchObject({ anchor: { from: 4, to: 8, words: 'DOOR' }, placed: true })
    expect(relocate('a gate', { pid: 'p', from: 20, to: 24, words: 'door' })).toEqual({ anchor: { pid: 'p', from: 6, to: 6, words: '' }, placed: false })
  })
})

describe('a scene’s sounds', () => {
  const marked = (id: string, kind: MarkedCue['kind'], at: CueAnchor, until: CueAnchor | null = null): MarkedCue => ({
    id,
    kind,
    description: `${id} sound`,
    at,
    until,
    ...(until && until.pid !== at.pid ? { untilHash: textHash(textOf(until.pid)) } : {})
  })
  const sound = (_kind: string, description: string) => ({ id: `id-${description}`, state: 'ready' as const })

  it('lists the AI’s and Adam’s in reading order, each with its library sound', () => {
    const edits: SoundEdits = {
      owned: {
        p3: [{ id: 'adam:1', kind: 'effect', description: 'footsteps on cobbles', soundId: '', at: on('p3', 'stepped'), origin: 'adam' }]
      }
    }
    const ai = new Map([
      ['p2', [marked('ai:door', 'effect', on('p2', 'slammed'))]],
      ['p1', [marked('ai:rain', 'ambience', on('p1', 'Rain'), on('p3', 'out'))]],
      // Adam's paragraph: the AI's marks there no longer count.
      ['p3', [marked('ai:gone', 'effect', on('p3', 'street'))]]
    ])
    const cues = sceneCues({ paragraphs, ai, edits, sound })
    expect(cues.map((c) => [c.id, c.origin, c.soundId])).toEqual([
      ['ai:rain', 'ai', 'id-ai:rain sound'],
      ['ai:door', 'ai', 'id-ai:door sound'],
      ['adam:1', 'adam', 'id-footsteps on cobbles']
    ])
    expect(cues[0]!.until).toEqual(on('p3', 'out'))
  })

  it('drops an ambience’s end whose paragraph’s words changed and can’t be found', () => {
    const changed = paragraphs.map((p) => (p.pid === 'p3' ? { ...p, text: 'She went in.' } : p))
    const ai = new Map([['p1', [marked('ai:rain', 'ambience', on('p1', 'Rain'), on('p3', 'out'))]]])
    expect(sceneCues({ paragraphs: changed, ai, edits: null, sound })[0]!.until).toBeNull()
    const moved = paragraphs.map((p) => (p.pid === 'p3' ? { ...p, text: 'Then she stepped out.' } : p))
    expect(sceneCues({ paragraphs: moved, ai, edits: null, sound })[0]!.until).toMatchObject({ pid: 'p3', words: 'out', from: 17 })
  })

  it('finds Adam’s sounds again after his words changed, and says when it couldn’t', () => {
    const edits: SoundEdits = {
      owned: { p2: [{ id: 'adam:1', kind: 'effect', description: 'door', soundId: '', at: { pid: 'p2', from: 3, to: 10, words: 'gunshot' }, origin: 'adam' }] }
    }
    const [c] = sceneCues({ paragraphs, ai: new Map(), edits, sound: () => null })
    expect(c).toMatchObject({ placed: false, soundId: '', sound: 'waiting', at: { from: 3, to: 10, words: 'ide, th' } })
  })
})

describe('the sounds on a reading’s clips', () => {
  const rain = cue('rain', 'ambience', on('p1', 'Rain'))
  const fire = cue('fire', 'ambience', on('p2', 'fire'), { until: on('p3', 'out') })
  const door = cue('door', 'effect', on('p2', 'slammed'))
  const thunder = cue('thunder', 'effect', on('p4', 'Thunder'))
  const cues = [rain, fire, door, thunder]
  const clips = [clip('p1', 0), clip('p2', 0, 26), clip('p2', 27), clip('p3', 0), clip('p4', 0)]

  it('puts each sound on the clip that holds its word, and the ambience playing as each clip starts', () => {
    const out = clipSounds(clips, cues, paragraphs)
    expect(out.map((c) => c.bed)).toEqual([null, 's-rain', 's-fire', 's-fire', null])
    expect(out.map((c) => c.sounds!.map((s) => `${s.edge}:${s.cueId}@${s.at}`))).toEqual([
      ['start:rain@0'],
      [`start:fire@${textOf('p2').indexOf('fire')}`],
      [`fire:door@${textOf('p2').indexOf('slammed')}`],
      [`end:fire@${textOf('p3').indexOf('out')}`],
      ['fire:thunder@0']
    ])
  })

  it('works out what is playing from the start of the scene when reading starts part way', () => {
    // Reading starts at the second clip of p2: the fire (which replaced the rain) is playing.
    const out = clipSounds(clips.slice(2), cues, paragraphs)
    expect(out.map((c) => c.bed)).toEqual(['s-fire', 's-fire', null])
    expect(out[0]!.sounds!.map((s) => s.cueId)).toEqual(['door'])
    // Sounds before where reading starts don't fire.
    expect(out.flatMap((c) => c.sounds!.map((s) => s.cueId))).not.toContain('rain')
  })

  it('puts a sound between clips on the next clip, at its start', () => {
    const gappy = [clip('p2', 0, 20), clip('p2', 40), clip('p4', 0)]
    const between = cue('crack', 'effect', { pid: 'p2', from: 30, to: 33, words: 'The' })
    const inGap = cue('step', 'effect', on('p3', 'stepped'))
    const out = clipSounds(gappy, [between, inGap], paragraphs)
    expect(out[1]!.sounds).toEqual([{ cueId: 'crack', soundId: 's-crack', edge: 'fire', volume: 1, at: 40 }])
    expect(out[2]!.sounds).toEqual([{ cueId: 'step', soundId: 's-step', edge: 'fire', volume: 1, at: 0 }])
  })

  it('lets a new ambience replace the last, and ignores the end of one already replaced', () => {
    const long = cue('rain', 'ambience', on('p1', 'Rain'), { until: on('p4', 'hills') })
    const out = clipSounds(clips, [long, fire], paragraphs)
    expect(out.map((c) => c.bed)).toEqual([null, 's-rain', 's-fire', 's-fire', null])
    // The rain's end in p4 comes after the fire replaced it (and ended): nothing to end.
    expect(out[4]!.sounds).toEqual([])
  })

  it('plays nothing for a sound that couldn’t be made, but still marks where it would be', () => {
    const failed = cue('rain', 'ambience', on('p1', 'Rain'), { sound: 'failed' })
    const out = clipSounds(clips, [failed], paragraphs)
    expect(out[0]!.sounds).toEqual([{ cueId: 'rain', soundId: '', edge: 'start', volume: 1, at: 0 }])
    expect(out[1]!.bed).toBeNull()
  })

  it('gives every clip an empty list when the scene has no sounds', () => {
    expect(clipSounds(clips, [], paragraphs).every((c) => c.bed === null && c.sounds!.length === 0)).toBe(true)
    expect(clipSounds([], cues, paragraphs)).toEqual([])
  })

  it('says what is playing at a place, and the sounds ahead of it nearest first', () => {
    expect(ambienceAt(cues, paragraphs, 'p3', 0)?.id).toBe('fire')
    expect(ambienceAt(cues, paragraphs, 'p4', 0)).toBeNull()
    expect(ambienceAt(cues, paragraphs, 'p1', 0)).toBeNull()
    expect(soundsAhead(cues, paragraphs, 'p2', 10).map((c) => c.id)).toEqual(['rain', 'fire', 'door', 'thunder'])
    expect(soundsAhead(cues, paragraphs, 'p3', 0).map((c) => c.id)).toEqual(['fire', 'thunder'])
  })
})

describe('each sound’s volume and mute, and a muted scene', () => {
  const rain = cue('rain', 'ambience', on('p1', 'Rain'), { volume: 0.5 })
  const fire = cue('fire', 'ambience', on('p2', 'fire'), { until: on('p3', 'out') })
  const door = cue('door', 'effect', on('p2', 'slammed'), { volume: 1.5 })
  const thunder = cue('thunder', 'effect', on('p4', 'Thunder'))
  const clips = [clip('p1', 0), clip('p2', 0, 26), clip('p2', 27), clip('p3', 0), clip('p4', 0)]

  it('carries each sound’s volume, and the ambience’s as the bed’s', () => {
    const out = clipSounds(clips, [rain, door, thunder], paragraphs)
    expect(out[0]!.sounds).toEqual([{ cueId: 'rain', soundId: 's-rain', edge: 'start', volume: 0.5, at: 0 }])
    expect(out[2]!.sounds![0]).toMatchObject({ cueId: 'door', volume: 1.5 })
    expect(out[4]!.sounds![0]).toMatchObject({ cueId: 'thunder', volume: 1 })
    expect(out.map((c) => [c.bed, c.bedVolume])).toEqual([
      [null, undefined],
      ['s-rain', 0.5],
      ['s-rain', 0.5],
      ['s-rain', 0.5],
      ['s-rain', 0.5]
    ])
  })

  it('leaves a muted sound out altogether: a muted ambience neither starts, replaces nor ends anything', () => {
    const out = clipSounds(clips, [rain, { ...fire, muted: true }, { ...door, muted: true }, thunder], paragraphs)
    expect(out.flatMap((c) => c.sounds!.map((s) => s.cueId))).toEqual(['rain', 'thunder'])
    // The rain plays on through where the muted fire would have replaced it, and past its end.
    expect(out.map((c) => c.bed)).toEqual([null, 's-rain', 's-rain', 's-rain', 's-rain'])
    // Nor is it made.
    expect(soundsAhead([rain, { ...fire, muted: true }, door], paragraphs, 'p1', 0).map((c) => c.id)).toEqual(['rain', 'door'])
  })

  it('plays nothing in a muted scene', () => {
    const out = clipSounds(clips, [rain, fire, door, thunder], paragraphs, { muted: true })
    expect(out.every((c) => c.bed === null && c.sounds === undefined && c.bedVolume === undefined)).toBe(true)
    expect(out.map((c) => c.key)).toEqual(clips.map((c) => c.key))
  })

  it('shows Adam’s volume and mute, and a sound’s new take', () => {
    const edits: SoundEdits = {
      owned: {
        p2: [
          { id: 'adam:1', kind: 'effect', description: 'door', soundId: '', at: on('p2', 'slammed'), origin: 'adam', volume: 1.7, muted: true },
          { id: 'adam:2', kind: 'effect', description: 'crackle', soundId: '', at: on('p2', 'fire'), origin: 'adam', volume: 9 }
        ]
      }
    }
    const cues = sceneCues({
      paragraphs,
      ai: new Map(),
      edits,
      sound: (_kind, description) => ({ id: `id-${description}`, state: 'ready', retake: description === 'door' ? 'ready' : null })
    })
    expect(cues.map((c) => [c.id, c.volume, c.muted, c.retake])).toEqual([
      ['adam:2', 2, undefined, null],
      ['adam:1', 1.7, true, 'ready']
    ])
  })

  it('keeps volumes between the softest and loudest', () => {
    expect([0.1, 0.25, 1, 1.234, 2, 5, Number.NaN, 'x'].map(cleanVolume)).toEqual([0.25, 0.25, 1, 1.23, 2, 2, 1, 1])
  })
})
