import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SceneCue } from '@shared/contracts/sounds'
import { readAloudReply, SOUND_DOOR, SOUND_RAIN } from '../../../tests/fake-provider/m4/readAloud.mjs'
import type { Ask } from '../readAloud/marks'
import { MARK_FIRST } from '../readAloud/speakers'
import { aiCueId, cuesFromReply, MAX_PER_PARAGRAPH, SoundMarker, soundParts, SoundStore, type SoundScene } from './marks'
import { parseSounds, type PromptParagraph, type SaidSound } from './prompt'
import { sceneCues, type MarkedCue, type Paragraph } from './scene'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aw-sound-marks-'))
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

const part: PromptParagraph[] = [
  { pid: 'a', text: 'Rain hammered the roof of the inn.', owned: false },
  { pid: 'b', text: 'Inside, Mara waited by the fire.', owned: true },
  { pid: 'c', text: 'The door slammed shut behind Tobin. He shook off the rain.', owned: false },
  { pid: 'd', text: 'They went up to bed.', owned: false }
]

describe('the AI’s sound marks kept for a scene', () => {
  const cue = (pid: string, text: string): MarkedCue => ({
    id: aiCueId(pid, 'h', 'bang', 0),
    kind: 'effect',
    description: 'bang',
    at: { pid, from: 0, to: text.indexOf(' '), words: text.slice(0, text.indexOf(' ')) },
    until: null
  })

  it('gives back only the marks of paragraphs whose words are unchanged, empty ones too', () => {
    const store = new SoundStore(dir)
    const scene: Paragraph[] = [
      { pid: 'p1', text: 'The gun fired.' },
      { pid: 'p2', text: 'Nothing here.' }
    ]
    store.save('w1', 's1', [{ pid: 'p1', text: scene[0]!.text, cues: [cue('p1', scene[0]!.text)] }, { pid: 'p2', text: scene[1]!.text, cues: [] }], scene)
    const now = store.current('w1', 's1', [scene[0]!, { pid: 'p2', text: 'Something here.' }])
    expect([...now.keys()]).toEqual(['p1'])
    expect(store.current('w1', 's1', scene).get('p2')).toEqual([])
  })

  it('drops marks for paragraphs that changed or went, and never writes outside its folder', () => {
    const store = new SoundStore(dir)
    store.save('w1', 's1', [{ pid: 'p1', text: 'One.', cues: [] }], [{ pid: 'p1', text: 'One.' }])
    store.save('w1', 's1', [{ pid: 'p2', text: 'Two.', cues: [] }], [{ pid: 'p2', text: 'Two.' }], new Set(['p2']))
    expect(Object.keys(store.load('w1', 's1'))).toEqual(['p2'])
    // Marks made for words a paragraph no longer has aren't kept.
    store.save('w1', 's1', [{ pid: 'p3', text: 'Old.', cues: [] }], [{ pid: 'p3', text: 'New.' }])
    expect(Object.keys(store.load('w1', 's1'))).toEqual(['p2'])
    const other = new SoundStore(join(dir, 'other'))
    other.save('../x', 's1', [{ pid: 'p1', text: 'One.', cues: [] }], [{ pid: 'p1', text: 'One.' }])
    expect(readdirSync(dir)).toEqual(['w1'])
  })
})

