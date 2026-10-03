import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClipSound, PlannedClip } from '@shared/contracts/readAloud'

// The reading's sounds against a stand-in mixer, the speech server's times and Settings.
const calls: string[] = []
let bedWanted: string | null = null
const times = vi.fn<(req: { at: number[] }) => Promise<{ seconds: number[]; aligned: boolean }>>()
let soundEffects = true
/** Clips whose speech the reading has (or is getting), by key; all of them unless a test says. */
let speechFor: ((key: string) => boolean) | null = null
const spoken = vi.fn(() => Promise.resolve('blob:clip'))

vi.mock('./mixer', () => ({
  mixer: {
    load: vi.fn(() => Promise.resolve(null)),
    setBed: (id: string | null) => {
      bedWanted = id || null
      calls.push(`bed ${id ?? 'none'}`)
    },
    bedEdge: (sound: ClipSound, bed: string | null, delay: number) => {
      bedWanted = bed
      calls.push(`${sound.edge} ${bed ?? 'none'} +${delay.toFixed(2)}`)
    },
    fire: (sound: ClipSound, delay: number) => calls.push(`fire ${sound.soundId} +${delay.toFixed(2)}`),
    duck: (on: boolean) => calls.push(on ? 'duck' : 'unduck'),
    pause: () => calls.push('pause'),
    resume: () => calls.push('resume'),
    stop: () => calls.push('stop'),
    get bedWanted() {
      return bedWanted
    }
  }
}))
vi.mock('@/lib/api', () => ({ api: { soundCueTimes: (req: { at: number[] }) => times(req) } }))
vi.mock('@/lib/store', () => ({ useApp: { getState: () => ({ settings: { speech: { soundEffects } } }) } }))
vi.mock('@/features/readAloud/audio', () => ({
  clipAudio: () => spoken(),
  hasAudio: (key: string) => (speechFor ? speechFor(key) : true)
}))

const { ReadingSounds } = await import('./readingSounds')

const TEXT = 'Rain hammered the tin roof. Then the door slammed shut.'

const clip = (over: Partial<PlannedClip>): PlannedClip => ({
  key: 'k1',
  pid: 'p1',
  from: 0,
  to: TEXT.length,
  sentences: [[0, TEXT.length]],
  who: 'Narrator',
  how: '',
  restMs: 0,
  waits: false,
  clip: { input: TEXT, voice: 'narrator', voiceDesign: '', instruct: '', delivery: '', pace: '', gentle: false, sounds: false },
  ...over
})

/** The audio element, as far as the sounds look at it. */
const media = (duration = 4): { currentTime: number; duration: number; paused: boolean; playbackRate: number } => ({
  currentTime: 0,
  duration,
  paused: false,
  playbackRate: 1
})

const flush = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  calls.length = 0
  bedWanted = null
  soundEffects = true
  speechFor = null
  spoken.mockClear()
  times.mockReset()
})
afterEach(() => vi.useRealTimers())