describe('the AI’s reply as sounds', () => {
  const said = (s: Partial<SaidSound>): SaidSound => ({ type: 'effect', sound: 'x', p: 1, at: '', word: '', ...s })

  it('places each sound on its word, and records every paragraph asked about', () => {
    const got = cuesFromReply(
      [
        said({ type: 'ambience', sound: 'steady rain on a roof', p: 1, at: 'Rain hammered', word: 'Rain' }),
        said({ sound: 'a door slamming', p: 2, at: 'The door slammed shut', word: 'slammed', seconds: 2 })
      ],
      part,
      null
    )
    expect([...got.cues.keys()]).toEqual(['a', 'c', 'd'])
    expect(got.cues.get('a')).toEqual([
      { id: expect.stringMatching(/^ai:[0-9a-f]{16}$/), kind: 'ambience', description: 'steady rain on a roof', at: { pid: 'a', from: 0, to: 4, words: 'Rain' }, until: null }
    ])
    expect(got.cues.get('c')![0]).toMatchObject({ kind: 'effect', seconds: 2, at: { pid: 'c', from: 9, to: 16, words: 'slammed' } })
    expect(got.cues.get('d')).toEqual([])
  })

  it('doesn’t start the ambience already playing again, and drops what it can’t place', () => {
    const playing = { id: 'ai:old', kind: 'ambience', description: 'Steady rain on the roof', at: { pid: 'z', from: 0, to: 1, words: 'x' }, origin: 'ai' } as SceneCue
    const got = cuesFromReply(
      [said({ type: 'ambience', sound: 'steady rain on a roof', p: 1, word: 'Rain' }), said({ p: 3, word: 'gunshot' }), said({ p: 9, word: 'Rain' })],
      part,
      playing
    )
    expect([...got.cues.values()].flat()).toEqual([])
  })

  it('ends an ambience where the AI says, its own or the one playing before', () => {
    const got = cuesFromReply(
      [said({ type: 'ambience', sound: 'rain on a roof', p: 1, word: 'Rain', until: { p: 2, at: '', word: 'Tobin' } })],
      part,
      null
    )
    expect(got.cues.get('a')![0]!.until).toMatchObject({ pid: 'c', words: 'Tobin' })
    expect(got.cues.get('a')![0]!.untilHash).toMatch(/^[0-9a-f]{20}$/)
    const own = cuesFromReply([said({ type: 'ambience', sound: 'rain', p: 1, word: 'Rain' }), said({ type: 'stop', p: 3, word: 'bed' })], part, null)
    expect(own.cues.get('a')![0]!.until).toMatchObject({ pid: 'd', words: 'bed' })
    const playing = { id: 'ai:old', kind: 'ambience', description: 'wind', at: { pid: 'z', from: 0, to: 1, words: 'x' }, origin: 'ai' } as SceneCue
    const before = cuesFromReply([said({ type: 'stop', p: 3, word: 'bed' })], part, playing)
    expect(before.ends).toMatchObject({ pid: 'z', cueId: 'ai:old', until: { pid: 'd', words: 'bed' } })
    // Adam's ambience is his: the AI doesn't end it.
    expect(cuesFromReply([said({ type: 'stop', p: 3, word: 'bed' })], part, { ...playing, origin: 'adam' }).ends).toBeUndefined()
  })

  it('keeps at most a couple of sounds in a paragraph', () => {
    const many = ['door', 'slammed', 'shut', 'behind'].map((word) => said({ sound: `a ${word}`, p: 2, word }))
    expect(cuesFromReply(many, part, null).cues.get('c')).toHaveLength(MAX_PER_PARAGRAPH)
  })

  it('gives a sound the same id while its paragraph’s words are the same', () => {
    expect(aiCueId('p', 'h', 'A door slamming', 3)).toBe(aiCueId('p', 'h', 'a door slamming.', 3))
    expect(aiCueId('p', 'h', 'a door slamming', 3)).not.toBe(aiCueId('p', 'h2', 'a door slamming', 3))
  })
})

describe('the parts of a scene the AI is asked about', () => {
  const scene: Paragraph[] = Array.from({ length: 8 }, (_, i) => ({ pid: `p${i + 1}`, text: `${'word '.repeat(80)}${i + 1}.` }))

  it('starts at the first paragraph wanted, shows the others between as context, and ends on one wanted', () => {
    const parts = soundParts(scene, new Set(['p2', 'p4']), 5000, 5000)
    expect(parts).toHaveLength(1)
    expect(parts[0]!.paragraphs.map((p) => [p.pid, p.owned])).toEqual([
      ['p2', false],
      ['p3', true],
      ['p4', false]
    ])
    expect(parts[0]!.before).toBe(scene[0]!.text)
  })

  it('makes a small first part, then parts of the usual size', () => {
    const all = new Set(scene.map((p) => p.pid))
    const parts = soundParts(scene, all, 900, 1300)
    expect(parts.map((p) => p.paragraphs.map((q) => q.pid))).toEqual([['p1', 'p2'], ['p3', 'p4', 'p5'], ['p6', 'p7', 'p8']])
  })
})

/** A SoundMarker whose AI is the fake provider (or `answer`), with what it was asked and told. */
function harness(answer?: (call: Parameters<Ask>[0]) => Promise<{ text: string | null; error: string | null }>) {
  const store = new SoundStore(dir)
  const asked: Parameters<Ask>[0][] = []
  const done: string[][] = []
  const found: string[] = []
  let stops = 0
  const marker = new SoundMarker({
    store,
    ask: () => ({
      call: async (call) => {
        asked.push(call)
        return answer ? answer(call) : { text: readAloudReply(call.system, [{ role: 'user', content: call.user }]), error: null }
      },
      stop: () => void stops++
    }),
    library: () => [{ kind: 'effect', description: SOUND_DOOR }],
    cuesOf: (s) => sceneCues({ paragraphs: s.paragraphs, ai: store.current(s.worldId, s.sceneId, s.paragraphs), edits: null, sound: () => null }),
    done: (_sceneId, pids) => done.push(pids),
    found: (_s, cues) => found.push(...cues.map((c) => c.description))
  })
  return { store, marker, asked, done, found, stops: () => stops }
}

const story: Paragraph[] = [
  { pid: 'p1', text: 'The rain fell on the tin roof all night.' },
  { pid: 'p2', text: 'Mara sat by the window and waited for him.' },
  { pid: 'p3', text: 'At last the door slammed shut downstairs.' },
  { pid: 'p4', text: 'She went down to meet him.' }
]
const scene = (o: Partial<SoundScene> = {}): SoundScene => ({ worldId: 'w1', sceneId: 's1', paragraphs: story, run: story.map((p) => p.pid), owned: new Set(), ...o })