describe('sounds during a reading', () => {
  it('puts the clip’s ambience on as it shows, and keeps it on through the next clip that starts in it', () => {
    const s = new ReadingSounds(() => new Map([['p1', TEXT]]))
    s.shown(clip({ bed: 'rain' }))
    s.shown(clip({ key: 'k2', bed: 'rain' }))
    s.shown(clip({ key: 'k3', bed: null }))
    expect(calls).toEqual(['bed rain', 'bed rain', 'bed none'])
  })

  it('fires an effect on its word by the speech server’s times, dipping the ambience while the voice speaks', async () => {
    times.mockResolvedValue({ seconds: [3], aligned: true })
    const sounds: ClipSound[] = [{ cueId: 'c1', soundId: 'door', edge: 'fire', at: TEXT.indexOf('slammed') }]
    const s = new ReadingSounds(() => new Map([['p1', TEXT]]))
    const c = clip({ sounds })
    s.shown(c)
    await flush()
    const m = media()
    s.playing(c, m as unknown as HTMLAudioElement)
    expect(times).toHaveBeenCalledWith(expect.objectContaining({ text: TEXT, from: 0, to: TEXT.length, at: [TEXT.indexOf('slammed')] }))
    m.currentTime = 2.5
    vi.advanceTimersByTime(30)
    expect(calls.filter((c) => c.startsWith('fire'))).toEqual([])
    m.currentTime = 2.97
    vi.advanceTimersByTime(30)
    expect(calls).toContain('fire door +0.03')
    // Once only.
    m.currentTime = 3.2
    vi.advanceTimersByTime(60)
    expect(calls.filter((c) => c.startsWith('fire'))).toHaveLength(1)
    s.done(true)
    expect(calls.slice(-1)).toEqual(['unduck'])
    expect(calls).toContain('duck')
  })

  it('stays right at double speed', async () => {
    times.mockResolvedValue({ seconds: [3], aligned: true })
    const s = new ReadingSounds(() => new Map([['p1', TEXT]]))
    const c = clip({ sounds: [{ cueId: 'c1', soundId: 'door', edge: 'fire', at: 40 }] })
    s.shown(c)
    await flush()
    const m = { ...media(), playbackRate: 2 }
    s.playing(c, m as unknown as HTMLAudioElement)
    // 0.1 s of the clip before its word is 0.05 s on the clock.
    m.currentTime = 2.9
    vi.advanceTimersByTime(30)
    expect(calls).toContain('fire door +0.05')
  })

  it('estimates by the words until the times come, and holds still while paused', async () => {
    times.mockReturnValue(new Promise(() => undefined))
    const s = new ReadingSounds(() => new Map([['p1', TEXT]]))
    const at = TEXT.length / 2
    const c = clip({ sounds: [{ cueId: 'c1', soundId: 'door', edge: 'fire', at }] })
    s.shown(c)
    const m = media(4)
    s.playing(c, m as unknown as HTMLAudioElement)
    m.currentTime = 1.5
    m.paused = true
    vi.advanceTimersByTime(90)
    expect(calls.some((c) => c.startsWith('fire'))).toBe(false)
    m.paused = false
    m.currentTime = 1.99
    vi.advanceTimersByTime(30)
    expect(calls.some((c) => c.startsWith('fire door'))).toBe(true)
  })

  it('starts and ends an ambience on its words, and an end fades only the ambience it ends', async () => {
    times.mockResolvedValue({ seconds: [1, 2, 3], aligned: true })
    const s = new ReadingSounds(() => new Map([['p1', TEXT]]))
    const c = clip({
      bed: null,
      sounds: [
        { cueId: 'a', soundId: 'rain', edge: 'start', at: 0 },
        { cueId: 'b', soundId: 'harbour', edge: 'end', at: 10 },
        { cueId: 'a', soundId: 'rain', edge: 'end', at: 20 }
      ]
    })
    s.shown(c)
    await flush()
    const m = media()
    s.playing(c, m as unknown as HTMLAudioElement)
    for (const t of [1, 2, 3]) {
      m.currentTime = t
      vi.advanceTimersByTime(30)
    }
    expect(calls.filter((x) => x.startsWith('start') || x.startsWith('end'))).toEqual(['start rain +0.00', 'end none +0.00'])
  })

  it('plays what a clip still owed when it ends, but not when it was cut off', async () => {
    times.mockResolvedValue({ seconds: [9], aligned: true })
    const s = new ReadingSounds(() => new Map([['p1', TEXT]]))
    const c = clip({ sounds: [{ cueId: 'c1', soundId: 'door', edge: 'fire', at: 40 }] })
    s.shown(c)
    await flush()
    s.playing(c, media() as unknown as HTMLAudioElement)
    s.done(true)
    expect(calls).toContain('fire door +0.00')

    calls.length = 0
    const c2 = clip({ key: 'k2', sounds: [{ cueId: 'c1', soundId: 'door', edge: 'fire', at: 40 }] })
    s.shown(c2)
    await flush()
    s.playing(c2, media() as unknown as HTMLAudioElement)
    s.done(false)
    expect(calls.some((x) => x.startsWith('fire'))).toBe(false)
  })

  it('leaves the ambience for the next scene at the end, and fades everything on Stop', () => {
    const s = new ReadingSounds(() => new Map())
    s.shown(clip({ bed: 'rain' }))
    s.ended()
    s.stop()
    expect(calls).not.toContain('stop')
    const t = new ReadingSounds(() => new Map())
    t.shown(clip({ bed: 'rain' }))
    t.stop()
    expect(calls).toContain('stop')
  })

  it('times only clips whose speech the reading already has or is getting, never one waiting or failed', async () => {
    times.mockResolvedValue({ seconds: [1], aligned: true })
    const sounds: ClipSound[] = [{ cueId: 'c1', soundId: 'door', edge: 'fire', at: 3 }]
    speechFor = (key) => key === 'have' || key === 'failed' || key === 'waits'
    const s = new ReadingSounds(() => new Map([['p1', TEXT]]))
    s.prepare(
      [
        clip({ key: 'have', sounds }),
        clip({ key: 'later', sounds }),
        clip({ key: 'waits', waits: true, sounds }),
        clip({ key: 'failed', sounds })
      ],
      new Set(['failed'])
    )
    await flush()
    expect(times).toHaveBeenCalledTimes(1)
    // Nothing here asks for speech of its own: only the clip the reading is getting was waited on.
    expect(spoken).toHaveBeenCalledTimes(1)
    // Once the reading has the next clip's speech, it is timed then.
    speechFor = () => true
    s.prepare([clip({ key: 'later', sounds })])
    await flush()
    expect(times).toHaveBeenCalledTimes(2)
  })

  it('runs the sounds’ clock whenever the voice plays, and at the end of a scene', () => {
    const s = new ReadingSounds(() => new Map())
    const c = clip({ bed: 'rain' })
    s.shown(c)
    s.playing(c, media() as unknown as HTMLAudioElement)
    expect(calls).toEqual(['bed rain', 'resume', 'duck'])
    calls.length = 0
    s.ended()
    expect(calls).toEqual(['resume', 'unduck'])
  })

  it('does nothing while sound effects are off, and stops them when they are turned off', () => {
    soundEffects = false
    const s = new ReadingSounds(() => new Map([['p1', TEXT]]))
    const c = clip({ bed: 'rain', sounds: [{ cueId: 'c1', soundId: 'door', edge: 'fire', at: 0 }] })
    s.prepare([c])
    s.shown(c)
    s.playing(c, media() as unknown as HTMLAudioElement)
    vi.advanceTimersByTime(100)
    s.done(true)
    expect(calls).toEqual([])
    expect(times).not.toHaveBeenCalled()

    soundEffects = true
    s.shown(c)
    soundEffects = false
    s.settingsChanged()
    expect(calls.slice(-1)).toEqual(['stop'])
  })
})