describe('marking sounds as reading goes', () => {
  it('marks the part ahead of a new reading, keeps what it found, and says so', async () => {
    const h = harness()
    h.marker.note(scene())
    expect(h.marker.busyIn('w1', 's1')).toEqual(new Set(['p1', 'p2', 'p3', 'p4']))
    await vi.waitFor(() => expect(h.done).toHaveLength(1))
    expect(h.asked[0]!.system.startsWith('[AIWRITE-READ-ALOUD v1] sounds')).toBe(true)
    expect(h.asked[0]!.user).toContain(`- effect: ${SOUND_DOOR}`)
    expect(h.done[0]).toEqual(['p1', 'p2', 'p3', 'p4'])
    expect(h.found).toEqual([SOUND_RAIN, SOUND_DOOR])
    const kept = h.store.current('w1', 's1', story)
    expect(kept.get('p2')).toEqual([])
    expect(kept.get('p3')![0]).toMatchObject({ kind: 'effect', description: SOUND_DOOR, at: { words: 'slammed' } })
    expect(h.marker.busyIn('w1', 's1').size).toBe(0)
    // Marked: not asked again.
    h.marker.note(scene())
    expect(h.asked).toHaveLength(1)
  })

  it('leaves Adam’s paragraphs alone', async () => {
    const h = harness()
    h.marker.note(scene({ owned: new Set(['p3']) }))
    await vi.waitFor(() => expect(h.done).toHaveLength(1))
    expect(h.asked[0]!.user).toContain('[--] At last the door slammed shut downstairs.')
    expect(h.found).toEqual([SOUND_RAIN])
    expect(h.store.current('w1', 's1', story).has('p3')).toBe(false)
  })

  it('asks the next part in turn, telling it what the last left playing', async () => {
    const long: Paragraph[] = Array.from({ length: 12 }, (_, i) => ({ pid: `q${i}`, text: `${i === 0 ? 'The rain began. ' : ''}${'Quiet words go by. '.repeat(30)}` }))
    const h = harness()
    const { again } = h.marker.note({ ...scene(), paragraphs: long, run: long.map((p) => p.pid) })
    await vi.waitFor(() => expect(h.asked).toHaveLength(2))
    expect(h.asked[1]!.user).toContain(`Playing as this passage starts: the ambience "${SOUND_RAIN}".`)
    // Where the reading should ask again: a little before the first paragraph not yet asked about.
    expect(again?.pid).toBeDefined()
    expect(long.findIndex((p) => p.pid === again!.pid)).toBeGreaterThan(1)
  })

  it('waits until the reading is near paragraphs that need marks', () => {
    const h = harness()
    const far = [{ pid: 'x', text: 'A'.repeat(MARK_FIRST * 3) }, ...story]
    h.store.save('w1', 's1', [{ pid: 'x', text: far[0]!.text, cues: [] }], far)
    const { again } = h.marker.note(scene({ paragraphs: far, run: far.map((p) => p.pid) }))
    expect(h.asked).toEqual([])
    expect(again).toEqual({ pid: 'x', at: MARK_FIRST * 2 })
  })

  it('is quiet when marking fails, and doesn’t ask again for a while', async () => {
    const h = harness(async () => ({ text: null, error: 'The read aloud model turned this down.' }))
    h.marker.note(scene())
    await vi.waitFor(() => expect(h.marker.busyIn('w1', 's1').size).toBe(0))
    expect(h.done).toEqual([])
    h.marker.note(scene())
    expect(h.asked).toHaveLength(1)
    // Find sounds asks again at once.
    h.marker.forgive('w1', 's1')
    h.marker.noteAll(scene(), new Set(story.map((p) => p.pid)))
    expect(h.asked).toHaveLength(2)
  })

  it('drops the reply when the reading stops', async () => {
    let reply: (v: { text: string | null; error: string | null }) => void = () => undefined
    const h = harness(() => new Promise((r) => (reply = r)))
    h.marker.note(scene())
    h.marker.stop('w1', 's1')
    expect(h.stops()).toBe(1)
    reply({ text: '{"sounds":[]}', error: null })
    await new Promise((r) => setTimeout(r, 0))
    expect(h.done).toEqual([])
    expect(h.store.load('w1', 's1')).toEqual({})
  })

  it('says why when the AI can’t be asked', () => {
    const marker = new SoundMarker({
      store: new SoundStore(dir),
      ask: () => ({ error: 'Choose a writer model first, in Settings › Models.' }),
      library: () => [],
      cuesOf: () => [],
      done: () => undefined,
      found: () => undefined
    })
    expect(marker.noteAll(scene(), new Set(['p1'])).error).toBe('Choose a writer model first, in Settings › Models.')
  })

  it('marks a new draft’s paragraphs in the background, from the fake provider’s reply', async () => {
    const h = harness()
    h.marker.noteAll(scene({ run: [] }), new Set(['p3']))
    await vi.waitFor(() => expect(h.done).toHaveLength(1))
    expect(h.done[0]).toEqual(['p3'])
    expect(parseSounds(readAloudReply(h.asked[0]!.system, [{ role: 'user', content: h.asked[0]!.user }])!)[0]).toMatchObject({ sound: SOUND_DOOR, p: 1 })
  })
})
